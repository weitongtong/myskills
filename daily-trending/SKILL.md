---
slug: daily-trending
version: 2.1.0
name: daily-trending
displayName: 每日技术热榜
description: "获取 Hacker News Top Stories 和 GitHub Trending 日榜，本地 JSON 存档 + Markdown 可读输出。当用户提到热榜、trending、HN、GitHub 热门、今日热门项目时使用。"
summary: "每日获取 HN 和 GitHub Trending，JSON 存档 + Markdown 可读输出。"
tags: hackernews, github, trending, crawler
metadata: { "deskclaw": { "emoji": "🔥", "requires": { "bins": ["node"] } } }
---

# 每日技术热榜

## 动作路由（必须严格遵循）

收到消息后，**先匹配下表，执行对应动作**。

| 消息关键词 | 动作 |
|-----------|------|
| "爬取热榜" / "抓取今日热榜" / "crawl trending" / "fetch trending" / "爬取今日热榜" | 执行 **爬取流程** |
| "今日热榜" / "热门项目" / "trending" / "HN热榜" / "GitHub热门" / "看看热榜" / "最新热门" / "show trending" | 执行 **查询流程** |

## 爬取流程

分两步：脚本负责网络请求和去噪并保存文件，你负责阅读 GitHub HTML 并提取结构化数据。

### 第一步：运行爬取脚本

```bash
node {baseDir}/scripts/crawl.mjs
```

> 如果 `node` 命令不可用，尝试使用 `~/.deskclaw/node/bin/node` 完整路径。

脚本会自动保存以下文件并在 stdout 输出摘要：

- `{baseDir}/data/{date}.json` — 包含日期、爬取时间和 HN 结构化数据
- `{baseDir}/data/{date}.gh.html` — 精简后的 GitHub Trending 页面 HTML（已去除 script/style/nav 等噪声标签）

可选参数：
- `--source hn` 仅爬取 Hacker News
- `--source gh` 仅爬取 GitHub Trending

### 第二步：阅读 GitHub HTML 并提取数据

用 `read_file` 读取 `{baseDir}/data/{date}.gh.html`。

**直接阅读 HTML 内容，像阅读网页一样理解其中的仓库列表，从中提取每个 trending 仓库的以下字段：**

- `rank`：排名序号（从 1 开始，按出现顺序）
- `repo`：仓库全名（格式 `owner/repo-name`，从链接中提取）
- `url`：仓库 URL（`https://github.com/{repo}`）
- `description`：项目描述
- `language`：编程语言
- `stars`：总 star 数（注意单位转换，如 "1,234" → 1234）
- `todayStars`：今日新增 star 数（通常显示为 "xxx stars today"）

**禁止事项**：
- **禁止编写任何代码或脚本来解析 HTML**（不要用 exec 运行 node/python 脚本）
- **禁止使用正则表达式提取数据**
- 你应该直接理解 HTML 文本中的内容，就像人类阅读网页源码一样

### 第三步：更新 JSON 并生成 Markdown

1. 用 `read_file` 读取 `{baseDir}/data/{date}.json`（脚本已在第一步保存）
2. 在 JSON 中添加 `gh` 数组（你在第二步提取的 GitHub 数据）
3. 用 `write_file` 写回更新后的 JSON 到 `{baseDir}/data/{date}.json`

完整 JSON 结构：

```json
{
  "date": "2026-04-08",
  "crawledAt": "2026-04-08T10:30:00.000Z",
  "hn": [
    { "rank": 1, "id": 12345, "title": "...", "url": "...", "score": 100, "comments": 50, "author": "...", "hnUrl": "..." }
  ],
  "gh": [
    { "rank": 1, "repo": "owner/name", "url": "https://github.com/owner/name", "description": "...", "language": "Rust", "stars": 5000, "todayStars": 200 }
  ]
}
```

4. 生成 Markdown 表格写入 `{baseDir}/data/{date}.md`，包含 HN 和 GitHub 两部分，格式自由，确保信息完整

5. 告知用户爬取结果（HN 多少条、GitHub 多少条）

## 查询流程

直接运行查询脚本并将输出返回给用户。

```bash
node {baseDir}/scripts/query.mjs
```

可选参数：
- `--days 7` 最近 N 天
- `--date 2026-04-08` 指定日期
- `--source hn` 或 `--source gh` 仅看单个数据源
- `--keyword rust` 关键词搜索
- `--top 10` 只看前 N 条
- 可组合：`--source gh --keyword python --top 5`

如果本地无数据，先执行爬取流程，再查询。

## 数据清理

```bash
node {baseDir}/scripts/crawl.mjs --clean
node {baseDir}/scripts/crawl.mjs --clean --keep-days 30
```

## 错误处理

### crawl.mjs 退出码

| 退出码 | 含义 | 处理方式 |
|--------|------|----------|
| 0 | 全部成功 | 正常继续第二步 |
| 1 | 部分失败（某数据源超时/网络错误） | 处理成功的部分，提示用户某个数据源暂时不可用 |
| 2 | 全部失败 | 告知用户爬取失败，建议检查网络后重试 |

### query.mjs 退出码

| 退出码 | 含义 | 处理方式 |
|--------|------|----------|
| 0 | 查询成功 | 正常返回脚本输出 |
| 1 | 无数据 | 提示用户先执行爬取，或检查日期/关键词是否正确 |
