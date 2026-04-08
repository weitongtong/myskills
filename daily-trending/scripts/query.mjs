#!/usr/bin/env node

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

// ── Args ──

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { days: null, date: null, source: 'all', keyword: null, top: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) opts.days = parseInt(args[++i], 10);
    if (args[i] === '--date' && args[i + 1]) opts.date = args[++i];
    if (args[i] === '--source' && args[i + 1]) opts.source = args[++i];
    if (args[i] === '--keyword' && args[i + 1]) opts.keyword = args[++i].toLowerCase();
    if (args[i] === '--top' && args[i + 1]) opts.top = parseInt(args[++i], 10);
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

// ── Filtering ──

function matchKeyword(text, keyword) {
  return text && text.toLowerCase().includes(keyword);
}

function filterItems(items, keyword) {
  if (!keyword || !items) return items;
  return items.filter(item =>
    matchKeyword(item.title, keyword) ||
    matchKeyword(item.repo, keyword) ||
    matchKeyword(item.description, keyword) ||
    matchKeyword(item.language, keyword),
  );
}

function limitItems(items, top) {
  if (!top || !items) return items;
  return items.slice(0, top);
}

// ── Formatting ──

function formatData(data, source, keyword, top) {
  const sections = [];

  if ((source === 'all' || source === 'hn') && data.hn?.length > 0) {
    let hnItems = filterItems(data.hn, keyword);
    hnItems = limitItems(hnItems, top);
    if (hnItems.length > 0) {
      const lines = [`🔶 Hacker News Top ${hnItems.length}\n`];
      for (const item of hnItems) {
        const comments = item.comments > 0 ? ` | 💬 ${item.comments}` : '';
        lines.push(`  ${String(item.rank).padStart(2)}. ${item.title}`);
        lines.push(`      ⬆ ${item.score}${comments}`);
        if (item.url !== item.hnUrl) {
          lines.push(`      🔗 ${item.url}`);
        }
        lines.push(`      💬 ${item.hnUrl}`);
      }
      sections.push(lines.join('\n'));
    }
  }

  if ((source === 'all' || source === 'gh') && data.gh?.length > 0) {
    let ghItems = filterItems(data.gh, keyword);
    ghItems = limitItems(ghItems, top);
    if (ghItems.length > 0) {
      const lines = [`🐙 GitHub Trending Top ${ghItems.length}\n`];
      for (const item of ghItems) {
        const lang = item.language ? ` [${item.language}]` : '';
        const starsStr = item.stars >= 1000 ? `${(item.stars / 1000).toFixed(1)}k` : String(item.stars);
        const todayStr = item.todayStars > 0 ? ` (+${item.todayStars} today)` : '';
        lines.push(`  ${String(item.rank).padStart(2)}. ${item.repo}${lang}`);
        if (item.description) lines.push(`      ${item.description}`);
        lines.push(`      ⭐ ${starsStr}${todayStr}`);
        lines.push(`      🔗 ${item.url}`);
      }
      sections.push(lines.join('\n'));
    }
  }

  if (sections.length === 0) return '';
  return `📅 ${data.date} 技术热榜\n\n${sections.join('\n\n')}`;
}

// ── Main ──

function main() {
  const opts = parseArgs();
  const allDates = listDates();

  if (allDates.length === 0) {
    console.log('暂无数据，请先执行爬取：node {baseDir}/scripts/crawl.mjs');
    process.exit(1);
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
    const output = formatData(data, opts.source, opts.keyword, opts.top);
    if (output.trim()) {
      console.log(output);
      hasOutput = true;
    }
  }

  if (!hasOutput) {
    console.log('指定日期无数据。可用日期：' + allDates.slice(0, 10).join(', '));
    process.exit(1);
  }
}

main();
