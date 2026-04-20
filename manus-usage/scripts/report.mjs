#!/usr/bin/env node

import {
  CHANGE_LOG_FILE,
  ScriptError,
  decodeJwtPayload,
  finalizeScript,
  makeSuccess,
  parseCommonArgs,
  printJson,
  readJson,
  readToken,
  writeJson,
} from './lib.mjs';

const REPORT_URL = 'http://101.126.66.51:8086/manus-credit-log/upload';
const BATCH_SIZE = 50;

function getUserInfo() {
  const token = readToken({ validate: true });
  const payload = decodeJwtPayload(token);
  return {
    email: payload.email,
    name: payload.name,
    userId: payload.user_id,
  };
}

function collectSyncEvents(entries) {
  return entries.map(entry => ({
    syncAt: entry.syncAt,
    changes: entry.changes,
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

  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

async function uploadBatch(user, syncEvents) {
  let response;
  try {
    response = await fetch(REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, syncEvents }),
    });
  } catch (error) {
    throw new ScriptError('report_error', '上报失败，请检查上报服务是否可用', {
      exitCode: 4,
      details: {
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new ScriptError('report_error', `上报失败（HTTP ${response.status}）`, {
      exitCode: 4,
      details: {
        httpCode: response.status,
        body: text,
      },
    });
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function main() {
  const { json } = parseCommonArgs();
  const changeLog = readJson(CHANGE_LOG_FILE, []);
  const unreportedIndices = [];

  for (let index = 0; index < changeLog.length; index++) {
    if (!changeLog[index].reported) unreportedIndices.push(index);
  }

  if (unreportedIndices.length === 0) {
    const payload = makeSuccess({
      message: '无未上报的变更，跳过',
      reportedEventCount: 0,
      remainingEventCount: 0,
    });
    if (json) {
      printJson(payload);
    } else {
      console.log('[report] 无未上报的变更，跳过');
    }
    return;
  }

  const unreportedEntries = unreportedIndices.map(index => changeLog[index]);
  const totalChanges = unreportedEntries.reduce((sum, entry) => sum + entry.changes.length, 0);
  const user = getUserInfo();

  if (!json) {
    console.log(`[report] 待上报 ${unreportedEntries.length} 个同步事件（共 ${totalChanges} 条变更）`);
    console.log(`[report] 用户: ${user.name} (${user.email})`);
  }

  const syncEvents = collectSyncEvents(unreportedEntries);
  const batches = batchSyncEvents(syncEvents);
  let reportedEventCount = 0;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchChanges = batch.reduce((sum, entry) => sum + entry.changes.length, 0);

    if (!json) {
      console.log(
        `[report] 上报第 ${batchIndex + 1}/${batches.length} 批（${batch.length} 个事件，${batchChanges} 条变更）...`,
      );
    }

    try {
      await uploadBatch(user, batch);
    } catch (error) {
      if (json) {
        const details = {
          reportedEventCount,
          remainingEventCount: unreportedEntries.length - reportedEventCount,
        };
        printJson({
          ...{
            ok: false,
            error: error instanceof ScriptError ? error.code : 'report_error',
            message: error instanceof Error ? error.message : String(error),
          },
          ...(error instanceof ScriptError && error.details ? { details: error.details } : {}),
          ...details,
        });
        process.exit(error instanceof ScriptError ? error.exitCode : 4);
      }

      throw error;
    }

    for (let offset = 0; offset < batch.length; offset++) {
      const idx = unreportedIndices[reportedEventCount];
      changeLog[idx].reported = true;
      reportedEventCount++;
    }
    writeJson(CHANGE_LOG_FILE, changeLog);

    if (!json) console.log(`[report] 第 ${batchIndex + 1} 批上报成功`);
  }

  if (json) {
    printJson(makeSuccess({
      message: '全部上报完成',
      reportedEventCount,
      remainingEventCount: 0,
    }));
  } else {
    console.log(`[report] 全部上报完成，共 ${reportedEventCount} 个同步事件`);
  }
}

main().catch(error => {
  finalizeScript(error, parseCommonArgs().json, err => `[report] 未预期的错误: ${err.message}`);
});
