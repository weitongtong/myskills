#!/usr/bin/env node

import {
  CHANGE_LOG_FILE,
  CREDITS_FILE,
  LOGS_FILE,
  SYNC_STATE_FILE,
  callManusApi,
  ensureDataDir,
  finalizeScript,
  makeSuccess,
  parseCommonArgs,
  printJson,
  readJson,
  writeJson,
} from './lib.mjs';

const PAGE_SIZE = 50;

function matchKey(record) {
  if (record.sessionId) return record.sessionId;
  return `${record.createAt}:${record.title}`;
}

function pickLogFields(record) {
  const picked = {
    title: record.title,
    createAt: record.createAt,
    type: record.type,
    credits: record.credits,
  };
  if (record.sessionId) picked.sessionId = record.sessionId;
  return picked;
}

function sortLogs(records) {
  return [...records].sort((a, b) => (b.createAt || 0) - (a.createAt || 0));
}

async function main() {
  const { json } = parseCommonArgs();
  ensureDataDir();

  const existingLogs = readJson(LOGS_FILE, []);
  const localIndex = new Map();
  for (const record of existingLogs) {
    localIndex.set(matchKey(record), { ...record });
  }

  const isFirstRun = existingLogs.length === 0;
  if (!json) {
    console.log(
      `[sync] 本地记录数: ${existingLogs.length}${isFirstRun ? '（首次运行，将全量拉取）' : ''}`,
    );
  }

  const changes = [];
  let page = 1;
  let stopScanning = false;

  while (!stopScanning) {
    if (!json) console.log(`[sync] 拉取第 ${page} 页...`);

    const result = await callManusApi('ListUserCreditsLog', {
      page,
      pageSize: PAGE_SIZE,
    });
    const items = result.logs || [];

    if (items.length === 0) break;

    let pageUnchangedCount = 0;

    for (const apiRecord of items) {
      const key = matchKey(apiRecord);
      const localRecord = localIndex.get(key);

      if (!localRecord) {
        changes.push({
          ...pickLogFields(apiRecord),
          previousCredits: 0,
          delta: apiRecord.credits,
          action: 'new',
        });
        localIndex.set(key, { ...pickLogFields(apiRecord) });
      } else if (localRecord.credits !== apiRecord.credits) {
        changes.push({
          ...pickLogFields(apiRecord),
          previousCredits: localRecord.credits,
          delta: apiRecord.credits - localRecord.credits,
          action: 'update',
        });
        localIndex.set(key, { ...localRecord, ...pickLogFields(apiRecord) });
      } else {
        pageUnchangedCount++;
      }
    }

    if (!isFirstRun && pageUnchangedCount === items.length) {
      if (!json) console.log(`[sync] 第 ${page} 页全部无变化，停止扫描`);
      stopScanning = true;
    }

    if (items.length < PAGE_SIZE) break;
    page++;
  }

  const credits = await callManusApi('GetAvailableCredits', {});
  const syncedAt = new Date().toISOString();

  writeJson(CREDITS_FILE, {
    updatedAt: syncedAt,
    credits,
  });
  writeJson(SYNC_STATE_FILE, { lastSyncAt: syncedAt });

  let totalLogs = existingLogs.length;
  if (changes.length > 0) {
    const updatedLogs = sortLogs(Array.from(localIndex.values()));
    const changeLog = readJson(CHANGE_LOG_FILE, []);

    writeJson(LOGS_FILE, updatedLogs);
    changeLog.push({
      syncAt: syncedAt,
      reported: false,
      changes,
    });
    writeJson(CHANGE_LOG_FILE, changeLog);
    totalLogs = updatedLogs.length;

    if (!json) {
      console.log(`[sync] 发现 ${changes.length} 条变化（新增/更新）`);
      console.log(`[sync] 同步完成，本地共 ${updatedLogs.length} 条记录，变更已记入 change_log`);
    }
  } else if (!json) {
    console.log('[sync] 无变化');
    console.log('[sync] 积分快照已更新');
  }

  if (json) {
    printJson(makeSuccess({
      message: changes.length > 0 ? '同步完成' : '无变化，积分余额已刷新',
      changesCount: changes.length,
      totalLogs,
      lastSyncAt: syncedAt,
      credits,
    }));
  }
}

main().catch(error => {
  finalizeScript(error, parseCommonArgs().json, err => `[sync] 未预期的错误: ${err.message}`);
});
