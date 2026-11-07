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

当前 bundle 已对照 `@deepseek-ai/dsh 0.1.7-alpha.1` 检查，设置卡片另外对照过 `0.1.5-rc.2`。这些版本保留了 ModSearch 用到的接口：

- npm bundle 仍通过 `dsh.bundle.patch` 声明配置层。
- web 接缝仍通过 `ctx.web.registerSearchProvider(...)` 接收 provider。
- 工具仍通过 `ctx.tools.register(...)` 注册。
- bundle 可以显示自己的设置卡片。从 0.1.6-alpha.2 起，它通过 `plugins.bundle.config` 插槽出现在「插件」面板里该 bundle 的页面上。更早的版本通过 `settings.plugin.item` 把它放在设置页里。

dsh 仍是预览版本，每次升级后都应重新检查。下面的组合检查不调用模型，不需要 API key，也不消耗额度：

```sh
npx -y @deepseek-ai/dsh --version
npx -y @deepseek-ai/dsh --profile web --dump-config
```

输出中应同时出现 `searchProvider: modsearch` 和名为 `@liustack/modsearch` 的插件行。

## 安装

把插件装进实际启动的 profile。浏览器界面通常使用 `web`：

```sh
npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modsearch@5.10.12
```

安装后重启 dsh，再确认真正解析到的包：

```sh
npx -y @deepseek-ai/dsh plugin --profile web list --depth 0
```

这里故意写精确版本。pnpm 11 可能通过 `minimumReleaseAge` 扣住刚发布的版本，让 `@latest` 解析成旧包。发布流程会让本命令中的版本与 `package.json` 保持同步。

桌面版的 `desktop` profile 只能在桌面版窗口里装，dsh CLI 会以 `profile "desktop" is managed exclusively by the Electron application` 拒绝它。在「添加插件」对话框里，填包名 `@liustack/modsearch`，不要填 GitHub 仓库地址。只有 npm 包带构建好的 CLI。从 GitHub 安装只拿到源码，而 pnpm 会拦下补构建的那一步。

## bundle 改了什么

bundle 贡献两条 patch：

1. 把 dsh web 接缝的 `searchProvider` 设为 `modsearch`，并保留自带的 `fetchProvider: http`（这一行会整体替换宿主的 web 配置）。
2. 把包根入口挂载为 `modsearch` 插件。

插件随后提供：

| 能力 | dsh 接口 | 行为 |
| :-- | :-- | :-- |
| 网页搜索 | 内置 `web_search` | 运行 ModSearch 网页引擎链，保留原生引用卡片。 |
| X 搜索 | 新增 `x_search` 工具 | 有 Grok Build 时直接使用。网页替代结果会明确标成降级。 |
| 带焦点读单页 | 新增 `read_page` 工具 | 读取一个 URL，可附问题聚焦。私网目标仍会拦截。dsh 自带的 `web_fetch` 照常保留，用于取原始正文和状态码。 |

## 配置搜索引擎

dsh 插件不维护第二份引擎配置。它继承同一组环境变量，并读取 CLI 与 skill 共用的 `~/.modsearch/config.json`。

先跑离线体检：

```sh
npx -y @liustack/modsearch@5.10.12 doctor
```

常用配置：

```sh
modsearch config set engine antigravity-cli
modsearch config set tavily.apiKey <key>
modsearch config set exa.apiKey <key>
modsearch config set firecrawl.apiKey <key>
modsearch config set keenable.apiKey <key>
modsearch config set firecrawl.keylessFetch false
modsearch config set cooldown off
```

不做任何设置就能开跑：搜索和单页抓取默认运行在 Firecrawl 的免注册免费额度上（每月 1,000 免费 credits，无需注册），搜索还能退到 Keenable 的免注册额度（每个 IP 每小时 1,000 次，无需注册），再退到 You.com 的免注册搜索（每个 IP 每天 100 次，无需注册）。免注册公网抓取默认开启，它会把请求的 URL 交给 Firecrawl 的云端爬虫，结果中的 warning 会标明这条路径。`firecrawl.keylessFetch false` 可让自动抓取只走本地。私有或保留地址不会发给 Firecrawl，而会落到本地抓取器。

完整说明见[引擎配置手册](../skills/modsearch/references/configure.zh-CN.md)和[安全说明](security.zh-CN.md)。

## 在网页端配置

dsh 网页端没有终端，所以插件自带一张设置卡片。dsh 0.1.6-alpha.2 及之后的版本里，它在插件自己的页面上：在侧栏点开「插件」，进入 `@liustack/modsearch`。更早的 dsh 版本把它显示为「设置 → 插件 → 插件配置」里的**搜索引擎（ModSearch）**卡片（dsh 自带的「网页搜索」卡片是 DeepSeek 自己的搜索提供方，两者不是一回事）。无论在哪，它改的都是 CLI 改的那份 `~/.modsearch/config.json`，走插件注册的路由 `/modsearch/config`。这份文件属于当前系统用户，不属于某个 dsh profile，所以本机所有 dsh profile 和 CLI 共用同一套引擎设置。

卡片管三件事：

- 首选引擎：自动，或 `antigravity-cli`、`tavily`、`exa`、`firecrawl`、`keenable`、`youcom`、`grok-cli` 之一。`firecrawl`、`keenable` 和 `youcom` 三项标注「免注册免费」。`local` 只抓单页不搜索，所以不在这个列表里，除非配置文件当前就把它设成了 `engine`，那时它照常显示，免得界面与文件不一致。
- 当前所选引擎自己的设置：HTTP 引擎（`tavily`、`exa`、`firecrawl`、`keenable`）显示 API 密钥与接口地址，`antigravity-cli` 显示模型。走自家命令行工具登录的引擎和内置抓取器只显示一行说明，因为它们两样都不需要。选中未配置密钥的 `firecrawl` 或 `keenable` 时会多一行说明，讲清它默认跑在免注册的免费额度上。选中 `youcom` 时不显示密钥框，改显示一行说明，因为它只有免注册这一种用法。
- 自动引擎链：只列出 `modsearch doctor` 判定本机已就绪的搜索引擎，每个一个复选框，勾选表示允许自动路由使用它。本机跑不了的引擎不出现在这里，它们不是需要用户做的决定。`local` 是单页抓取，不参与搜索，所以也不在这排里。`grok-cli` 只服务 X 搜索，旁边标注「仅 X 搜索」。读不到 doctor 结果时会列出全部搜索引擎并说明状态未知。保存成功后卡片会重新问一次 doctor，刚配好密钥的引擎马上就能长出复选框。

每个引擎默认都勾选。取消勾选只写入 `enabled: false`，重新勾选会删除这项覆盖，不保存多余的 `true`。取消当前首选引擎时，首选项会回到自动。卡片只改自己列出来的引擎：没有复选框的引擎（本机跑不了的，以及 `local`）的 `enabled` 一律原样带过，改它们只能用 `modsearch config set <engine>.enabled`。本机一个就绪引擎都没有时，这排复选框换成一行提示，说明本机暂无就绪的引擎。

Tavily、Exa、Firecrawl、Keenable 的官方接口地址内置在 provider 代码里。界面的接口地址只表示覆盖值。留空或清空都会使用内置官方地址，不会把默认 URL 写进配置文件。

其余设置仍然只走 CLI，包括 `bin`、`allowPrivateNetwork`、`cooldown` 和 `keylessFetch`。卡片保存时会原样带过这些字段，也无法新建它们。

密钥的处理：

- 浏览器拿不到已保存的密钥，只知道有没有。密钥框留空保存，原密钥保持不变。
- 多个密钥写在同一个输入框中，用英文逗号分隔。ModSearch 会按顺序尝试，鉴权、限流或配额失败时自动轮换。其他失败不会逐个尝试所有密钥，而是继续走引擎后备链。
- 环境变量里的密钥在运行时仍然优先于配置文件，卡片会直说这一点，而不是让人以为保存改变了结果。
- 插件不限制 Host、Origin 或 Fetch Metadata 请求头，域名反代和局域网部署都可以读取、保存设置。部署时，认证必须同时覆盖 `/modsearch/config` 和 dsh 本身。这个直接注册的插件路由不会自动继承 dsh Connection 的登录认证。
- 写盘方式与 CLI 一致：先写一个新的 0600 临时文件，再重命名覆盖。
- 这个路由只在插件开启时存在。在「插件」页关掉 bundle 会把它一起撤下，重新打开后不用重启就会恢复。

## 配置 dsh 插件

插件开关写在 profile patch 中，通常是 `~/.dsh/profiles/<name>/cordis.patch.yml`。后应用的 profile patch 会覆盖 bundle 行：

```yaml
- id: modsearch
  config:
    searchProvider: true
    xSearch: true
    readPage: true
    settingsCard: true
    providerTimeoutMs: 40000
    providerDeadlineMs: 55000
```

所有字段都可省略：

| 字段 | 默认值 | 作用 |
| :-- | :-- | :-- |
| `searchProvider` | `true` | 向 dsh web 接缝注册 ModSearch。 |
| `xSearch` | `true` | 注册 `x_search`。 |
| `readPage` | `true` | 注册 `read_page`。 |
| `settingsCard` | `true` | 提供设置卡片与 `/modsearch/config` 路由。关掉后两者都不注册，浏览器那半边也随之停手。 |
| `providerTimeoutMs` | `40000` | `web_search` provider 路径上单个引擎最多用多久（即 CLI 的 `--timeout`）。要明显小于 `providerDeadlineMs`，备用引擎才轮得到。 |
| `providerDeadlineMs` | `55000` | `web_search` 整次运行最多用多久，所有引擎合计（即 CLI 的 `--deadline`）。应小于 dsh 的工具预算，自带搜索路由是 60 秒。 |

只关闭 `x_search` 或 `read_page` 不会影响别的能力。关闭 `searchProvider` 时还要把 web 接缝指向另一个已注册 provider。否则 dsh 仍被配置成选择 `modsearch`，但对应 provider 已不存在：

```yaml
- id: web
  config:
    searchProvider: deepseek-official
    fetchProvider: http

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
npx -y @deepseek-ai/dsh plugin --profile <name> add @liustack/modsearch@5.10.12
```

卸载命令：

```sh
npx -y @deepseek-ai/dsh plugin --profile <name> remove @liustack/modsearch
```

如果用户 patch 仍写着 `searchProvider: modsearch`，卸载后要修改或删除该覆盖。

## 故障定位

- `declares no dsh.bundle`：装到了旧版 ModSearch。按上方精确版本重新安装。
- `modsearch's CLI build is missing`，或 5.10.6 及更早版本报 `Cannot find module .../dist/main.js`：插件是从 GitHub 仓库装的，没有构建产物。卸载后按包名 `@liustack/modsearch` 重新添加。
- `web seam has no registerSearchProvider`：dsh 移动了开发预览接口。`x_search` 与 `read_page` 仍会注册，网页搜索则跳过并打印明确日志。修改插件前先检查最新 dsh release。
- `modsearch failed (exit ...)`：运行 `modsearch doctor`。错误会保留 CLI 尝试过的引擎。
- `plugin list` 有包但 `--dump-config` 没有：检查 `~/.dsh/profiles/<name>/package.json` 的 `dsh.profile.bundles` 中是否存在该包。
- Electron 又打开一个应用进程，没有运行 CLI：使用 ModSearch 5.4.3 或更高版本。插件会给子进程设置 `ELECTRON_RUN_AS_NODE=1`。
- `settings namespace skipped: TypeError: scope.settings.register is not a function`：在 dsh 0.1.7 或更新版本上用了 ModSearch 5.10.3 或更旧版本。搜索和两个工具照常可用，只是设置卡片缺失。升级到 ModSearch 5.10.4 或更高版本。
- 插件页上看不到 ModSearch 的设置：dsh 0.1.6-alpha.2 把插件设置搬到了插件页，而 ModSearch 5.10.3 及更旧版本只把卡片交给旧的设置页插槽。升级到 ModSearch 5.10.4 或更高版本。如果配置了 `settingsCard: false`，卡片是被有意关掉的。
- `settings card route skipped: Error: webserver: duplicate exact route "/modsearch/config"`：ModSearch 5.10.3 或更旧版本在「插件」页关掉插件时没有撤下路由。重启 dsh，或升级到 ModSearch 5.10.4 或更高版本。

CLI 自身的错误见[故障排查](troubleshooting.zh-CN.md)。
