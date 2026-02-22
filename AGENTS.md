# Project Overview (for AI Agent)

## Goal

Provide the `modsearch` CLI tool that turns search queries into structured web evidence for LLM agent workflows.

## Technical Approach

- **Provider-extensible search backend** — v1 ships with Gemini CLI as default provider; future versions can support any search-capable model/service provider
- **JSON output**: query result summary + normalized item list + uncertainty
- **Single responsibility**: this project only handles search (no image parsing / page fetching)

```bash
pnpm install
```

## Code Organization

```
src/
├── main.ts                # CLI entry
├── search.ts              # provider invocation + output parsing
├── prompt.ts              # default search prompt template
└── providers/
    ├── index.ts           # provider registry
    └── geminiCli.ts       # default provider implementation
```

## Skills Directory

```
skills/
└── modsearch/
    ├── SKILL.md
    └── references/
        └── output-schema.md
```

The CLI is exposed via `dist/main.js`.

## CLI Usage

```bash
modsearch -q "OpenAI latest news"
modsearch -q "TypeScript 5.9 release notes" -o search.json --provider gemini-cli
```

## Operational Docs (`docs/`)

1. Operational docs use front-matter metadata (`summary`, `read_when`).
2. Before creating a new doc, run `pnpm docs:list` to review the existing index.
3. Before coding, check the `read_when` hints and read relevant docs as needed.
4. Existing docs: `commit`, `testing`, `research-gemini-claude-skills`.

## .gitignore must include

- `node_modules/`
- `dist/`
- `skills/**/outputs/`
- common logs/cache/system files

