<div align="center">
  <h1>ModSearch</h1>
  <p><b>给纯文本 LLM 外挂联网搜索和网页抓取，免费。</b></p>
  <p>
    <a href="https://www.npmjs.com/package/@liustack/modsearch"><img src="https://img.shields.io/npm/v/@liustack/modsearch" alt="npm"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  </p>
  <p><a href="./README.md">English</a></p>
</div>

你最喜欢的模型聪明但活在过去。DeepSeek-V4-Flash 推理漂亮价格便宜，可问它训练截止之后的事，它只能猜。跑在 Claude Code、OpenClaw、Codex 或任何没有搜索工具的宿主里，它查不了资料，你贴个 URL 它也读不了。

ModSearch 用一条命令补上这两块。给它查询词，返回真实的最新搜索结果。给它 URL，把页面抓成干净的 markdown 证据。两者都是结构化 JSON。「上网」这件事交给 [Antigravity CLI](https://antigravity.google)（`agy`），用的是 Google 的免费额度，不动你的 API 账单。

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

装一次 skill，你的 agent 从此自己搜索、自己读网页。不换模型，不要 API key，不用改提示词。

## 快速开始

**1. 安装 Antigravity CLI 并登录**（一次性）：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # 浏览器完成登录后退出
```

**2. 安装 skill**，直接告诉你的 agent（Claude Code、Codex、OpenClaw、Cursor 等）：

```text
Install the skill from https://github.com/liustack/modsearch
```

或者自己动手：

```bash
npx -y skills add liustack/modsearch
```

**3. 用起来。** 问任何时效性问题，或者贴一个 URL。模型需要活的互联网时，skill 自动触发。

## 看看效果

搜索：

```bash
npx @liustack/modsearch -q "DeepSeek V4 Flash release date and context window" --max-results 3
```

真实输出（截断）：

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

抓取网页，还能带上关注点：

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

搜索 5-20 秒，抓取 10-30 秒。JSON 结构由 provider 层的 schema 强制保证，你的 agent 再也不用从 markdown 里抠 JSON。

## CLI 参数

```bash
modsearch -q "<查询词>"              # 搜索模式
modsearch -u <url> [-q "<关注点>"]   # 抓取模式
```

| 参数 | 含义 | 默认值 |
| :-- | :-- | :-- |
| `-q, --query <text>` | 查询词，与 `-u` 同用时是提取关注点 | |
| `-u, --url <url>` | 抓取该页面，不做搜索 | |
| `-o, --output <path>` | 同时把 JSON 写入文件 | |
| `-m, --model <name>` | provider 模型 | `gemini-3.6-flash-low` |
| `-p, --provider <name>` | provider | `antigravity-cli` |
| `--max-results <n>` | 搜索结果上限 | `8` |
| `--prompt <text>` | 额外约束 | |
| `--timeout <ms>` | provider 超时 | `180000` |
| `--provider-bin <path>` | provider 可执行文件 | `agy` |
| `--workdir <path>` | provider 运行目录 | |

难啃的调研问题，换 `-m gemini-3.1-pro-high`。输出契约见 [skills/modsearch/references/output-schema.md](skills/modsearch/references/output-schema.md)。

## 为什么外挂，而不是换更大的模型？

- **模型不用换。** 你选 DeepSeek-V4-Flash（或 gpt-oss，或别的什么）是为了价格和推理能力。ModSearch 只接网线，不动这个选择。
- **证据强过感觉。** 答案带着 URL、日期和明确的 `uncertainty` 清单回来，你的 agent 引用来源，而不是猜。
- **引擎会死，桥不会。** v1 跑在 Gemini CLI 免费档上，2026 年 6 月被 Google 停掉。v2 换到继任者 Antigravity CLI，同一个 provider 接口，下次换引擎只改一个文件，不用重写。v2 还顺手吞并了网页抓取，它原本是个独立项目（modfetch，已退役）。

姊妹项目 ModLens 用同样的思路补上视觉：[liustack/modlens](https://github.com/liustack/modlens)。

## 用 liustack 打造

ModSearch v2 从需求成形、编码到交付，全程由 **[liustack](https://github.com/liustack/liustack)** 驱动。四个 Agent Skills，一个闭环：动手前 `shaping` 捋清楚，编码时 `coding` 上纪律，出问题 `dig` 挖根因，交接时 `snapshot` 留快照。比 Superpowers 更轻，也更锋利。

**ModSearch 给你的模型接上网线，liustack 给你的整个工作流装上纪律：**

```bash
npx -y skills add liustack/liustack -g
```

⭐ 觉得有用？给 [ModSearch](https://github.com/liustack/modsearch) 和 [liustack](https://github.com/liustack/liustack) 各点一个 star。star 是下一个开发者找到它们的方式。

## 安全说明

- ModSearch 调用 `agy` 时带 `--dangerously-skip-permissions`，因为 print 模式不带它就不执行工具。提示词里已把 agent 限制为只做搜索和抓取，并要求把网页内容当数据、绝不当指令。即便如此，抓回来的页面是不可信输入，尽量在沙箱化的工作目录里运行。
- 搜索输出是证据，不是圣旨：引擎无法核实的部分会进 `uncertainty`。v1 里那个一眼假的数值 `relevance` 分数已删除，排序本身就是相关度。

## 免责声明

仅供个人学习与实验，请勿用于商业用途。Antigravity CLI 的使用受你自己的 Google 账号条款与额度约束。

## License

MIT
