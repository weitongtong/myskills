#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_DIR = join(__dirname, '..');
const DATA_DIR = join(BASE_DIR, 'data');
const STATE_PATH = join(DATA_DIR, 'state.json');
const TOKEN_CACHE_PATH = join(DATA_DIR, '.token_cache.json');

const FEISHU_API = 'https://open.feishu.cn/open-apis';
const DEFAULT_DOMAIN = 'bytedance.feishu.cn';

const BLOCK_TYPE = { TEXT: 2, HEADING2: 4, DIVIDER: 22 };

// ── Config ──

function loadConfig() {
  const configPath = process.env.NANOBOT_CONFIG_PATH
    || join(homedir(), '.deskclaw', 'nanobot', 'config.json');

  if (!existsSync(configPath)) {
    output({
      status: 'error',
      code: 'config_not_found',
      message: `未找到 nanobot 配置文件: ${configPath}，请确认 DeskClaw 已正确安装`,
    });
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch {
    output({ status: 'error', code: 'config_parse_error', message: `配置文件解析失败: ${configPath}` });
    process.exit(1);
  }

  const feishu = config?.channels?.feishu;
  if (!feishu?.appId || !feishu?.appSecret) {
    output({
      status: 'error',
      code: 'feishu_not_configured',
      message: '飞书通道未配置或缺少 appId/appSecret，请先在 DeskClaw 设置中配置飞书通道',
    });
    process.exit(1);
  }

  return {
    FEISHU_APP_ID: feishu.appId,
    FEISHU_APP_SECRET: feishu.appSecret,
    FEISHU_DOMAIN: DEFAULT_DOMAIN,
    FEISHU_FOLDER_TOKEN: '',
  };
}

// ── Output ──

function output(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

// ── Token ──

async function getToken(env) {
  if (existsSync(TOKEN_CACHE_PATH)) {
    try {
      const cache = JSON.parse(readFileSync(TOKEN_CACHE_PATH, 'utf-8'));
      if (cache.token && cache.expires_at > Date.now() + 30 * 60 * 1000) {
        return cache.token;
      }
    } catch { /* ignore corrupt cache */ }
  }

  const res = await fetch(`${FEISHU_API}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ app_id: env.FEISHU_APP_ID, app_secret: env.FEISHU_APP_SECRET }),
  });
  const data = await res.json();
  if (data.code !== 0) {
    output({ status: 'error', code: 'token_failed', message: `获取 token 失败: ${data.msg}` });
    process.exit(2);
  }

  const cache = { token: data.tenant_access_token, expires_at: Date.now() + data.expire * 1000 };
  writeFileSync(TOKEN_CACHE_PATH, JSON.stringify(cache), 'utf-8');
  return cache.token;
}

// ── Feishu API helpers ──

async function feishuPost(token, path, body) {
  const res = await fetch(`${FEISHU_API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Block builders ──

function textElement(content) {
  return { text_run: { content } };
}

function textBlock(content) {
  return {
    block_type: BLOCK_TYPE.TEXT,
    text: { elements: [textElement(content)] },
  };
}

function heading2Block(content) {
  return {
    block_type: BLOCK_TYPE.HEADING2,
    heading2: { elements: [textElement(content)] },
  };
}

function dividerBlock() {
  return { block_type: BLOCK_TYPE.DIVIDER, divider: {} };
}

// ── State ──

function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function saveState(state) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return fmtDate(d);
}

function getWeekEnd(weekStart) {
  const [y, m, d] = weekStart.split('-').map(Number);
  const date = new Date(y, m - 1, d + 6);
  return fmtDate(date);
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDocUrl(documentId, env) {
  const domain = env.FEISHU_DOMAIN || 'bytedance.feishu.cn';
  return `https://${domain}/docx/${documentId}`;
}

// ── Create document ──

async function createDocument(token, env) {
  const weekStart = getWeekStart();
  const weekEnd = getWeekEnd(weekStart);
  const title = `分享速记 ${weekStart} ~ ${weekEnd}`;

  const body = { title };
  if (env.FEISHU_FOLDER_TOKEN) body.folder_token = env.FEISHU_FOLDER_TOKEN;

  const data = await feishuPost(token, '/docx/v1/documents', body);

  if (data.code !== 0) {
    output({ status: 'error', code: 'create_failed', message: `创建文档失败: ${data.msg} (code: ${data.code})` });
    process.exit(2);
  }

  const doc = data.data.document;
  const state = {
    document_id: doc.document_id,
    document_url: buildDocUrl(doc.document_id, env),
    week_start: weekStart,
    items: [],
  };
  saveState(state);
  return state;
}

// ── Append blocks ──

async function appendBlocks(token, documentId, blocks) {
  const data = await feishuPost(
    token,
    `/docx/v1/documents/${documentId}/blocks/${documentId}/children`,
    { children: blocks },
  );

  if (data.code !== 0) {
    output({ status: 'error', code: 'append_failed', message: `追加内容失败: ${data.msg} (code: ${data.code})` });
    process.exit(2);
  }
  return data;
}

// ── Ensure current week document ──

async function ensureWeekDoc(token, env) {
  const currentWeek = getWeekStart();
  let state = loadState();

  if (state && state.week_start === currentWeek && state.document_id) {
    return state;
  }

  return createDocument(token, env);
}

// ── Read stdin ──

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

// ── Commands ──

async function cmdStatus(_env) {
  const state = loadState();

  if (!state || !state.document_id) {
    output({
      status: 'ok',
      has_document: false,
      message: '本周尚未创建文档',
    });
    return;
  }

  const currentWeek = getWeekStart();
  const isCurrent = state.week_start === currentWeek;

  output({
    status: 'ok',
    has_document: true,
    is_current_week: isCurrent,
    document_id: state.document_id,
    document_url: state.document_url,
    week_start: state.week_start,
    week_end: getWeekEnd(state.week_start),
    items_count: state.items.length,
    items: state.items,
  });
}

async function cmdAppend(env) {
  const raw = await readStdin();
  if (!raw) {
    output({ status: 'error', code: 'no_input', message: '未收到 stdin 输入，请通过 stdin 传入 JSON' });
    process.exit(1);
  }

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    output({ status: 'error', code: 'invalid_json', message: 'stdin 输入不是有效的 JSON' });
    process.exit(1);
  }

  const { title, source, content } = input;
  if (!title || !content) {
    output({ status: 'error', code: 'missing_fields', message: '缺少必要字段: title, content' });
    process.exit(1);
  }

  const token = await getToken(env);
  const state = await ensureWeekDoc(token, env);

  if (source) {
    const dup = state.items.find(it => it.source === source);
    if (dup) {
      output({ status: 'duplicate', title: dup.title, source: dup.source });
      process.exit(3);
    }
  }

  const idx = state.items.length + 1;
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const blocks = [
    heading2Block(`${idx}. ${title}`),
    textBlock(`来源：${source || '无'} | 收录时间：${timeStr}`),
  ];

  const paragraphs = content.split('\n').filter(p => p.trim());
  for (const p of paragraphs) {
    blocks.push(textBlock(p));
  }
  blocks.push(dividerBlock());

  await appendBlocks(token, state.document_id, blocks);

  state.items.push({ title, source: source || '', time: timeStr });
  saveState(state);

  output({
    status: 'ok',
    document_id: state.document_id,
    document_url: state.document_url,
    items_count: state.items.length,
    title,
  });
}

async function cmdCreate(env) {
  const token = await getToken(env);
  const state = await createDocument(token, env);
  output({
    status: 'ok',
    document_id: state.document_id,
    document_url: state.document_url,
    week_start: state.week_start,
    week_end: getWeekEnd(state.week_start),
  });
}

// ── Main ──

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  const env = loadConfig();
  const cmd = process.argv[2];

  switch (cmd) {
    case 'status':
      await cmdStatus(env);
      break;
    case 'append':
      await cmdAppend(env);
      break;
    case 'create':
      await cmdCreate(env);
      break;
    default:
      output({ status: 'error', code: 'unknown_command', message: `未知命令: ${cmd}。支持: status, append, create` });
      process.exit(1);
  }
}

main().catch(e => {
  output({ status: 'error', code: 'fatal', message: e.message });
  process.exit(2);
});
