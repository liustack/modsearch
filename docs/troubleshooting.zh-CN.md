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

Firecrawl 的免注册端点会收住普通搜索链，所以裸安装也有可用引擎。现在看到这条信息，表示所有候选都在运行时失败。按尝试列表找真实原因，常见情况是网络不可用、超时、免注册每日额度耗尽，或已配置引擎的账号额度用完。

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash && agy   # 然后登录
# 或增加一份个人 API 额度：
modsearch config set tavily.apiKey <key>
modsearch config set exa.apiKey <key>
modsearch config set firecrawl.apiKey <key>
```

云端引擎失败时，单页抓取（`-u`）仍会落到内置本地引擎。

## 额度耗尽

```
Individual quota reached. Please upgrade your subscription ... Resets in 94h19m9s.
```

agy 的免费额度是 Antigravity 桌面应用、CLI、SDK 共享的每周配额，并行子 agent 会加速消耗。三条出路：

- 等报错里写的重置时间。
- 加一个带 key 的搜索引擎（Tavily、Exa 或 Firecrawl）。之后搜索自动落到它，你不用再做任何事。
- 冷却开着时（默认），agy 会被记为耗尽并挪到链末尾直到重置，后续运行先走别家。见下文「某个引擎总被跳过」。

## Exa 或 Firecrawl 鉴权被拒

```
exa rejected the API key (401). Fix it: modsearch config set exa.apiKey <key>
firecrawl rejected the API key (401). Fix it: modsearch config set firecrawl.apiKey <key>
firecrawl rejected the keyless request (401). Anonymous access may be unavailable or rate-limited.
```

前两条表示已配置的 key 错误或被吊销。按报错里的命令设一个有效值，或导出 `EXA_API_KEY` / `FIRECRAWL_API_KEY`。免注册报错表示 Firecrawl 没有接受这次匿名请求。等待每日额度恢复，配置免费 key 提高限制，或换其他引擎。鉴权失败不会进入冷却。

## Exa 或 Firecrawl 额度用完

```
exa is out of credits: ...
firecrawl is out of credits: ...
```

当前额度已经用完。对 Firecrawl 而言，它可能是免注册每日额度，也可能是账号额度。其他搜索引擎会自动接手，冷却开着时耗尽的引擎会被挪到链末尾直到恢复。加额度、换引擎，或等待对应周期重置。

## Tavily 月度额度用完（432/433）

```
tavily is out of monthly quota (HTTP 432). ...
```

月度预算花完时 Tavily 返回 432（套餐用量上限）或 433（按量付费上限）。modsearch 把它们读作月度额度类错误，冷却开着时这个引擎会被按住一整天而不是默认的 45 分钟，因为一小时内重试只会撞同一堵墙。期间其他搜索引擎接手。到 https://app.tavily.com 加钱或等月度重置。

## 某个引擎总被跳过

modsearch 在绕开一个冷却。引擎撞过额度墙后会被记在 `~/.modsearch/state.json` 里，恢复前总是最后一试，结果的 `warnings` 会写明是哪个引擎、冷却到什么时候。跑 `modsearch doctor` 看谁在冷却、还剩多久。手动清除：

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
Blocked private network target: example.com -> 198.18.91.58. If a VPN or proxy on
this machine maps public hosts into reserved ranges, allow it with
--allow-private-network, or: modsearch config set allowPrivateNetwork true
```

SSRF 防护拒绝了一个保留地址段里的地址。两种截然不同的成因：

- **VPN 或代理**把公网主机名映射进 `198.18.0.0/15` 这类地址段，分流隧道客户端很常见。用上面的参数或配置放行。
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

## 全军覆没

```
Every engine for the web source failed.
  - antigravity-cli: ...
  - tavily: ...
```

每个引擎自己的失败按顺序列出。从第一个能修的下手，通常是额度或 key。

## 还是没辙

用 modsearch 打印的失败命令原样重跑一遍，把那份输出附在 issue 里：https://github.com/liustack/modsearch/issues
