---
summary: '安全：SSRF 防护、DNS 重绑定防护、不可信页面内容的处理'
read_when:
  - 抓取不受你控制的 URL
  - 审查这个工具在你机器上做什么
  - 决定要不要放行私有网络目标
---

# 安全

[English](security.md) | 简体中文

## API key 怎么存、怎么保护

- key 存在 `~/.modsearch/config.json`，文件 0600 权限，目录 0700。`modsearch doctor` 会判定文件权限，权限过宽时给出可直接复制的 `chmod` 修复命令（Windows 没有 POSIX 权限位，跳过判定）。
- `modsearch config set <engine>.apiKey` 不带值时弹出不回显的输入提示（管道喂一行也行），key 不进 argv、不进 shell 历史、不进 agent 对话的落盘记录。
- `config show` 可以放心贴进 issue：key 在自己的字段里打码，同时从视图的每一个字符串里洗掉，URL 里的凭据用真实 URL 解析器打码，token 形状的字符串（`sk-...`、`api_key=...`）即使没人声明它是 key 也会被移除。唯一的诚实边界：一个没有可识别形状、只存在于非密钥字段里的秘密（比如贴进 `model` 的裸 token）无法与普通数据区分，所以不要把秘密存进 `apiKey` 以外的字段。
- 引用外部文本的错误信息（网关错误体、子进程 stderr）在到达终端、JSON 输出的 `attempts` 与 `warnings`、冷却状态文件之前，都先经过统一脱敏器。
- 没有 keychain 或凭据管理器集成，也没有静态加密：保护手段就是文件权限加上述输出边界。环境变量（`TAVILY_API_KEY`、`EXA_API_KEY`、`FIRECRAWL_API_KEY`）可替代文件，且永远不落盘。

## 本地抓取器的 SSRF 防护

`local` 引擎在任何请求发出之前就拒绝：

- 私有和保留的 IPv4、IPv6 地址段，包括 `::ffff:` 映射形式
- 云元数据端点（`169.254.169.254`、`metadata.google.internal` 等）
- 带内嵌凭据的 URL，以及 http/https 之外的任何协议

每一跳重定向都重新检查，响应大小和字符数都有上限。

## DNS 重绑定已被关死

安全检查解析主机名，校验它映射到的每一个地址，然后返回它批准的那个 IP。连接通过带自定义 lookup 的 `undici` dispatcher 钉在那个 IP 上，socket 只去检查时看到的地址。检查和连接之间变卦的 DNS 应答，再也换不进一个防护没审过的地址。Host 头和 TLS SNI 仍带原始主机名，普通网站不受影响。每一跳重定向都重复检查并重新钉住新目标。

钉的是 IP 层，不是端口层，且只作用于本地引擎。引擎驱动的抓取（agy）跑在它自己的沙箱里，不在这里的范围内。

## VPN 与保留地址段

Firecrawl 公网页面抓取是一条云端边界：公网页面的 URL 会被发给 Firecrawl 的服务，由云端浏览器读取。它默认开启（裸安装能读 JavaScript 页面靠的就是它），每次云端抓取的结果都带一条注明路径的 warning。想让自动抓取只走本地，运行 `modsearch config set firecrawl.keylessFetch false`。配置了 Firecrawl key 或显式选择 Firecrawl 引擎时仍会启用。URL 中直写的私有和保留地址目标在任何配置下都不会发往云端。DNS 解析结果按下文更窄的披露规则处理。

分流隧道的 VPN 客户端常把公网主机名映射进 `198.18.0.0/15` 这类保留段，普通网站在本地守卫看来也会像私网。`--allow-private-network`（或顶层的 `modsearch config set allowPrivateNetwork true`）只对本地抓取器放行。开关打开时，本地抓取器还会信任操作系统证书库，由本地转发代理的已安装 CA 签发的证书才能通过校验。它不授权云端披露。不要用它去访问真正的内网地址。

Firecrawl 的云端披露判定对 DNS 结果采用更窄的规则。Clash、Surge 和 mihomo 都把 `198.18.0.0/15` 用作标准 fake-ip 池，因此这段地址在该判定中视为疑似 fake-ip 占位值。只有所有解析结果都是真私网或保留地址时，主机名才不会交给 Firecrawl。只要有一个公网地址就会放行。这个例外只作用于 DNS 解析结果。URL 中直写的 `198.18.0.0/15` 地址仍会被拒绝，本地 SSRF 守卫也继续把整个地址段判为私网，socket 固定路径仍经过原有安全检查。

## 不可信的页面内容

抓回的页面和搜索结果是不可信输入。提示词要求引擎把页面内容严格当数据，绝不执行里面的指令，但那是缓解不是保证。URL 不是你自己的时，在沙箱工作目录里跑。

ModSearch 调用 `agy` 时带 `--dangerously-skip-permissions`，因为某些环境下不带它提示词模式会失败。提示词把 agent 限制在搜索和抓取上。

## 证据，不是编造

引擎验证不了的东西进 `uncertainty`，不靠补齐。v1 的数值 `relevance` 分数看着精确其实是编的，v2 删掉了它：排序本身已经携带相关性。
