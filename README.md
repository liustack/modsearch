<div align="center">
  <img src="https://raw.githubusercontent.com/liustack/modsearch/main/assets/banner.jpg" width="100%" alt="ModSearch, plug-in web search and page fetch for text-only LLMs" />
  <h1>ModSearch</h1>
  <p><b>Free plug-in web search for your text-only LLM.</b></p>
  <p>
    <a href="https://www.npmjs.com/package/@liustack/modsearch"><img src="https://img.shields.io/npm/v/@liustack/modsearch" alt="npm"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  </p>
  <p><a href="./README.zh-CN.md">简体中文</a></p>
</div>

DeepSeek-V4-Flash gives you a lot of model for very little money: fast, cheap, capable, and completely unable to look anything up or read a web page. Point it at a third-party gateway and it gets worse, because built-in search is not even on the menu there.

ModSearch gets it online. One command searches the web, reads a specific page, or goes into X, and what comes back is not a wall of page text but a few hundred tokens of structured evidence: a summary, source links, dates, and a list of what could not be pinned down. No model swap, no prompt surgery, no local proxy.

![A text-only model reaches web search, one-page reading, and X through the modsearch skill, and gets structured JSON evidence back](https://raw.githubusercontent.com/liustack/modsearch/main/assets/flow.en.png)

## Three steps

**1. Install the skill.** Tell your agent (Claude Code, Codex, OpenClaw, and Cursor all take this):

```text
Install the skill from https://github.com/liustack/modsearch
```

Or do it yourself: `npx -y skills add liustack/modsearch`

**2. Give it a search engine.** Antigravity CLI is the easy answer: no key, and it covers both searching and page reading.

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # opens browser sign-in, then exit
```

**3. Ask.** Any question that needs checking, or any URL, and the skill fires on its own.

There is no step four. No config file to fill in, no environment variable to export. Reading a page needs nothing installed and always works. Searching needs either agy or a Tavily key (1,000 free credits a month), and with neither, the command hands you both options rather than failing vaguely.

Requirements, in one line: Node 18+, macOS or Linux.

## See it work

```bash
npx @liustack/modsearch -q "DeepSeek V4 Flash release date and context window" --max-results 3
```

Real output, truncated:

```json
{
  "mode": "search",
  "query": "DeepSeek V4 Flash release date and context window",
  "results": [
    {
      "source": "web",
      "engine": "antigravity-cli",
      "model": "gemini-3.6-flash-low",
      "summary": "DeepSeek V4 Flash was initially released as a preview on April 24, 2026, followed by its official production API release (DeepSeek-V4-Flash-0731) on July 31, 2026. Across both releases it features a 1 million (1M) token context window.",
      "items": [
        {
          "title": "DeepSeek-V4-Flash Official Release & API Specs",
          "url": "https://deepseek.com",
          "snippet": "...284B total parameters and 13B active parameters with enhanced post-training.",
          "published_at": "2026-07-31"
        }
      ],
      "uncertainty": [],
      "durationSeconds": 5.5
    }
  ],
  "meta": { "generatedAt": "2026-08-05T...", "durationSeconds": 5.6 }
}
```

`results` is always an array, one entry per corpus, so the shape never changes with the number of sources.

Reading one page, with an optional focus:

```bash
npx @liustack/modsearch -u "https://github.com/liustack/liustack" -q "what skills does it ship"
```

```json
{
  "mode": "fetch",
  "results": [
    {
      "source": "web",
      "engine": "antigravity-cli",
      "summary": "Extracted structured evidence from liustack/liustack GitHub README focused on the skills shipped by the package.",
      "content": "#### Shipped Skills\n1. **`shaping`** (Before you start) ...\n2. **`coding`** (While coding) ...\n3. **`dig`** (When there's a bug) ...\n4. **`snapshot`** (When handing off) ...",
      "links": [
        {
          "text": "shaping SKILL.md",
          "url": "https://github.com/liustack/liustack/blob/main/skills/shaping/SKILL.md"
        }
      ],
      "uncertainty": []
    }
  ]
}
```

Inside the Codex desktop app: drop in a blog link, ask what it says, and 25 seconds later there is a structured summary, with no browser opened.

![Text-only DeepSeek summarising a blog link through ModSearch](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

Open-ended questions land too: "what's interesting in AI today" comes back in 36 seconds with six sourced items, and a closing note about which parts came from aggregated retrieval and might be off.

![Text-only DeepSeek running an open-ended news search through ModSearch](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## Even if you already have search

Built-in search works like this: the model asks, the server pushes whole pages into the context, and the model hunts for the answer inside them. Navigation bars, footers, cookie banners: you pay for every word. One search-heavy answer measured about 30,000 tokens here, most of it spent right there.

ModSearch gives the model distilled evidence instead of raw material. Same question, a few hundred tokens on your model's side.

| | Built-in search | Search MCP servers | ModSearch |
| :-- | :-- | :-- | :-- |
| What your model reads | whole pages, ~30k tokens | usually whole pages too | a few hundred tokens of evidence |
| Citable sources | the model assembles them | depends on the server | titles, links, dates are in the result |
| Reading a specific URL | usually not offered | a few support it | `-u`, with an optional focus |
| X (Twitter) | invisible | invisible | visible with Grok Build |
| When the channel has no search tool | stuck | works | works |
| What to install | nothing | a server plus config | one CLI or one skill |

The weaknesses sit here too: agy's free tier is a weekly quota and heavy use hits the wall (a Tavily key picks it up automatically). The X route needs a SuperGrok or X Premium subscription. The built-in local fetcher runs no JavaScript, so pages rendered entirely client-side come back thin.

## Three things it does

| Job | What it takes | How |
| :-- | :-- | :-- |
| Search the public web | agy or a Tavily key | `-q "query"` |
| Read one URL | nothing at all | `-u <url>`, add `-q` for a focus |
| Search X (Twitter) | Grok Build (SuperGrok or X Premium) | automatic, or `--source x` |

Reading a page always working is a hard guarantee: a wrong setting, a missing agy, an engine dying mid-run, all of them land on the built-in local fetcher.

### The X route is worth its own paragraph

After X shut its API, Google's index cannot see inside, so no web search can answer "what are people saying on X". The one thing that can is xAI's own [Grok Build CLI](https://x.ai/news/grok-build-cli).

Install it and it works on its own, under two conditions: the query mentions X (`twitter`, `tweet`, `x.com`, `on X`, or the Chinese equivalents), and `grok` is installed and signed in here. When both hold, the query goes to X only, spends no agy quota, and comes back with real posts, author handles, and x.com links.

Without Grok nothing breaks: web search takes the question and the result notes in `uncertainty` that this is second-hand, because the web cannot see inside X. Decide it yourself with `--source x`, `--source web,x`, or `--source web`.

## CLI reference

```bash
modsearch -q "<query>"               # search mode
modsearch -u <url> [-q "<focus>"]    # fetch mode
```

| Flag | Meaning | Default |
| :-- | :-- | :-- |
| `-q, --query <text>` | Query, or the extraction focus when paired with `-u` | |
| `-u, --url <url>` | Fetch this page instead of searching | |
| `-s, --source <list>` | Corpora: `web`, `x`, or `web,x` | from the query, else `web` |
| `-e, --engine <name>` | Force one engine for this run | picked from what works here |
| `-o, --output <path>` | Also write JSON to a file | |
| `-m, --model <name>` | Engine model, where the engine has one | `gemini-3.6-flash-low` |
| `--max-results <n>` | Maximum search results | `8` |
| `--prompt <text>` | Extra constraints | |
| `--timeout <ms>` | Engine timeout | `180000` |
| `--allow-private-network` | Let the http engine reach reserved ranges, for VPNs that map public hosts into them | off |
| `--workdir <path>` | Working directory for engines that run a command | |

Full output contract: [output-schema.md](skills/modsearch/references/output-schema.md). When an error is not self-explanatory, [troubleshooting](docs/troubleshooting.md) lists every message this CLI prints with its cause and fix.

## Configuration (optional)

`~/.modsearch/config.json` holds the one decision worth making: which engine searches.

```bash
modsearch config init                       # starter file, every field optional
modsearch config set tavily.apiKey <key>    # engine credentials, saved 0600
modsearch config set engine tavily          # choose the search engine
modsearch config set engine ""              # clear it, back to automatic
modsearch config show                       # keys come out masked
```

Reading pages and searching X need no configuration: the first uses your chosen engine when it can read pages and the local fetcher when it cannot, and the second has exactly one possible engine.

You do not have to remember any of this. The skill carries the full setup guide, so "set my Tavily key in modsearch" is enough.

## Using it in Codex (DeepSeek and friends)

DeepSeek's official endpoints ship a server-side `web_search`, carried by the Responses API that Codex speaks and the Anthropic-compatible endpoint that Claude Code speaks, so pointing either at `api.deepseek.com` with `web_search = "live"` already gives you search (see the [official integration guide](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)). Inside Codex, then, ModSearch is not about going from nothing to something. It is the bill from earlier.

To hand it the job, turn the built-in one off in `~/.codex/config.toml`, or the model reaches for that one first and the skill never gets a word in:

```toml
web_search = "disabled"
```

A few things built-in search cannot give you at all: the official `/chat/completions` endpoint does not offer the tool (which is what shuts OpenCode and Pi out), and neither do DashScope or most third-party gateways. Reading a specific page and reaching X are outside its scope too.

## Why a bridge instead of a bigger model

- **Keep your model.** You picked DeepSeek-V4-Flash (or gpt-oss, or whatever else) for price and reasoning, not for search. ModSearch adds the live web without touching that choice.
- **Evidence beats vibes.** Answers arrive with URLs, dates, and an explicit `uncertainty` list, so your agent cites instead of guessing.
- **Engines die, the bridge survives.** v1 ran on Gemini CLI's free tier until Google shut it down in June 2026. v2 moved to Antigravity CLI behind the same interface, so the next swap costs one file.

Sister project ModLens does the same for vision: [liustack/modlens](https://github.com/liustack/modlens).

## Shameless plug

This project runs on LIUSTACK Skills. ModSearch v2 was shaped, coded, and shipped with **[liustack](https://github.com/liustack/liustack)** end to end: `shaping` before you build, `coding` while you build, `dig` when it breaks, `snapshot` when you hand off. Lighter than Superpowers, and sharper.

**ModSearch gives your model a network cable. LIUSTACK Skills gives your dev workflow wings:**

```bash
npx -y skills add liustack/liustack -g
```

⭐ Like it? [Star ModSearch](https://github.com/liustack/modsearch) and [star liustack](https://github.com/liustack/liustack). Stars are how the next developer finds them.

## Security notes

- The `http` engine carries SSRF guards: private addresses (IPv4 and IPv6, including `::ffff:` mapped forms), cloud metadata endpoints, and URLs with embedded credentials are refused, every redirect hop is re-checked, and body size and character counts are capped. **One known gap, stated rather than hidden**: the hostname is resolved for the check and resolved again by `fetch`, so a DNS answer that changes in between (rebinding) can point the connection somewhere the check never saw. Closing it requires pinning the connection to the validated IP, which Node's global `fetch` does not expose. Keep it in mind when fetching links you do not trust.

- ModSearch runs `agy` with `--dangerously-skip-permissions`, because print mode can fail in some setups without it. The prompt keeps the agent to searching and fetching only, and tells it to treat page content as data, never as instructions. Even so, fetched pages are untrusted input, so prefer running inside a sandboxed workspace.
- Search output is evidence. Whatever the engine cannot verify lands in `uncertainty`. The precise-looking but fabricated numeric `relevance` score from v1 is gone, item order carries the ranking.

## Disclaimer

Personal learning and experimentation only, not for commercial use. Antigravity CLI usage runs under your own Google account's terms and quota.

## License

MIT
