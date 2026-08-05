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

DeepSeek-V4-Flash 碗大又好吃，速度快、便宜、能打，唯独查不了资料、读不了网页。换成第三方网关更惨，连内置搜索这个选项都没有。

ModSearch 给它接上网线：一条命令搜网页、精读某个页面、翻 X，回来的不是一坨网页原文，是几百 token 的结构化证据（摘要、来源链接、日期，外加一份没查实的清单）。模型不用换，提示词不用改，本地不装代理。

![纯文本模型经 modsearch skill 拿到网页搜索、单页精读、X 三条来源，回来的是结构化 JSON 证据](https://raw.githubusercontent.com/liustack/modsearch/main/assets/flow.zh.png)

## 三步用起来

**一、装 skill。** 跟你的 agent 说一句就行（Claude Code、Codex、OpenClaw、Cursor 都吃这套）：

```text
安装这个 skill https://github.com/liustack/modsearch
```

自己动手也行：`npx -y skills add liustack/modsearch`

**二、接一个搜索引擎。** 推荐 Antigravity CLI，零 key，搜索和读网页它一个人全包：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # 浏览器完成登录后退出
```

**三、直接问。** 问任何需要查证的问题，或者甩一个 URL 上去，skill 自己会触发。

没有第四步。没有配置文件要填，也没有环境变量要 export。读网页零依赖，本来就能用；搜索要么走 agy，要么给个 Tavily key（免费档每月一千次），两个都没有时命令会把这两条路直接摆给你，而不是含糊报错。

环境要求就一行：Node 18+，macOS 或 Linux。

## 看看效果

```bash
npx @liustack/modsearch -q "DeepSeek V4 Flash release date and context window" --max-results 3
```

真实输出（已截断）：

```json
{
  "mode": "search",
  "query": "DeepSeek V4 Flash release date and context window",
  "results": [
    {
      "source": "web",
      "engine": "antigravity-cli",
      "model": "gemini-3.6-flash-low",
      "summary": "DeepSeek V4 Flash was initially released as a preview on April 24, 2026, followed by its official production API release (DeepSeek-V4-Flash-0731) on July 31, 2026. Across both releases it features a 1 million (1M) token context window.",
      "items": [
        {
          "title": "DeepSeek-V4-Flash Official Release & API Specs",
          "url": "https://deepseek.com",
          "snippet": "...284B total parameters and 13B active parameters with enhanced post-training.",
          "published_at": "2026-07-31"
        }
      ],
      "uncertainty": [],
      "durationSeconds": 5.5
    }
  ],
  "meta": { "generatedAt": "2026-08-05T...", "durationSeconds": 5.6 }
}
```

`results` 永远是数组，一个语料一格，形状不随语料数量变。

读一个页面，还能指定关注点：

```bash
npx @liustack/modsearch -u "https://github.com/liustack/liustack" -q "what skills does it ship"
```

```json
{
  "mode": "fetch",
  "results": [
    {
      "source": "web",
      "engine": "antigravity-cli",
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
  ]
}
```

Codex 桌面 App 里的样子：丢个博客链接问一句「说的什么」，25 秒拿到结构化摘要，浏览器都不用开。

![纯文本 DeepSeek 通过 ModSearch 总结博客链接](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

开放问题也接得住：「看看今天有啥有趣的 AI 新鲜事」，36 秒六条带来源的趣闻，末尾还主动交代哪些来自检索聚合、细节可能有出入。

![纯文本 DeepSeek 通过 ModSearch 跑开放式新闻搜索](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## 就算你已经有搜索

内置搜索是这么干活的：模型发起搜索，服务端把整页网页塞进上下文，模型再在里面找答案。导航栏、页脚、cookie 提示，你为每一个字付费。我实测一次带搜索的问答约三万 token，大半烧在这儿。

ModSearch 给模型的是提炼后的证据，不是原料。同一个问题，主模型这边只读几百 token。

| | 内置搜索 | 搜索类 MCP server | ModSearch |
| :-- | :-- | :-- | :-- |
| 主模型要读多少 | 整页原文，约 3 万 token | 多数也是整页 | 几百 token 的证据 |
| 能不能引用来源 | 靠模型自己整理 | 看实现 | 标题、链接、日期都在结果里 |
| 精读指定 URL | 一般给不了 | 少数支持 | `-u`，还能带关注点 |
| X（推特） | 看不见 | 看不见 | 装了 Grok Build 就能看 |
| 渠道没搜索工具时 | 没辙 | 能用 | 能用 |
| 要装什么 | 无 | 一个 server 加配置 | 一个 CLI 或 skill |

短板也摆在这儿：agy 的免费额度是周配额，重度用会撞墙（配了 Tavily key 就自动接上）。X 那条路要 SuperGrok 或 X Premium 订阅。内置的本地抓取器不跑 JavaScript，纯前端渲染的页面它读得薄。

## 它能干三件事

| 干什么 | 需要什么 | 怎么用 |
| :-- | :-- | :-- |
| 搜公共网页 | agy 或一个 Tavily key | `-q "查询词"` |
| 读一个 URL | 什么都不用装 | `-u <url>`，可加 `-q` 指定关注点 |
| 搜 X（推特） | Grok Build（SuperGrok 或 X Premium 自带） | 自动触发，或 `--source x` |

读网页永远能用是硬保证：配置写错、agy 没装、引擎半路跑挂，都会落到内置的本地抓取器。

### X 这条路值得单说

X 关上 API 大门之后，Google 的索引进不去，任何网页搜索都答不了「X 上大家怎么说」。能进去的只有 xAI 自家的 [Grok Build CLI](https://x.ai/news/grok-build-cli)。

装了它就自动生效，两个条件同时成立才走 X：查询词带 X 味（`twitter`、`tweet`、`x.com`、`on X`，中文的推特、推文、发推、在 X 上），并且本机 `grok` 已装已登录。命中时只走 X 不走网页，一点 agy 额度不花，返回真实帖子、作者 handle、原帖链接。

没装 Grok 也不报错：问题交给网页搜索，并在 `uncertainty` 里写明这是看不进 X 的二手信息。想自己拿主意就用 `--source x`、`--source web,x` 或 `--source web`。

## CLI 参数

```bash
modsearch -q "<查询词>"              # 搜索模式
modsearch -u <url> [-q "<关注点>"]   # 抓取模式
```

| 参数 | 含义 | 默认值 |
| :-- | :-- | :-- |
| `-q, --query <text>` | 查询词，配合 `-u` 时是提取关注点 | |
| `-u, --url <url>` | 抓这一页，不做搜索 | |
| `-s, --source <list>` | 语料：`web`、`x` 或 `web,x` | 看查询词，默认 `web` |
| `-e, --engine <name>` | 本次强制用某个引擎 | 自动挑本机能用的 |
| `-o, --output <path>` | 同时把 JSON 写入文件 | |
| `-m, --model <name>` | 引擎模型（有模型概念的引擎才有用） | `gemini-3.6-flash-low` |
| `--max-results <n>` | 搜索结果上限 | `8` |
| `--prompt <text>` | 额外约束 | |
| `--timeout <ms>` | 引擎超时 | `180000` |
| `--allow-private-network` | 放行保留网段，给把公网域名映射进内网段的 VPN 用 | 关 |
| `--workdir <path>` | 需要起子进程的引擎的运行目录 | |

完整输出契约见 [output-schema.md](skills/modsearch/references/output-schema.md)。报错查不明白就看[故障排查](docs/troubleshooting.md)，那里按报错原文列了成因和解法。

## 配置（可选）

`~/.modsearch/config.json` 只有一个需要你做的决定：搜索用哪个引擎。

```bash
modsearch config init                       # 生成骨架，每个字段都可留空
modsearch config set tavily.apiKey <key>    # 引擎凭据，落盘即 0600
modsearch config set engine tavily          # 指定搜索引擎
modsearch config set engine ""              # 清空，恢复自动挑选
modsearch config show                       # key 打码显示
```

读网页和搜 X 都不需要配置：前者你选的引擎能读就读、不能读就走本地抓取器，后者只有 Grok 进得去，没得选。

这些命令你一条都不用记，skill 里带着完整的配置说明，直接跟 agent 说「帮我把 Tavily key 配进 modsearch」就行。

## 在 Codex 里用（DeepSeek 等纯文本模型）

DeepSeek 官方端点自带服务端 `web_search`，Codex 走的 Responses API 承接，Claude Code 走的 Anthropic 兼容端点也承接，配上 `web_search = "live"` 直连 `api.deepseek.com` 就有搜索了（见[官方集成文档](https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/codex)）。所以在 Codex 里 ModSearch 换来的不是「从无到有」，而是前面那笔账。

想把这活交给它，在 `~/.codex/config.toml` 里关掉内置的那条，否则模型伸手就用内置的，skill 插不上话：

```toml
web_search = "disabled"
```

有几件事内置搜索给不了：官方的 `/chat/completions` 端点根本没提供这个工具（OpenCode、Pi 这些宿主就是这么被挡在门外的），DashScope 和多数第三方网关同理。精读某个页面、查 X，也都不在它能力范围。

## 为什么外挂，而不是换更大的模型

- **模型不用换。** 你选 DeepSeek-V4-Flash（或 gpt-oss，或别的什么）图的是价格和推理，不是搜索。ModSearch 只帮它接网线，不碰这个选择。
- **证据强过感觉。** 答案带着 URL、日期和一份 `uncertainty` 清单，agent 引用来源而不是靠猜。
- **引擎会死，桥不会死。** v1 跑在 Gemini CLI 免费档上，2026 年 6 月被 Google 一刀切停掉。v2 换到 Antigravity CLI，接口没动，下次再换引擎也只改一个文件。

兄弟项目 ModLens 用同一招补上视觉：[liustack/modlens](https://github.com/liustack/modlens)。

## 插入一条硬广告

本项目由 LIUSTACK Skills 驱动，ModSearch v2 从需求成形、编码到交付，全程用 **[liustack](https://github.com/liustack/liustack)** 驱动：动手前 `shaping` 捋清楚，编码时 `coding` 上纪律，出问题 `dig` 挖根因，交接时 `snapshot` 留快照。比 Superpowers 更轻，也更强。

**ModSearch 给你的模型接上网线，LIUSTACK Skills 给你的开发工作流装上翅膀：**

```bash
npx -y skills add liustack/liustack -g
```

⭐ 好用的话，给 [ModSearch](https://github.com/liustack/modsearch) 和 [liustack](https://github.com/liustack/liustack) 各点一个 star。star 是下一个开发者找到它们的方式。

## 安全说明

- `http` 引擎自带 SSRF 防护：拦内网地址（IPv4 和 IPv6，含 `::ffff:` 这类映射写法）、云元数据端点、带凭据的 URL，重定向逐跳重新校验，并限制体积和字符数。**有一个已知缺口如实写在这里**：校验时解析一次域名，`fetch` 时又解析一次，两次之间被掉包（DNS rebinding）就能绕过。堵住它需要把连接钉死在校验过的 IP 上，而 Node 的全局 `fetch` 不给这个能力。抓不受信任的链接时请留意。

- ModSearch 调用 `agy` 时带上 `--dangerously-skip-permissions`，因为 prompt/print 模式不带这个参数在某些场景会失败。提示词已经把 agent 限定在只做搜索和抓取，并要求把网页内容当数据看，绝不当指令执行。即便如此，抓回来的页面终归是不可信输入，尽量在沙箱化的工作目录里跑。
- 搜索输出是证据，引擎没法核实的部分会进 `uncertainty`。v1 里那个看着挺精确、实则编出来的数值 `relevance` 分数，v2 已经删掉，排序本身就代表相关度。

## 免责声明

仅供个人学习与实验，不用于商业用途。Antigravity CLI 的使用受你自己的 Google 账号条款和额度约束。

## License

MIT
