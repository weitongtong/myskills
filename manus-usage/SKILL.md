---
slug: manus-usage
version: 1.1.0
name: manus-usage
displayName: Manus 使用记录
description: "Manus AI 使用记录管理。支持增量同步、变更上报、本地查询、token 刷新分流。"
summary: "严格脚本驱动的 Manus 使用记录 Skill：同步、上报、查询、token 刷新。"
tags: manus, usage, credits
metadata: { "deskclaw": { "emoji": "📊", "requires": { "bins": ["curl", "bash", "node"], "mcps": ["playwright"] } } }
---

# Manus 使用记录

这个 skill 必须走“固定入口 + 固定脚本 + 固定错误码”。

不要自由发挥，不要自己拼接底层 API 请求，不要把排障扩展成开放式探索。

## 固定入口

只允许以下 4 个入口：

| 用户意图 | 必须执行 |
|---|---|
| 同步 manus 使用记录 | `node {baseDir}/scripts/sync.mjs --json` |
| 上报 manus 使用记录 | `node {baseDir}/scripts/report.mjs --json` |
| 查询 manus 使用记录 / 用量 / 积分 / 余额 | `node {baseDir}/scripts/query-local.mjs --json` |
| 刷新 manus token | 按下方“刷新 token 流程”执行 |

## 输出契约

### 结构化脚本

以下脚本必须返回 JSON：

- `sync.mjs --json`
- `report.mjs --json`
- `query-local.mjs --json`
- `refresh-token.sh`
- `fetch-usage.sh`

### 固定错误码

遇到错误时，只按以下错误码分流：

- `token_not_found`
- `token_invalid`
- `token_expired`
- `playwright_unavailable`
- `npm_eacces`
- `api_error`
- `report_error`

不要自己发明新的业务分支。

## 禁止事项

- 禁止读取其他 skill 来代替本流程
- 禁止使用 `deskclaw-browser` skill、`chrome-devtools`、DeskClaw 内置 `browser` 工具代替 Playwright MCP
- 禁止执行 `pip install playwright`
- 禁止执行 `npm list`、`find ~/.deskclaw`、`cat ~/.deskclaw/...`、`grep ~/.deskclaw/...` 这类开放式排障
- 禁止自己调用 Manus API 来代替 `sync.mjs` / `fetch-usage.sh`
- 禁止在同一失败点盲目重试超过 1 次
- 禁止自动执行需要提权的修复命令，例如 `sudo chown ...`

## 决策树

### 1. 同步 manus 使用记录

1. 运行 `node {baseDir}/scripts/sync.mjs --json`
2. 解析 JSON：
   - `ok: true`：向用户汇总 `message`、`changesCount`、`totalLogs`、`lastSyncAt`
   - `error: token_not_found`：进入“刷新 token 流程”
   - `error: token_invalid`：告知本地 token 格式无效，需要重新提取 token；然后进入“刷新 token 流程”
   - `error: token_expired`：进入“刷新 token 流程”
   - `error: api_error`：直接转述脚本错误，不做额外 API 或环境排障

### 2. 查询 manus 使用记录 / 积分 / 余额

1. 先运行 `node {baseDir}/scripts/query-local.mjs --json`
2. 如果返回 `status: "ok"`：
   - 用中文整理结果
   - 优先展示 `credits`
   - 再展示最近记录
3. 如果返回 `status: "empty"`：
   - 只允许自动补一次：运行 `node {baseDir}/scripts/sync.mjs --json`
   - 若同步成功，再重新运行一次 `query-local.mjs --json`
   - 若同步返回 `token_not_found` / `token_invalid` / `token_expired`，按错误码处理，不再继续查询
4. 不要在查询路径中调用开放式排障命令

### 3. 上报 manus 使用记录

1. 运行 `node {baseDir}/scripts/report.mjs --json`
2. 解析 JSON：
   - `ok: true`：向用户说明已上报完成，展示 `reportedEventCount`
   - `error: token_not_found`：进入“刷新 token 流程”
   - `error: token_invalid`：告知本地 token 格式无效，然后进入“刷新 token 流程”
   - `error: report_error`：直接转述脚本错误；若返回了 `reportedEventCount` / `remainingEventCount`，明确说明“部分成功，下次可续传”

### 4. 刷新 manus token

当用户明确要求“刷新 manus token”，或脚本返回：

- `token_not_found`
- `token_invalid`
- `token_expired`

都进入下面流程。

## 刷新 token 流程

### A. 先检查 Playwright MCP

只允许一次自愈，顺序固定：

1. 调用 `mcp_deskclaw_mcp_server_list`
2. 如果不存在 `playwright`：
   - 调用 `mcp_deskclaw_mcp_server_add`
   - 参数固定为：
     - `name`: `playwright`
     - `command`: `npx`
     - `args`: `-y @playwright/mcp`
3. 调用 `mcp_deskclaw_restart_gateway`
4. 再检查一次 Playwright MCP 是否可用
5. 如果仍不可用，立即停止，按错误分类回复

不要继续安装、搜索、读取更多环境文件。

### B. Playwright 错误分类

如果 MCP 相关输出包含以下任一特征，按 `npm_eacces` 处理：

- `npm ERR! code EACCES`
- `root-owned files`
- `.npm/_cacache`
- `sudo chown -R`

此时必须停止，并告诉用户：

- 这是本机 npm 缓存权限问题，不是 Manus token 问题
- 不要自动执行修复命令
- 给出建议命令：

```bash
sudo chown -R "$(id -u):$(id -g)" ~/.npm
```

如果 npm 错误里已经给出更具体的 `sudo chown -R UID:GID "PATH"`，优先把那条原样转述给用户。

如果 MCP 输出包含以下任一特征，按 `playwright_unavailable` 处理：

- `failed to connect`
- `Connection closed`
- 浏览器工具调用失败，且自愈后仍不可用

此时直接告知用户 Playwright MCP 不可用，建议修复 DeskClaw / Playwright 环境后重试。

### C. 浏览器提取 token

仅在 Playwright MCP 已可用时继续：

1. 用 `playwright` MCP 的 `browser_navigate` 打开 `https://manus.im/app`
2. 用 `browser_snapshot` 判断是否已登录
3. 如果未登录：
   - 提示用户在弹出的浏览器中完成登录
   - 用 `browser_wait_for` 等待已登录标志，不要反复轮询
4. 用 `browser_evaluate` 提取 `session_id` cookie：

```javascript
() => {
  const cookies = document.cookie.split('; ');
  for (const c of cookies) {
    const [name, ...rest] = c.split('=');
    if (name === 'session_id') return rest.join('=');
  }
  return null;
}
```

5. 若返回空值，停止并告知用户 token 提取失败
6. 运行：

```bash
bash {baseDir}/scripts/refresh-token.sh "提取到的token"
```

7. 如果脚本返回 `ok: true`，重新执行之前失败的原始命令一次
8. 如果脚本返回 `token_invalid`，停止并告知用户本次提取的 token 无效

## 查询结果展示模板

查询成功时，用中文整理，不要原样贴 JSON。格式参考：

```text
📊 Manus 使用情况

💰 积分余额
- 总积分：...
- 免费积分：...
- 每日刷新积分：... / ...
- 下次刷新：...（北京时间）

📋 最近使用记录（共 N 条）
1. 标题 — 日期 — 消耗/获得 X 积分
   🔗 https://manus.im/app/{sessionId}
```

注意：

- `createAt` 是 Unix 秒级时间戳，要转北京时间展示
- `credits < 0` 显示为“消耗 X 积分”
- `credits > 0` 显示为“获得 X 积分”

## 兜底在线查询

只有在本地查询不可用、且用户确实需要即时在线结果时，才允许使用：

```bash
bash {baseDir}/scripts/fetch-usage.sh all
bash {baseDir}/scripts/fetch-usage.sh credits
bash {baseDir}/scripts/fetch-usage.sh log 1 20
```

用途仅限“在线查数据”，不承担 token 刷新职责。

## 开发生效路径

这个仓库中的 skill 位于 `myskills/manus-usage/`，但运行时真正加载的是 `workspace/skills/`。

开发态下，`deskclaw/scripts/dev.js` 会把仓库里的 `myskills/` 链接到运行时 `workspace/skills/`。

因此：

- 修改仓库文件后，要确认当前运行环境使用的是开发链接副本
- 不要假设“改了 `myskills/` 就一定自动影响已安装的发布态 skill”
