<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch" />
</p>

<h1 align="center">ModSearch</h1>

<p align="center"><b>为不能联网的模型补上联网能力：网页搜索、X 搜索、单页抓取。免费，免注册，免 API key。</b></p>

<p align="center">🥇 <b>全网最强的 DeepSeek Harness (dsh) 联网搜索插件</b> 🥇</p>

<p align="center">引擎：<b>Firecrawl</b>（免注册，默认）· <b>Antigravity CLI</b> · <b>Tavily</b> · <b>Exa</b> · <b>Grok（X）</b> · <b>local</b>，自动故障转移</p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="docs/troubleshooting.zh-CN.md">故障排查</a> ·
  <a href="skills/modsearch/references/configure.zh-CN.md">配置</a> ·
  <a href="skills/modsearch/references/output-schema.zh-CN.md">输出契约</a> ·
  <a href="docs/security.zh-CN.md">安全</a> ·
  <a href="https://github.com/liustack/modlens">ModLens（视觉）</a>
</p>

<p align="center">
  <a href="https://x.com/liustack"><img src="https://img.shields.io/badge/follow-%40liustack-black?style=flat-square&logo=x&logoColor=white" alt="Follow @liustack on X"></a>
  <a href="https://www.npmjs.com/package/@liustack/modsearch"><img src="https://img.shields.io/npm/v/@liustack/modsearch?style=flat-square&label=npm&color=cb3837" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@liustack/modsearch?style=flat-square" alt="Node.js"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
  <img src="https://img.shields.io/badge/Not%20backed%20by-Y%20Combinator-FF6600?style=flat-square&logo=ycombinator&logoColor=white" alt="Not backed by Y Combinator">
  <img src="https://img.shields.io/badge/users-unknown-lightgrey?style=flat-square" alt="Users unknown">
</p>

DeepSeek-V4-Flash 等模型没有联网能力或联网能力羸弱。ModSearch 通过外挂方式大幅增强模型网页搜索、X 搜索、单页抓取能力。装完即用：默认引擎是 Firecrawl 的免注册通道，[每月 1,000 免费 credits](https://www.firecrawl.dev/blog/firecrawl-keyless-launch)，不用注册账号，不用 API key，不用绑卡。

## 交流

用出问题了就[提个 issue](https://github.com/liustack/modsearch/issues/new/choose)。其他的都欢迎来 X 上聊：**[@liustack](https://x.com/liustack)**，你用它做了什么、在哪个 harness 上跑、接下来该做什么，新版本也是那边先发。社群正在筹备中。

## 特性

- **🥇 全网最强的 DeepSeek Harness (dsh) 联网搜索插件：** 一条命令 `npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modsearch@5.6.0`，dsh 内置的 `web_search` 就跑在 modsearch 引擎链上，无需 API key，原生引用卡片全部保留。旁边再落两个 dsh 没有的工具：搜 X（推特）的 `x_search` 和带焦点读单页的 `read_page`。更新就是再跑一遍同一条命令。这里点名版本号而不用 `@latest`，是因为 pnpm 11 会扣住最近 24 小时内发布的版本，并让 dist-tag 在剩余的旧版本中解析。细节见[接入指南](docs/harness-setup.zh-CN.md#deepseek-harness-dsh)。
- **开箱免费，免注册。** 搜索和单页抓取默认跑在 Firecrawl 免注册通道上：[每月 1,000 免费 credits](https://www.firecrawl.dev/blog/firecrawl-keyless-launch)，没有账号、没有 API key、没有绑卡。后备通道也全部免费：Antigravity CLI 只需浏览器登录，Tavily、Exa 和免费的 Firecrawl key 各带独立的月度额度，均不要求绑卡。
- **自动故障转移。** 一个通道失败或额度耗尽时自动切换下一个。
- **可搜索 X（推特）。** 安装 Grok Build 后，可检索网页索引覆盖不到的 X 内容。
- **一次安装，多端可用。** 支持 Claude Code、Codex、Pi、OpenCode。

## 支持的引擎

Firecrawl 零配置直接可用，其余引擎各一条命令。key 存在 `~/.modsearch/config.json`（0600 权限，展示时打码）：

| 引擎 | 能做什么 | 免费额度 | 怎么开 |
| :-- | :-- | :-- | :-- |
| Firecrawl（默认） | 网页搜索 + 单页抓取 | 免注册每月 1,000 免费 credits。注册免费 key 再得独享的每月 1,000 | 无需任何操作，装完即用 |
| Antigravity CLI | 网页搜索 + 单页抓取 | 免费，浏览器登录 | 安装 `agy` 并登录 |
| Tavily | 网页搜索 | 每月 1,000 credits，不绑卡 | `modsearch config set tavily.apiKey <key>` |
| Exa | 网页搜索 | 每月 $10 循环额度（约 1,400 次），不绑卡 | `modsearch config set exa.apiKey <key>` |
| Grok Build | X（推特）搜索 | 随 SuperGrok 或 X Premium 订阅 | 安装 `grok` 并登录 |
| local | 单页抓取 | 内置，零安装 | 无需任何操作 |

key 也可以走环境变量（`TAVILY_API_KEY`、`EXA_API_KEY`、`FIRECRAWL_API_KEY`）。配了多个引擎就自动故障转移，好的优先。想用 Tavily、Exa、Firecrawl 兼容的第三方或自建端点？把引擎指过去即可：`modsearch config set tavily.baseURL <url>`。每个引擎的全部配置项见[配置指南](skills/modsearch/references/configure.zh-CN.md)。

## 安装

**第一步，交给你的 AI。** skill 一装好，搜索和单页抓取就跑在 Firecrawl 的免注册免费额度上，所以安装只是一句话：

> 按 https://github.com/liustack/modsearch 的 INSTALL.md 安装并配置 modsearch skill，完成后运行体检并把结果告诉我。

**第二步（可选），再加免费引擎。** Antigravity CLI 的综述质量更高，Tavily、Exa 或免费 Firecrawl key 能在免注册额度之上再加一份个人额度，都不要求绑卡。只有 agy 的浏览器登录需要你亲手完成：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy                                                           # 浏览器完成登录后退出
```

选了 key 的话，发一句话给 AI 即可：「把我的 tavily key 设成 tvly-...」。

## 用法

装好之后不需要记任何命令。正常聊天，提出需要查证的问题或给出一个链接，skill 自动触发：选引擎、跑搜索或抓取，答案带着来源回来。

## 实测

两张截图均为 Codex 桌面 App 中的原样记录，驱动的是自身不能联网的 DeepSeek-V4-Flash。

给出一个博客链接，询问文章内容。25 秒后返回全文的结构化摘要，全程未打开浏览器。

![不能联网的 DeepSeek 通过 ModSearch 总结博客链接](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

不指定目标，只问「今天有什么有趣的 AI 新闻」。36 秒后返回六条带来源的结果，并在结尾说明哪些信息来自检索聚合、细节可能有出入。该提醒来自 `uncertainty` 字段。

![开放问题返回六条带来源的结果，并附可信度说明](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## 文档

| 文档                                                     | 适用场景                                    |
| :------------------------------------------------------- | :------------------------------------------ |
| [INSTALL.md](INSTALL.md)                                 | 一步步安装 skill（为 agent 编写）           |
| [CLI 手册](skills/modsearch/references/cli.zh-CN.md)           | skill 所驱动的 CLI：参数、配置与体检        |
| [故障排查](docs/troubleshooting.zh-CN.md)                      | 命令报错，查成因和解法                      |
| [配置手册](skills/modsearch/references/configure.zh-CN.md)     | 配置 key、切换引擎、排查配置                |
| [输出契约](skills/modsearch/references/output-schema.zh-CN.md) | 解析 JSON 或构建下游工具                    |
| [dsh 插件](docs/dsh.zh-CN.md)                                | 安装、配置、验证与更新原生 dsh bundle       |
| [宿主接入](docs/harness-setup.zh-CN.md)                        | 在 Codex、Claude Code、OpenCode、Pi 中配置  |
| [安全说明](docs/security.zh-CN.md)                             | SSRF 防护、DNS 重绑定防护、不可信输入的处理 |
| [更新日志](CHANGELOG.md)                                 | 查询版本变更                                |

## 参与方式

本仓库不接受 PR。项目由作者独立维护，所有代码经作者本人审阅，这是它可靠性的前提。两种有效的参与方式：

- **[提交 issue](https://github.com/liustack/modsearch/issues)。** bug、建议、难以理解的报错或文档都欢迎。issue 会被认真阅读，并影响后续开发方向。
- **Fork。** MIT 协议下你的副本完全归你，修改和发布不受限制。

## 插入硬广一条

关注微信公众号「liustack」：AI 工具、实践与想法，第一时间推送。微信扫码，或搜一搜「liustack」：

<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/wechat-qrcode.png" width="420" alt="微信公众号 liustack" />
</p>

⭐ 如果它对你有用，请给 [ModSearch](https://github.com/liustack/modsearch) 一个 star，这是其他开发者找到它的方式。

## Star History

<a href="https://www.star-history.com/?repos=liustack%2Fmodlens%2Cliustack%2Fmodsearch&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liustack/modlens%2Cliustack/modsearch&type=date&theme=dark&legend=top-left&sealed_token=Or7BuI_WngbmbQXmU5MOkRi0mu8ZaeY9zRa58EIgcS7P3rwC-hgRNTUvf0IRK2SJL86kdzcR15m7kFiQNWljDgM_z-aroCB17QE25tS-e2dUlNmU7N6r2w" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liustack/modlens%2Cliustack/modsearch&type=date&legend=top-left&sealed_token=Or7BuI_WngbmbQXmU5MOkRi0mu8ZaeY9zRa58EIgcS7P3rwC-hgRNTUvf0IRK2SJL86kdzcR15m7kFiQNWljDgM_z-aroCB17QE25tS-e2dUlNmU7N6r2w" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liustack/modlens%2Cliustack/modsearch&type=date&legend=top-left&sealed_token=Or7BuI_WngbmbQXmU5MOkRi0mu8ZaeY9zRa58EIgcS7P3rwC-hgRNTUvf0IRK2SJL86kdzcR15m7kFiQNWljDgM_z-aroCB17QE25tS-e2dUlNmU7N6r2w" />
 </picture>
</a>

## 免责声明

ModSearch 以 MIT 许可发布，使用不受限制。作者不对任何用途（含商业使用）提供保证与背书。上游引擎（Antigravity CLI、Tavily、Exa、Firecrawl、Grok Build）各有自己的条款与额度，遵守这些约束由使用者负责。

## License

MIT
