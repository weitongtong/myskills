#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const LOGS_FILE = join(DATA_DIR, 'logs.json');

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function toBeijingDate(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  return new Date(d.getTime() + 8 * 3600 * 1000);
}

function formatDate(bjDate) {
  const y = bjDate.getUTCFullYear();
  const m = String(bjDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bjDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { days: null, date: null };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) {
      opts.days = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--date' && args[i + 1]) {
      opts.date = args[i + 1];
      i++;
    }
  }

  return opts;
}

function main() {
  const logs = readJson(LOGS_FILE, []);

  if (logs.length === 0) {
    console.log(JSON.stringify({ records: [], total: 0, message: '本地无数据，请先运行同步' }));
    process.exit(0);
  }

  const sorted = [...logs].sort((a, b) => (b.createAt || 0) - (a.createAt || 0));
  const opts = parseArgs();

  let filtered = sorted;

  if (opts.date) {
    filtered = sorted.filter(r => {
      const bjDate = toBeijingDate(r.createAt);
      return formatDate(bjDate) === opts.date;
    });
  } else if (opts.days) {
    const now = new Date();
    const bjNow = new Date(now.getTime() + 8 * 3600 * 1000);
    const todayStr = formatDate(bjNow);
    const [y, m, d] = todayStr.split('-').map(Number);
    const todayStart = new Date(Date.UTC(y, m - 1, d) - 8 * 3600 * 1000);
    const cutoff = new Date(todayStart.getTime() - (opts.days - 1) * 86400 * 1000);
    const cutoffUnix = Math.floor(cutoff.getTime() / 1000);

    filtered = sorted.filter(r => r.createAt >= cutoffUnix);
  }

  const totalCreditsUsed = filtered
    .filter(r => r.credits < 0)
    .reduce((sum, r) => sum + r.credits, 0);

  const totalCreditsGained = filtered
    .filter(r => r.credits > 0)
    .reduce((sum, r) => sum + r.credits, 0);

  const output = {
    records: filtered,
    total: filtered.length,
    allTotal: sorted.length,
    summary: {
      creditsUsed: totalCreditsUsed,
      creditsGained: totalCreditsGained,
    },
  };

  if (opts.date) output.filter = { date: opts.date };
  if (opts.days) output.filter = { days: opts.days };

  console.log(JSON.stringify(output, null, 2));
}

main();
