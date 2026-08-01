# Project Overview (for AI Agent)

## Goal

Provide the `modsearch` CLI tool that turns search queries and page URLs into structured web evidence for LLM agent workflows.

## Technical Approach

- **Pluggable provider** — v2 ships with Antigravity CLI (`agy`) as the default provider. The provider interface (`buildInvocation` + `parseOutput`) keeps the next engine swap contained to one file.
- **Two modes, one CLI**: `-q` searches the web, `-u` fetches a single page (absorbed from the retired `modfetch` project). `-u` plus `-q` fetches with an answer focus.
- **Schema-enforced JSON output**: the provider is invoked with `--json-schema`, so the structured result comes back guaranteed, no markdown scraping.
- **Single responsibility**: this project handles the live web (search + fetch). Image parsing lives in `modlens`.

```bash
pnpm install
```

## Code Organization

```
src/
├── main.ts       # CLI entry
├── search.ts     # orchestration: mode resolution, provider run, envelope
├── prompt.ts     # search + fetch prompt templates
├── schema.ts     # JSON schemas enforced on the provider
└── providers/
    ├── index.ts        # provider interface + registry
    └── antigravity.ts  # agy invocation + output parsing
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
modsearch -q "TypeScript 5.9 release notes"
modsearch -u "https://example.com/docs" -q "rate limits"
modsearch -q "..." -o search.json -m gemini-3.1-pro-high --max-results 5
```

The default provider requires Antigravity CLI installed and signed in (`agy`). Searches take 5-20 seconds, fetches 10-30.

## Verification

- `pnpm typecheck && pnpm test` for unit-level checks (mode resolution, invocation building, output parsing).
- Real end-to-end runs consume the user's agy quota. Ask before running them in bulk.

## Operational Docs (`docs/`)

1. Operational docs use front-matter metadata (`summary`, `read_when`).
2. Before creating a new doc, run `pnpm docs:list` to review the existing index.
3. Before coding, check the `read_when` hints and read relevant docs as needed.
4. Existing docs: `commit`, `testing`, `research-gemini-claude-skills` (historical, Gemini CLI era).

## .gitignore must include

- `node_modules/`
- `dist/`
- `skills/**/outputs/`
- common logs/cache/system files
