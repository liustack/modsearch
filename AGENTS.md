# Project Overview (for AI Agent)

## Goal

Provide the `modsearch` CLI tool that turns search queries and page URLs into structured web evidence for LLM agent workflows.

## Technical Approach

- **Pluggable engines** — the engine interface (`buildInvocation` + `parseOutput` for subprocess engines, or `execute` for in-process ones) keeps each engine contained to one file, so adding or swapping one touches nothing else. Antigravity CLI (`agy`) is the preferred search engine when it is available.
- **Two modes, one CLI**: `-q` searches the web, `-u` fetches a single page (absorbed from the retired `modfetch` project). `-u` plus `-q` fetches with an answer focus.
- **Schema-enforced JSON output**: subprocess engines are invoked with `--json-schema`, so the structured result comes back guaranteed, no markdown scraping.
- **Single responsibility**: this project handles the live web (search + fetch). Image parsing lives in `modlens`.
- **X handling**: X-flavored `-q` queries route entirely to Grok Build (`grok-cli`) when it is installed and signed in, spending no agy quota. When Grok is missing or fails, a web engine answers instead, and that entry is marked `status: "degraded"` with `source: "web"` and `requestedSource: "x"` so the second-hand nature is explicit, never silent. On a `--source web,x` run with X unreachable, the X slot returns a separate `status: "unavailable"` entry rather than vanishing. An explicit `-e`/`--engine` is a hard force: exactly that engine, no fallback, an error if it cannot do the job. One shared output contract for every engine.

```bash
pnpm install
```

## Code Organization

```
src/
├── main.ts       # CLI entry: search/fetch command + doctor + config subcommands
├── search.ts     # orchestration: mode, plan, run each source concurrently, envelope
├── doctor.ts     # `modsearch doctor`: diagnose config + routing, no quota, no network
├── router.ts     # every routing decision: sources, role to engine, fallbacks
├── config.ts     # layered config by role: flags > env > ~/.modsearch/config.json
├── subprocess.ts # running an engine binary and draining its output
├── system.ts     # tiny host helpers (is this binary on PATH)
├── prompt.ts     # search + fetch prompt templates
├── schema.ts     # JSON schemas enforced on engines that support them
└── providers/
    ├── index.ts        # engine interface + registry + role preference
    ├── antigravity.ts  # agy: search + fetch
    ├── tavily.ts       # Tavily API: search
    ├── grok.ts         # Grok Build: X
    └── httpFetch.ts    # direct HTTP fetch, no dependencies

Tests are co-located: each module has an adjacent `*.test.ts`.
```

## Skills Directory

```
skills/
└── modsearch/
    ├── SKILL.md
    └── references/
        ├── configure.md
        └── output-schema.md
```

The CLI is exposed via `dist/main.js`.

## CLI Usage

```bash
modsearch -q "TypeScript 5.9 release notes"
modsearch -u "https://example.com/docs" -q "rate limits"
modsearch -q "..." -o search.json -m gemini-3.1-pro-high --max-results 5
```

The Antigravity CLI search path requires `agy` installed and signed in. A run takes 10-30 seconds on the agent-loop engines (agy, grok) and 2-3 seconds on the direct API ones (tavily, http).

## Verification

- `pnpm typecheck && pnpm test` for unit-level checks (mode resolution, invocation building, output parsing).
- Real end-to-end runs consume the user's agy quota. Ask before running them in bulk.

## Evals (`evals/`)

Unit tests stay offline and prove the logic. Evals run the built CLI end to end
against real engines and the network, and leave an evidence trail. They are run
locally, on demand, and are **not** in CI (most cases spend quota).

- `pnpm build && pnpm eval` runs the seed cases. The runner reads
  `modsearch doctor --json` first and skips any case whose engine is not set up
  here; the SSRF case needs nothing and always runs.
- Each case is a file in `evals/cases/` default-exporting `{ id, title,
  requirement, args, expectError?, expectation, check }`. Keep assertions
  structural (shape, links, dates, a status, a warning), never an exact-string
  match on a synthesized summary.
- Evidence artifacts land in `evals/results/<date>/` (gitignored). Format and
  field meanings are in `evals/README.md`.

## Operational Docs (`docs/`)

1. Operational docs use front-matter metadata (`summary`, `read_when`).
2. Before creating a new doc, run `pnpm docs:list` to review the existing index.
3. Before coding, check the `read_when` hints and read relevant docs as needed.
4. Existing docs: `troubleshooting` (every error this CLI prints, with causes and fixes), `testing`, `commit`, `research-gemini-claude-skills` (historical, Gemini CLI era).

## .gitignore must include

- `node_modules/`
- `dist/`
- `skills/**/outputs/`
- common logs/cache/system files
