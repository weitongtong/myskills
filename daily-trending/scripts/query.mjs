#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// ── Args ──

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { days: null, date: null, source: 'all' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) opts.days = parseInt(args[++i], 10);
    if (args[i] === '--date' && args[i + 1]) opts.date = args[++i];
    if (args[i] === '--source' && args[i + 1]) opts.source = args[++i];
  }
  return opts;
}

// ── Data loading ──

function listDates() {
  if (!existsSync(DATA_DIR)) return [];
  return readdirSync(DATA_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map(f => f.replace('.json', ''))
    .sort()
    .reverse();
}

function loadDate(date) {
  const p = join(DATA_DIR, `${date}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

// ── Formatting ──

function formatData(data, source) {
  const lines = [`📅 ${data.date} 技术热榜\n`];

  if ((source === 'all' || source === 'hn') && data.hn?.length > 0) {
    lines.push(`🔶 Hacker News Top ${data.hn.length}\n`);
    for (const item of data.hn) {
      const comments = item.comments > 0 ? ` | 💬 ${item.comments}` : '';
      lines.push(`  ${String(item.rank).padStart(2)}. ${item.title}`);
      lines.push(`      ⬆ ${item.score}${comments}`);
      if (item.url !== item.hnUrl) {
        lines.push(`      🔗 ${item.url}`);
      }
      lines.push(`      💬 ${item.hnUrl}`);
    }
    lines.push('');
  }

  if ((source === 'all' || source === 'gh') && data.gh?.length > 0) {
    lines.push(`🐙 GitHub Trending Top ${data.gh.length}\n`);
    for (const item of data.gh) {
      const lang = item.language ? ` [${item.language}]` : '';
      const starsStr = item.stars >= 1000 ? `${(item.stars / 1000).toFixed(1)}k` : String(item.stars);
      const todayStr = item.todayStars > 0 ? ` (+${item.todayStars} today)` : '';
      lines.push(`  ${String(item.rank).padStart(2)}. ${item.repo}${lang}`);
      if (item.description) lines.push(`      ${item.description}`);
      lines.push(`      ⭐ ${starsStr}${todayStr}`);
      lines.push(`      🔗 ${item.url}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ──

function main() {
  const opts = parseArgs();
  const allDates = listDates();

  if (allDates.length === 0) {
    console.log('暂无数据，请先执行爬取：node {baseDir}/scripts/crawl.mjs');
    process.exit(0);
  }

  let targetDates = [];

  if (opts.date) {
    targetDates = [opts.date];
  } else if (opts.days) {
    targetDates = allDates.slice(0, opts.days);
  } else {
    targetDates = [allDates[0]];
  }

  let hasOutput = false;
  for (const date of targetDates) {
    const data = loadDate(date);
    if (!data) {
      console.log(`⚠️ ${date}: 无数据\n`);
      continue;
    }
    console.log(formatData(data, opts.source));
    hasOutput = true;
  }

  if (!hasOutput) {
    console.log('指定日期无数据。可用日期：' + allDates.slice(0, 10).join(', '));
  }
}

main();
