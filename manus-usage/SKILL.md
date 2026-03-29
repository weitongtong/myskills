---
name: manus-usage
description: "Manus AI 使用记录管理。支持增量同步（高频）、变更上报（低频）、本地查询。"
metadata: { "deskclaw": { "emoji": "📊", "requires": { "bins": ["curl", "bash", "node"] } } }
---

# Manus 使用记录

## 动作路由（必须严格遵循，不要自行发挥）

收到消息后，**先匹配下表，直接执行对应命令**。不要写文件、不要自己组织数据，只需运行脚本并将脚本输出返回给用户。

| 消息关键词 | 必须执行的命令 | 说明 |
|-----------|--------------|------|
| "同步 manus 使用记录" | `node {baseDir}/scripts/sync.mjs` | 增量扫描 + 比对 + 记录变更，只需运行脚本并返回输出 |
| "上报 manus 使用记录" | `node {baseDir}/scripts/report.mjs` | 上报本地未报的变更事件到服务器，只需运行脚本并返回输出 |
| "manus 使用记录/用量/积分/余额" | `node {baseDir}/scripts/query-local.mjs` | 查询本地数据，按下方"输出格式"回复用户 |

**禁止事项**：
- 收到"上报"时，禁止自己写 markdown 文件或本地日志来代替上报，必须执行 `report.mjs`
- 收到"同步"时，禁止自己调 API 来代替同步，必须执行 `sync.mjs`

## 查询使用记录

```bash
# 查询全部
node {baseDir}/scripts/query-local.mjs

# 最近 N 天
node {baseDir}/scripts/query-local.mjs --days 7

# 指定日期
node {baseDir}/scripts/query-local.mjs --date 2026-03-27
```

如果本地无数据（`total: 0`），先执行 `node {baseDir}/scripts/sync.mjs`，再查询。

## 实时查询（仅在本地数据不可用时使用）

仅当 `query-local.mjs` 无法工作时才用此方式，正常情况不要使用：

```bash
bash {baseDir}/scripts/fetch-usage.sh all      # 积分 + 记录
bash {baseDir}/scripts/fetch-usage.sh credits   # 仅积分
bash {baseDir}/scripts/fetch-usage.sh log 1 20  # 记录分页
```

## 响应字段说明

### 积分余额 (GetAvailableCredits)

| 字段 | 含义 |
|------|------|
| `totalCredits` | 总可用积分 |
| `freeCredits` | 免费积分 |
| `refreshCredits` | 当前每日刷新积分 |
| `maxRefreshCredits` | 每日刷新积分上限 |
| `nextRefreshTime` | 下次刷新时间 (UTC) |
| `refreshInterval` | 刷新周期 |

### 使用记录 (ListUserCreditsLog)

| 字段 | 含义 |
|------|------|
| `logs[].title` | 任务标题 |
| `logs[].createAt` | 时间（Unix 时间戳，需转换为北京时间） |
| `logs[].credits` | 积分变更（负数=消耗，正数=获得） |
| `logs[].type` | `CREDIT_LOG_TYPE_COST`=消耗，`CREDIT_LOG_TYPE_CREDIT_ALL`=获得 |
| `logs[].sessionId` | 关联会话 ID，可拼接为 `https://manus.im/app/{sessionId}` |
| `total` | 记录总数 |

## 输出格式

用中文回复，格式参考：

```
📊 Manus 使用情况

💰 积分余额
  总积分：1,300
  ├ 免费积分：1,000
  └ 每日刷新积分：300 / 300
  下次刷新：2026-03-29 00:00 (北京时间)

📋 最近使用记录（共 N 条）
  1. 最新AI新闻整理 — 3月27日 — 消耗 6 积分
     🔗 https://manus.im/app/2SNxdk8jtEjgaappWdwBir
  2. 新用户奖励 — 3月27日 — 获得 1,000 积分
```

注意：
- `createAt` 为 Unix 秒级时间戳，需转换为北京时间 (UTC+8) 展示
- 积分消耗显示为"消耗 X 积分"，获得显示为"获得 X 积分"
- 有 `sessionId` 的记录附上链接

## Token 过期处理

认证 token 存储在 `{baseDir}/.token`。当脚本以退出码 2 退出或输出包含 `"error":"token_expired"` 时，说明 token 已过期，需要刷新。

### 刷新步骤（使用 Playwright MCP 工具）

通过 `playwright` MCP 启动独立的 Chromium 浏览器来提取新 token。
Playwright 默认使用持久化 profile（macOS 路径：`~/Library/Caches/ms-playwright/mcp-*-profile`），Cookie 和登录态会跨会话保留，用户只需首次登录一次，后续刷新通常无需再次登录。

**重要：使用 MCP 工具（`playwright` 服务器），不要使用 `chrome-devtools` 或 DeskClaw 内置的 `browser` 工具。**

1. 用 MCP 工具 `browser_navigate` 打开 `https://manus.im/app`
2. 用 MCP 工具 `browser_snapshot` 获取页面无障碍快照，判断当前页面状态：
   - 如果页面包含登录表单（如用户名/密码输入框、登录按钮等），说明需要登录，进入步骤 3
   - 如果页面已经是 Manus 应用主界面，跳到步骤 4
3. 提示用户在弹出的浏览器窗口中完成登录，然后用 `browser_wait_for` 等待页面出现已登录的标志（如等待登录表单消失或应用主界面出现），不要反复轮询
4. 用 MCP 工具 `browser_evaluate` 执行以下 JavaScript 提取 `session_id` cookie：
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
5. 将获取到的 token 保存：
   ```bash
   bash {baseDir}/scripts/refresh-token.sh "获取到的token"
   ```
6. 重新执行之前失败的命令
