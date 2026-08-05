# Changelog

## 3.3.0 - 2026-08-06

- README rebuilt against how widely used projects actually write theirs (uv, crush, openclaw, hermes-agent, and current guidance): install command inside the first screen, a nav row and badges in the hero, short scannable highlights, and roughly 1,000 words instead of a long read. Detail moved into `docs/harness-setup.md` and `docs/security.md` rather than being inlined, and a Documentation table points at all of it.

## 3.2.7 - 2026-08-06

- README rewritten rather than patched again. The token argument had been made five separate times (opening, feature list, its own section, the comparison table, the Codex section), the hero ran nineteen lines before the first heading, the feature list and the capability table said the same things, and the comparison compared on weak axes ("setup cost" and "who pays those tokens" are one question). Twelve sections became eight, and phrases that announce honesty rather than demonstrate it are gone.

## 3.2.6 - 2026-08-06

- The flow diagram says something again. Replacing ASCII art with an abstract illustration removed the labels along with the alignment chore, which was a bad trade: a picture of three icons tells a reader nothing. It is now a rendered diagram with real labels, one per language, generated from HTML so nothing drifts.

## 3.2.5 - 2026-08-06

- README: drops the roles vocabulary. Telling a reader there is one setting and then handing them a table of three roles and four engines contradicts itself, and roles are an internal idea anyway. The section now answers what a reader actually asks: what do you want to do, and what does it take.

## 3.2.4 - 2026-08-06

- Releases are now one command: `pnpm release <version|patch|minor|major>` refuses a dirty tree, a non-main branch, a duplicate tag, or a version with no CHANGELOG entry, then runs typecheck, tests, and build before anything irreversible happens, and finishes with tag, push, npm publish, and a GitHub release. Publishing by hand is how a version once reached npm with no changelog and no tag behind it.
- Every previously published version now has a git tag, reconstructed from the commit that carried it.

## 3.2.3 - 2026-08-05

- README: adds a scannable feature block and a requirements line, which were missing entirely, so what you get is readable without consuming prose.
- New `docs/troubleshooting.md`: every error this CLI prints, with cause and fix, linked from the README and the skill.
- The ASCII flow diagram is now a real illustration. Its alignment had needed repair across several releases, which is a poor trade for a picture.
- Test scaffolding moved into `src/testing/helpers.ts` and realistic engine samples into `src/fixtures/`. Fake binaries, temp HOMEs, and temp config paths were reimplemented per test file, so a fix in one copy left the others behind.
- The Gemini CLI era research doc is marked historical so it is not read as current design.

## 3.2.2 - 2026-08-05

- Docs: the README led with "your model's built-in search is a bit weak", which framed the whole project as a patch for one model's shortcoming and gave a reader with working search no reason to keep reading. It now leads with the cost that applies to everyone: built-in search pushes whole pages into your model's context, measured at about 30,000 tokens for one search-heavy answer, against a few hundred for structured evidence. Adds an honest comparison against built-in search and search MCP servers, weaknesses included, and states the two conditions that route a query to X.

## 3.2.1 - 2026-08-05

- `config init` now writes only the shape (`{"engine": "", "engines": {}}`) instead of every engine with its fields pre-filled. The old skeleton buried the single real decision under placeholders, and worse, it wrote today's defaults (`bin: agy`, a model name) into the file, where they would silently outrank any future change to those defaults. The command prints what can be set instead of putting it on disk.

## 3.2.0 - 2026-08-05

**Configuration collapsed to one decision.** Choosing an engine per role turned out to be three questions where users only have one. `~/.modsearch/config.json` now holds a single `engine`, the one that searches. Page fetch uses that engine when it can fetch and the built-in local fetcher when it cannot, and X only ever uses Grok Build, so neither is configurable any more. Older shapes (v2's `provider`, and the per-role grouping that existed for a few hours) are read and mapped automatically.

**Fixes a verification pass caught in the 3.1.0 fixes.** The reviewer proved each one.

- The subprocess timeout fix never applied: only its constant landed, so a child ignoring SIGTERM still hung the caller. Verified now: a run with a 200ms timeout returns in 216ms instead of waiting out the process.
- `stripElement` lowercased the whole document with Unicode rules, which can change a string's length, then used those indices to slice the original. Twenty `İ` characters shifted the indices enough to leak hidden script content into the visible text.
- A tag name inside an attribute value (`<div data-note="<script>">`) was read as an unclosed element, dropping the rest of the page.
- `--engine grok --source web,x` with Grok absent still ran the web search twice, because an explicitly named engine entered the chain without an availability check.
- An engine's result could still overwrite `model` whenever that engine had no model of its own.
- Link extraction only recognised quoted `href="..."`, missing `href=https://...` and `href = "..."`.
- Tavily's timeout left its deadline timer armed after a fast success.
- The streaming decoders were never flushed, so trailing bytes of a split character were dropped instead of surfacing.
- `AbortSignal.timeout` rejects with `TimeoutError`, which the abort check did not recognise, so real timeouts were reported as generic request failures.

## 3.1.0 - 2026-08-05

Security and correctness pass after an external review (gpt-5.6-sol) that proved every finding with a probe.

**Security**

- SSRF bypass: `http://[::ffff:127.0.0.1]` normalizes to `::ffff:7f00:1`, whose hex form the private-range check missed, and the probe reached a service bound to loopback. IPv4-mapped IPv6 is now decoded from the address groups.
- Denial of service: the HTML sanitizing regexes backtracked catastrophically. 200 KB of malformed markup took 14.6 seconds and 1 MB ran past 42 seconds, while bodies can reach 2 MB and a synchronous regex cannot be interrupted by a timeout. Element stripping is now a linear scan: the same input takes about a millisecond.
- Hang: the request timeout only covered response headers, so a slow body could wait forever. One deadline now spans DNS, every redirect hop, and the body.
- Crash: a numeric HTML entity beyond the Unicode maximum threw out of `String.fromCodePoint` and killed the fetch. Out-of-range and surrogate code points are left as text.

**Correctness**

- `--source web,x` with no Grok ran the same web search twice, billing it twice. The degraded X entry now folds into the web entry it duplicates.
- A mid-run Grok failure fell back to a web engine but kept `source: "x"` with no caveat, presenting second-hand web evidence as X coverage. The degrade note now travels with the plan.
- An engine's own result could overwrite `source`, `engine`, and `model`. Routing facts are applied last.
- Legacy config migration dropped fields when old and new shapes named the same engine, and ignored alias names like `agy` and `direct`. Merging is now per engine and alias-aware.
- Tavily ignored `--timeout` and used its SDK's 60 second ceiling.
- `--source ""` silently ran the default sources instead of erroring.
- A typo in `--engine` was buried under generic setup advice.
- Config files that exist but cannot be read (permissions) silently became empty configs.
- Subprocess: a timeout only sent one SIGTERM and waited, so an engine ignoring signals hung the CLI. It now settles at once and escalates to SIGKILL. Output decoding kept no state across chunks, so a multi-byte character split across a chunk boundary became replacement characters.
- Link extraction ignored `<base href>` and left entities undecoded in URLs.

## 3.0.1 - 2026-08-05

- Docs: the README output examples still showed the v2 single-object shape. Both languages now show the v3 `results` array, and both blocks parse as valid JSON.

## 3.0.0 - 2026-08-05

Breaking. modsearch used to treat every engine as one flat list with a single `-p` flag and a routing chain between them, which put a web search engine, an X client, and a page fetcher on the same axis. They are three different jobs, so they are now three roles.

- **Roles**: `search` (public web: antigravity-cli, tavily), `fetch` (one URL: antigravity-cli, http), `social` (X: grok-cli). Each role picks its own engine, so changing one never disturbs another.
- **Sources instead of engine swapping**: `--source web`, `--source x`, or `--source web,x`. X coexists with web search rather than replacing it. An X-flavored query still goes to X alone by default, spending no agy quota.
- **Output contract**: `results` is now an array with one entry per source, each carrying `source`, `engine`, and that engine's result fields. Always an array, so the shape never changes. Replaces the old single `result` object.
- **Config by role**: `~/.modsearch/config.json` gains `search`/`fetch`/`social` blocks plus one `engines` map. `modsearch config set search.engine tavily` pins one role. Old configs (`provider` plus `providers`) are read and mapped automatically.
- **Page fetch cannot be configured into failure**: a wrong engine name, a missing binary, or a runtime error all fall through to the local `http` engine, which needs nothing installed.
- **Zero config, zero install still works**: fetch runs anywhere, and when no search engine exists the error lists both ways to get one instead of naming a single dependency.
- CLI: `-p/--provider` becomes `-e/--engine`, and `--x`/`--no-x` become `--source`. Internals split into `router.ts` (all routing), `subprocess.ts`, and `system.ts`.

## 2.6.0 - 2026-08-05

- New `http` engine for page fetch, ported from the retired modfetch project: a plain HTTP request plus text and link extraction, with no dependencies, no key, and no quota. Page fetch now prefers `antigravity-cli` and falls back to `http` when agy is missing, so `-u` works on a machine with nothing installed. Honest trade: no LLM synthesis, no focus narrowing, and JavaScript-rendered pages come back thin.
- The port keeps modfetch's SSRF guards (blocked hostnames, private IPv4 and IPv6 ranges, cloud metadata endpoints, every redirect hop re-checked, size and character limits). VPNs that map public hosts into reserved ranges trip those guards, so the block message names that case and `--allow-private-network` (or `http.allowPrivateNetwork` in config) opens it.

## 2.5.1 - 2026-08-05

- Engines now declare which modes they can serve, and asking one for something it cannot do says exactly that. The message adapts to the machine: it names other engines that are actually set up, and when none can fetch a page it says so once and moves on instead of insisting the user adopt Antigravity CLI. A user running Tavily alone is never told they did something wrong.
- Skill: new `references/configure.md` with per-engine setup, a capability table, pinning, and troubleshooting, so asking an agent "how do I configure modsearch" gets real answers instead of guesses.

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
