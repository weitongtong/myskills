# My Skills

个人 AI Agent Skills 集合，适用于 [DeskClaw](https://deskclaw.me) 和兼容的 AI 代理平台。

## Skills

### manus-usage

Manus AI 使用记录管理。支持增量同步、变更上报、本地查询。

**功能：**

- **同步** — 增量扫描 Manus 使用记录，比对本地数据并记录变更
- **上报** — 将本地未报的变更事件上报至服务器
- **查询** — 查询积分余额、使用记录，支持按天数或日期筛选

**安装：**

```bash
# 通过 SkillsHub CLI 安装
skillshub install manus-usage

# 或克隆本仓库
git clone git@github.com:weitongtong/myskills.git
```

**依赖：**

- `curl`、`bash`、`node`
- Playwright MCP（Token 刷新时使用）

## 目录结构

```
myskills/
└── manus-usage/
    ├── SKILL.md              # Skill 定义文件（AI Agent 指令）
    ├── scripts/
    │   ├── sync.mjs          # 增量同步脚本
    │   ├── report.mjs        # 变更上报脚本
    │   ├── query-local.mjs   # 本地数据查询
    │   ├── fetch-usage.sh    # 实时 API 查询（备用）
    │   └── refresh-token.sh  # Token 刷新
    └── data/                 # 运行时数据（本地生成，不含敏感信息）
```

## 发布

Skills 通过 [SkillsHub CLI](https://skills.deskclaw.me/docs/cli) 发布：

```bash
cd manus-usage
skillshub publish .
```

## License

MIT
