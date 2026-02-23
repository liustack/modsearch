---
name: modsearch
description: "Bridge web search capability for LLM workflows. Use when user asks for latest info, external facts, or source links and the active model/toolchain lacks direct search ability."
allowed-tools:
  - Bash
---

# ModSearch - Search Bridge Skill

Use this skill when:
- User asks for web search, latest updates, or source-backed answers
- Current model/toolchain cannot perform direct search reliably
- You need structured search results before downstream summarization/fetch

## Prerequisites

```bash
modsearch --version
```

If using the default provider (`gemini-cli`), ensure Gemini CLI is installed and authenticated:

```bash
gemini --version
```

If missing:

```bash
npm install -g @google/gemini-cli
gemini
```

Or run directly with `npx` (no global install required):

```bash
npx @google/gemini-cli          # launch interactive auth
```

## Command

```bash
modsearch -q "<query>"
# or via npx
npx @liustack/modsearch -q "<query>"
```

Optional:

```bash
modsearch -q "<query>" -o <output-json-path> -p <provider> -m <model> --max-results <n> --prompt "<extra constraints>"
```

## Workflow

1. Run `modsearch` with the user query.
2. Parse JSON output.
3. Use `summary` and `items` as evidence for reasoning or for selecting URLs to fetch.
4. If `uncertainty` is non-empty, explicitly communicate ambiguity to the user.

## Output Contract

- `summary`: high-level synthesis of search findings
- `items`: normalized list (`title`, `url`, `snippet`, `source`, `published_at`, `relevance`)
- `uncertainty`: caveats, missing data, or confidence risks

Detailed schema: `references/output-schema.md`

## Failure Handling

- If provider command fails (missing auth, quota, network, binary not found), report exact error and suggest provider setup checks.
- If JSON is partially malformed, keep `rawText` and continue with best-effort extraction.

## Implementation Note

v1 uses Gemini CLI as the default provider (`gemini -p` with JSON output mode).  
The architecture is provider-extensible and can support any search-capable model or service provider in future versions.
