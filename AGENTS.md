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

## dsh Plugin (`dsh/`)

`dsh/index.js` is a DeepSeek Harness plugin: plain JS, node builtins only, no build step, no dsh package imports. It spawns the CLI from `dist/main.js` inside the same package and plugs in three ways: the engine chain becomes the web seam's search provider (`cordis.patch.yml` repoints the seam's `searchProvider` at it, so dsh's native `web_search` tool runs on modsearch), and `x_search` / `read_page` register as raw tools for the two capabilities dsh has no seam for. The schema copies `dsh/search-schema.json` and `dsh/fetch-schema.json` are kept in lockstep with `src/schema.ts` by `src/dshPlugin.test.ts`, which also tests the plugin's behavior against a fake CLI via the `MODSEARCH_DSH_CLI` env override. The package.json `dsh.bundle` manifest plus the root export make the package installable with `dsh plugin add`.

`dsh/client.js` is the browser half, declared by the package.json `dsh.client` manifest: a settings card contributed to the `settings.plugin.item` slot, so a dsh web user with no terminal can pick an engine and set a key. It talks to the loopback route `/modsearch/config` that the host half registers on scoped `ctx.inject(['webServer'])`, which reads and writes `~/.modsearch/config.json` directly (no CLI spawn, no legacy migration) and never sends a stored key to the browser. Settings the card does not own (`bin`, `allowPrivateNetwork`, `cooldown`, `keylessFetch`) stay CLI-only and are copied through untouched. `src/dshClient.test.ts` evaluates `dsh/client.js` with stubbed browser globals; the route's own tests live in `src/dshPlugin.test.ts`.

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

## Release Policy

- Use patch releases for routine fixes and features. After `5.4.1`, the next release is `5.4.2`.
- Do not bump the minor or major version unless the user explicitly changes this policy.
- Prepare releases with `pnpm release patch`.

## Evals (`evals/`)

Unit tests stay offline and prove the logic. Evals run the built CLI end to end
against real engines and the network, and leave an evidence trail. They are run
locally, on demand, and are **not** in CI (most cases spend quota).

- `pnpm build && pnpm eval` runs the seed cases. The runner reads
  `modsearch doctor --json` first and skips any case whose engine is not set up
  here. The SSRF case needs nothing and always runs.
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
