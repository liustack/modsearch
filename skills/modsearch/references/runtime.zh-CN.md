# modsearch 运行时参考

[English](runtime.md) | 简体中文

skill 如何启动 `modsearch` CLI、钉在哪个版本、在什么都跑不了的机器上如何给出诊断。启动器 `scripts/run.sh`（macOS / Linux）和 `scripts/run.ps1`（Windows）实现下面的全部内容，除版本常量和各自的 shell 语法外必须逐字一致。

## 钉住的版本

- 钉住的 CLI 版本：5.4.0
- npm 包：`@liustack/modsearch`
- CLI 命令名：`modsearch`

上面这行版本号和两个启动器内部的常量由 `scripts/release.mjs` 在发布时从 `package.json` 盖章写入，不要手改。三份副本与 `package.json` 一旦不一致，`scripts/stamp.test.mjs` 会让构建失败。

## 解析顺序

每次调用按这个顺序找一条能跑 CLI 的路：

1. **`PATH` 上已有兼容的 `modsearch`**，按名字直接跑。
2. **有 `npx`，且 `node` 满足 CLI 的 22.13 下限**，跑 `npx --yes --package @liustack/modsearch@<钉住版本> modsearch <args>`。骑在老 node 上的 npx 会被跳过：那条路已知会在运行时失败。
3. **有 `bunx`**，跑 `bunx --bun @liustack/modsearch@<钉住版本> <args>`。
4. **原生产物**，留给 B 阶段。目前没有发布任何产物，这个分支报告 `nativeArtifact.available: false` 后继续往下走。
5. **什么都没有**，打印结构化诊断并以 `78`（`EX_CONFIG`）退出。

启动器原样转发 stdin、stdout、stderr 和退出码，所以无论怎么启动，CLI 的 JSON 输出契约完全一致。

## 兼容规则

`PATH` 上找到的 `modsearch` 只有在**与钉住版本同一主版本号，且不老于它**时才算兼容。同主版本让已装了匹配 CLI 的用户不被强制走一遍 `npx` 重新下载（设计里的「不回退」要求）。不老于则拒绝比这份 skill 编写时还旧的全局构建，那种情况下启动器跳过 `PATH`，改用钉住版本的 `npx` / `bunx`。

## 缓存与权限（B 阶段，尚未启用）

A 阶段不发原生产物。`npx` 和 `bunx` 路径首次使用时拉取钉住的 npm 包并缓存（这就是这两个运行器的工作方式），除此之外不下载任何东西。B 阶段原生产物落地后，启动器会按用户、按版本缓存它们，并用绝对路径启动：

- macOS：`~/Library/Caches/liustack/modsearch/<version>/`
- Linux：`${XDG_CACHE_HOME:-$HOME/.cache}/liustack/modsearch/<version>/`
- Windows：`%LOCALAPPDATA%\liustack\modsearch\<version>\`

约束是：不用 `sudo` 或管理员权限，不碰系统目录，不改 `PATH`，先下载到临时文件、校验 SHA-256 后原子移动，失败时不留任何未校验的可执行文件。下载一律用 `curl`（Windows 上写全 `curl.exe`），它不会打隔离标记（Mark-of-the-Web），启动器也从不摘除浏览器本会设置的安全标记。

## 诊断字段

`run.sh doctor --json`（以及 `run.ps1 doctor --json`）输出这个结构：

- `tool`、`package`、`pinnedVersion`：这份 skill 的目标。
- `os`、`arch`：归一化的主机标识（`darwin` / `linux` / `windows`，`arm64` / `x64`）。
- `checked.pathCli`：`PATH` 上 `modsearch` 的 `{ present, path, version, compatible }`，`compatible` 按上面的规则判定。
- `checked.npx`：`{ present, path, nodeMeetsFloor }`，`nodeMeetsFloor` 是本机 node 是否满足 CLI 的 22.13 下限，npx 路径的前提。
- `checked.bunx`：`{ present, path }`。
- `checked.node`：`{ present, version }`。
- `nativeArtifact`：`{ available, note }`，A 阶段 `available` 为 `false`。
- `selected`：选定的路：`path`、`npx`、`bunx` 或 `none`。
- `nextSteps`：`selected` 为 `none` 时，给用户的一到两条直白建议（装 Node 22.13+ 或 Bun）。其余情况为空。
- `cliDoctor`：CLI 可用时，把 CLI 自己的 `doctor --json` 报告（引擎与配置诊断）嵌在这里，否则为 `null`。

`doctor` 不花额度。启动器自己的诊断是离线的：只检查本地环境，不发任何网络请求。经 npx 或 bunx 转接 CLI 的 `doctor` 时，首次可能会下载钉住的包（这两个运行器就是这样工作的），之后走本地缓存。

## 交付形态：长期保持本地 CLI

modsearch 有意保持本地 CLI 形态，分发设计第 10 节（不需要本地执行的能力迁去远程 MCP）对它**不适用**。原因就是产品本身：搜索引擎的 key 握在用户机器上，消耗的额度是用户自己的，中间没有中心化服务。托管 MCP 会把这三样都从用户机器上挪走，与这个工具的初衷相反。D 阶段可能为将来某个工具退役原生产物，但只要这三条性质还成立，modsearch 就保持本地 CLI。
