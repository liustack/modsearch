# ModSearch 输出契约

[English](output-schema.md) | 简体中文

CLI 向 stdout 打印一个 JSON 对象。顶层信封对每次运行都一样：

```json
{
  "mode": "search",
  "query": "current Node.js LTS",
  "url": null,
  "results": [
    {
      "source": "web",
      "requestedSource": "web",
      "engine": "antigravity-cli",
      "model": "gemini-3.6-flash-low",
      "status": "ok",
      "durationSeconds": 5.5,
      "summary": "The current Node.js LTS is v24.19.0 (Krypton), released 2026-08-03.",
      "items": [
        {
          "title": "Node.js v24.19.0 release",
          "url": "https://nodejs.org/en/blog/release/v24.19.0",
          "snippet": "Krypton is the active LTS line.",
          "source": "nodejs.org",
          "published_at": "2026-08-03"
        }
      ],
      "uncertainty": [],
      "warnings": [],
      "attempts": [
        { "engine": "antigravity-cli", "ok": true, "durationSeconds": 5.5 }
      ]
    }
  ],
  "meta": {
    "generatedAt": "2026-08-06T12:00:00.000Z",
    "durationSeconds": 5.6
  }
}
```

要点：

- `results` 永远是数组，每个语料一条，所以哪怕单语料运行，结构也不变。
- `meta` 只记录整次运行何时完成、总共多久。每个语料的耗时、引擎、模型在各自的 `results` 条目里，因为一次运行可能跨多个引擎。
- 路由事实（`source`、`engine`、`model`、`durationSeconds`）由 modsearch 在引擎作答后盖章写入，引擎伪造不了是谁答的。

## `results` 条目

每条都以相同的路由字段开头，然后把引擎自己的结果字段平铺在旁边：

| 字段 | 含义 |
| :-- | :-- |
| `source` | `web` 或 `x`，这条证据实际来自的语料 |
| `requestedSource` | `web` 或 `x`，被请求的语料。运行降级时与 `source` 不同 |
| `engine` | 实际作答的引擎（`antigravity-cli`、`tavily`、`grok-cli`、`local`），语料不可达时为 `null` |
| `model` | 使用的模型，引擎有模型时才有值（没有时是空字符串） |
| `status` | `ok`、`degraded` 或 `unavailable`（见下文） |
| `warnings` | 这个语料的路由与运行警告：一次回退、一条降级说明、一个配置笔误、本地引擎的「无综述」和「已放行私有网络」提示。说的是答案怎么产生的，不是答案里的事实。永远是数组，常为空 |
| `attempts` | 这个语料按顺序试过的每个引擎：`{ engine, ok, error?, durationSeconds, cost?, credits? }`。`ok: false` 的条目带失败 `error`。会上报消耗的引擎会附 `cost`（exa，美元）或 `credits`（firecrawl）。两个字段都可选，不上报的引擎上没有。成功的运行末尾恰有一条 `ok: true` |
| `durationSeconds` | 这一个语料花了多久，什么都没跑时为 `null` |

其余字段取决于模式。

### `uncertainty` 与 `warnings` 的区别

两个独立的列表，转述结果时这个区分很重要：

- `uncertainty` 是引擎对**事实本身**的存疑：填不上的空缺、互相矛盾的来源、可能过期的数字、薄得不可信的页面。转述时把它们作为答案的保留意见。
- `warnings` 说的是**答案怎么产生的**：一个引擎挂了由另一个顶上、X 请求由网页作答、配置 key 是个笔误、一次抓取跟了重定向或关了私有网络防护。当它影响对路由的信任（尤其是降级）时要转述，但它不是对事实的怀疑。

老版本把两者都塞在 `uncertainty` 里。曾从 `uncertainty` 里解析路由信息的消费者现在应改读 `warnings`。

### `status` 与降级的 X 答案

`status` 告诉消费者这条结果把请求的语料服务得怎么样：

- `ok`：请求的语料作了答。`source` 等于 `requestedSource`。
- `degraded`：替补语料作了答。目前只有 X 会降级：Grok Build 缺失、未登录或故障时，由网页引擎回答 X 请求。此时条目是 `requestedSource: "x"`、`source: "web"`、`status: "degraded"`，`warnings` 解释网页数据看不到 X 内部。不要把降级条目当成 X 的覆盖来呈现。
- `unavailable`：没有任何东西能服务这个语料。`engine` 为 `null`，`items` 为空，`attempts` 为空，`durationSeconds` 为 `null`，`warnings` 说明原因。`--source web,x` 运行中 X 不可达时，X 槽位就是这样显式存在，而不是无声消失：

```json
{
  "source": "x",
  "requestedSource": "x",
  "engine": null,
  "status": "unavailable",
  "summary": "",
  "items": [],
  "uncertainty": [],
  "warnings": [
    "X itself was not reachable here (Grok Build missing, signed out, or failing), so this came from the public web, which cannot see inside X."
  ],
  "attempts": [],
  "durationSeconds": null
}
```

### attempt 上的引擎消耗

计量自己用量的引擎会在实际运行的那条 attempt 上报告，调用方可以据此统计一次运行的成本。两个字段都可选：只出现在上报它们的引擎上，都不上报的引擎（agy、tavily、本地引擎）上永远没有。

- `cost`：美元，来自 exa。
- `credits`：firecrawl 的 credits。

```json
{
  "engine": "exa",
  "ok": true,
  "durationSeconds": 1.2,
  "cost": 0.007
}
```

## 搜索模式（`-q`）

平铺进条目的引擎结果：

```json
{
  "summary": "string",
  "items": [
    {
      "title": "string",
      "url": "string",
      "snippet": "string",
      "source": "string（可选）",
      "published_at": "string（可选）"
    }
  ],
  "uncertainty": ["string"]
}
```

- `items` 的顺序就是相关性排序。没有数值型 `relevance` 分数：模型会编造它，顺序本身已经携带了相关性。
- `items` 为空且 `uncertainty` 有内容，表示这次搜索没找到可靠的东西。

## 抓取模式（`-u`）

`items` 换成 `content` 加 `links`：

```json
{
  "mode": "fetch",
  "query": null,
  "url": "https://nodejs.org/en/about",
  "results": [
    {
      "source": "web",
      "requestedSource": "web",
      "engine": "antigravity-cli",
      "model": "gemini-3.6-flash-low",
      "status": "ok",
      "durationSeconds": 8.1,
      "summary": "About page for the Node.js project.",
      "content": "# About Node.js\nNode.js is a JavaScript runtime...",
      "links": [
        { "text": "Downloads", "url": "https://nodejs.org/en/download" }
      ],
      "uncertainty": [],
      "warnings": [],
      "attempts": [
        { "engine": "antigravity-cli", "ok": true, "durationSeconds": 8.1 }
      ]
    }
  ],
  "meta": {
    "generatedAt": "2026-08-06T12:00:00.000Z",
    "durationSeconds": 8.2
  }
}
```

- `content` 是页面主体内容，agy 给 markdown，本地引擎给原样文本（它不跑 JavaScript，也不做综述）。
- `links` 是有用的外链，至多 20 条，可以为空。

## 备注

- `query` 和 `url` 与请求对应：恰有一个非 null。
- 上面的示例信封由 `src/output-schema.test.ts` 与真实的 `RunSearchResult` 对照校验，这份文档与代码脱节时测试会失败。
