<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch" />
</p>

<h1 align="center">ModSearch</h1>

<p align="center"><b>为纯文本模型补上联网能力：网页搜索、X 搜索、单页抓取，返回可引用的结构化证据。</b></p>

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

```text
把这句话发给你的 AI：按 https://github.com/liustack/modsearch 的 INSTALL.md 安装并配置 modsearch skill
```

DeepSeek-V4-Flash 这类纯文本模型没有联网能力，回答时效性问题只能依赖训练数据，答案可能过期而模型自己无从察觉。ModSearch 为它补上三种能力：搜索网页、抓取指定页面、搜索 X（推特），返回几百 token 的结构化证据，每条带来源。不更换模型，不修改提示词，起步不需要任何 key。

## 亮点

- **免费起步。** 默认引擎无需 API key。三个备用引擎（Tavily、Exa、Firecrawl）均有月度免费额度，注册均不要求绑卡。
- **自动故障转移。** 引擎失败或额度耗尽时自动切换下一个，并记录冷却状态，后续查询直接从可用引擎开始，不重复失败请求。
- **可搜索 X（推特）。** 安装 Grok Build 后，可检索网页索引覆盖不到的 X 内容。
- **一次安装，多端可用。** 支持 Claude Code、Codex、Pi、OpenCode。

## 安装

把下面这句话发给你的 AI，它会完成安装、配置和验证，并把结果告诉你：

> 按 https://github.com/liustack/modsearch 的 INSTALL.md 安装并配置 modsearch skill，完成后运行体检并把结果告诉我。

**唯一需要你亲手做的一步**：默认搜索引擎 Antigravity CLI 的浏览器登录需要本人完成：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash   # 安装，AI 已代装过则跳过
agy                                                           # 浏览器完成登录后退出
```

不想装 Antigravity CLI 的话，把 Tavily、Exa 或 Firecrawl 任意一家的免费 key 发给你的 AI 让它配置，就不需要这一步（Tavily 每月 1,000 次，Exa 每月约 1,400 次，Firecrawl 每月 1,000 点，注册均无需绑卡）。

## 用法

安装 skill 后无需记忆命令：提出需要查证的问题，或给出一个 URL，skill 自动触发，由启动器决定如何运行 modsearch。下面的命令用于在装有 Node 的机器上自己驱动 CLI：

```bash
modsearch -q "Node.js 现在的 LTS 版本"        # 搜索网页
modsearch -u "https://nodejs.org/en/about"    # 抓取一个页面，可加 -q 指定提取关注点
modsearch -q "推特上怎么评价" --source x       # 搜索 X，涉及 X 的查询会自动路由
```

输出始终是 `results` 数组，每个语料一条：

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

`uncertainty` 是引擎对事实层面的存疑说明。`warnings` 记录这条结果的路由过程（引擎切换、X 降级为网页、重定向）。`attempts` 记录每次引擎尝试及其结果。

## 实测

两张截图均为 Codex 桌面 App 中的原样记录，驱动的是纯文本的 DeepSeek-V4-Flash。

给出一个博客链接，询问文章内容。25 秒后返回全文的结构化摘要，全程未打开浏览器。

![纯文本 DeepSeek 通过 ModSearch 总结博客链接](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

不指定目标，只问「今天有什么有趣的 AI 新闻」。36 秒后返回六条带来源的结果，并在结尾说明哪些信息来自检索聚合、细节可能有出入。该提醒来自 `uncertainty` 字段。

![开放问题返回六条带来源的结果，并附可信度说明](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## 工作原理

![纯文本模型经 modsearch skill 获得网页搜索、单页抓取、X 三条来源，返回结构化 JSON 证据](https://raw.githubusercontent.com/liustack/modsearch/main/assets/flow.zh.png)

四个步骤：

1. 模型需要外部信息时 skill 触发：时效性问题、用户给出的 URL、涉及 X 的查询。
2. skill 运行 `modsearch` 命令，按任务类型从本机可用引擎中选择一个。
3. 引擎失败或额度耗尽时自动切换下一个，结果中记录实际应答的引擎与切换原因。
4. 模型读取 JSON 证据，带来源作答。

三类任务各有引擎，只有搜索需要准备条件：

| 任务 | 前置条件 | 用法 |
| :-- | :-- | :-- |
| 搜索公共网页 | agy，或 Tavily / Exa / Firecrawl 任一 key | `-q "查询词"` |
| 抓取一个 URL | 无，JavaScript 页面需要 Firecrawl | `-u <url>` |
| 搜索 X（推特） | Grok Build（SuperGrok 或 X Premium 附带） | 自动触发，或 `--source x` |

限制如下：agy 免费额度按周发放，重度使用会耗尽。X 搜索依赖订阅。本地抓取器不执行 JavaScript，纯前端渲染页面内容有限（Firecrawl 可覆盖）。引擎额度耗尽时记入冷却状态并移至队尾，后续查询优先使用可用引擎，冷却结束后自动恢复。

作为量级参照：由服务端内置搜索承载的一次问答，实测消耗约三万 token（2026-08，DeepSeek-V4-Flash 经 Codex 的 Responses API 端点）。ModSearch 返回的证据通常在几百 token。

## CLI 参数

| 参数 | 含义 | 默认值 |
| :-- | :-- | :-- |
| `-q, --query <text>` | 查询词，与 `-u` 同用时为提取关注点 | |
| `-u, --url <url>` | 抓取该页面，不执行搜索 | |
| `-s, --source <list>` | 语料：`web`、`x` 或 `web,x` | 由查询词判定，默认 `web` |
| `-e, --engine <name>` | 本次仅使用该引擎，失败直接报错，不切换其他引擎 | 自动选择 |
| `-o, --output <path>` | 同时将 JSON 写入文件 | |
| `-m, --model <name>` | 引擎模型 | `gemini-3.6-flash-low` |
| `--prompt <text>` | 本次运行的额外约束，透传给引擎 | |
| `--max-results <n>` | 搜索结果上限 | `8` |
| `--timeout <ms>` | 引擎超时 | `180000` |
| `--workdir <path>` | 子进程引擎的工作目录 | 当前目录 |
| `--allow-private-network` | 放行保留网段，用于将公网域名解析到保留地址的 VPN 环境 | 关 |

配置是可选的。`~/.modsearch/config.json` 的核心决定只有一个：搜索使用哪个引擎（`modsearch config set engine tavily`，留空为自动）。抓取和 X 搜索无需配置。额度冷却故障转移默认开启，`modsearch config set cooldown off` 关闭，`modsearch state clear` 清空冷却记录。完整的文件结构与字段说明（含顶层 `allowPrivateNetwork`）见[配置手册](skills/modsearch/references/configure.md)。

`modsearch doctor` 输出本机诊断：Node 版本、各任务的引擎就绪状态及原因、配置来源、私网放行状态、当前冷却中的引擎。不消耗额度，不发起网络请求，`--json` 输出可供程序消费。路由行为不符合预期时先运行它。

## 平台支持

macOS 与 Linux 完整支持，并在 CI 上以 Node 22 和 24 运行完整测试套件。skill 附带 `scripts/run.sh`（macOS 与 Linux）和 `scripts/run.ps1`（Windows）两个启动器，自动选择本机可用的运行方式，三个平台行为一致。

CI 矩阵同样包含 `windows-latest`（Node 22 和 24），运行相同的 typecheck、测试与构建。Windows 上能用什么，取决于各部分依赖什么：

- **CLI、路由与配置逻辑，以及各 HTTP 引擎**（`local` 抓取、Tavily、Exa、Firecrawl）是纯 Node 实现，只用到 `fetch` 和文件系统，因此跨平台。
- **agy 与 grok 是外部 CLI。** modsearch 以命令名、无 shell 的方式调用它们，所以 PATH 上有原生 Windows 可执行文件时可用，而 npm 那种 `.cmd` 包装则不行。是否存在 Windows 版本由这些工具自己决定，与 modsearch 无关。
- **冷却状态文件**通过临时文件加原子改名写入。Windows 上该改名会替换目标文件，但系统无法替换被其他进程打开的文件，因此极少见的同时写入竞争可能丢掉一次写入。该存储是尽力而为的缓存，读取时会合并，后续运行可重新发现丢失的内容。

仅限 Unix 的测试（调用假 CLI、SIGTERM/SIGKILL 升级、POSIX 权限位）在 Windows 上跳过，原因记录在 [docs/testing.md](docs/testing.md)。

## 文档

| 文档 | 适用场景 |
| :-- | :-- |
| [INSTALL.md](INSTALL.md) | 一步步安装 skill（为 agent 编写） |
| [故障排查](docs/troubleshooting.md) | 命令报错，查成因和解法 |
| [配置手册](skills/modsearch/references/configure.md) | 配置 key、切换引擎、排查配置 |
| [输出契约](skills/modsearch/references/output-schema.md) | 解析 JSON 或构建下游工具 |
| [宿主接入](docs/harness-setup.md) | 在 Codex、Claude Code、OpenCode、Pi 中配置 |
| [安全说明](docs/security.md) | SSRF 防护、DNS 重绑定防护、不可信输入的处理 |
| [更新日志](CHANGELOG.md) | 查询版本变更 |
| [AGENTS.md](AGENTS.md) | 修改本项目代码 |

## 参与方式

本仓库不接受 PR。项目由作者独立维护，所有代码经作者本人审阅，这是它可靠性的前提。两种有效的参与方式：

- **[提交 issue](https://github.com/liustack/modsearch/issues)。** bug、建议、难以理解的报错或文档都欢迎。issue 会被认真阅读，并影响后续开发方向。
- **Fork。** MIT 协议下你的副本完全归你，修改和发布不受限制。

## 关注公众号

AI 工具、实践与想法，第一时间推送。微信扫码，或搜索「liustack」关注：

<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/wechat-qrcode.png" width="420" alt="微信公众号 liustack" />
</p>

⭐ 如果它对你有用，请给 [ModSearch](https://github.com/liustack/modsearch) 一个 star，这是其他开发者找到它的方式。

## 免责声明

ModSearch 以 MIT 许可发布，使用不受限制。作者不对任何用途（含商业使用）提供保证与背书。上游引擎（Antigravity CLI、Tavily、Exa、Firecrawl、Grok Build）各有自己的条款与额度，遵守这些约束由使用者负责。

## License

MIT
