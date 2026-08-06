<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch" />
</p>

<h1 align="center">ModSearch</h1>

<p align="center"><b>Give a text-only model the web: search, X, and any page, returned as citable evidence.</b></p>

<p align="center">
  <a href="./README.zh-CN.md">简体中文</a> ·
  <a href="docs/troubleshooting.md">Troubleshooting</a> ·
  <a href="skills/modsearch/references/configure.md">Configuration</a> ·
  <a href="skills/modsearch/references/output-schema.md">Output contract</a> ·
  <a href="docs/security.md">Security</a> ·
  <a href="https://github.com/liustack/modlens">ModLens (vision)</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@liustack/modsearch"><img src="https://img.shields.io/npm/v/@liustack/modsearch?style=flat-square&label=npm&color=cb3837" alt="npm"></a>
  <a href="https://github.com/liustack/modsearch/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/liustack/modsearch/ci.yml?branch=main&style=flat-square&label=ci" alt="CI"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/node/v/@liustack/modsearch?style=flat-square" alt="Node.js"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License"></a>
</p>

```bash
npx -y skills add liustack/modsearch              # install the skill
npx @liustack/modsearch -q "current Node.js LTS"  # or just use the CLI
```

Text-only models like DeepSeek-V4-Flash cannot reach the web, so time-sensitive questions get answered from training data, which may be out of date without the model knowing. ModSearch adds three capabilities: web search, single-page fetch, and X (Twitter) search, returning a few hundred tokens of structured evidence with sources. No model change, no prompt changes, no key required to start.

## Highlights

- **Free to start.** The default engine needs no API key. All three fallback engines (Tavily, Exa, Firecrawl) offer monthly free tiers with no card required.
- **Automatic failover.** When an engine fails or exhausts its quota, the next one takes over. Exhausted engines are recorded as cooling, so later queries start from a working engine instead of repeating a failed request.
- **Structured evidence.** Output is a few hundred tokens: titles, links, dates, and an `uncertainty` list naming what could not be verified, rather than whole pages.
- **Searches X (Twitter).** With Grok Build installed, ModSearch queries the corpus that web indexes cannot reach.
- **Page fetching always works.** A dependency-free local fetcher is the guaranteed floor. With a Firecrawl key, JavaScript-rendered pages are supported.
- **Install once, use everywhere.** Works in Claude Code, Codex, Pi, and OpenCode.

## Installation

```bash
npx -y skills add liustack/modsearch
```

Or tell your agent: "Install the skill from https://github.com/liustack/modsearch".

Then give it a search engine. **Antigravity CLI** (no key, covers searching and page reading):

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash && agy   # sign in, then exit
```

Or configure a keyed engine. All three have monthly free tiers and require no card:

```bash
modsearch config set tavily.apiKey <key>       # Tavily: 1,000 credits a month
modsearch config set exa.apiKey <key>          # Exa: $10 of recurring monthly credit, about 1,400 searches
modsearch config set firecrawl.apiKey <key>    # Firecrawl: 1,000 credits a month, supports JavaScript pages
```

With none configured, the error message lists these options. Page fetching needs nothing installed. Requires Node 22.13+, macOS or Linux.

## Usage

With the skill installed you do not type commands: ask anything that needs checking, or paste a URL, and it fires on its own. By hand:

```bash
modsearch -q "current Node.js LTS version"     # search the web
modsearch -u "https://nodejs.org/en/about"     # read one page, add -q for a focus
modsearch -q "reactions on X" --source x       # search X, automatic for queries about X
```

Output is always a `results` array, one entry per corpus:

```json
{
  "mode": "search",
  "results": [{
    "source": "web",
    "engine": "antigravity-cli",
    "summary": "The current Node.js LTS is v24.19.0 (Krypton), released 2026-08-03.",
    "items": [{ "title": "...", "url": "https://...", "published_at": "2026-08-03" }],
    "uncertainty": [],
    "warnings": [],
    "durationSeconds": 5.5
  }]
}
```

`uncertainty` is what the engine could not pin down about the facts. `warnings` is how the answer was routed (a fallback, a stand-in for X, redirects), and `attempts` records each engine tried.

## See it work

Both screenshots are unedited runs from the Codex desktop app, driving a text-only DeepSeek-V4-Flash.

Give it a blog link and ask what the post says. Twenty-five seconds later: a structured summary of the whole post, with no browser involved.

![Text-only DeepSeek summarising a blog link through ModSearch](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

Give it no target at all, just "anything interesting in AI today?". Thirty-six seconds later: six sourced stories, with a closing note on which details came from aggregation and deserve a second look. The note comes from the `uncertainty` field.

![An open-ended question comes back as six sourced stories with a stated confidence caveat](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## How it works

![A text-only model reaches web search, one-page reading, and X through the modsearch skill, and gets structured JSON evidence back](https://raw.githubusercontent.com/liustack/modsearch/main/assets/flow.en.png)

Four steps:

1. The skill triggers when the model needs outside information: a time-sensitive question, a user-supplied URL, a query about X.
2. It runs the `modsearch` CLI, which picks an engine for the task from what is available on the machine.
3. If that engine fails or exhausts its quota, the next one takes over. The output records which engine answered and why any switch happened.
4. The model reads the JSON evidence and answers with sources.

Three tasks, each with its own engines. Only searching requires setup:

| Job | What it takes | How |
| :-- | :-- | :-- |
| Search the public web | agy, or a Tavily, Exa, or Firecrawl key | `-q "query"` |
| Read one URL | nothing at all, or Firecrawl for JavaScript pages | `-u <url>` |
| Search X (Twitter) | Grok Build (SuperGrok or X Premium) | automatic, or `--source x` |

The limitations: agy's free quota is issued weekly and heavy use exhausts it. The X route requires a subscription. The local fetcher does not execute JavaScript, so client-rendered pages return limited content (Firecrawl covers those). When an engine exhausts its quota, it is recorded as cooling and moved to the back of the chain, so later queries start from a working engine until it recovers.

For scale: one question answered through server-side built-in search measured about 30,000 tokens of context (2026-08, DeepSeek-V4-Flash through Codex's Responses API endpoint). ModSearch's evidence is typically a few hundred tokens.

## CLI reference

| Flag | Meaning | Default |
| :-- | :-- | :-- |
| `-q, --query <text>` | Query, or the extraction focus when paired with `-u` | |
| `-u, --url <url>` | Fetch this page instead of searching | |
| `-s, --source <list>` | Corpora: `web`, `x`, or `web,x` | from the query, else `web` |
| `-e, --engine <name>` | Use only this engine for this run. On failure the run errors instead of switching engines | automatic |
| `-o, --output <path>` | Also write JSON to a file | |
| `-m, --model <name>` | Engine model | `gemini-3.6-flash-low` |
| `--prompt <text>` | Extra constraints for this run, passed to the engine | |
| `--max-results <n>` | Maximum search results | `8` |
| `--timeout <ms>` | Engine timeout | `180000` |
| `--workdir <path>` | Working directory for engines that run a command | current directory |
| `--allow-private-network` | Let the local fetcher reach reserved ranges, for VPNs that map public hosts into them | off |

Configuration is optional. `~/.modsearch/config.json` holds one main decision: which engine searches (`modsearch config set engine tavily`, empty means automatic). Fetching and X search need no settings. Quota cooldown failover is on by default, `modsearch config set cooldown off` disables it, and `modsearch state clear` resets the cooldown records. The full file structure and every field (including the top-level `allowPrivateNetwork` switch) are documented in the [configuration doc](skills/modsearch/references/configure.md).

`modsearch doctor` prints a local diagnosis: Node version, each task's engines with their readiness and reasons, where each config value comes from, the private-network setting, and any engines currently cooling. It spends no quota and makes no network request, and `--json` makes the output machine-readable. Run it first when routing does not behave as expected.

## Documentation

| Doc | Read it when |
| :-- | :-- |
| [Troubleshooting](docs/troubleshooting.md) | A command failed and the message needs decoding |
| [Configuration](skills/modsearch/references/configure.md) | Setting a key, switching engines, fixing config |
| [Output contract](skills/modsearch/references/output-schema.md) | Parsing the JSON or building on it |
| [Harness setup](docs/harness-setup.md) | Wiring it into Codex, Claude Code, OpenCode, or Pi |
| [Security](docs/security.md) | SSRF guards, DNS-rebinding protection, untrusted input |
| [CHANGELOG](CHANGELOG.md) | Finding what changed in a version |
| [AGENTS.md](AGENTS.md) | Working on this codebase |

## Contributing

ModSearch does not accept pull requests. The project is maintained by a single author who reviews every line, which is a deliberate choice for reliability. Two effective ways to contribute:

- **[Open an issue](https://github.com/liustack/modsearch/issues).** Bugs, suggestions, confusing errors, unclear docs. Issues are read and shape what gets built next.
- **Fork it.** Under MIT your copy is fully yours to modify and publish.

## Shameless plug

This project runs on LIUSTACK Skills: `shaping` before you build, `coding` while you build, `dig` when it breaks, `snapshot` when you hand off. Lighter than Superpowers, and stronger.

```bash
npx -y skills add liustack/liustack -g
```

⭐ If it helps, star [ModSearch](https://github.com/liustack/modsearch) and [liustack](https://github.com/liustack/liustack). Stars are how the next developer finds them.

## Disclaimer

ModSearch is MIT-licensed, so use is not restricted. The author gives no warranty and no endorsement for any particular use, commercial or otherwise. The upstream engines it drives (Antigravity CLI, Tavily, Exa, Firecrawl, Grok Build) each carry their own terms and quotas, and complying with them is the user's responsibility.

## License

MIT
