#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = join(__dirname, '..');
const DATA_DIR = join(BASE_DIR, 'data');
const CHANGE_LOG_FILE = join(DATA_DIR, 'change_log.json');
const TOKEN_FILE = join(BASE_DIR, '.token');

// const REPORT_URL = 'http://localhost:8086/manus-credit-log/upload';
const REPORT_URL = 'http://101.126.66.51:8086/manus-credit-log/upload';
const BATCH_SIZE = 50;

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}

function getUserInfo() {
  if (!existsSync(TOKEN_FILE)) {
    console.error(JSON.stringify({ error: 'token_not_found', message: 'Token 文件不存在' }));
    process.exit(1);
  }
  const token = readFileSync(TOKEN_FILE, 'utf-8').trim();
  const payload = decodeJwtPayload(token);
  return {
    email: payload.email,
    name: payload.name,
    userId: payload.user_id,
  };
}

function collectSyncEvents(entries) {
  return entries.map(e => ({
    syncAt: e.syncAt,
    changes: e.changes,
  }));
}

function batchSyncEvents(syncEvents) {
  const batches = [];
  let currentBatch = [];
  let currentCount = 0;

  for (const event of syncEvents) {
    if (currentCount + event.changes.length > BATCH_SIZE && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentCount = 0;
    }
    currentBatch.push(event);
    currentCount += event.changes.length;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

async function uploadBatch(user, syncEvents) {
  const res = await fetch(REPORT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user, syncEvents }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

async function main() {
  const changeLog = readJson(CHANGE_LOG_FILE, []);
  const unreportedIndices = [];

  for (let i = 0; i < changeLog.length; i++) {
    if (!changeLog[i].reported) {
      unreportedIndices.push(i);
    }
  }

  if (unreportedIndices.length === 0) {
    console.log('[report] 无未上报的变更，跳过');
    process.exit(0);
  }

  const unreportedEntries = unreportedIndices.map(i => changeLog[i]);
  const totalChanges = unreportedEntries.reduce((sum, e) => sum + e.changes.length, 0);
  console.log(`[report] 待上报 ${unreportedEntries.length} 个同步事件（共 ${totalChanges} 条变更）`);

  const user = getUserInfo();
  console.log(`[report] 用户: ${user.name} (${user.email})`);

  const syncEvents = collectSyncEvents(unreportedEntries);
  const batches = batchSyncEvents(syncEvents);

  let reportedEventCount = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchChanges = batch.reduce((sum, e) => sum + e.changes.length, 0);
    console.log(`[report] 上报第 ${b + 1}/${batches.length} 批（${batch.length} 个事件，${batchChanges} 条变更）...`);

    try {
      await uploadBatch(user, batch);

      for (const event of batch) {
        const idx = unreportedIndices[reportedEventCount];
        changeLog[idx].reported = true;
        reportedEventCount++;
      }
      writeJson(CHANGE_LOG_FILE, changeLog);

      console.log(`[report] 第 ${b + 1} 批上报成功`);
    } catch (err) {
      console.error(`[report] 第 ${b + 1} 批上报失败: ${err.message}`);
      console.error(`[report] 已成功 ${reportedEventCount}/${unreportedEntries.length} 个事件，下次运行将继续`);
      process.exit(4);
    }
  }

  console.log(`[report] 全部上报完成，共 ${reportedEventCount} 个同步事件`);
}

main().catch(err => {
  console.error(`[report] 未预期的错误: ${err.message}`);
  process.exit(1);
});
