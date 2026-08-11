<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch" />
</p>

<h1 align="center">ModSearch</h1>

<p align="center"><b>为纯文本模型补上联网能力：网页搜索、X 搜索、单页抓取。</b></p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="docs/troubleshooting.md">故障排查</a> ·
  <a href="skills/modsearch/references/configure.md">配置</a> ·
  <a href="skills/modsearch/references/output-schema.md">输出契约</a> ·
  <a href="docs/security.md">安全</a> ·
  <a href="https://github.com/liustack/modlens">ModLens（视觉）</a>
</p>

<p align="center">
  <a href="https://x.com/liustack"><img src="https://img.shields.io/badge/follow-%40liustack-black?style=flat-square&logo=x&logoColor=white" alt="Follow @liustack on X"></a>
  <a href="https://www.npmjs.com/package/@liustack/modsearch"><img src="https://img.shields.io/npm/v/@liustack/modsearch?style=flat-square&label=npm&color=cb3837" alt="npm"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@liustack/modsearch?style=flat-square" alt="Node.js"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
</p>

DeepSeek-V4-Flash 等模型没有联网能力或联网能力羸弱。ModSearch 通过外挂方式大幅增强模型网页搜索、X 搜索、单页抓取能力。

## 特性

- **完全免费。** 默认走 Antigravity CLI 通道，无需 API key。三个备用通道（Tavily、Exa、Firecrawl）均有月度免费额度，注册均不要求绑卡。
- **自动故障转移。** 一个通道失败或额度耗尽时自动切换下一个。
- **可搜索 X（推特）。** 安装 Grok Build 后，可检索网页索引覆盖不到的 X 内容。
- **一次安装，多端可用。** 支持 Claude Code、Codex、Pi、OpenCode。

## 安装

**第一步，准备搜索引擎（唯一需要你亲手做的）。** 默认引擎 Antigravity CLI 需要本人在浏览器完成登录：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy                                                           # 浏览器完成登录后退出
```

不想装它就注册一个免费 key，Tavily、Exa、Firecrawl 任选一家（Tavily 每月 1,000 次，Exa 每月约 1,400 次，Firecrawl 每月 1,000 点，注册均无需绑卡）。

**第二步，剩下的交给你的 AI。** 把这句话发给它，选了 key 的话把 key 一起发：

> 按 https://github.com/liustack/modsearch 的 INSTALL.md 安装并配置 modsearch skill，完成后运行体检并把结果告诉我。

## 用法

装好之后不需要记任何命令。正常聊天，提出需要查证的问题或给出一个链接，skill 自动触发：选引擎、跑搜索或抓取，答案带着来源回来。

## 实测

两张截图均为 Codex 桌面 App 中的原样记录，驱动的是纯文本的 DeepSeek-V4-Flash。

给出一个博客链接，询问文章内容。25 秒后返回全文的结构化摘要，全程未打开浏览器。

![纯文本 DeepSeek 通过 ModSearch 总结博客链接](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

不指定目标，只问「今天有什么有趣的 AI 新闻」。36 秒后返回六条带来源的结果，并在结尾说明哪些信息来自检索聚合、细节可能有出入。该提醒来自 `uncertainty` 字段。

![开放问题返回六条带来源的结果，并附可信度说明](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## 文档

| 文档                                                     | 适用场景                                    |
| :------------------------------------------------------- | :------------------------------------------ |
| [INSTALL.md](INSTALL.md)                                 | 一步步安装 skill（为 agent 编写）           |
| [CLI 手册](skills/modsearch/references/cli.md)           | skill 所驱动的 CLI：参数、配置与体检        |
| [故障排查](docs/troubleshooting.md)                      | 命令报错，查成因和解法                      |
| [配置手册](skills/modsearch/references/configure.md)     | 配置 key、切换引擎、排查配置                |
| [输出契约](skills/modsearch/references/output-schema.md) | 解析 JSON 或构建下游工具                    |
| [宿主接入](docs/harness-setup.md)                        | 在 Codex、Claude Code、OpenCode、Pi 中配置  |
| [安全说明](docs/security.md)                             | SSRF 防护、DNS 重绑定防护、不可信输入的处理 |
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
