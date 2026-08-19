---
summary: 'DeepSeek Harness 插件：安装、配置、验证、更新与故障定位'
read_when:
  - 在 dsh profile 中安装或更新 modsearch
  - 配置 dsh 插件开关或 modsearch 引擎
  - 验证 dsh 中的 web_search、x_search 或 read_page
  - dsh 发布新版本后检查兼容性
---

# DeepSeek Harness 插件

[English](dsh.md) | 简体中文

ModSearch 是原生 dsh bundle。它保留 dsh 内置的 `web_search` 工具与引用卡片，只替换背后的搜索 provider，同时补上 dsh web 接缝没有的 `x_search` 和 `read_page`。

## 兼容性

当前 bundle 已对照 `@deepseek-ai/dsh 0.1.0-rc.7` 检查。这个版本没有改变 ModSearch 使用的三个接口：

- npm bundle 仍通过 `dsh.bundle.patch` 声明配置层。
- web 接缝仍通过 `ctx.web.registerSearchProvider(...)` 接收 provider。
- 工具仍通过 `ctx.tools.register(...)` 注册。

dsh 仍是候选版本，每次升级后都应重新检查。下面的组合检查不调用模型，不需要 API key，也不消耗额度：

```sh
npx -y @deepseek-ai/dsh --version
npx -y @deepseek-ai/dsh --profile web --dump-config
```

输出中应同时出现 `searchProvider: modsearch` 和名为 `@liustack/modsearch` 的插件行。

## 安装

把插件装进实际启动的 profile。浏览器界面通常使用 `web`：

```sh
npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modsearch@5.6.0
```

安装后重启 dsh，再确认真正解析到的包：

```sh
npx -y @deepseek-ai/dsh plugin --profile web list --depth 0
```

这里故意写精确版本。pnpm 11 可能通过 `minimumReleaseAge` 扣住刚发布的版本，让 `@latest` 解析成旧包。发布流程会让本命令中的版本与 `package.json` 保持同步。

## bundle 改了什么

bundle 贡献两条 patch：

1. 把 dsh web 接缝的 `searchProvider` 设为 `modsearch`。
2. 把包根入口挂载为 `modsearch` 插件。

插件随后提供：

| 能力 | dsh 接口 | 行为 |
| :-- | :-- | :-- |
| 网页搜索 | 内置 `web_search` | 运行 ModSearch 网页引擎链，保留原生引用卡片。 |
| X 搜索 | 新增 `x_search` 工具 | 有 Grok Build 时直接使用。网页替代结果会明确标成降级。 |
| 带焦点读单页 | 新增 `read_page` 工具 | 读取一个 URL，可附问题聚焦。私网目标仍会拦截。 |

## 配置搜索引擎

dsh 插件不维护第二份引擎配置。它继承同一组环境变量，并读取 CLI 与 skill 共用的 `~/.modsearch/config.json`。

先跑离线体检：

```sh
npx -y @liustack/modsearch@5.6.0 doctor
```

常用配置：

```sh
modsearch config set engine antigravity-cli
modsearch config set tavily.apiKey <key>
modsearch config set exa.apiKey <key>
modsearch config set firecrawl.apiKey <key>
modsearch config set firecrawl.keylessFetch false
modsearch config set cooldown off
```

不做任何设置就能开跑：搜索和单页抓取默认运行在 Firecrawl 的免注册免费额度上（每月 1,000 免费 credits，无需注册）。免注册公网抓取默认开启，它会把请求的 URL 交给 Firecrawl 的云端爬虫，结果中的 warning 会标明这条路径。`firecrawl.keylessFetch false` 可让自动抓取只走本地。私有或保留地址不会发给 Firecrawl，而会落到本地抓取器。

完整说明见[引擎配置手册](../skills/modsearch/references/configure.zh-CN.md)和[安全说明](security.zh-CN.md)。

## 配置 dsh 插件

插件开关写在 profile patch 中，通常是 `~/.dsh/profiles/<name>/cordis.patch.yml`。后应用的 profile patch 会覆盖 bundle 行：

```yaml
- id: modsearch
  config:
    searchProvider: true
    xSearch: true
    readPage: true
    providerTimeoutMs: 55000
```

所有字段都可省略：

| 字段 | 默认值 | 作用 |
| :-- | :-- | :-- |
| `searchProvider` | `true` | 向 dsh web 接缝注册 ModSearch。 |
| `xSearch` | `true` | 注册 `x_search`。 |
| `readPage` | `true` | 注册 `read_page`。 |
| `providerTimeoutMs` | `55000` | `web_search` provider 路径交给 CLI 的截止时间。应小于 dsh 的工具预算。 |

只关闭 `x_search` 或 `read_page` 不会影响别的能力。关闭 `searchProvider` 时还要把 web 接缝指向另一个已注册 provider。否则 dsh 仍被配置成选择 `modsearch`，但对应 provider 已不存在：

```yaml
- id: web
  config:
    searchProvider: deepseek-official

- id: modsearch
  config:
    searchProvider: false
```

修改 patch 后运行 `--dump-config`。dsh patch 行会整体替换目标行的 `config`，所以同一行需要保留的值必须全部重写。

## 运行时验证

按 dsh 的标准入口启动 profile：

```sh
npx -y @deepseek-ai/dsh --profile web
```

依次使用三个小问题：

1. `搜索当前 Node.js LTS 版本并引用来源。`
2. `搜索 X 上 @deepseek_ai 最近的帖子。`
3. `读取 https://example.com 并总结页面。`

第一个调用应使用 dsh 原生 `web_search` 卡片。后两个应分别显示为 `x_search` 和 `read_page`。工具存在但引擎失败时，运行 `modsearch doctor`。

## 更新与卸载

用当前精确版本刷新 profile 中记录的请求：

```sh
npx -y @deepseek-ai/dsh plugin --profile <name> add @liustack/modsearch@5.6.0
```

卸载命令：

```sh
npx -y @deepseek-ai/dsh plugin --profile <name> remove @liustack/modsearch
```

如果用户 patch 仍写着 `searchProvider: modsearch`，卸载后要修改或删除该覆盖。

## 故障定位

- `declares no dsh.bundle`：装到了旧版 ModSearch。按上方精确版本重新安装。
- `web seam has no registerSearchProvider`：dsh 移动了开发预览接口。`x_search` 与 `read_page` 仍会注册，网页搜索则跳过并打印明确日志。修改插件前先检查最新 dsh release。
- `modsearch failed (exit ...)`：运行 `modsearch doctor`。错误会保留 CLI 尝试过的引擎。
- `plugin list` 有包但 `--dump-config` 没有：检查 `~/.dsh/profiles/<name>/package.json` 的 `dsh.profile.bundles` 中是否存在该包。
- Electron 又打开一个应用进程，没有运行 CLI：使用 ModSearch 5.4.3 或更高版本。插件会给子进程设置 `ELECTRON_RUN_AS_NODE=1`。

CLI 自身的错误见[故障排查](troubleshooting.zh-CN.md)。
