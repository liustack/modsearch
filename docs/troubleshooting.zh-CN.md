---
summary: '故障排查：modsearch 会打印的每条报错、成因和解法'
read_when:
  - 一次运行失败了，报错信息看不明白
  - 结果来自一个你没想到的引擎
  - 判断一次失败是配置、额度还是 bug
---

# 故障排查

[English](troubleshooting.md) | 简体中文

下面每条信息都是 modsearch 真实会打印的。用你看到的字样在本页搜索。

## 第一步：先跑 `modsearch doctor`

解读报错之前先跑 `modsearch doctor`。它报告 Node 版本、每个角色下各引擎的就绪状态和原因（二进制在不在 PATH、key 来自环境还是文件、Grok 登录文件在不在）、配置来自哪里、文件权限、私有网络状态，全程不花额度、不发请求。缺什么会附一条可直接复制的修复命令。大多数配置问题在这里一眼可见。加 `--json` 可把报告喂给工具。

## 所有搜索引擎都失败

```
Every engine for the web source failed.
  - firecrawl: ...
```

Firecrawl、Keenable 和 You.com 都能走免注册端点搜索，所以裸安装也有可用引擎。现在看到这条信息，表示所有候选都在运行时失败。按尝试列表找真实原因，常见情况是网络不可用、超时、免注册每日额度耗尽、Keenable 免注册的每小时额度用完、You.com 免注册的每日额度用完，或已配置引擎的账号额度用完。

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash && agy   # 然后登录
# 或增加一份个人 API 额度：
modsearch config set tavily.apiKey <key>
modsearch config set exa.apiKey <key>
modsearch config set firecrawl.apiKey <key>
modsearch config set keenable.apiKey <key>
```

云端引擎失败时，单页抓取（`-u`）仍会落到内置本地引擎。

## 走 HTTP 代理出网

```
firecrawl request failed: fetch failed; cause: getaddrinfo EAI_AGAIN api.firecrawl.dev
firecrawl does not allow keyless use from a proxy or VPN exit IP. Set a free key: modsearch config set firecrawl.apiKey <key>, or use keenable or youcom.
```

modsearch 的每个引擎 API 调用和单页抓取都会读 `http_proxy` / `https_proxy` / `no_proxy`（大小写都认），不需要额外的 Node 参数。前提是代理变量在拉起 modsearch 的那个进程的环境里。由服务管理器（而不是登录 shell）启动的宿主常常缺这几个变量，这时尝试列表里会出现 `EAI_AGAIN`、`ENOTFOUND`、`ECONNREFUSED` 这类 DNS 或连接错误。把变量导出到宿主启动的地方，或写进它的服务配置。5.10.12 之前只有单页抓取认代理，搜索会在所有引擎上报一句光秃秃的 `fetch failed`。

Firecrawl 会拒绝来自 VPN 或代理 IP 的免注册请求，等多久都没用：配一个免费的 Firecrawl key，或者让 Keenable 和 You.com 来答（它们本来就排在后面，什么都不用改）。

## 额度耗尽

```
Individual quota reached. Please upgrade your subscription ... Resets in 94h19m9s.
```

agy 的免费额度是 Antigravity 桌面应用、CLI、SDK 共享的每周配额，并行子 agent 会加速消耗。三条出路：

- 等报错里写的重置时间。
- 加一个带 key 的搜索引擎（Tavily、Exa、Firecrawl 或 Keenable）。You.com 没有 key 可加。之后搜索自动落到它，你不用再做任何事。
- 冷却开着时（默认），agy 会被记为耗尽并挪到链末尾直到重置，后续运行先走别家。见下文「某个引擎总被跳过」。

## agy 在你所在地区不可用

```
Eligibility check failed: Your current account is not eligible for Antigravity, because it is not currently available in your location.
```

Antigravity 没有在你所在的地区开放，所以不管登没登录，agy 每次调用都会拒绝。其他搜索引擎会自动接手。冷却开着时（默认），agy 会被按在链末尾一整天，后续运行不再先启动它。如果这台机器上 agy 永远用不了，就把它彻底移出自动链：

```bash
modsearch config set antigravity-cli.enabled false
```

## Windows 上闪出控制台窗口

`antigravity-cli` 引擎运行时，可能会弹出一个黑色控制台窗口并抢走焦点，多半发生在 agy 刚自我更新之后。modsearch 启动 agy 时隐藏了它的控制台，这一层确实一直隐藏着。窗口来自 agy 在自我更新收尾时自己启动的助手进程。这个助手进程会新开一个属于自己的控制台，modsearch 这边的任何设置都够不到它。在自身没有控制台的图形界面宿主（比如 DSH Desktop）下最常见。

窗口会自己关掉，不影响结果。想避开它，按上面的方法把 agy 移出自动链。需要时用 `-e antigravity-cli` 显式指定仍能调用它。

## Exa、Firecrawl 或 Keenable 鉴权被拒

```
exa rejected the API key (401). Fix it: modsearch config set exa.apiKey <key>
firecrawl rejected the API key (401). Fix it: modsearch config set firecrawl.apiKey <key>
keenable rejected the API key (401). Fix it: modsearch config set keenable.apiKey <key>
firecrawl rejected the keyless request (401). Anonymous access may be unavailable or rate-limited.
```

前三条表示已配置的 key 错误或被吊销。按报错里的命令设一个有效值，或导出 `EXA_API_KEY` / `FIRECRAWL_API_KEY` / `KEENABLE_API_KEY`。配了多个 key 时，被拒的 key 会先轮换到下一个。免注册报错表示 Firecrawl 没有接受这次匿名请求。等待每日额度恢复，配置免费 key 提高限制，或换其他引擎。鉴权失败不会进入冷却。

## Exa、Firecrawl 或 Keenable 额度用完

```
exa is out of credits: ...
firecrawl is out of credits: ...
keenable is out of credits (HTTP 402). ...
```

当前额度已经用完。对 Firecrawl 而言，它可能是免注册每日额度，也可能是账号额度。其他搜索引擎会自动接手，冷却开着时耗尽的引擎会被挪到链末尾直到恢复。加额度、换引擎，或等待对应周期重置。Keenable 带 key 的额度是每个组织每月 100,000 次，在 https://app.keenable.ai 管理。

## Keenable 免注册额度本小时用完

```
keenable's keyless pool for this IP is used up for the hour (1,000 requests). Set a free key for your own quota: modsearch config set keenable.apiKey <key> ...
```

不带 key 时，Keenable 每个 IP 每小时给 1,000 次，同一 IP 上的所有人共用这份额度（办公室、VPN 出口、云主机都算），每秒最多 10 次。链上的下一个搜索引擎会自动接手。想要一份独享额度，到 https://app.keenable.ai 领个免费 key：带 key 的 Keenable 没有每小时上限，每月 100,000 次。

```bash
modsearch config set keenable.apiKey <key>
# 或环境变量：export KEENABLE_API_KEY=<key>
```

## You.com 免注册额度今天用完

```
youcom's keyless allowance for this IP is used up for the day (100 searches). Search continues with the next engine.
```

You.com 免注册搜索每个 IP 每天给 100 次，同一 IP 上的所有人共用这份额度（办公室、VPN 出口、云主机都算）。链上的下一个搜索引擎会自动接手，这条错误不会让 You.com 进入冷却。它没有可以加的 key 来换更大的额度，所以等到第二天，或换其他引擎。其他失败的信息形如 `youcom returned <status> <statusText>. <body>`。

## Tavily 月度额度用完（432/433）

```
tavily is out of monthly quota (HTTP 432). ...
```

月度预算花完时 Tavily 返回 432（套餐用量上限）或 433（按量付费上限）。modsearch 把它们读作月度额度类错误，冷却开着时这个引擎会被按住一整天而不是默认的 45 分钟，因为一小时内重试只会撞同一堵墙。期间其他搜索引擎接手。到 https://app.tavily.com 加钱或等月度重置。

## 某个引擎总被跳过

modsearch 在绕开一个冷却。引擎撞过额度墙或地区限制后会被记在 `~/.modsearch/state.json` 里，恢复前总是最后一试，结果的 `warnings` 会写明是哪个引擎、冷却到什么时候。跑 `modsearch doctor` 看谁在冷却、还剩多久。手动清除：

```bash
modsearch state clear
```

想彻底关掉这个行为、让路由和从前完全一样：`modsearch config set cooldown off`。冷却中的引擎从不被移除，只是排序靠后，其他全挂时仍会试它。

## 答题的引擎不对

看输出里的 `results[].engine`。引擎按本机装了什么逐次挑选，所以这通常是正确行为而不是故障：

- 期望 agy，来了 `tavily`：agy 失败或不可用，Tavily 接了活。`warnings` 写明了这次回退，`attempts` 里有 agy 的具体失败。
- 期望 agy，抓取来了 `local`：同样的剧情，页面按原样返回，没有综述和焦点提炼（`warnings` 有说明）。
- 问的是 X，来了 `antigravity-cli` 或 `tavily`：Grok Build 缺失或未登录，这是二手的网页证据。`warnings` 会明说。

需要确定用哪个引擎时，用 `-e <name>` 硬指定。

## 私有网络目标被拦

```
Blocked private network target: example.com -> 10.0.0.5. If a VPN or proxy on
this machine maps public hosts into reserved ranges outside the 198.18.0.0/15
fake-IP pool, allow it with
--allow-private-network, or: modsearch config set allowPrivateNetwork true
```

```
Blocked private network target: github.com -> 127.0.0.1. If a VPN or proxy on
this machine maps public hosts into reserved ranges outside the 198.18.0.0/15
fake-IP pool, or a hosts-file accelerator (such as Watt Toolkit / Steam++) points
public domains at 127.0.0.1, allow it with
--allow-private-network, or: modsearch config set allowPrivateNetwork true
```

Clash、Clash Verge Rev、mihomo 和 Surge 的代理 fake-ip 模式开箱即用。DNS 返回的 `198.18.0.0/15` 地址会被视为 fake-ip 占位值，无需开启 `allowPrivateNetwork`。例外仅限 DNS 结果。在 URL 中直接写 `http://198.18.0.5/`，开关关闭时仍会被拦截。

SSRF 防护拒绝了一个私有或保留地址。可能有三种成因：

- **VPN 或代理**把公网主机名映射进其他保留地址段，例如 `10.0.0.0/8`。分流隧道客户端可能出现这种情况，用上面的参数或配置放行。
- **hosts 文件加速器**，例如 Watt Toolkit / Steam++。它把公网域名写进 hosts，指向 `127.0.0.1`，本机进程在 443 上监听并转发。用 `modsearch config set allowPrivateNetwork true` 放行。放行后，Node 22.15+ 上 modsearch 会自动信任操作系统证书库，由代理的本地已安装 CA 签发的证书就能通过校验。Node 22.13 和 22.14 没有通过这个 API 读取系统证书库的能力，请升级到 22.15+。如果要给整个 Node 进程启用系统 CA，Node 22.15+ 可设 `NODE_OPTIONS=--use-system-ca`，`NODE_USE_SYSTEM_CA=1` 则需要 Node 22.19+ 或 24.6+。firecrawl 是云端引擎，够不到本机回环地址，此场景只能走 local 引擎。
- **真正的内网地址**，这正是防护存在的意义。不要为了够它而关掉防护。

## 页面抓回来几乎是空的

本地引擎不跑 JavaScript。纯客户端渲染的页面 HTML 里几乎没有内容，结果会在 `uncertainty` 里说明。可选项：改走 agy 抓（`-e antigravity-cli`），或找一个服务端渲染的同内容 URL。

## 硬指定了一个跑不了的引擎

`-e`/`--engine` 是硬指定：只用那一个引擎，没有回退。指定的引擎是笔误、干不了这个活，或运行时失败，这次运行就报错，而不是悄悄换引擎花别家的额度。

```
Unknown engine "tavil" (--engine). Drop -e to let modsearch pick one that works, or name a known engine: ...
```

笔误。改对拼写，或去掉 `-e` 让 modsearch 自动选。

```
The tavily engine cannot fetch (--engine forces it with no fallback). Drop -e to let modsearch pick an engine that can. ...
```

你把一个只会搜索的引擎硬指定去读页面了。去掉 `-e` 让 modsearch 路由，或硬指定 `-e antigravity-cli`（它能抓取）。

## 配置文件问题

```
Cannot read /Users/you/.modsearch/config.json: EACCES ... Fix the file or its permissions.
```

文件存在但读不了。文件缺失是正常的（那就是零配置路径），所以这是真实的权限或文件类型问题，值得修而不是无视。Windows 上文件在 `%USERPROFILE%\.modsearch\config.json`。

```
Failed to parse ... Fix or delete the file.
```

JSON 无效。`modsearch config init --force` 重写一个干净的，原内容丢弃。

## 超时

```
antigravity-cli engine timed out after 210000 ms.
```

先用 `--timeout 300000` 重试一次。还超时的话，引擎是卡住了不是慢：手动开 `agy` 检查。无视 SIGTERM 的引擎会被升级到 SIGKILL，所以就算进程不配合，超时也总能及时返回。

```
firecrawl: skipped: the run deadline of 55000 ms was used up before it could start.
```

这次运行带了 `--deadline`（dsh 插件总会带），排在前面的引擎把整个时限用完了，这个引擎根本没开始跑。通常是第一个引擎太慢。可以调低 `--timeout`，别让一个引擎吃掉全部时间，或者在调用方等得起时调高 `--deadline`。在 dsh 里对应 `providerTimeoutMs` 和 `providerDeadlineMs`，见 [dsh 文档](dsh.zh-CN.md#配置-dsh-插件)。

## Grok Build 在搜索 X 之前就停了

```
Grok Build stopped before searching X (placeholder result). Retry, or update Grok Build.
```

Grok Build 在调用 X 搜索工具之前就结束了，返回空的 items，再配上「正在检索…」这类占位说法。旧版 modsearch 会给 grok 传 `--json-schema`，这个参数会截断 Grok Build 的搜索循环，所以每次都是占位结果。当前版本不再传这个参数，结果从最终消息里读取。

再跑一次搜索。如果反复出现，更新 Grok Build（`grok` CLI）。

## modsearch 拒绝运行（递归守卫）

```
modsearch refused to run: it was started from inside an engine that modsearch itself spawned (recursion guard). An engine such as Grok Build tried to call modsearch instead of using its own search tools.
```

modsearch 拉起了一个引擎，那个引擎又想再跑一次 modsearch。CLI 会拦住这个循环，避免再花一轮额度。

这不是配置问题。grok-cli 已经禁止了会向外调 shell 的工具。再跑一次搜索。如果反复出现，更新 Grok Build（`grok` CLI）。

## 全军覆没

```
Every engine for the web source failed.
  - antigravity-cli: ...
  - tavily: ...
```

每个引擎自己的失败按顺序列出。从第一个能修的下手，通常是额度或 key。

## 还是没辙

用 modsearch 打印的失败命令原样重跑一遍，把那份输出附在 issue 里：https://github.com/liustack/modsearch/issues
