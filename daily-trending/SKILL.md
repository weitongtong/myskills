---
slug: daily-trending
version: 1.0.0
name: daily-trending
displayName: 每日技术热榜
description: "爬取 Hacker News Top Stories 和 GitHub Trending 日榜，本地 JSON 存档 + Markdown 可读输出。当用户提到热榜、trending、HN、GitHub 热门、今日热门项目时使用。"
summary: "每日爬取 HN 和 GitHub Trending，JSON 存档 + Markdown 可读输出。"
tags: hackernews, github, trending, crawler
metadata: { "deskclaw": { "emoji": "🔥", "requires": { "bins": ["node"] } } }
---

# 每日技术热榜

## 动作路由（必须严格遵循）

收到消息后，**先匹配下表，直接执行对应命令**。只需运行脚本并将脚本输出返回给用户。

| 消息关键词 | 必须执行的命令 | 说明 |
|-----------|--------------|------|
| "爬取热榜" / "抓取今日热榜" / "crawl trending" / "爬取今日热榜" | `node {baseDir}/scripts/crawl.mjs` | 爬取 HN + GitHub Trending，保存到本地 |
| "今日热榜" / "热门项目" / "trending" / "HN热榜" / "GitHub热门" | `node {baseDir}/scripts/query.mjs` | 查询本地已爬取的数据并展示 |

**禁止事项**：
- 收到"爬取"时，禁止自己访问 API 来代替爬取，必须执行 `crawl.mjs`
- 收到查询时，禁止自己读取 JSON 文件来代替查询，必须执行 `query.mjs`

## 爬取热榜

```bash
# 爬取全部（HN + GitHub）
node {baseDir}/scripts/crawl.mjs

# 仅爬取 Hacker News
node {baseDir}/scripts/crawl.mjs --source hn

# 仅爬取 GitHub Trending
node {baseDir}/scripts/crawl.mjs --source gh
```

脚本会将数据保存到 `{baseDir}/data/{日期}.json` 和 `{baseDir}/data/{日期}.md`。

## 查询热榜

```bash
# 查询最新一天
node {baseDir}/scripts/query.mjs

# 最近 N 天
node {baseDir}/scripts/query.mjs --days 7

# 指定日期
node {baseDir}/scripts/query.mjs --date 2026-04-08

# 仅看 HN 或 GitHub
node {baseDir}/scripts/query.mjs --source hn
node {baseDir}/scripts/query.mjs --source gh
```

如果本地无数据，先执行 `node {baseDir}/scripts/crawl.mjs`，再查询。

## 错误处理

| 退出码 | 含义 | 处理方式 |
|--------|------|----------|
| 0 | 全部成功 | 正常返回脚本输出 |
| 1 | 部分失败（某数据源超时/解析失败） | 返回脚本输出，提示用户某个数据源暂时不可用 |
| 2 | 全部失败 | 告知用户爬取失败，建议检查网络后重试 |
