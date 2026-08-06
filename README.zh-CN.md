<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch" />
</p>

<h1 align="center">ModSearch</h1>

<p align="center"><b>给纯文本模型接上网线：搜网页、搜 X、读页面，回来的是能引用的证据，不是整页原文。</b></p>

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

DeepSeek-V4-Flash 这类模型便宜、快、能打，唯独活在训练截止那天。问它 Node.js 现在的 LTS 是多少，它凭记忆给你一个数，语气笃定，还可能是错的。ModSearch 给它接一条通往外界的线：搜网页、精读某个页面、进 X 翻帖子，回来的是几百 token 的结构化证据，条条带来源。模型不用换，提示词不用改，起步不要 key。

## 亮点

- **默认就是免费的。** 默认引擎不要任何 key，备胎引擎（Tavily、Exa、Firecrawl）全都有不绑卡的月度免费档。烧穿其中一家的额度，也轮不到你掏钱。
- **自己换人，还记仇。** 引擎挂掉或额度烧干，当场换下一个顶上。冷却记录会记住谁烧穿了，下一次查询直接从能干活的引擎起步，不再白撞一遍慢失败。`doctor` 看谁在冷却，`state clear` 提前赦免。
- **交回证据，不是整页网页。** 服务端内置搜索把整页塞进主模型上下文（实测一次问答约三万 token），ModSearch 只交回几百 token 的可引用证据：标题、链接、日期，外加一份写明哪些没查实的 `uncertainty` 清单。
- **能进 X（推特）。** 装了 Grok Build 就进得去，那是任何网页索引都够不着的语料。
- **读网页永不失手。** 零依赖的本地抓取器无条件兜底，配了 Firecrawl 连 JS 渲染的页面都吃得下。
- **一次装好，处处能用。** Claude Code、Codex、Pi、OpenCode 都吃同一份 skill。

<sub>「约三万 token」是 2026-08 的一次实测，不是基准跑分：DeepSeek-V4-Flash 经 Codex 的 Responses API 端点回答一次带搜索的问答。它说明的是「整页塞进上下文」的量级，不是某个固定数字。</sub>

## 安装

```bash
npx -y skills add liustack/modsearch
```

或者跟你的 agent 说一句「安装这个 skill https://github.com/liustack/modsearch」。

再给它一个搜索引擎。**Antigravity CLI**（零 key，搜索和读网页一并包了）：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash && agy   # 浏览器登录后退出
```

或者一个带 key 的 API，每个都有常驻免费额度且无需绑卡：

```bash
modsearch config set tavily.apiKey <key>       # Tavily: 每月 1,000 credits
modsearch config set exa.apiKey <key>          # Exa: 每月 $10 循环赠额，约 1,400 次搜索
modsearch config set firecrawl.apiKey <key>    # Firecrawl: 每月 1,000 credits，还能读 JavaScript 页面
```

一个都没有时命令会把这些选项直接摆给你。读网页零依赖，本来就能用。需要 Node 22.13+，macOS 或 Linux。

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
    "warnings": [],
    "durationSeconds": 5.5
  }]
}
```

`uncertainty`是引擎对事实拿不准的地方。`warnings`是这条答案怎么路由来的（换了引擎、X 用网页顶替、跟了跳转），`attempts`记录试过哪些引擎。

## 实测

两张截图都是 Codex 桌面 App 里的原样实录，驱动的是纯文本的 DeepSeek-V4-Flash。

丢个博客链接问一句「说的什么」。25 秒后拿到全文的结构化摘要，浏览器从头到尾没打开过。

![纯文本 DeepSeek 通过 ModSearch 总结博客链接](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

连目标都不给，只说「看看今天有啥有趣的 AI 新鲜事」。36 秒后回来六条带来源的趣闻，末尾还主动交代：哪些信息来自检索聚合，细节可能有出入。这份诚实不是临场发挥，是从 `uncertainty` 字段一路带出来的。

![开放问题回来六条带来源的新鲜事，还主动交代可信度](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## 它是怎么干活的

![纯文本模型经 modsearch skill 拿到网页搜索、单页精读、X 三条来源，回来的是结构化 JSON 证据](https://raw.githubusercontent.com/liustack/modsearch/main/assets/flow.zh.png)

没有魔法，四步：

1. 模型需要外部世界时 skill 触发：时效性问题、贴进来的 URL、带 X 味的查询。
2. skill 跑 `modsearch` 命令，命令按活儿从你本机装了的引擎里挑一个。
3. 引擎跑挂了或额度烧干，下一个自动顶上，结果里记着是谁答的、为什么换人。
4. 模型读回 JSON 证据，带着来源回答，而不是凭记忆。

三件活，各有各的引擎，只有搜索需要你准备一样东西：

| 干什么 | 需要什么 | 怎么用 |
| :-- | :-- | :-- |
| 搜公共网页 | agy，或一个 Tavily / Exa / Firecrawl key | `-q "查询词"` |
| 读一个 URL | 什么都不用装，JavaScript 页面可交给 Firecrawl | `-u <url>` |
| 搜 X（推特） | Grok Build（SuperGrok 或 X Premium 自带） | 自动触发，或 `--source x` |

短板一并摆这儿：agy 免费额度是周配额，重度用会撞墙。X 那条路要订阅。本地抓取器不跑 JavaScript，纯前端渲染的页面读得薄（配了 Firecrawl 就能读）。某个引擎额度烧干时，带 key 的备用引擎会自动接上，modsearch 还会记住这个撞墙的引擎，把它挪到队尾，下次运行先用健康的引擎故障转移，不再撞同一堵墙。

## CLI 参数

| 参数 | 含义 | 默认值 |
| :-- | :-- | :-- |
| `-q, --query <text>` | 查询词，配合 `-u` 时是提取关注点 | |
| `-u, --url <url>` | 抓这一页，不做搜索 | |
| `-s, --source <list>` | 语料：`web`、`x` 或 `web,x` | 看查询词，默认 `web` |
| `-e, --engine <name>` | 本次强制只用这一个引擎，不兜底：该引擎干不了或失败就直接报错，不会偷偷换别的引擎。想让 modsearch 自动挑并故障切换就别加它。 | 自动挑本机能用的 |
| `-o, --output <path>` | 同时把 JSON 写入文件 | |
| `-m, --model <name>` | 引擎模型 | `gemini-3.6-flash-low` |
| `--prompt <text>` | 本次运行的额外约束，透传给引擎 | |
| `--max-results <n>` | 搜索结果上限 | `8` |
| `--timeout <ms>` | 引擎超时 | `180000` |
| `--workdir <path>` | 需要跑命令的引擎的工作目录 | 当前目录 |
| `--allow-private-network` | 放行保留网段，给映射公网域名的 VPN 用 | 关 |

配置是可选的，`~/.modsearch/config.json` 只有一个决定要做：搜索用哪个引擎（`modsearch config set engine tavily`，留空则自动挑）。读网页和搜 X 都不需要配置。额度冷却故障转移默认开启，`modsearch config set cooldown off` 可关掉，`modsearch state clear` 清掉正在冷却的记录。完整的文件结构和每个字段（含顶层 `allowPrivateNetwork` 开关）见[配置手册](skills/modsearch/references/configure.md)。

跑 `modsearch doctor` 看本机现状：Node 版本、每个角色的引擎各自就绪与否及原因、配置来自哪层、私网放行开没开、当前有哪些引擎在冷却。它不花额度、不发网络请求，加 `--json` 可喂给工具。路由不如预期时先跑它。

## 文档

| 文档 | 什么时候看 |
| :-- | :-- |
| [故障排查](docs/troubleshooting.md) | 命令报错，想知道成因和解法 |
| [配置手册](skills/modsearch/references/configure.md) | 配 key、换引擎、排查配置 |
| [输出契约](skills/modsearch/references/output-schema.md) | 要解析 JSON 或写下游工具 |
| [宿主接入](docs/harness-setup.md) | 在 Codex、Claude Code、OpenCode、Pi 里配置 |
| [安全说明](docs/security.md) | SSRF 防护、DNS 重绑定防护、不可信输入的处理 |
| [更新日志](CHANGELOG.md) | 想知道某个版本改了什么 |
| [AGENTS.md](AGENTS.md) | 要改这个项目的代码 |

## 参与方式

本仓不收 PR。工具小，一双手维护，每一行代码都要作者自己背，这个闭环收紧了它才可靠。真正帮得上忙的两条路：

- **[提 issue](https://github.com/liustack/modsearch/issues)。** bug、想法、看不懂的报错、读着别扭的文档都算。issue 一定会被读，也真的会影响接下来做什么。
- **Fork。** MIT 协议下你的副本完全归你：改名、魔改、发布都随意。

## 关注公众号

AI 工具、实践与想法，第一时间推送。微信扫码，或搜一搜「liustack」关注：

<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/wechat-qrcode.png" width="420" alt="微信公众号 liustack" />
</p>

⭐ 好用的话给 [ModSearch](https://github.com/liustack/modsearch) 点个 star，这是下一个开发者找到它的方式。

## 免责声明

ModSearch 以 MIT 许可发布，使用不受限制。作者不对任何用途（含商业使用）提供保证与背书。它驱动的上游引擎（Antigravity CLI、Tavily、Grok Build）各有各的条款与额度，遵守这些约束由使用者自负。

## License

MIT
