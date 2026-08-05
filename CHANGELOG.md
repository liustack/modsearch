# Changelog

## 2.5.0 - 2026-08-05

- Layered config at `~/.modsearch/config.json` via `modsearch config init/set/show` (0600 perms, keys masked on show), mirroring modlens. Store the Tavily key without exporting an env var, pin one engine to disable routing, or point at custom agy/grok binaries. Flags beat env vars, env vars beat the file.
- The skill can do it for you: ask your agent to set a key or switch engines and it runs the commands.
- The tavily provider's missing-key error now names both ways to supply one and links the free tier.

## 2.4.3 - 2026-08-05

- Docs: README now documents all three engines including Tavily (previously missing entirely), states agy's weekly quota reality instead of promising a "completely free" solution, moves the X search story out from behind the CLI table, and corrects the DeepSeek built-in search facts (both official protocol endpoints carry `web_search`, `/chat/completions` does not, which is what shuts OpenCode and Pi out).

## 2.4.2 - 2026-08-05

- Fix: runs with the `antigravity-cli` provider could hang until the timeout killed them, the same defect reported against modlens ([modlens#1](https://github.com/liustack/modlens/issues/1)). agy exits cleanly but leaves a language server holding the inherited stdout pipe, so the child's `close` event never fires. Provider runs now settle on `exit` plus a short drain window and release the pipes afterwards.

## 2.4.1 - 2026-08-05

- Reverted the browser-scraping provider shipped in 2.4.0 (yanked). Google serves a captcha to Playwright-driven Chrome even headed, with anti-detection flags and a persistent profile, and a plain HTTP fetch gets a JS-only shell with no results in it. A search engine that answers with a captcha is not a search engine, and falling back to a second-tier index was not worth the dependency. 2.4.0 users get 2.3.0 behavior back, minus the Playwright install.


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
