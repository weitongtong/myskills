#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = join(__dirname, '..');
const DATA_DIR = join(BASE_DIR, 'data');
const LOGS_FILE = join(DATA_DIR, 'logs.json');
const CHANGE_LOG_FILE = join(DATA_DIR, 'change_log.json');
const SYNC_STATE_FILE = join(DATA_DIR, 'sync_state.json');
const TOKEN_FILE = join(BASE_DIR, '.token');

const API_BASE = 'https://api.manus.im/user.v1.UserService';
const PAGE_SIZE = 50;

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

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

function getToken() {
  if (!existsSync(TOKEN_FILE)) {
    console.error(JSON.stringify({ error: 'token_not_found', message: 'Token 文件不存在，请先刷新 token' }));
    process.exit(1);
  }
  return readFileSync(TOKEN_FILE, 'utf-8').trim();
}

function matchKey(record) {
  if (record.sessionId) return record.sessionId;
  return `${record.createAt}:${record.title}`;
}

async function callApi(endpoint, body = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'connect-protocol-version': '1',
    },
    body: JSON.stringify(body),
  });

  if (res.status === 401) {
    console.error(JSON.stringify({ error: 'token_expired', message: 'Manus token 已过期，请按 SKILL.md 中的指引刷新 token' }));
    process.exit(2);
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(JSON.stringify({ error: 'api_error', http_code: res.status, body: text }));
    process.exit(3);
  }

  return res.json();
}

async function main() {
  ensureDataDir();

  const logs = readJson(LOGS_FILE, []);
  const localIndex = new Map();
  for (const record of logs) {
    localIndex.set(matchKey(record), record);
  }

  const isFirstRun = logs.length === 0;
  console.log(`[sync] 本地记录数: ${logs.length}${isFirstRun ? '（首次运行，将全量拉取）' : ''}`);

  const changes = [];
  let page = 1;
  let stopScanning = false;

  while (!stopScanning) {
    console.log(`[sync] 拉取第 ${page} 页...`);
    const result = await callApi('ListUserCreditsLog', { page, pageSize: PAGE_SIZE });
    const items = result.logs || [];

    if (items.length === 0) break;

    let pageUnchangedCount = 0;

    for (const apiRecord of items) {
      const key = matchKey(apiRecord);
      const localRecord = localIndex.get(key);

      if (!localRecord) {
        changes.push({
          ..._pickFields(apiRecord),
          previousCredits: 0,
          delta: apiRecord.credits,
          action: 'new',
        });
        localIndex.set(key, apiRecord);
      } else if (localRecord.credits !== apiRecord.credits) {
        changes.push({
          ..._pickFields(apiRecord),
          previousCredits: localRecord.credits,
          delta: apiRecord.credits - localRecord.credits,
          action: 'update',
        });
        Object.assign(localRecord, apiRecord);
      } else {
        pageUnchangedCount++;
      }
    }

    if (!isFirstRun && pageUnchangedCount === items.length) {
      console.log(`[sync] 第 ${page} 页全部无变化，停止扫描`);
      stopScanning = true;
    }

    if (items.length < PAGE_SIZE) break;
    page++;
  }

  if (changes.length === 0) {
    console.log('[sync] 无变化');
    writeJson(SYNC_STATE_FILE, { lastSyncAt: new Date().toISOString() });
    return;
  }

  console.log(`[sync] 发现 ${changes.length} 条变化（新增/更新）`);

  const updatedLogs = Array.from(localIndex.values());
  writeJson(LOGS_FILE, updatedLogs);

  const changeLog = readJson(CHANGE_LOG_FILE, []);
  changeLog.push({
    syncAt: new Date().toISOString(),
    reported: false,
    changes,
  });
  writeJson(CHANGE_LOG_FILE, changeLog);

  writeJson(SYNC_STATE_FILE, { lastSyncAt: new Date().toISOString() });

  console.log(`[sync] 同步完成，本地共 ${updatedLogs.length} 条记录，变更已记入 change_log`);
}

function _pickFields(record) {
  const picked = {
    title: record.title,
    createAt: record.createAt,
    type: record.type,
    credits: record.credits,
  };
  if (record.sessionId) picked.sessionId = record.sessionId;
  return picked;
}

main().catch(err => {
  console.error(`[sync] 未预期的错误: ${err.message}`);
  process.exit(1);
});
