#!/usr/bin/env node

import {
  CREDITS_FILE,
  LOGS_FILE,
  SYNC_STATE_FILE,
  parseCommonArgs,
  printJson,
  readJson,
} from './lib.mjs';

function toBeijingDate(unixSeconds) {
  const date = new Date(unixSeconds * 1000);
  return new Date(date.getTime() + 8 * 3600 * 1000);
}

function formatDate(beijingDate) {
  const year = beijingDate.getUTCFullYear();
  const month = String(beijingDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(beijingDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseArgs(argv) {
  const opts = { days: null, date: null };

  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--days' && argv[index + 1]) {
      opts.days = parseInt(argv[index + 1], 10);
      index++;
    } else if (argv[index] === '--date' && argv[index + 1]) {
      opts.date = argv[index + 1];
      index++;
    }
  }

  return opts;
}

function buildSummary(records) {
  const creditsUsed = records
    .filter(record => record.credits < 0)
    .reduce((sum, record) => sum + record.credits, 0);

  const creditsGained = records
    .filter(record => record.credits > 0)
    .reduce((sum, record) => sum + record.credits, 0);

  return {
    creditsUsed,
    creditsGained,
  };
}

function main() {
  const { args } = parseCommonArgs();
  const opts = parseArgs(args);

  const logs = readJson(LOGS_FILE, []);
  const creditsState = readJson(CREDITS_FILE, null);
  const syncState = readJson(SYNC_STATE_FILE, null);

  const sorted = [...logs].sort((a, b) => (b.createAt || 0) - (a.createAt || 0));
  let filtered = sorted;

  if (opts.date) {
    filtered = sorted.filter(record => formatDate(toBeijingDate(record.createAt)) === opts.date);
  } else if (opts.days) {
    const now = new Date();
    const beijingNow = new Date(now.getTime() + 8 * 3600 * 1000);
    const todayStr = formatDate(beijingNow);
    const [year, month, day] = todayStr.split('-').map(Number);
    const todayStart = new Date(Date.UTC(year, month - 1, day) - 8 * 3600 * 1000);
    const cutoff = new Date(todayStart.getTime() - (opts.days - 1) * 86400 * 1000);
    const cutoffUnix = Math.floor(cutoff.getTime() / 1000);
    filtered = sorted.filter(record => record.createAt >= cutoffUnix);
  }

  const payload = {
    status: sorted.length === 0 && !creditsState ? 'empty' : 'ok',
    total: filtered.length,
    records: filtered,
    credits: creditsState?.credits ?? null,
    summary: buildSummary(filtered),
    lastSyncAt: syncState?.lastSyncAt ?? creditsState?.updatedAt ?? null,
  };

  if (sorted.length > 0) payload.allTotal = sorted.length;
  if (opts.date) payload.filter = { date: opts.date };
  if (opts.days) payload.filter = { days: opts.days };
  if (payload.status === 'empty') payload.message = '本地无数据，请先运行同步';

  printJson(payload);
}

main();
