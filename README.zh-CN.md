<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch" />
</p>

<h1 align="center">ModSearch</h1>

<p align="center"><b>给纯文本模型接上网线，而不用整页网页糊住它的上下文。</b></p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="docs/troubleshooting.md">故障排查</a> ·
  <a href="skills/modsearch/references/configure.md">配置</a> ·
  <a href="skills/modsearch/references/output-schema.md">输出契约</a> ·
  <a href="docs/security.md">安全</a> ·
  <a href="https://github.com/liustack/modlens">ModLens（视觉）</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@liustack/modsearch"><img src="https://img.shields.io/npm/v/@liustack/modsearch?style=flat-square&label=npm&color=cb3837" alt="npm"></a>
  <a href="https://github.com/liustack/modsearch/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/liustack/modsearch/ci.yml?branch=main&style=flat-square&label=ci" alt="CI"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@liustack/modsearch?style=flat-square" alt="Node.js"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
</p>

```bash
npx -y skills add liustack/modsearch          # 装 skill
npx @liustack/modsearch -q "Node.js LTS 版本"  # 或者直接当 CLI 用
```

DeepSeek-V4-Flash 这类模型便宜、快、能打，唯独查不了资料读不了网页。ModSearch 一条命令搜网页、精读某个页面、翻 X，回来的是几百 token 的结构化证据，而不是一坨网页原文。模型不用换，提示词不用改。

## 亮点

- **省上下文。** 内置搜索把整页塞进主模型（实测一次问答约三万 token），这里主模型只读几百 token 的证据。
- **答案能引用。** 标题、链接、日期都在结果里，外加一份写明哪些没查实的 `uncertainty`。
- **能进 X（推特）。** 装了 Grok Build 就进得去，那是网页搜索够不着的地方。
- **读网页永不失手。** 零依赖的本地抓取器兜底，引擎没装或跑挂都落到它。
- **零配置起步。** 没有配置文件要填，装了什么就用什么，额度烧穿自动换引擎。
- **一次装好，处处能用。** Claude Code、Codex、Pi、OpenCode 都吃这套。

<sub>「约三万 token」是 2026-08 的一次实测，不是基准跑分：DeepSeek-V4-Flash 经 Codex 的 Responses API 端点回答一次带搜索的问答。它说明的是「整页塞进上下文」的量级，不是某个固定数字。</sub>

## 安装

```bash
npx -y skills add liustack/modsearch
```

或者跟你的 agent 说一句「安装这个 skill https://github.com/liustack/modsearch」。

再给它一个搜索引擎，二选一。**Antigravity CLI**（零 key，搜索和读网页一并包了）：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash && agy   # 浏览器登录后退出
```

或者一个 **[Tavily](https://app.tavily.com) key**（免费档每月一千次）：

```bash
modsearch config set tavily.apiKey <key>
```

两个都没有时命令会把这两条路直接摆给你。读网页零依赖，本来就能用。需要 Node 18+，macOS 或 Linux。

## 用法

装完 skill 就不用记命令，直接问需要查证的问题或甩一个 URL，skill 自己触发。手动用：

```bash
modsearch -q "Node.js 现在的 LTS 版本"        # 搜网页
modsearch -u "https://nodejs.org/en/about"    # 读一个页面，可加 -q 指定关注点
modsearch -q "推特上怎么评价" --source x       # 搜 X，带 X 味的查询会自动走这条
```

输出永远是 `results` 数组，一个语料一格：

```json
{
  "mode": "search",
  "results": [{
    "source": "web",
    "engine": "antigravity-cli",
    "summary": "Node.js 当前 LTS 是 v24.19.0（Krypton），2026-08-03 发布。",
    "items": [{ "title": "...", "url": "https://...", "published_at": "2026-08-03" }],
    "uncertainty": [],
    "durationSeconds": 5.5
  }]
}
```

Codex 桌面 App 里的实拍：丢个博客链接问一句「说的什么」，25 秒拿到结构化摘要，浏览器都不用开。

![纯文本 DeepSeek 通过 ModSearch 总结博客链接](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

## 它是怎么干活的

![纯文本模型经 modsearch skill 拿到网页搜索、单页精读、X 三条来源，回来的是结构化 JSON 证据](https://raw.githubusercontent.com/liustack/modsearch/main/assets/flow.zh.png)

三件事，各有各的引擎，只有搜索需要你准备一样东西：

| 干什么 | 需要什么 | 怎么用 |
| :-- | :-- | :-- |
| 搜公共网页 | agy 或一个 Tavily key | `-q "查询词"` |
| 读一个 URL | 什么都不用装 | `-u <url>` |
| 搜 X（推特） | Grok Build（SuperGrok 或 X Premium 自带） | 自动触发，或 `--source x` |

短板一并摆这儿：agy 免费额度是周配额，重度用会撞墙（配了 Tavily key 自动接上）。X 那条路要订阅。本地抓取器不跑 JavaScript，纯前端渲染的页面读得薄。

## CLI 参数

| 参数 | 含义 | 默认值 |
| :-- | :-- | :-- |
| `-q, --query <text>` | 查询词，配合 `-u` 时是提取关注点 | |
| `-u, --url <url>` | 抓这一页，不做搜索 | |
| `-s, --source <list>` | 语料：`web`、`x` 或 `web,x` | 看查询词，默认 `web` |
| `-e, --engine <name>` | 本次强制用某个引擎 | 自动挑本机能用的 |
| `-o, --output <path>` | 同时把 JSON 写入文件 | |
| `-m, --model <name>` | 引擎模型 | `gemini-3.6-flash-low` |
| `--prompt <text>` | 本次运行的额外约束，透传给引擎 | |
| `--max-results <n>` | 搜索结果上限 | `8` |
| `--timeout <ms>` | 引擎超时 | `180000` |
| `--workdir <path>` | 需要跑命令的引擎的工作目录 | 当前目录 |
| `--allow-private-network` | 放行保留网段，给映射公网域名的 VPN 用 | 关 |

配置是可选的，`~/.modsearch/config.json` 只有一个决定要做：搜索用哪个引擎（`modsearch config set engine tavily`，留空则自动挑）。读网页和搜 X 都不需要配置。

## 文档

| 文档 | 什么时候看 |
| :-- | :-- |
| [故障排查](docs/troubleshooting.md) | 命令报错，想知道成因和解法 |
| [配置手册](skills/modsearch/references/configure.md) | 配 key、换引擎、排查配置 |
| [输出契约](skills/modsearch/references/output-schema.md) | 要解析 JSON 或写下游工具 |
| [宿主接入](docs/harness-setup.md) | 在 Codex、Claude Code、OpenCode、Pi 里配置 |
| [安全说明](docs/security.md) | SSRF 防护、已知缺口、不可信输入的处理 |
| [更新日志](CHANGELOG.md) | 想知道某个版本改了什么 |
| [AGENTS.md](AGENTS.md) | 要改这个项目的代码 |

## 插入一条硬广告

本项目由 LIUSTACK Skills 驱动：动手前 `shaping` 捋清楚，编码时 `coding` 上纪律，出问题 `dig` 挖根因，交接时 `snapshot` 留快照。比 Superpowers 更轻，也更强。

```bash
npx -y skills add liustack/liustack -g
```

⭐ 好用的话给 [ModSearch](https://github.com/liustack/modsearch) 和 [liustack](https://github.com/liustack/liustack) 各点一个 star。star 是下一个开发者找到它们的方式。

## 免责声明

ModSearch 以 MIT 许可发布，使用不受限制。作者不对任何用途（含商业使用）提供保证与背书。它驱动的上游引擎（Antigravity CLI、Tavily、Grok Build）各有各的条款与额度，遵守这些约束由使用者自负。

## License

MIT
