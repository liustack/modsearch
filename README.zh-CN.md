<div align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch，给纯文本 LLM 外挂联网搜索和网页抓取" />
  <h1>ModSearch</h1>
  <p><b>给纯文本 LLM 外挂联网搜索和网页抓取，免费。</b></p>
  <p>
    <a href="https://www.npmjs.com/package/@liustack/modsearch"><img src="https://img.shields.io/npm/v/@liustack/modsearch" alt="npm"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  </p>
  <p><a href="./README.md">English</a></p>
</div>

DeepSeek-V4-Flash 推理漂亮，价格厚道，可惜活在训练截止那天，之后发生的事一概靠猜。跑在 Claude Code、OpenClaw、Codex 或者任何没配搜索工具的宿主里，它查不了资料，你贴个 URL 过去，它也读不出个所以然。

一条命令把这两块都补上。给 ModSearch 一个查询词，它回你真实的最新搜索结果。给它一个 URL，它把页面抓成干净的 markdown 证据。两种输出都是结构化 JSON。「上网」这件事，交给 [Antigravity CLI](https://antigravity.google)（`agy`）去干，用的是 Google 的免费额度，不碰你的 API 账单。

```text
你的纯文本模型 ──▶ modsearch skill（需要时效信息时自动触发）
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
         -q "查询词"           -u <url>
          联网搜索              网页抓取
              └─────────┬─────────┘
                        ▼
             agy · Gemini 3.6 Flash（免费额度）
                        │
                        ▼
           结构化 JSON 证据 ──▶ 模型带着来源回答
```

skill 装一次，你的 agent 以后自己搜索、自己读网页。模型不用换，API key 不用要，提示词也不用改。

## 快速开始

**1. 安装 Antigravity CLI 并登录**（一次性）：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # 浏览器完成登录后退出
```

**2. 安装 skill。** 直接告诉你的 agent（Claude Code、Codex、OpenClaw、Cursor 等）：

```text
Install the skill from https://github.com/liustack/modsearch
```

或者自己动手：

```bash
npx -y skills add liustack/modsearch
```

**3. 用起来。** 问任何时效性问题，或者贴一个 URL 上去。模型需要联网的时候，skill 自动触发。

## 看看效果

搜索：

```bash
npx @liustack/modsearch -q "DeepSeek V4 Flash release date and context window" --max-results 3
```

真实输出（已截断）：

```json
{
  "mode": "search",
  "provider": "antigravity-cli",
  "result": {
    "summary": "DeepSeek V4 Flash was initially released as a preview on April 24, 2026, followed by its official production API release (DeepSeek-V4-Flash-0731) on July 31, 2026. Across both releases it features a 1 million (1M) token context window.",
    "items": [
      {
        "title": "DeepSeek-V4-Flash Official Release & API Specs",
        "url": "https://deepseek.com",
        "snippet": "...284B total parameters and 13B active parameters with enhanced post-training.",
        "published_at": "2026-07-31"
      }
    ],
    "uncertainty": []
  },
  "meta": { "model": "gemini-3.6-flash-low", "durationSeconds": 5.5 }
}
```

抓取网页，还可以带上关注点：

```bash
npx @liustack/modsearch -u "https://github.com/liustack/liustack" -q "what skills does it ship"
```

```json
{
  "mode": "fetch",
  "result": {
    "summary": "Extracted structured evidence from liustack/liustack GitHub README focused on the skills shipped by the package.",
    "content": "#### Shipped Skills\n1. **`shaping`** (Before you start) ...\n2. **`coding`** (While coding) ...\n3. **`dig`** (When there's a bug) ...\n4. **`snapshot`** (When handing off) ...",
    "links": [ { "text": "shaping SKILL.md", "url": "https://github.com/liustack/liustack/blob/main/skills/shaping/SKILL.md" } ],
    "uncertainty": []
  }
}
```

搜索一次 5-20 秒，抓取一次 10-30 秒。JSON 结构由 provider 层的 schema 硬性保证，你的 agent 不用再从 markdown 里抠 JSON 出来。

抓取模式在 Codex 桌面 App 里跑起来是这样：丢一个博客链接，问一句「说的什么」，25 秒拿到结构化摘要，浏览器都不用开。

![纯文本 DeepSeek 通过 ModSearch 总结博客链接](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

开放问题也接得住：问一句「看看今天有啥有趣的 AI 新鲜事」，36 秒回来六条带来源的趣闻，末尾还主动交代哪些信息来自检索聚合、细节可能有出入。

![纯文本 DeepSeek 通过 ModSearch 跑开放式新闻搜索](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## CLI 参数

```bash
modsearch -q "<查询词>"              # 搜索模式
modsearch -u <url> [-q "<关注点>"]   # 抓取模式
```

| 参数 | 含义 | 默认值 |
| :-- | :-- | :-- |
| `-q, --query <text>` | 查询词，配合 `-u` 使用时是提取关注点 | |
| `-u, --url <url>` | 抓取这一页，不做搜索 | |
| `-o, --output <path>` | 同时把 JSON 写入文件 | |
| `-m, --model <name>` | provider 模型 | `gemini-3.6-flash-low` |
| `-p, --provider <name>` | provider | `antigravity-cli` |
| `--max-results <n>` | 搜索结果上限 | `8` |
| `--prompt <text>` | 额外约束 | |
| `--timeout <ms>` | provider 超时 | `180000` |
| `--provider-bin <path>` | provider 可执行文件 | `agy` |
| `--workdir <path>` | provider 运行目录 | |

调研问题难啃，换成 `-m gemini-3.1-pro-high`。输出契约见 [skills/modsearch/references/output-schema.md](skills/modsearch/references/output-schema.md)。

更想用 API 型引擎？设好 `TAVILY_API_KEY` 后，`-p tavily` 让搜索模式跑在 [Tavily](https://app.tavily.com) 上（每月 1000 次免费额度，社区贡献者 [@mani2001](https://github.com/mani2001)）。网页抓取（`-u`）仍走默认 provider。

## 在 Codex 里用（DeepSeek 等纯文本模型）

DeepSeek 官方 Responses 端点自带服务端 `web_search` 工具，Codex 配上 `web_search = "live"` 直连 `api.deepseek.com` 时，普通搜索已经被顺手覆盖了（见[官方集成文档](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/codex)）。ModSearch 真正派上用场是这三种情况：你的渠道没内置搜索（DashScope 和大多数第三方网关都是这样）、你要精读某一个具体页面（`-u` 抓取，内置搜索干不了这个）、或者你用的宿主压根没有原生搜索工具。

## 为什么外挂，而不是换更大的模型？

- **模型不用换。** 你选 DeepSeek-V4-Flash（或 gpt-oss，或别的什么）图的是价格和推理能力，不是搜索能力。ModSearch 只帮它接上网线，不碰这个选择。
- **证据强过感觉。** 答案带着 URL、日期，还有一份明明白白的 `uncertainty` 清单，你的 agent 引用来源，不是靠猜。
- **引擎会死，桥不会死。** v1 跑在 Gemini CLI 免费档上，2026 年 6 月被 Google 一刀切停掉。v2 换到继任者 Antigravity CLI，还是同一个 provider 接口，下次再换引擎，改一个文件就行，不用重写。v2 还顺手吞并了网页抓取，它原本是个独立项目（modfetch，已经退役）。

姊妹项目 ModLens 用同一招补上视觉：[liustack/modlens](https://github.com/liustack/modlens)。

## 用 liustack 打造

ModSearch v2 从需求成形、编码到交付，全程用 **[liustack](https://github.com/liustack/liustack)** 跑完。四个 Agent Skills，一个闭环：动手前 `shaping` 捋清楚，编码时 `coding` 上纪律，出问题 `dig` 挖根因，交接时 `snapshot` 留快照。比 Superpowers 更轻，也更锋利。

**ModSearch 给你的模型接上网线，liustack 给你的整个工作流装上纪律：**

```bash
npx -y skills add liustack/liustack -g
```

⭐ 好用的话，给 [ModSearch](https://github.com/liustack/modsearch) 和 [liustack](https://github.com/liustack/liustack) 各点一个 star。star 是下一个开发者找到它们的方式。

## 安全说明

- ModSearch 调用 `agy` 时带上 `--dangerously-skip-permissions`，因为 print 模式不带这个参数就不执行工具调用。提示词已经把 agent 限定在只做搜索和抓取，并要求把网页内容当数据看，绝不当指令执行。即便如此，抓回来的页面终归是不可信输入，尽量在沙箱化的工作目录里跑。
- 搜索输出是证据，不是圣旨。引擎没法核实的部分会进 `uncertainty`。v1 里那个看着挺精确、实则编出来的数值 `relevance` 分数，v2 已经删掉，排序本身就代表相关度。

## 免责声明

仅供个人学习与实验，不用于商业用途。Antigravity CLI 的使用受你自己的 Google 账号条款和额度约束。

## License

MIT
