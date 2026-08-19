---
summary: '宿主接入：dsh、Codex、Claude Code、OpenCode、Pi，以及内置搜索覆盖什么'
read_when:
  - 在某个具体的编码 agent 里配置 modsearch
  - 安装 DeepSeek Harness (dsh) 插件
  - 决定要不要关掉宿主的内置搜索
  - 网关或端点根本没有搜索工具
---

# 宿主接入

[English](harness-setup.md) | 简体中文

## DeepSeek Harness (dsh)

dsh 和其他宿主不一样：modsearch 以原生插件接入，不走提示词触发的 skill。这个包本身就是一个 dsh bundle，一条命令装进 profile：

插件开关、profile patch、运行时验证、更新方法和兼容性检查见独立的 [dsh 插件指南](dsh.zh-CN.md)。

```sh
npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modsearch@5.6.0
```

一次落地三件事：

- **`web_search` 开始跑在 modsearch 上。** dsh 本就带一个原生 `web_search` 工具，架在可插拔的 provider 接缝上，默认钉在 DeepSeek 的带 key 搜索 API。bundle 把 modsearch 引擎链注册为 provider 并把接缝指过来（`searchProvider: modsearch`），于是搜索完全不需要 API key：Firecrawl 免注册免费额度开箱就能答，装了 agy 或配了 key 时它们优先，Web UI 的原生引用卡片也全部保留。想切回去，在更后的 profile patch 里把 `searchProvider` 钉回其他 provider。
- **`x_search`** 覆盖 dsh 没有接缝的语料。Grok Build 装好并登录时路由给它，网页顶替的答案会在工具输出里标注降级，绝不无声。
- **`read_page`** 把一个 URL 读成结构化证据（summary、正文提取、外链、不确定项），可带答案焦点。dsh 自带的 `web_fetch` 默认关闭，因为那个 provider 把 SSRF 防护推给了别人。ModSearch 默认拦截私网目标，这个工具也不暴露绕开开关。公网 URL 默认走 Firecrawl 免注册云端浏览器，能读 JavaScript 渲染的页面。结果会带一条注明云端路径的 warning，`modsearch config set firecrawl.keylessFetch false` 可让自动抓取只走本地。

引擎、key、路由继续放在 `~/.modsearch/config.json`，与其他所有宿主共用。dsh 还在开发者预览期，插件接口可能变化。这个插件刻意把接触面压到最小（一次 provider 注册和两次原始工具注册），任何一处变了都会在宿主日志里大声降级。dsh 提示 `declares no dsh.bundle` 的话，是 pnpm 的发布时长门槛装到了旧版本，请按下方点名版本号重装。

dsh 跑在 Electron 桌面宿主里时，插件也能正常工作。Electron 会让 `process.execPath` 指向桌面应用本身，因此插件启动 CLI 子进程时会显式设置 `ELECTRON_RUN_AS_NODE=1`。这样随包附带的 `dist/main.js` 会由 Node 执行，不会作为参数重新交给桌面应用。

### 保持更新

安装当前版本或刷新已有 profile 时，重跑 `add` 并点名版本号：

```sh
npx -y @deepseek-ai/dsh plugin --profile <name> add @liustack/modsearch@5.6.0
```

`npm view @liustack/modsearch version` 可以查到当前版本号。本页的版本号由发布流程自动同步。这里继续使用 `add` 也是有意的，因为它会用上面点名的精确版本替换 profile 中记录的安装请求。不要换成 `update`，后者只在已记录的 semver 请求内更新，还会再次让 pnpm 经过发布时长过滤来选版本。

这里点名版本号而不用 `@latest` 是有意的。pnpm 11 默认通过 `minimumReleaseAge` 扣住最近 24 小时内发布的版本，再让 dist-tag 在通过过滤的候选里解析。因此 `@latest` 会静默装到旧版本，而不是跳过冷静期。精确版本可以避开这次 dist-tag 解析。从 pnpm 11.1.3 开始，默认宽松模式会把尚未度过冷静期的精确版本写入该 profile 的 `pnpm-workspace.yaml`，放在 `minimumReleaseAgeExclude` 下，然后继续安装。其余包仍受发布时长窗口保护。

重启 dsh，然后确认实际装到了什么：

```sh
npx -y @deepseek-ai/dsh plugin --profile <name> list
```

## Codex（以及其他 DeepSeek 环境）

DeepSeek 官方端点自带服务端 `web_search` 工具，由 Codex 说的 Responses API 和 Claude Code 说的 Anthropic 兼容端点承载。把两者之一指向 `api.deepseek.com` 并设 `web_search = "live"`，搜索就已经有了（见[官方接入指南](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)）。

所以在 Codex 里，ModSearch 不是从无到有，而是省上下文的账：内置搜索把整页内容塞进模型上下文，一次搜索密集的回答实测约 30,000 token，而结构化证据只要几百。

想把活交给它，先在 `~/.codex/config.toml` 里关掉内置搜索，否则模型先伸手够那个，skill 永远轮不上：

```toml
web_search = "disabled"
```

## 内置搜索完全不存在的地方

- 官方 `/chat/completions` 端点不提供这个工具，**OpenCode** 和 **Pi** 就是被这挡在外面的。
- DashScope 和大多数第三方网关只暴露模型的推理，别的什么都没有。
- 读一个指定页面，以及触达 X，在哪里都不在内置搜索的能力范围内。

## 各宿主的 skill 位置

| 宿主 | 从哪里读 skill |
| :-- | :-- |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Pi、OpenCode | `~/.agents/skills/` |

Windows 上 `~` 是用户目录，即 `%USERPROFILE%\.claude\skills\` 等等。

三者都支持符号链接，把 skill 目录链接一次，每个 agent 都始终用最新版。
