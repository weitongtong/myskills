#!/usr/bin/env node

import { writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = join(__dirname, '..');
const DATA_DIR = join(BASE_DIR, 'data');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// ── Args ──

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { source: 'all', keepDays: 90 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) opts.source = args[++i];
    if (args[i] === '--keep-days' && args[i + 1]) opts.keepDays = parseInt(args[++i], 10);
  }
  return opts;
}

// ── Hacker News ──

async function fetchHN() {
  const res = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HN topstories failed: ${res.status}`);
  const ids = await res.json();
  const top = ids.slice(0, 30);

  const items = [];
  const BATCH = 10;
  for (let i = 0; i < top.length; i += BATCH) {
    const batch = top.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          const r = await fetch(
            `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
            { signal: AbortSignal.timeout(10000) }
          );
          return r.ok ? r.json() : null;
        } catch {
          return null;
        }
      })
    );
    items.push(...results);
    if (i + BATCH < top.length) await sleep(200);
  }

  return items
    .filter(Boolean)
    .map((item, idx) => {
      const hnUrl = `https://news.ycombinator.com/item?id=${item.id}`;
      return {
        rank: idx + 1,
        id: item.id,
        title: item.title || '',
        url: item.url || hnUrl,
        score: item.score || 0,
        comments: item.descendants || 0,
        author: item.by || '',
        hnUrl,
      };
    });
}

// ── GitHub Trending ──

async function fetchGitHub() {
  const res = await fetch('https://github.com/trending', {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub trending failed: ${res.status}`);
  const html = await res.text();
  return parseGitHubHTML(html);
}

function parseGitHubHTML(html) {
  const items = [];
  const articleRe = /<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;

  while ((match = articleRe.exec(html)) !== null && items.length < 25) {
    const block = match[1];
    try {
      const repoMatch = block.match(/href="\/([^/]+\/[^/"]+)"/);
      if (!repoMatch) continue;
      const repo = repoMatch[1].trim();

      let description = '';
      const descMatch = block.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
      if (descMatch) description = descMatch[1].replace(/<[^>]+>/g, '').trim();

      let language = '';
      const langMatch = block.match(/itemprop="programmingLanguage"[^>]*>([^<]+)/i);
      if (langMatch) language = langMatch[1].trim();

      let stars = 0;
      const starsMatch = block.match(/href="\/[^"]*\/stargazers"[^>]*>([\s\S]*?)<\/a>/i);
      if (starsMatch) {
        const num = starsMatch[1].replace(/<[^>]+>/g, '').replace(/,/g, '').trim();
        stars = parseInt(num, 10) || 0;
      }

      let todayStars = 0;
      const todayMatch = block.match(/([\d,]+)\s*stars?\s*today/i);
      if (todayMatch) todayStars = parseInt(todayMatch[1].replace(/,/g, ''), 10) || 0;

      items.push({
        rank: items.length + 1,
        repo,
        url: `https://github.com/${repo}`,
        description,
        language,
        stars,
        todayStars,
      });
    } catch (e) {
      process.stderr.write(`[warn] GitHub parsing error on article: ${e.message}\n`);
    }
  }

  if (items.length === 0) {
    process.stderr.write('[warn] GitHub Trending: no articles parsed, HTML structure may have changed\n');
  }
  return items;
}

// ── Output generation ──

function generateMarkdown(date, hn, gh) {
  const lines = [`# ${date} 每日技术热榜\n`];

  if (hn.length > 0) {
    lines.push(`## Hacker News Top ${hn.length}\n`);
    lines.push('| # | 标题 | 分数 | 评论 | 链接 |');
    lines.push('|---|------|------|------|------|');
    for (const item of hn) {
      const title = item.title.replace(/\|/g, '\\|');
      const link = item.url === item.hnUrl
        ? `[讨论](${item.hnUrl})`
        : `[原文](${item.url}) / [讨论](${item.hnUrl})`;
      lines.push(`| ${item.rank} | ${title} | ${item.score} | ${item.comments} | ${link} |`);
    }
    lines.push('');
  }

  if (gh.length > 0) {
    lines.push(`## GitHub Trending Top ${gh.length}\n`);
    lines.push('| # | 项目 | 描述 | 语言 | Star | 今日 |');
    lines.push('|---|------|------|------|------|------|');
    for (const item of gh) {
      const desc = (item.description || '-').replace(/\|/g, '\\|');
      const starsStr = item.stars >= 1000 ? `${(item.stars / 1000).toFixed(1)}k` : String(item.stars);
      lines.push(`| ${item.rank} | [${item.repo}](${item.url}) | ${desc} | ${item.language || '-'} | ${starsStr} | +${item.todayStars} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Data cleanup ──

function cleanOldData(keepDays) {
  if (!existsSync(DATA_DIR)) return 0;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cutoffStr = fmtDate(cutoff);
  let removed = 0;

  for (const f of readdirSync(DATA_DIR)) {
    const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})\.(json|md)$/);
    if (dateMatch && dateMatch[1] < cutoffStr) {
      try {
        unlinkSync(join(DATA_DIR, f));
        removed++;
      } catch { /* ignore */ }
    }
  }
  return removed;
}

// ── Helpers ──

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmtDate(d) { return d.toLocaleDateString('sv-SE'); }

// ── Main ──

async function main() {
  const opts = parseArgs();
  const today = fmtDate(new Date());
  const crawledAt = new Date().toISOString();

  mkdirSync(DATA_DIR, { recursive: true });

  let hn = [];
  let gh = [];
  let hnOk = false;
  let ghOk = false;

  if (opts.source === 'all' || opts.source === 'hn') {
    try {
      hn = await fetchHN();
      hnOk = true;
    } catch (e) {
      process.stderr.write(`[error] HN crawl failed: ${e.message}\n`);
    }
  }

  if (opts.source === 'all' || opts.source === 'gh') {
    try {
      gh = await fetchGitHub();
      ghOk = true;
    } catch (e) {
      process.stderr.write(`[error] GitHub crawl failed: ${e.message}\n`);
    }
  }

  const data = { date: today, crawledAt, hn, gh };
  const jsonPath = join(DATA_DIR, `${today}.json`);
  const mdPath = join(DATA_DIR, `${today}.md`);

  writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
  writeFileSync(mdPath, generateMarkdown(today, hn, gh), 'utf-8');

  const removed = cleanOldData(opts.keepDays);

  const parts = [];
  if (opts.source === 'all' || opts.source === 'hn') parts.push(`HN: ${hn.length} 条`);
  if (opts.source === 'all' || opts.source === 'gh') parts.push(`GitHub: ${gh.length} 条`);

  console.log(`爬取完成 (${today})`);
  console.log(`  ${parts.join(' | ')}`);
  console.log(`  已保存: ${today}.json, ${today}.md`);
  if (removed > 0) console.log(`  已清理: ${removed} 个过期文件`);

  const wantHN = opts.source === 'all' || opts.source === 'hn';
  const wantGH = opts.source === 'all' || opts.source === 'gh';
  if ((wantHN && !hnOk) && (wantGH && !ghOk)) process.exit(2);
  if ((wantHN && !hnOk) || (wantGH && !ghOk)) process.exit(1);
}

main().catch(e => {
  process.stderr.write(`[fatal] ${e.message}\n`);
  process.exit(2);
});
