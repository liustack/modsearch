# 配置 ModSearch

[English](configure.md) | 简体中文

用户问怎么装 modsearch、要加 key、要换引擎，或者遇到配置类的失败时，读这份文档。直接替用户把命令跑了，不要把说明贴给对方。

## 心智模型

三件工作，称为角色（role）。每个角色有能干这活的引擎：

| 工作 | 引擎 | 可配置吗 |
| :-- | :-- | :-- |
| 搜公开网页 | `firecrawl`、`antigravity-cli`、`tavily`、`exa` | 可以，`engine` 这一个设置就是管它的 |
| 读一个 URL | 所选引擎（若它能抓取），然后是免注册的 `firecrawl`，最后 `local` | 不可以，跟随上面的选择 |
| 搜 X（推特） | `grok-cli` | 不可以，别的引擎看不到 X 里面 |

搜索顺序固定为 `firecrawl`、`antigravity-cli`、`tavily`、`exa`。抓取顺序是 `firecrawl`、`antigravity-cli`、`local`。可用性会过滤这份名单，额度冷却会重新排序（见下文），但基础顺序不变。Firecrawl 领跑两条链，因为它的免注册通道在裸机上就能用，不要账号不要 key。

从这张表能推出两个事实，它们回答大多数问题：

- **单页抓取永远可用。** `local` 引擎零安装，无论其他引擎配没配、坏没坏，它都是抓取的兜底。
- **网页搜索无需配置。** Firecrawl 的免注册免费额度（每月 1,000 credits，无需注册）开箱就能扛。配置了 `engine` 时以配置为准。

X 是独立语料，不是竞争的搜索引擎，所以它永远不会顶替网页搜索。`--source` 选语料，`--engine` 选工具。

## 零配置

modsearch 没有配置文件也能跑：装完就在 Firecrawl 的免注册免费额度上搜索和抓取。它看这台机器上有什么，用最好的那个。只有用户想改变这一点时才需要建配置。

最强的免费升级是 Antigravity CLI，它写带引用的综述，一个工具同时覆盖搜索和抓取，还不要 key：

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
    "antigravity-cli": { "bin": "agy", "model": "gemini-3.6-flash-low" },
    "tavily":          { "apiKey": "tvly-...", "baseURL": "https://gw.example.com/tavily" },
    "exa":             { "apiKey": "..." },
    "firecrawl":       { "apiKey": "fc-...", "keylessFetch": false },
    "grok-cli":        { "bin": "grok" }
  }
}
```

JSON 不支持注释，所以每个字段的说明在这里：

| 字段 | 类型 | 作用范围 | 含义 |
| :-- | :-- | :-- | :-- |
| `engine` | string | 顶层 | 由哪个引擎搜索。空表示自动（用本机可用的最好那个）。取值 `antigravity-cli`、`tavily`、`exa`、`firecrawl` 之一。别名 `agy`、`antigravity`、`grok`、`http`、`direct` 也接受，会归一为正式名。 |
| `cooldown` | `"on"` / `"off"` | 顶层 | 额度冷却故障转移。默认开。关掉后不读不写任何状态，路由与从前完全一致。 |
| `allowPrivateNetwork` | boolean | 顶层 | 本地网络策略：允许本地抓取器访问保留和私有地址段。它对 firecrawl 从不生效：目标是保留地址，或解析到保留地址，都一律不发给云端，因为这个开关授权的是本地访问，不是把内部主机名交给第三方服务。默认 `false`。 |
| `engines` | object | 顶层 | 按引擎正式名分组的每引擎设置。 |
| `engines.<name>.apiKey` | string | `tavily`、`exa`、`firecrawl` | 该引擎的 API key。也可用环境变量 `TAVILY_API_KEY` / `EXA_API_KEY` / `FIRECRAWL_API_KEY`，环境变量优先于文件。 |
| `engines.<name>.baseURL` | string | `tavily`、`exa`、`firecrawl` | 替换官方主机的接口地址：兼容的第三方网关、代理、自建部署。必须是完整的 http(s) URL。也可用环境变量 `TAVILY_BASE_URL` / `EXA_BASE_URL` / `FIRECRAWL_BASE_URL`。设为空即取消。详见下方端点一节。 |
| `engines.firecrawl.keylessFetch` | boolean | `firecrawl` | 允许 Firecrawl 在无 key 时抓取公网页面。默认 `true`（免注册抓取开箱即开）。设为 `false` 可让自动抓取远离 Firecrawl 云端。配置了 key 或显式选择 Firecrawl 引擎时仍会启用。 |
| `engines.<name>.bin` | string | `antigravity-cli`、`grok-cli` | 该引擎 CLI 的路径。默认在 `PATH` 上找 `agy` 和 `grok`。 |
| `engines.<name>.model` | string | `antigravity-cli` | 引擎使用的模型。默认 `gemini-3.6-flash-low`。 |

`local`（内置抓取器）和 `grok-cli` 不需要凭据，所以没有值得存的每引擎设置。老文件把 `allowPrivateNetwork` 存在 `engines.http.allowPrivateNetwork` 下，或存成字符串 `"true"`/`"false"` 的，读取时会自动提升为顶层布尔值。

```bash
modsearch config set engine tavily            # 选定搜索引擎
modsearch config set engine ""                # 回到自动
modsearch config set tavily.apiKey <key>      # 引擎凭据
modsearch config set tavily.apiKey            # 不带值：隐藏输入提示（见下）
modsearch config set tavily.baseURL <url>     # 兼容的第三方端点
modsearch config set cooldown off             # 关闭额度冷却故障转移
modsearch config set allowPrivateNetwork true # 允许访问保留/私有地址段
```

用户要往对话里贴 key 时，先给更干净的路径：让用户在自己的终端跑不带值的
`modsearch config set <engine>.apiKey`，CLI 会弹出不回显的输入提示，key 不进这
个对话、不进 argv、不进 shell 历史（`pbpaste | modsearch config set
tavily.apiKey` 管道喂入也行）。用户还是直接贴进对话的话，照常替他保存：这个选
项是给在意的人的，不是一道门。

抓取只有一个开关（上文的 `firecrawl.keylessFetch`），X 一个都没有，这是故意的。抓取用所选引擎（若它能抓），然后是免注册的 Firecrawl，最后是内置本地抓取器。X 只有一个可能的引擎，没有需要存的选择。

角色概念出现之前写的配置（一个全局 `provider` 加一个 `providers` 表）会被自动读取并映射，不用手动迁移。

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

两个角色开箱都免 key 运行。抓取正是 Firecrawl 领跑的原因：它在云端跑真实浏览器，JavaScript 渲染的页面能带着本地引擎看不到的内容回来。这也意味着公网 URL 会被交给第三方，每次云端抓取的结果 warning 都会标明这条边界。想让自动抓取只走本地，设 `firecrawl.keylessFetch false`：搜索照常免 key，抓取则跳过 Firecrawl，除非配置了 key 或用 `-e firecrawl` 显式选它。私有或保留地址的目标一律跳过它、交给本地引擎，即使 `--allow-private-network` 开着也一样：URL 里写的保留段 IP、天生本地的名字（`localhost`、`*.local`、`*.internal`），以及解析到保留 IP 的公网样子主机，都不发给云端。VPN 的假 IP 和真内部名从这里分不出来，所以都不上线。开关只让本地引擎访问它们。

每次 Firecrawl 抓取花一个 credit 并强制重新爬。modsearch 发送 `maxAge: 0`，关掉 Firecrawl 默认的多天缓存，所以抓取永远不会拿到过期内容。这个取舍是故意的：一次抓取一个 credit，换来内容是新的，这正是工具的意义。想省 credits 不要新鲜度的话，Firecrawl 不是该选的引擎。

### 第三方兼容端点（tavily、exa、firecrawl）

三个 HTTP 引擎可以指向任何与官方 API 同协议的端点：转售网关、区域代理、自建部署。设置 `baseURL` 后，引擎在它上面拼各自的文档路径（tavily 和 exa 是 `/search`，firecrawl 是 `/v2/search` 和 `/v2/scrape`），所以 base 为 `https://gw.example.com/tavily` 时会请求 `https://gw.example.com/tavily/search`。

```bash
modsearch config set tavily.baseURL https://gw.example.com/tavily
modsearch config set tavily.baseURL ""        # 回到官方端点
# 或按次生效：export TAVILY_BASE_URL=... / EXA_BASE_URL=... / FIRECRAWL_BASE_URL=...
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

把公网主机名映射进保留地址段的 VPN 会触发这些防护：

```bash
modsearch -u <url> --allow-private-network
modsearch config set allowPrivateNetwork true   # 永久生效（顶层，全局）
```

## 额度冷却故障转移

引擎因额度类错误失败时，modsearch 把它记在 `~/.modsearch/state.json`（与 `config.json` 分开），并把它挪到后备链末尾直到恢复，这样下一次运行先落到健康引擎，而不是撞同一堵墙。这是软化的熔断器，不是负载均衡：健康引擎拿全部工作，耗尽的只在最后一试。

- 耗尽的引擎不会被移除。其他全部失败或不可用时仍会试它，一旦成功立即清除冷却。
- 引擎报错里的精确重置时间（agy 的 `Resets in 94h19m9s`）会被采用。没写时间的额度错误冷却 45 分钟。按秒的速率限制是瞬时的，从不记录。
- 显式 `-e`/`--engine` 完全无视冷却，与硬指定规则一致。
- 结果的 `warnings` 会写明哪个引擎在冷却、冷却到什么时候。

开关默认开：

```bash
modsearch config set cooldown off   # 关闭：不读不写状态，路由与从前完全一致
modsearch config set cooldown on    # 重新打开
modsearch state clear               # 立即忘掉所有冷却
```

`modsearch doctor` 会显示开关状态和当前在冷却的引擎，以及剩余时间。

## 故障排查

- `firecrawl rejected the keyless request`：免注册访问暂不可用或达到限额。配置免费 Firecrawl key，等待每日额度恢复，或改用其他引擎。
- agy 的额度报错：每周免费额度用完了。加一个带 key 的搜索引擎，或等报错里写的重置时间。冷却开着时，agy 会被自动挪到最后直到重置。
- `exa is out of credits` / `firecrawl is out of credits`：当前额度用完了。其他搜索引擎会自动接手，冷却把耗尽的挪到最后直到恢复。
- `Blocked private network target`：SSRF 防护。用户在 VPN 后面的话，用 `--allow-private-network` 重试。
- 配置里引擎名写错：modsearch 在 `warnings` 里说明，并照常用一个能干活的引擎。用户想要回那个引擎时把名字改对。
- 超时：先用 `--timeout 300000` 重试一次再上报失败。
