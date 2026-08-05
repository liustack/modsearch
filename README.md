<p align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch" />
</p>

<h1 align="center">ModSearch</h1>

<p align="center"><b>Put a text-only model online without flooding its context with whole web pages.</b></p>

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

Models like DeepSeek-V4-Flash are cheap, fast, capable, and unable to look anything up. ModSearch searches the web, reads a specific page, or goes into X, and hands back a few hundred tokens of structured evidence instead of a wall of page text. No model swap, no prompt surgery.

## Highlights

- **Cheap on context.** Built-in search pushes whole pages into your model (~30k tokens for one measured answer). Here your model reads a few hundred tokens of evidence.
- **Citable answers.** Titles, links, and dates come back in the result, plus an `uncertainty` list naming what could not be pinned down.
- **Reaches X (Twitter).** With Grok Build installed, the one place web search cannot see.
- **Reading a page never fails.** A dependency-free local fetcher is the floor when an engine is missing or dies mid-run.
- **Zero config to start.** Nothing to fill in. It uses what is installed and switches engines when a quota runs dry.
- **Install once, works everywhere.** Claude Code, Codex, Pi, and OpenCode all take it.

<sub>The ~30,000-token figure is one 2026-08 measurement, not a benchmark: a single search-backed question answered by DeepSeek-V4-Flash through Codex's Responses API endpoint. It stands for the cost of pushing whole pages into context, not a fixed number.</sub>

## Installation

```bash
npx -y skills add liustack/modsearch
```

Or tell your agent: "Install the skill from https://github.com/liustack/modsearch".

Then give it a search engine, either one. **Antigravity CLI** (no key, covers searching and page reading):

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash && agy   # sign in, then exit
```

Or a **[Tavily](https://app.tavily.com) key** (1,000 free credits a month):

```bash
modsearch config set tavily.apiKey <key>
```

With neither, the command hands you both options rather than failing vaguely. Reading a page needs nothing installed. Requires Node 18+, macOS or Linux.

## Usage

With the skill installed you do not type commands: ask anything that needs checking, or paste a URL, and it fires on its own. By hand:

```bash
modsearch -q "current Node.js LTS version"     # search the web
modsearch -u "https://nodejs.org/en/about"     # read one page, add -q for a focus
modsearch -q "reactions on X" --source x       # search X, automatic for X-flavored queries
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
    "durationSeconds": 5.5
  }]
}
```

Inside the Codex desktop app: drop in a blog link, ask what it says, and 25 seconds later there is a structured summary, no browser opened.

![Text-only DeepSeek summarising a blog link through ModSearch](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

## How it works

![A text-only model reaches web search, one-page reading, and X through the modsearch skill, and gets structured JSON evidence back](https://raw.githubusercontent.com/liustack/modsearch/main/assets/flow.en.png)

Three jobs, each with its own engines, and only searching asks anything of you:

| Job | What it takes | How |
| :-- | :-- | :-- |
| Search the public web | agy or a Tavily key | `-q "query"` |
| Read one URL | nothing at all | `-u <url>` |
| Search X (Twitter) | Grok Build (SuperGrok or X Premium) | automatic, or `--source x` |

The weaknesses, in the same place: agy's free tier is a weekly quota and heavy use hits the wall (a Tavily key picks it up automatically), the X route needs a subscription, and the local fetcher runs no JavaScript, so client-rendered pages come back thin.

## CLI reference

| Flag | Meaning | Default |
| :-- | :-- | :-- |
| `-q, --query <text>` | Query, or the extraction focus when paired with `-u` | |
| `-u, --url <url>` | Fetch this page instead of searching | |
| `-s, --source <list>` | Corpora: `web`, `x`, or `web,x` | from the query, else `web` |
| `-e, --engine <name>` | Force one engine for this run | picked from what works here |
| `-o, --output <path>` | Also write JSON to a file | |
| `-m, --model <name>` | Engine model | `gemini-3.6-flash-low` |
| `--prompt <text>` | Extra constraints for this run, passed to the engine | |
| `--max-results <n>` | Maximum search results | `8` |
| `--timeout <ms>` | Engine timeout | `180000` |
| `--workdir <path>` | Working directory for engines that run a command | current directory |
| `--allow-private-network` | Let the local fetcher reach reserved ranges, for VPNs that map public hosts into them | off |

Configuration is optional. `~/.modsearch/config.json` holds one decision: which engine searches (`modsearch config set engine tavily`, empty means automatic). Reading pages and searching X need no settings.

## Documentation

| Doc | Read it when |
| :-- | :-- |
| [Troubleshooting](docs/troubleshooting.md) | A command failed and the message needs decoding |
| [Configuration](skills/modsearch/references/configure.md) | Setting a key, switching engines, fixing config |
| [Output contract](skills/modsearch/references/output-schema.md) | Parsing the JSON or building on it |
| [Harness setup](docs/harness-setup.md) | Wiring it into Codex, Claude Code, OpenCode, or Pi |
| [Security](docs/security.md) | SSRF guards, the known gap, untrusted input |
| [CHANGELOG](CHANGELOG.md) | Finding what changed in a version |
| [AGENTS.md](AGENTS.md) | Working on this codebase |

## Shameless plug

This project runs on LIUSTACK Skills: `shaping` before you build, `coding` while you build, `dig` when it breaks, `snapshot` when you hand off. Lighter than Superpowers, and stronger.

```bash
npx -y skills add liustack/liustack -g
```

⭐ If it helps, star [ModSearch](https://github.com/liustack/modsearch) and [liustack](https://github.com/liustack/liustack). Stars are how the next developer finds them.

## Disclaimer

ModSearch is MIT-licensed, so use is not restricted. The author gives no warranty and no endorsement for any particular use, commercial or otherwise. The upstream engines it drives (Antigravity CLI, Tavily, Grok Build) each carry their own terms and quotas, and complying with them is the user's responsibility.

## License

MIT
