# ModSearch

面向 AI Agent 的搜索外挂 CLI，用于把查询词转换成结构化网页搜索证据，补齐 LLM 工作流中的搜索能力缺口。

## 特性

- 面向 Agent 场景，提供稳定可复用的外部搜索上下文
- Provider 可扩展架构（v1 默认提供 `gemini-cli`）
- 输出结构化 JSON（`summary`、`items`、`uncertainty`）
- 适合作为 Agent Skill 工具被 Claude Code / Codex 等调用
- 单一职责：只做搜索，不做视觉解析、不做页面抓取

## 安装

```bash
npm install -g @liustack/modsearch
```

或直接用 `npx`：

```bash
npx @liustack/modsearch [options]
```

如果使用默认 provider，请先安装并认证 Gemini CLI：

```bash
npm install -g @google/gemini-cli
gemini
```

## 用法

```bash
# 标准输出 JSON
modsearch -q "OpenAI latest news"

# 落盘到文件
modsearch -q "OpenAI latest news" -o search.json

# 指定 provider、模型和结果数量
modsearch -q "TypeScript 5.9 release notes" -p gemini-cli -m gemini-2.5-flash --max-results 6
```

## 参数

- `-q, --query <text>` 查询词（必填）
- `-o, --output <path>` 可选输出 JSON 路径
- `-p, --provider <name>` 搜索 provider 名称（默认 `gemini-cli`）
- `-m, --model <name>` 模型名（provider 相关）
- `--prompt <text>` 额外搜索约束
- `--max-results <n>` 最大结果条数（默认 `8`）
- `--timeout <ms>` 超时毫秒（默认 `180000`）
- `--provider-bin <path>` provider 可执行路径
- `--workdir <path>` provider 命令运行目录

## Provider 机制

ModSearch 从设计上支持 provider 扩展。  
`gemini-cli` 只是 v1 的默认底层搜索引擎，后续可以接入任何具备搜索能力的模型或服务商。

## Agent Skill

- [modsearch/SKILL.md](skills/modsearch/SKILL.md)

## 说明

- `modsearch` 只做搜索能力。
- `modlens` / `modfetch` 是其他独立项目，不在本仓库实现。

## 免责声明

本项目仅供个人学习与实验使用，请勿用于商业用途。

## License

MIT
