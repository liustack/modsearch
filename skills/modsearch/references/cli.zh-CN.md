# ModSearch CLI 手册

[English](cli.md) | 简体中文

skill 通过启动器驱动这个 CLI。这一页讲的是直接运行它。

## 直接使用

装好 skill 后不需要敲命令：问任何需要查证的问题，或贴一个 URL，它就会自己触发，启动器负责选择怎么运行 modsearch。下面的命令用于在有 Node 的机器上自己驱动 CLI：

```bash
modsearch -q "current Node.js LTS version"     # 搜网页
modsearch -u "https://nodejs.org/en/about"     # 读一个页面，加 -q 指定关注点
modsearch -q "reactions on X" --source x       # 搜 X，关于 X 的查询会自动路由过去
```

输出永远是一个 `results` 数组，每个语料一条：

```json
{
  "mode": "search",
  "results": [{
    "source": "web",
    "engine": "antigravity-cli",
    "summary": "The current Node.js LTS is v24.19.0 (Krypton), released 2026-08-03.",
    "items": [{ "title": "...", "url": "https://...", "published_at": "2026-08-03" }],
    "uncertainty": [],
    "warnings": [],
    "durationSeconds": 5.5
  }]
}
```

`uncertainty` 是引擎对事实本身没把握的地方。`warnings` 是答案的产生方式（一次回退、X 由网页顶替、重定向），`attempts` 记录每个试过的引擎。

## 参数

| 参数 | 含义 | 默认 |
| :-- | :-- | :-- |
| `-q, --query <text>` | 查询语句，与 `-u` 搭配时是提取关注点 | |
| `-u, --url <url>` | 抓取这个页面，而不是搜索 | |
| `-s, --source <list>` | 语料：`web`、`x` 或 `web,x` | 由查询判断，否则 `web` |
| `-e, --engine <name>` | 本次只用这个引擎。失败时直接报错，不换引擎 | 自动 |
| `-o, --output <path>` | 同时把 JSON 写入文件 | |
| `-m, --model <name>` | 引擎模型 | `gemini-3.6-flash-low` |
| `--prompt <text>` | 本次运行的附加约束，传给引擎 | |
| `--max-results <n>` | 搜索结果上限 | `8` |
| `--timeout <ms>` | 引擎超时 | `180000` |
| `--workdir <path>` | 运行命令类引擎的工作目录 | 当前目录 |
| `--allow-private-network` | 允许本地抓取器访问保留地址段，给把公网主机映射进去的 VPN 用 | 关 |

配置是可选的。`~/.modsearch/config.json` 里只有一个主要决定：谁来搜索（`modsearch config set engine tavily`，空表示自动）。抓取和 X 搜索不需要任何设置。额度冷却故障转移默认开，`modsearch config set cooldown off` 关掉，`modsearch state clear` 重置冷却记录。完整的文件结构和每个字段（包括顶层的 `allowPrivateNetwork` 开关）见[配置文档](configure.zh-CN.md)。

`modsearch doctor` 打印本机诊断：Node 版本、每项任务的引擎就绪状态和原因、每个配置值的来源、私有网络设置、当前在冷却的引擎。它不花额度、不发网络请求，`--json` 让输出可被程序读取。路由行为不符合预期时先跑它。

## 平台支持

macOS 和 Linux 完整支持，CI 在 Node 22 和 24 上跑全量测试。skill 附带两个启动器，macOS 和 Linux 用 `scripts/run.sh`，Windows 用 `scripts/run.ps1`，它们自动选择可用的运行方式，三个平台行为一致。

CI 矩阵同样包含 `windows-latest` 的 Node 22 和 24，跑同一套 typecheck、测试、构建关卡。各部分在 Windows 上的可用性取决于它依赖什么：

- **CLI 本体、路由与配置逻辑、HTTP 引擎**（`local` 抓取、Tavily、Exa、Firecrawl）是纯 Node：只用 `fetch` 和文件系统，天然跨平台。
- **agy 和 grok 是外部 CLI。** modsearch 不经 shell 按名字直接运行它们，所以 PATH 上的原生 Windows 可执行文件可用，npm 风格的 `.cmd` 垫片不可用。有没有 Windows 构建是每个工具自己的决定，不是 modsearch 的。
- **冷却状态文件**通过临时文件加原子重命名写入。Windows 上这个重命名能替换目标，但替换不了被其他进程占用的文件，所以极少数的同时写入竞争可能丢掉一次写。这个存储是读取时合并的尽力缓存，丢掉的内容后续运行会重新发现。
