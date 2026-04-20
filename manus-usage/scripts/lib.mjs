import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const BASE_DIR = join(__dirname, '..');
export const DATA_DIR = join(BASE_DIR, 'data');
export const LOGS_FILE = join(DATA_DIR, 'logs.json');
export const CHANGE_LOG_FILE = join(DATA_DIR, 'change_log.json');
export const SYNC_STATE_FILE = join(DATA_DIR, 'sync_state.json');
export const CREDITS_FILE = join(DATA_DIR, 'credits.json');
export const TOKEN_FILE = join(BASE_DIR, '.token');
export const API_BASE = 'https://api.manus.im/user.v1.UserService';

export class ScriptError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'ScriptError';
    this.code = code;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details ?? null;
  }
}

export function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

export function writeJson(path, data) {
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
}

export function parseCommonArgs(argv = process.argv.slice(2)) {
  const args = [...argv];
  const json = args.includes('--json');
  return {
    json,
    args: args.filter(arg => arg !== '--json'),
  };
}

export function isJwtFormat(token) {
  if (!token) return false;
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);
}

export function decodeJwtPayload(token) {
  if (!isJwtFormat(token)) {
    throw new ScriptError('token_invalid', 'Token 格式无效，请重新提取 Manus token');
  }

  try {
    const parts = token.split('.');
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    throw new ScriptError('token_invalid', 'Token 格式无效，请重新提取 Manus token');
  }
}

export function readToken({ validate = false } = {}) {
  if (!existsSync(TOKEN_FILE)) {
    throw new ScriptError('token_not_found', 'Token 文件不存在，请先刷新 token');
  }

  const token = readFileSync(TOKEN_FILE, 'utf-8').trim();
  if (!token) {
    throw new ScriptError('token_not_found', 'Token 文件为空，请先刷新 token');
  }

  if (validate) decodeJwtPayload(token);
  return token;
}

export function makeSuccess(payload = {}) {
  return {
    ok: true,
    ...payload,
  };
}

export function makeError(error, payload = {}) {
  if (error instanceof ScriptError) {
    return {
      ok: false,
      error: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
      ...payload,
    };
  }

  return {
    ok: false,
    error: 'unexpected_error',
    message: error instanceof Error ? error.message : String(error),
    ...payload,
  };
}

export function printJson(payload) {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

export function finalizeScript(error, jsonMode, fallbackFormatter) {
  if (jsonMode) {
    printJson(makeError(error));
    process.exit(error instanceof ScriptError ? error.exitCode : 1);
  }

  if (error instanceof ScriptError) {
    process.stderr.write(JSON.stringify(makeError(error)) + '\n');
    process.exit(error.exitCode);
  }

  const message = fallbackFormatter
    ? fallbackFormatter(error)
    : `[script] 未预期的错误: ${error instanceof Error ? error.message : String(error)}`;
  process.stderr.write(message + '\n');
  process.exit(1);
}

export function classifyApiBody(text, httpCode) {
  const normalized = String(text || '');
  if (httpCode === 401 || /"unauthenticated"/i.test(normalized)) {
    return new ScriptError('token_expired', 'Manus token 已过期，请刷新 token', {
      exitCode: 2,
    });
  }

  return new ScriptError('api_error', `Manus API 请求失败（HTTP ${httpCode}）`, {
    exitCode: 3,
    details: {
      httpCode,
      body: normalized,
    },
  });
}

export async function callManusApi(endpoint, body = {}) {
  const token = readToken({ validate: true });

  let response;
  try {
    response = await fetch(`${API_BASE}/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'connect-protocol-version': '1',
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new ScriptError('api_error', 'Manus API 请求失败，请检查网络连接后重试', {
      exitCode: 3,
      details: {
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw classifyApiBody(text, response.status);
  }

  return response.json();
}
