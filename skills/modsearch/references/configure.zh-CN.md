# 配置 ModSearch

[English](configure.md) | 简体中文

用户问怎么装 modsearch、要加 key、要换引擎，或者遇到配置类的失败时，读这份文档。直接替用户把命令跑了，不要把说明贴给对方。

## 心智模型

三件工作，称为角色（role）。每个角色有能干这活的引擎：

| 工作 | 引擎 | 可配置吗 |
| :-- | :-- | :-- |
| 搜公开网页 | `firecrawl`、`keenable`、`youcom`、`antigravity-cli`、`tavily`、`exa` | 首选引擎加每引擎参与开关 |
| 读一个 URL | 首选引擎（若它能抓取），然后是 `firecrawl`、`keenable`、`antigravity-cli`、`local` | 每引擎参与开关 |
| 搜 X（推特） | `grok-cli` | 每引擎参与开关 |

搜索顺序固定为 `firecrawl`、`keenable`、`youcom`、`antigravity-cli`、`tavily`、`exa`。抓取顺序是 `firecrawl`、`keenable`、`antigravity-cli`、`local`。每个引擎默认都参与。`engines.<name>.enabled: false` 会先排除一个引擎，可用性再过滤剩余名单，额度冷却最后重排就绪链（见下文）。Firecrawl 领跑两条链，因为它的免注册通道在裸机上就能用，不要账号不要 key。Keenable 在搜索和抓取里都排第二，也是同样的理由：Firecrawl 额度用完时，裸机上还有一个免注册的后备。You.com 排第三：额度更小的免注册通道（每个 IP 每天 100 次），给前两个都用完的繁忙 IP 兜底。

从这张表能推出两个事实，它们回答大多数问题：

- **单页抓取零配置可用。** `local` 引擎零安装，默认是抓取的最后兜底。只有用户明确禁用它时才会离开自动链。
- **网页搜索可在 Firecrawl 免注册免费额度上运行**（每月 1,000 credits，无需注册），后面还有 Keenable 的免注册额度（每个 IP 每小时 1,000 次）和 You.com 的免注册搜索（每个 IP 每天 100 次）。配置了 `engine` 时以配置为准。搜索链不含 `local`，因为 `local` 不能搜索。三个免注册引擎都被限流时，搜索至少还需要一个带 key 的引擎或 `agy` 作为后备。抓取仍有 `local` 兜底。

X 是独立语料，不是竞争的搜索引擎，所以它永远不会顶替网页搜索。`--source` 选语料，`--engine` 选工具。

## 零配置

modsearch 没有配置文件也能跑：抓取有 `local` 兜底，搜索先走 Firecrawl 的免注册免费额度，再走 Keenable 的，再走 You.com 的。搜索没有 local 后备（`local` 不能搜索），所以三个免注册引擎都被限流时需要一个带 key 的引擎或 `agy`。它看这台机器上有什么，用最好的那个。只有用户想改变这一点时才需要建配置。

首选的免费升级是 Antigravity CLI，它写带引用的综述，一个工具同时覆盖搜索和抓取，还不要 key：

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # 用户在浏览器完成登录后退出
```

登录没法自动化，请用户本人跑一次 `agy`。

## 配置文件

`~/.modsearch/config.json`，写入时权限 0600，展示时 key 打码。优先级：CLI 参数 > 环境变量 > 这个文件 > 内置默认值。

```bash
modsearch config init     # 生成起步文件，每个字段都可省略
modsearch config show     # 生效配置：文件与环境变量合并，每个值标注来源 (file)/(env)，key 打码，别名归一显示
```

完整结构。每个字段都可省略，文件本身也可省略：

```json
{
  "engine": "tavily",
  "cooldown": "on",
  "allowPrivateNetwork": false,
  "engines": {
    "antigravity-cli": { "bin": "agy", "model": "gemini-3.8-flash-low" },
    "tavily":          { "apiKey": "tvly-...", "baseURL": "https://gw.example.com/tavily" },
    "exa":             { "apiKey": "...", "enabled": false },
    "firecrawl":       { "apiKey": "fc-...", "keylessFetch": false },
    "keenable":        { "apiKey": "..." },
    "grok-cli":        { "bin": "grok" }
  }
}
```

JSON 不支持注释，所以每个字段的说明在这里：

| 字段 | 类型 | 作用范围 | 含义 |
| :-- | :-- | :-- | :-- |
| `engine` | string | 顶层 | 由哪个引擎搜索。空表示自动（用本机可用的最好那个）。取值 `antigravity-cli`、`tavily`、`exa`、`firecrawl`、`keenable`、`youcom` 之一。别名 `agy`、`antigravity`、`grok`、`http`、`direct` 也接受，会归一为正式名。 |
| `cooldown` | `"on"` / `"off"` | 顶层 | 额度冷却故障转移。默认开。关掉后不读不写任何状态，路由与从前完全一致。 |
| `allowPrivateNetwork` | boolean | 顶层 | 允许本地抓取器访问私有或保留地址，包括 VPN 使用的其他保留地址段和 hosts 文件加速器。默认 `false`。DNS 返回的 `198.18.0.0/15` 地址已按 fake-ip 占位值放行，无需此开关。在 URL 中直写该地址段，开关关闭时仍会被拦截。此设置从不授权云端披露（Firecrawl 或 Keenable），URL 中直写的私有和保留目标始终不会发往云端。对于 DNS 结果，只有应用 fake-ip 例外后所有地址仍被判为私有或保留地址时，云端引擎才会拒绝披露。 |
| `engines` | object | 顶层 | 按引擎正式名分组的每引擎设置。 |
| `engines.<name>.enabled` | boolean | 所有引擎 | 是否允许自动路由使用该引擎。省略表示启用。设为 `false` 会排除它，设为 `true` 会删除覆盖并回到内置默认。单次显式 `--engine` 仍会强制使用该引擎。 |
| `engines.<name>.apiKey` | string | `tavily`、`exa`、`firecrawl`、`keenable` | 一个 API key，或用英文逗号分隔的多个 key。解析时会忽略空白和空项。鉴权、限流或配额失败时按顺序轮换 key。网络、5xx 或解析失败时直接切换下一个引擎。也可用环境变量 `TAVILY_API_KEY` / `EXA_API_KEY` / `FIRECRAWL_API_KEY` / `KEENABLE_API_KEY`，环境变量优先于文件。 |
| `engines.<name>.baseURL` | string | `tavily`、`exa`、`firecrawl`、`keenable` | 替换官方主机的接口地址：兼容的第三方网关、代理、自建部署。必须是完整的 http(s) URL。也可用环境变量 `TAVILY_BASE_URL` / `EXA_BASE_URL` / `FIRECRAWL_BASE_URL` / `KEENABLE_BASE_URL`。设为空即取消。详见下方端点一节。 |
| `engines.firecrawl.keylessFetch`、`engines.keenable.keylessFetch` | boolean | `firecrawl`、`keenable` | 允许该引擎在无 key 时通过它的云端抓取公网页面。默认 `true`（免注册抓取开箱即开）。设为 `false` 可让自动抓取远离该引擎的云端。配置了 key，或在你自己的全局配置里显式选择该引擎时仍会启用。 |
| `engines.<name>.bin` | string | `antigravity-cli`、`grok-cli` | 该引擎 CLI 的路径。默认在 `PATH` 上找 `agy` 和 `grok`。 |
| `engines.<name>.model` | string | `antigravity-cli` | 引擎使用的模型。默认 `gemini-3.8-flash-low`。 |

`local`（内置抓取器）和 `grok-cli` 不需要凭据，但都接受通用的 `enabled` 开关。老文件把 `allowPrivateNetwork` 存在 `engines.http.allowPrivateNetwork` 下，或存成字符串 `"true"`/`"false"` 的，读取时会自动提升为顶层布尔值。

```bash
modsearch config set engine tavily            # 选定搜索引擎
modsearch config set engine ""                # 回到自动
modsearch config set tavily.apiKey <key>      # 引擎凭据
modsearch config set tavily.apiKey <key1,key2> # 按此顺序轮换 key
modsearch config set tavily.apiKey            # 不带值：隐藏输入提示（见下）
modsearch config set tavily.baseURL <url>     # 兼容的第三方端点
modsearch config set tavily.enabled false     # 不让 Tavily 参与自动故障转移
modsearch config set tavily.enabled true      # 删除禁用覆盖
modsearch config set cooldown off             # 关闭额度冷却故障转移
modsearch config set allowPrivateNetwork true # 允许访问保留/私有地址段
```

用户要往对话里贴 key 时，先给更干净的路径：让用户在自己的终端跑不带值的
`modsearch config set <engine>.apiKey`，CLI 会弹出不回显的输入提示，key 不进这
个对话、不进 argv、不进 shell 历史（`pbpaste | modsearch config set
tavily.apiKey` 管道喂入也行）。用户还是直接贴进对话的话，照常替他保存：这个选
项是给在意的人的，不是一道门。

通用 `enabled` 开关同时作用于搜索、抓取和 X。抓取先用能抓取的首选引擎，再按内置顺序尝试已启用的引擎。禁用 `local` 会移除默认抓取兜底。禁用 `grok-cli` 会让 X 请求走文档约定的公开网页降级路径。单次显式 `--engine` 不受这些持久化禁用项影响。

项目也可以带一份自己的小配置，见下一节。

角色概念出现之前写的配置（一个全局 `provider` 加一个 `providers` 表）会被自动读取并映射，不用手动迁移。

## 项目配置

项目里可以放一个 `.modsearch/config.json`。modsearch 从当前目录往上找，到家目录为止停下。`~/.modsearch/config.json` 不会被当成项目文件。取最近的一个，叠在全局文件之上。

项目文件只能收紧，不能放宽。它只能设三样东西：

```json
{
  "engine": "tavily",
  "engines": {
    "exa": { "enabled": false },
    "antigravity-cli": { "model": "gemini-3.8-flash-low" }
  }
}
```

- `engine`：这个项目首选的搜索引擎。
- `engines.<name>.enabled: false`：在这里把某个引擎排除出自动路由。`true` 不能把全局文件关掉的引擎再打开。
- `engines.<name>.model`：该引擎用的模型。

其余一律忽略：`apiKey`、`bin`、`baseURL`、`keylessFetch`、`cooldown`、`allowPrivateNetwork`、`enabled: true`，以及 modsearch 不认识的引擎。项目目录可能是别人的仓库，里面的 `bin` 能运行任意程序，`baseURL` 能把你的 key 发到任何地方。被忽略的条目只报路径，不报值，出现在搜索时的 stderr、`modsearch doctor`（一行 `project:` 和一行 `! ignored ...`，`--json` 里是 `projectConfig`）和 `modsearch config show`（值后面标 `(project)`）里。

项目的 `engine` 不等于同意云端抓取。如果它指向一个你关掉了 `keylessFetch` 的云端引擎，或者一个没配好的引擎（比如没有 key 的 Tavily），路由会跳过它并给出一条说明。只有你自己的全局配置才能表示同意。

项目文件写坏了，这次运行会失败：`Failed to read the project config <path>: ... Fix or delete the file.` 或 `The project config <path> is not a JSON object. Fix or delete the file.` 设 `MODSEARCH_PROJECT_CONFIG=off` 可关掉这个查找。`modsearch config set` 仍只写全局文件。

dsh 插件给它启动的 CLI 设了 `MODSEARCH_PROJECT_CONFIG=off`。一个 dsh 进程服务所有工作区，工具调用又不会说明来自哪个工作区，所以 CLI 的当前目录是 dsh 的，不是工作区的。dsh 里按工作区生效的配置，要等 dsh 把工作区路径传给插件。

## 引擎设置

### antigravity-cli（搜索 + 抓取，免费，无 key）

按上文安装并登录。它的免费额度是与 Antigravity 桌面应用和 SDK 共享的每周配额，重度使用的一天可能把它耗尽。耗尽时报错会明说。

```bash
modsearch config set antigravity-cli.model gemini-3.1-pro-high   # 更难的研究型问题
modsearch config set antigravity-cli.bin /custom/path/to/agy
```

### tavily（搜索，免费额度）

每月 1,000 credits，不绑卡，基础搜索一次一个 credit。key 在 https://app.tavily.com 领。

```bash
modsearch config set tavily.apiKey <key>
# 或环境变量：export TAVILY_API_KEY=<key>
```

给免注册额度和 agy 都耗尽时上的好保险：有 key 在，网页搜索会自动落到 Tavily。

### exa（搜索，每月免费额度）

每月循环 $10 额度，约 1,400 次搜索，不绑卡。key 在 https://exa.ai 领。

```bash
modsearch config set exa.apiKey <key>
# 或环境变量：export EXA_API_KEY=<key>
```

Exa 返回排好序的链接和高亮片段，但不写综述，所以它的 summary 是机械拼的，证据在 `items` 里。它在搜索顺序中排在 Tavily 之后。

### firecrawl（搜索 + 抓取，默认免注册）

默认引擎，也是裸安装能直接干活的原因：Firecrawl 的免注册通道[每月送 1,000 免费 credits，无需注册](https://www.firecrawl.dev/blog/firecrawl-keyless-launch)。免注册请求不发送 Authorization header，按 IP 计量，受每日请求数和 credits 两项上限约束（[限流文档](https://docs.firecrawl.dev/rate-limits#keyless-no-api-key)没有公开每日上限的具体数字）。在 https://firecrawl.dev 领一个免费 key，可以再得独享的每月 1,000 credits 和更高限额：

```bash
modsearch config set firecrawl.apiKey <key>
# 或环境变量：export FIRECRAWL_API_KEY=<key>
modsearch config set firecrawl.keylessFetch false   # 让自动抓取不走云端
```

两个角色开箱都免 key 运行。抓取正是 Firecrawl 领跑的原因：它在云端跑真实浏览器，JavaScript 渲染的页面能带着本地引擎看不到的内容回来。这也意味着公网 URL 会被交给第三方，每次云端抓取的结果 warning 都会标明这条边界。想让自动抓取只走本地，要同时设 `firecrawl.keylessFetch false` 和 `keenable.keylessFetch false`（Keenable 的阅读器也在云端，见下文）：搜索照常免 key，抓取则两者都跳过，除非配置了 key 或用 `-e` 显式选其中一个。URL 中直写的私有和保留地址目标始终跳过 Firecrawl，即使开着 `--allow-private-network` 也不例外。主机名的 DNS 结果采用更窄的云端披露规则。Clash、Surge 和 mihomo 使用的标准 fake-ip 池 `198.18.0.0/15` 会被视为占位值，只有所有解析地址都是真私网或保留地址时才会拦下。只要有一个公网地址就会放行。这个例外只作用于 DNS 结果。本地 SSRF 守卫仍把 `198.18.0.0/15` 判为私网，这个开关也只让本地引擎访问它。

每次 Firecrawl 抓取花一个 credit 并强制重新爬。modsearch 发送 `maxAge: 0`，关掉 Firecrawl 默认的多天缓存，所以抓取永远不会拿到过期内容。这个取舍是故意的：一次抓取一个 credit，换来内容是新的，这正是工具的意义。想省 credits 不要新鲜度的话，Firecrawl 不是该选的引擎。

### keenable（搜索 + 抓取，默认免注册）

不要 key 也不用注册，在搜索和抓取顺序里都排第二，紧跟 Firecrawl。免注册请求走 Keenable 的公共端点，每个 IP 每小时 1,000 次（同一 IP 上所有人共用），每秒最多 10 次。在 https://app.keenable.ai 领一个免费 key，请求就改走带 key 的端点：没有每小时上限，每个组织每月 100,000 次。

```bash
modsearch config set keenable.apiKey <key>
# 或环境变量：export KEENABLE_API_KEY=<key>
```

搜索时它和 Exa 一样返回排好序的链接和片段（Keenable 有发布日期时也带上），但不写综述，所以 summary 是机械拼的，会有一条 warning 说明这一点，证据在 `items` 里。

Keenable 也能读页面（`-u`）。免注册抓取走 `/v1/fetch/public`，不用注册。有 key 时改走 `/v1/fetch`。每次抓取都要求实时读取，而不是 Keenable 索引里的旧副本，返回的是 Keenable 提取出的 markdown，不是页面原样。它的阅读器会不会执行 JavaScript，文档没有说明，别指望它能。公网 URL 会被发给 Keenable，所以结果带一条 warning，SSRF 规则与 Firecrawl 相同：URL 中直写的私有或保留地址，以及 DNS 结果全是私网的主机名（`198.18.0.0/15` 的 fake-ip 池按占位值算，不算私网），都不会离开本机。`-u` 配 `-q`（或 `--prompt`）时，关注点会作为 Keenable 的 `prompt` 发出，内容就变成 Keenable 模型针对该关注点的提取结果，不是页面正文，links 为空，warning 会说明。关注点超过 2,000 字符时会丢掉它并给出 warning，返回完整页面。

```bash
modsearch config set keenable.keylessFetch false   # 让自动抓取不走 Keenable 云端
```

`keenable.keylessFetch false` 的语义和 Firecrawl 的一样：配置了 key，或在你自己的全局配置里选了 `engine keenable`，就会重新启用。

### youcom（搜索，只有免注册）

不要 key 也不用注册，在搜索顺序里排第三，在 Firecrawl 和 Keenable 之后。请求走 `https://api.you.com/v1/agents/search`，每个 IP 每天 100 次（同一 IP 上所有人共用）。它没有 `apiKey`、`baseURL` 或模型设置，也没有带 key 的升级方式。`--max-results` 最多 50。想让自动路由跳过它，设 `engines.youcom.enabled: false`，`-e youcom` 仍可单次强制使用。

You.com 只搜索，所以 `-u` 配 `-e youcom` 会报错。它和 Keenable 一样返回排好序的链接和片段（You.com 有 `page_age` 时作为发布日期带上），但不写综述，所以 summary 是机械拼的，会有一条 warning 说明这一点，证据在 `items` 里。

### 第三方兼容端点（tavily、exa、firecrawl、keenable）

四个 HTTP 引擎可以指向任何与官方 API 同协议的端点：转售网关、区域代理、自建部署。设置 `baseURL` 后，引擎在它上面拼各自的文档路径（tavily 和 exa 是 `/search`，firecrawl 是 `/v2/search` 和 `/v2/scrape`，keenable 带 key 时是 `/v1/search` 和 `/v1/fetch`，免注册时是 `/v1/search/public` 和 `/v1/fetch/public`），所以 base 为 `https://gw.example.com/tavily` 时会请求 `https://gw.example.com/tavily/search`。

官方基地址内置在 provider 代码里，分别是 `https://api.tavily.com`、`https://api.exa.ai`、`https://api.firecrawl.dev`、`https://api.keenable.ai`。它们不会被复制进 `config.json`。`baseURL` 缺失或被清空都表示使用内置官方地址，这样后续版本修正默认值时不会被旧配置文件压住。dsh 设置卡片也遵守同一规则。

```bash
modsearch config set tavily.baseURL https://gw.example.com/tavily
modsearch config set tavily.baseURL ""        # 回到官方端点
# 或按次生效：export TAVILY_BASE_URL=... / EXA_BASE_URL=... / FIRECRAWL_BASE_URL=... / KEENABLE_BASE_URL=...
```

API key 会发给 base 指定的主机。这正是功能的意义，也正是信任决定：只指向你愿意把这个 key 交出去的主机。

### grok-cli（X，随 SuperGrok 或 X Premium 订阅）

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok    # 用户用 SuperGrok 或 X Premium 登录
```

不需要再开任何东西。`grok` 装好并登录后，X 味的查询自动去 X。没装的话，X 问题由公开网页作答，结果的 `warnings` 里会写明。

### local（抓取，零安装）

内置的直连抓取器（别名 `http` 和 `direct` 仍然可用）。无需设置。它带 SSRF 防护（私有地址段、云元数据、每一跳重定向检查、大小上限），并把连接钉在校验过的 IP 上，DNS 重绑定钻不过去。它不跑 JavaScript，也不是完整的浏览器沙箱：抓不可信的 URL 时，仍应在沙箱工作目录里跑。

两种代理形态：

1. TUN + fake-ip（Clash、Clash Verge Rev、mihomo、Surge）。DNS 返回的 `198.18.0.0/15` 地址会被视为 fake-ip 占位值，无需开启任何开关。连接仍固定到检查过的 fake-ip，Host 请求头和 TLS SNI 保留原域名。在 URL 中直接写 `http://198.18.0.5/`，`allowPrivateNetwork` 关闭时仍会被拦截。
2. 系统 HTTP 代理（`http_proxy` / `https_proxy` 环境变量，DNS 返回真实 IP）。需要设置这些环境变量。本地引擎会把请求转给代理。主机名由代理解析，所以 socket 不会钉在检查过的 IP 上。

如果分流 VPN 把公网主机名映射进其他保留地址段，或 Watt Toolkit / Steam++ 等 hosts 文件加速器将其指向回环地址，仍需用仅对本地抓取生效的开关放行：

```bash
modsearch -u <url> --allow-private-network
modsearch config set allowPrivateNetwork true   # 永久生效（顶层，全局）
```

## 额度冷却故障转移

某个 API key 因额度类错误失败时，modsearch 把这个 key 记在 `~/.modsearch/state.json`（与 `config.json` 分开）。下一次运行会先试同一引擎里的健康 key。只有所有已配置 key 都在冷却时，整个引擎才会移到后备链末尾。没有 API key 的引擎仍按引擎粒度冷却。这是软化的熔断器，不是负载均衡：健康 key 和健康引擎拿全部工作，冷却项仍保留为最后尝试。

- 冷却中的 key 不会被移除。某个 key 成功后只清除它自己的冷却。旧格式的引擎级状态仍可读取，并在任一 key 成功前作用于该引擎的所有 key。
- 引擎报错里的精确重置时间（agy 的 `Resets in 94h19m9s`）会被采用。没写时间的额度错误冷却 45 分钟。按秒的速率限制是瞬时的，从不记录。
- 显式 `-e`/`--engine` 仍是硬指定，不会跨引擎后备。同一引擎有多个 key 时，健康 key 仍排在冷却 key 前面。
- 结果的 `warnings` 会指出哪个 key 进入冷却。只有所有已配置 key 都在冷却并导致引擎后移时，路由 warning 才按引擎报告。

开关默认开：

```bash
modsearch config set cooldown off   # 关闭：不读不写状态，路由与从前完全一致
modsearch config set cooldown on    # 重新打开
modsearch state clear               # 立即忘掉所有冷却
```

`modsearch doctor` 会显示开关状态和当前在冷却的每个引擎或 key，以及剩余时间。

## 故障排查

- `firecrawl rejected the keyless request`：免注册访问暂不可用或达到限额。配置免费 Firecrawl key，等待每日额度恢复，或改用其他引擎。搜索没有 `local` 后备（`local` 不能搜索）。
- agy 的额度报错：每周免费额度用完了。加一个带 key 的搜索引擎，或等报错里写的重置时间。冷却开着时，agy 会被自动挪到最后直到重置。
- `keenable's keyless pool for this IP is used up for the hour`：本 IP 共用的免注册额度（每小时 1,000 次）用完了。下一个搜索引擎会接手。配一个免费 Keenable key 可得独享的每月 100,000 次。
- `youcom's keyless allowance for this IP is used up for the day (100 searches)`：本 IP 共用的免注册额度（每天 100 次）用完了。下一个搜索引擎会接手，You.com 不会进入冷却。它没有可加的 key，所以等到第二天或换其他引擎。其他失败的信息形如 `youcom returned <status> <statusText>. <body>`。
- `exa is out of credits` / `firecrawl is out of credits` / `keenable is out of credits`：当前额度用完了。其他搜索引擎会自动接手，冷却把耗尽的挪到最后直到恢复。
- `Blocked private network target`：SSRF 防护。用户在 VPN 后面的话，用 `--allow-private-network` 重试。
- 配置里引擎名写错：modsearch 在 `warnings` 里说明，并照常用一个能干活的引擎。用户想要回那个引擎时把名字改对。
- 超时：先用 `--timeout 300000` 重试一次再上报失败。
