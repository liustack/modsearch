# ModSearch

A search plugin for OpenClaw, Claude Code, and other AI coding agents — turns search queries into structured web evidence, bridging the search gap for LLM workflows.

[中文说明](README.zh-CN.md)

## Features

- Built for agent workflows that need reliable external search context
- Provider-extensible architecture (ships with `gemini-cli` as default provider)
- Outputs machine-consumable JSON (`summary`, `items`, `uncertainty`)
- Designed to be called from Agent Skills (OpenClaw, Claude Code, Codex, Cursor, etc.)
- Single responsibility: search only (no image parsing, no page fetching)

## Install

```bash
npm install -g @liustack/modsearch
```

Or run with `npx`:

```bash
npx @liustack/modsearch [options]
```

Or install as an **Agent Skill** — tell any AI coding tool that supports agent skills (Claude Code, Codex, OpenCode, OpenClaw, Cursor, Antigravity, etc.):

```
Install the skill from https://github.com/liustack/modsearch
```

Or use the `skills` CLI directly:

```bash
npx skills add https://github.com/liustack/modsearch --skill modsearch
```

If you use the default provider, install and authenticate Gemini CLI first:

```bash
npm install -g @google/gemini-cli
gemini
```

## Usage

```bash
# Print JSON result to stdout
modsearch -q "OpenAI latest news"

# Save to file
modsearch -q "OpenAI latest news" -o search.json

# Select provider + model and control result count
modsearch -q "TypeScript 5.9 release notes" -p gemini-cli -m gemini-2.5-flash --max-results 6
```

## Options

| Flag | Description |
|------|-------------|
| `-q, --query <text>` | Search query (required) |
| `-o, --output <path>` | Write result JSON to a file |
| `-p, --provider <name>` | Search provider name (default: `gemini-cli`) |
| `-m, --model <name>` | Model name (provider-specific) |
| `--prompt <text>` | Extra prompt constraints |
| `--max-results <n>` | Maximum result items (default: `8`) |
| `--timeout <ms>` | Timeout in milliseconds (default: `180000`) |
| `--provider-bin <path>` | Provider CLI binary path |
| `--workdir <path>` | Working directory for provider command |

## Search Providers

ModSearch is provider-extensible by design.  
`gemini-cli` is only the default provider in v1, and can be replaced by any model/service provider that offers search capability through a compatible provider adapter.

## Agent Skill

- [modsearch/SKILL.md](skills/modsearch/SKILL.md)

## Disclaimer

This project is for personal learning and experimentation only. It is not intended for commercial use.

## License

MIT
