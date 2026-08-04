# Changelog

## 2.4.0 - 2026-08-05

- Provider classes and in-class chains: `web` (public web) and `social` (login-walled data). Routing picks the class from the query and walks the chain on failure: web search runs antigravity-cli, then playwright, then tavily; page fetch runs antigravity-cli, then playwright; X queries run grok-cli and degrade to the web chain with an honest uncertainty note instead of failing. agy quota exhaustion no longer bricks anything. Output gains a `class` field.
- New `playwright` provider: a real headless Chrome (system Chrome channel preferred) scrapes the Google results page, auto-downgrades to Bing when Google blocks, and browser-extracts any page in fetch mode. No accounts, no quota, no LLM: mechanical summaries, honest uncertainty.
- Layered config at `~/.modsearch/config.json` via `modsearch config init/set/show` (0600 perms, masked keys): pin a provider, store the tavily key, point at custom agy/grok binaries, toggle playwright headless. Flags > env > file.

## 2.3.0 - 2026-08-05

- X handling redesigned from companion source to routing: an X-flavored query now runs entirely on Grok Build (`grok-cli`) when it is installed and signed in, spending no agy quota at all, and silently falls back to the default provider when grok is absent or fails mid-run. The short-lived `x` section from 2.2.0 is gone: every engine returns the same `{ summary, items, uncertainty }` contract, X posts arrive as items (`source: "x.com"`, title carries the handle), and `provider` names the engine that answered.
- `grok-cli` is also selectable explicitly (`-p grok-cli`); explicit `-p` always beats routing. `--x` forces the route, `--no-x` pins the default provider.

## 2.2.0 - 2026-08-05

- X (Twitter) companion source: for X-flavored queries, `-q` now also searches real X posts through a locally installed [Grok Build CLI](https://x.ai/news/grok-build-cli) and attaches them as an `x` section next to the main result. Activates only when `grok` is installed and signed in (SuperGrok or X Premium) and fails silently: no grok, no X keywords, or any grok error simply means no `x` section. `--x` forces it, `--no-x` disables it, `--grok-bin` points at a custom binary.
- Salvage parsing for grok's after-the-fact schema validation: when the model emits concatenated JSON objects and `structuredOutput` comes back null, the last valid X result is recovered from the raw text.
- Build hardening: every Node built-in is externalized in the bundle (an `os` import was silently bundling to undefined).
- Project hygiene: tests co-located with sources (`src/*.test.ts`, no `test/` directory), GitHub Actions CI, this changelog.

## 2.1.0 - 2026-08-02

- Tavily search provider ported to the v2 contract (search mode only, needs `TAVILY_API_KEY`). Originally contributed by @mani2001 against v1.

## 2.0.0 - 2026-08-01

- Breaking: engine migrated from the discontinued Gemini CLI free tier to Antigravity CLI (`agy`).
- Absorbed the retired `modfetch` project: one CLI, `-q` searches, `-u` fetches.
- Schema-enforced structured output via `--json-schema`; `result`/`meta` envelope; fabricated relevance scores dropped.
