#!/usr/bin/env node

import { writeFileSync, mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';

// ── Args ──

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { source: 'all', clean: false, keepDays: 90 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) opts.source = args[++i];
    if (args[i] === '--clean') opts.clean = true;
    if (args[i] === '--keep-days' && args[i + 1]) opts.keepDays = parseInt(args[++i], 10);
  }
  return opts;
}

// ── Helpers ──

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmtDate(d) { return d.toISOString().slice(0, 10); }

async function fetchWithRetry(url, options = {}, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }
      throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      if (attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }
      throw e;
    }
  }
}

// ── Hacker News (structured JSON via official API) ──

async function fetchHN() {
  const res = await fetchWithRetry(
    'https://hacker-news.firebaseio.com/v0/topstories.json',
    { signal: AbortSignal.timeout(15000) },
  );
  const ids = await res.json();
  const top = ids.slice(0, 30);

  const items = [];
  const BATCH = 10;
  for (let i = 0; i < top.length; i += BATCH) {
    const batch = top.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          const r = await fetchWithRetry(
            `https://hacker-news.firebaseio.com/v0/item/${id}.json`,
            { signal: AbortSignal.timeout(10000) },
          );
          return r.json();
        } catch {
          return null;
        }
      }),
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

// ── GitHub Trending (fetch HTML + strip noise, LLM will parse) ──

function stripNoise(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

async function fetchGitHubHTML() {
  const res = await fetchWithRetry(
    'https://github.com/trending',
    {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(15000),
    },
  );
  const html = await res.text();
  return stripNoise(html);
}

// ── Data cleanup ──

function cleanOldData(keepDays) {
  if (!existsSync(DATA_DIR)) return 0;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - keepDays);
  const cutoffStr = fmtDate(cutoff);
  let removed = 0;

  for (const f of readdirSync(DATA_DIR)) {
    const dateMatch = f.match(/^(\d{4}-\d{2}-\d{2})\.(json|md|gh\.html)$/);
    if (dateMatch && dateMatch[1] < cutoffStr) {
      try { unlinkSync(join(DATA_DIR, f)); removed++; } catch { /* ignore */ }
    }
  }
  return removed;
}

// ── Main ──

async function main() {
  const opts = parseArgs();

  if (opts.clean) {
    const removed = cleanOldData(opts.keepDays);
    console.log(`已清理 ${removed} 个过期文件`);
    return;
  }

  mkdirSync(DATA_DIR, { recursive: true });

  const today = fmtDate(new Date());
  const crawledAt = new Date().toISOString();
  const jsonPath = join(DATA_DIR, `${today}.json`);
  const ghHtmlPath = join(DATA_DIR, `${today}.gh.html`);

  let hn = [];
  let ghHtmlSize = 0;
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
      const ghHtml = await fetchGitHubHTML();
      writeFileSync(ghHtmlPath, ghHtml, 'utf-8');
      ghHtmlSize = ghHtml.length;
      ghOk = true;
    } catch (e) {
      process.stderr.write(`[error] GitHub crawl failed: ${e.message}\n`);
    }
  }

  writeFileSync(jsonPath, JSON.stringify({ date: today, crawledAt, hn }, null, 2), 'utf-8');

  const parts = [];
  if (opts.source === 'all' || opts.source === 'hn') parts.push(`HN: ${hn.length} 条`);
  if (opts.source === 'all' || opts.source === 'gh') {
    parts.push(ghOk ? `GitHub HTML: ${Math.round(ghHtmlSize / 1024)}KB` : 'GitHub: 失败');
  }

  console.log(`爬取完成 (${today}) | ${parts.join(' | ')}`);
  console.log(`已保存: ${today}.json${ghOk ? ', ' + today + '.gh.html' : ''}`);

  const removed = cleanOldData(opts.keepDays);
  if (removed > 0) console.log(`已清理: ${removed} 个过期文件`);

  const wantHN = opts.source === 'all' || opts.source === 'hn';
  const wantGH = opts.source === 'all' || opts.source === 'gh';
  if ((wantHN && !hnOk) && (wantGH && !ghOk)) process.exit(2);
  if ((wantHN && !hnOk) || (wantGH && !ghOk)) process.exit(1);
}

main().catch(e => {
  process.stderr.write(`[fatal] ${e.message}\n`);
  process.exit(2);
});
