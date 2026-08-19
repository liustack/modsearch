---
summary: '安全：SSRF 防护、DNS 重绑定防护、不可信页面内容的处理'
read_when:
  - 抓取不受你控制的 URL
  - 审查这个工具在你机器上做什么
  - 决定要不要放行私有网络目标
---

# 安全

[English](security.md) | 简体中文

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

Firecrawl 公网页面抓取是一条云端边界：公网页面的 URL 会被发给 Firecrawl 的服务，由云端浏览器读取。它默认开启（裸安装能读 JavaScript 页面靠的就是它），每次云端抓取的结果都带一条注明路径的 warning。想让自动抓取只走本地，运行 `modsearch config set firecrawl.keylessFetch false`。配置了 Firecrawl key 或显式选择 Firecrawl 引擎时仍会启用。私有和保留地址目标在任何配置下都不会发往云端，见下文。

分流隧道的 VPN 客户端常把公网主机名映射进 `198.18.0.0/15` 这类保留段，普通网站也会触发防护。`--allow-private-network`（或顶层的 `modsearch config set allowPrivateNetwork true`）只对本地抓取器放行：firecrawl 永远不会收到保留地址或解析到保留地址的目标，因为这个开关授权的是本地访问，不是把内部主机名交给云服务。不要用它去够真正的内网地址。

## 不可信的页面内容

抓回的页面和搜索结果是不可信输入。提示词要求引擎把页面内容严格当数据，绝不执行里面的指令，但那是缓解不是保证。URL 不是你自己的时，在沙箱工作目录里跑。

ModSearch 调用 `agy` 时带 `--dangerously-skip-permissions`，因为某些环境下不带它提示词模式会失败。提示词把 agent 限制在搜索和抓取上。

## 证据，不是编造

引擎验证不了的东西进 `uncertainty`，不靠补齐。v1 的数值 `relevance` 分数看着精确其实是编的，v2 删掉了它：排序本身已经携带相关性。
