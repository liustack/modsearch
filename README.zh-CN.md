<div align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch，给纯文本 LLM 外挂联网搜索和网页抓取" />
  <h1>ModSearch</h1>
  <p><b>免费给你的大语言模型（纯文本 LLM）外挂联网搜索能力。</b></p>
  <p>
    <a href="https://www.npmjs.com/package/@liustack/modsearch"><img src="https://img.shields.io/npm/v/@liustack/modsearch" alt="npm"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  </p>
  <p><a href="./README.md">English</a></p>
</div>

DeepSeek-V4-Flash 碗大又好吃，速度快，性能强，但官方内联的联网搜索能力有点弱，第三方提供商甚至根本不支持联网搜索能力。在这个年代一个大模型它查不了资料，看不了网页可是大麻烦。

ModSearch 用最轻的方式解决它：不动你的配置，不装本地代理，就是一个搜索外挂，CLI 和 skill 两种用法。它产出的不是一段网页摘抄，是结构化的搜索证据：摘要、来源列表（标题、链接、日期）、还有一份老实的不确定清单。搜索和抓网页归它一起管，`-q` 搜，`-u` 抓。默认引擎是 [Antigravity CLI](https://antigravity.google)（`agy`），走 Google 自家的索引，零 key 就能开跑。原理如下：

```text
纯文本模型 ──▶ modsearch skill（需要时效信息时自动触发）
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

**1. 安装 Antigravity CLI 并登录**（一次性，零 key）：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # 浏览器完成登录后退出
```

免费额度够日常用，但不是无限（见下文「三个引擎」）。

**2. 安装 skill。** 直接告诉你的 agent（Claude Code、Codex、OpenClaw、Cursor 等）：

```text
安装这个 skill https://github.com/liustack/modsearch
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
    "links": [
      {
        "text": "shaping SKILL.md",
        "url": "https://github.com/liustack/liustack/blob/main/skills/shaping/SKILL.md"
      }
    ],
    "uncertainty": []
  }
}
```

抓取模式在 Codex 桌面 App 里跑起来是这样：丢一个博客链接，问一句「说的什么」，25 秒拿到结构化摘要，浏览器都不用开。

![纯文本 DeepSeek 通过 ModSearch 总结博客链接](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

开放问题也接得住：问一句「看看今天有啥有趣的 AI 新鲜事」，36 秒回来六条带来源的趣闻，末尾还主动交代哪些信息来自检索聚合、细节可能有出入。

![纯文本 DeepSeek 通过 ModSearch 跑开放式新闻搜索](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## 有 Grok Build，就送你 X（推特）搜索

X 关上 API 大门之后，Google 的索引进不去，任何网页搜索引擎都答不了「X 上大家怎么说」。能进去的只有 xAI 自家的 [Grok Build CLI](https://x.ai/news/grok-build-cli)，SuperGrok 和 X Premium 订阅自带。

ModSearch 的做法是路由，不是堆引擎。查询词里带着 X 味（twitter、tweet、推特、推文、x.com、on X 这些），而且本机装着登录过的 `grok`，这条查询就整条改走 Grok：真实帖子、作者 handle、原帖链接，JSON 结构跟普通搜索一模一样，而且一点 agy 额度都不花（那点额度本来就紧张，留给 Google 真正擅长的活）。没装 Grok Build，或者 grok 半路失手，查询就安静回落到默认引擎。零配置。

```bash
modsearch -q "DeepSeek V4 Flash 在推特上的评价"   # 自动改走 grok-cli
modsearch -q "社区对这次发布的风评" --x            # 没有关键词也强制路由
modsearch -q "..." --no-x                          # 锁定默认引擎
```

## CLI 参数

```bash
modsearch -q "<查询词>"              # 搜索模式
modsearch -u <url> [-q "<关注点>"]   # 抓取模式
```

| 参数                    | 含义                                 | 默认值                 |
| :---------------------- | :----------------------------------- | :--------------------- |
| `-q, --query <text>`    | 查询词，配合 `-u` 使用时是提取关注点 |                        |
| `-u, --url <url>`       | 抓取这一页，不做搜索                 |                        |
| `-o, --output <path>`   | 同时把 JSON 写入文件                 |                        |
| `-m, --model <name>`    | provider 模型                        | `gemini-3.6-flash-low` |
| `-p, --provider <name>` | provider                             | `antigravity-cli`      |
| `--max-results <n>`     | 搜索结果上限                         | `8`                    |
| `--prompt <text>`       | 额外约束                             |                        |
| `--timeout <ms>`        | provider 超时                        | `180000`               |
| `--provider-bin <path>` | provider 可执行文件                  | `agy`                  |
| `--workdir <path>`      | provider 运行目录                    |                        |

调研问题难啃，换成 `-m gemini-3.1-pro-high`。输出契约见 [skills/modsearch/references/output-schema.md](skills/modsearch/references/output-schema.md)。

## 三个引擎

| 引擎 | 需要什么 | 管什么 |
| :-- | :-- | :-- |
| `antigravity-cli`（默认） | `agy` 登录过，零 key | 搜索 + 抓网页，走 Google 索引 |
| `tavily` | 一个 Tavily key（[免费档](https://app.tavily.com)每月 1000 credits，不要信用卡，基础搜索 1 次 1 credit） | 只管搜索，`-p tavily` 显式选用 |
| `grok-cli` | Grok Build 登录过（SuperGrok 或 X Premium） | X 上的内容，命中关键词自动路由 |

配置放在 `~/.modsearch/config.json`，环境变量能盖过它（`TAVILY_API_KEY`），命令行参数最大：

```bash
modsearch config init                        # 生成配置骨架
modsearch config set tavily.apiKey <key>     # 落盘即 0600 权限
modsearch config set provider tavily         # 钉死一个引擎，路由随之关闭
modsearch config set provider ""             # 清空，恢复自动路由
modsearch config show                        # key 打码显示
```

这些命令你一条都不用记。skill 里带着这份配置说明，装完直接问你的 agent：「帮我把 Tavily key 配进 modsearch」「modsearch 怎么配置」，它自己会跑完。

`agy` 胜在零 key，短板是额度。它的免费档如今是一次性发放的周配额，桌面应用、CLI、SDK 共用一个池子，subagent 并行还加倍消耗，用超了得等下个周期（我们实测撞过一次，提示「94 小时后重置」）。搜得多的人可以配上 `TAVILY_API_KEY` 备一手，X 那条路则完全不吃 agy 额度。

## 在 Codex 里用（DeepSeek 等纯文本模型）

DeepSeek 官方端点自带服务端 `web_search` 工具，Codex 走的 Responses API 承接，Claude Code 走的 Anthropic 兼容端点也承接，配上 `web_search = "live"` 直连 `api.deepseek.com`，普通搜索就被顺手覆盖了（见[官方集成文档](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/codex)）。ModSearch 真正派上用场是这几种情况：你的渠道没内置搜索（DashScope 和大多数第三方网关都是这样，官方的 `/chat/completions` 端点也没提供这个工具，OpenCode、Pi 这些宿主就是这么被挡在门外的）、你要精读某一个具体页面（`-u` 抓取，内置搜索干不了）、你要查 X 上的内容（Google 索引进不去）、或者你用的宿主压根没有原生搜索工具。

## 为什么外挂，而不是换更大的模型？

- **模型不用换。** 你选 DeepSeek-V4-Flash（或 gpt-oss，或别的什么）图的是价格和推理能力，不是搜索能力。ModSearch 只帮它接上网线，不碰这个选择。
- **证据强过感觉。** 答案带着 URL、日期，还有一份明明白白的 `uncertainty` 清单，你的 agent 引用来源，不是靠猜。
- **引擎会死，桥不会死。** v1 跑在 Gemini CLI 免费档上，2026 年 6 月被 Google 一刀切停掉。v2 换到继任者 Antigravity CLI，还是同一个 provider 接口，下次再换引擎，改一个文件就行，不用重写。

兄弟项目 ModLens 用同一招补上视觉：[liustack/modlens](https://github.com/liustack/modlens)。

## 插入一条硬广告

本项目由 LIUSTACK Skills 驱动，ModSearch v2 从需求成形、编码到交付，全程用 **[liustack](https://github.com/liustack/liustack)** 驱动：动手前 `shaping` 捋清楚，编码时 `coding` 上纪律，出问题 `dig` 挖根因，交接时 `snapshot` 留快照。比 Superpowers 更轻，也更强。

**ModSearch 给你的模型接上网线，LIUSTACK Skills 给你的开发工作流装上翅膀：**

```bash
npx -y skills add liustack/liustack -g
```

⭐ 好用的话，给 [ModSearch](https://github.com/liustack/modsearch) 和 [liustack](https://github.com/liustack/liustack) 各点一个 star。star 是下一个开发者找到它们的方式。

## 安全说明

- ModSearch 调用 `agy` 时带上 `--dangerously-skip-permissions`，因为 prompt/print 模式不带这个参数在某些场景会失败。提示词已经把 agent 限定在只做搜索和抓取，并要求把网页内容当数据看，绝不当指令执行。即便如此，抓回来的页面终归是不可信输入，尽量在沙箱化的工作目录里跑。
- 搜索输出是证据，引擎没法核实的部分会进 `uncertainty`。v1 里那个看着挺精确、实则编出来的数值 `relevance` 分数，v2 已经删掉，排序本身就代表相关度。

## 免责声明

仅供个人学习与实验，不用于商业用途。Antigravity CLI 的使用受你自己的 Google 账号条款和额度约束。

## License

MIT
