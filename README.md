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

DeepSeek-V4-Flash gives you a lot of model for very little money: fast and strong, but its built-in web search is weak, and most third-party gateways ship no search at all. A model that cannot look things up or read a web page is a real handicap these days.

It is not only a question of having search at all. Even when your model ships with it, that route quietly bills you: the pages it retrieves are pushed whole into your model's context, and one search-heavy answer measured about 30,000 tokens here.

ModSearch moves that step outside your model. Retrieval and distillation happen elsewhere, and your model reads a few hundred tokens of structured evidence instead: a summary, a source list with titles, links and dates, and an honest list of what could not be pinned down. **Two orders of magnitude apart.**

It never touches your config and never adds a local proxy. Run it as a CLI or install it as an Agent Skill: `-q` searches, `-u` reads one page closely, and with Grok Build installed it reaches X too. How it works:

![One query fans out to three sources: the web, one page, X, and evidence comes back to the terminal](https://raw.githubusercontent.com/liustack/modsearch/main/assets/flow.jpg)

- **Search stays out of your model's context.** Retrieval and distillation happen outside, and your model reads a few hundred tokens of evidence instead of whole pages.
- **Answers carry sources.** Summary, links, dates, and an honest list of what could not be pinned down, so your model cites instead of recalling.
- **It can read one page closely.** `-q` searches, `-u` turns a URL into clean evidence, with an optional extraction focus.
- **It can see X.** With Grok Build installed it reaches the one place no web search can.
- **Zero config, never stuck.** It uses whatever is installed, switches engines when a quota runs dry, and always has a local fallback for reading pages.

**Requirements**: Node 18+, macOS or Linux. Search needs agy or a Tavily key. Page fetch needs nothing at all. Hit a problem? [Troubleshooting](docs/troubleshooting.md) lists every error this CLI prints, with causes and fixes.

Install the skill once and your agent starts searching and reading the web on its own. No model swap, no prompt surgery.

## Why not just use built-in search

Built-in search works like this: the model asks, the server pushes the retrieved pages into the context whole, and the model hunts for the answer inside them. You pay for every navigation bar, every footer, every cookie banner, none of which has anything to do with your question. One search-heavy answer measured about 30,000 tokens here, most of it spent exactly there.

ModSearch hands your model evidence, not raw material.

| | Built-in search | Search MCP servers | ModSearch |
| :-- | :-- | :-- | :-- |
| Cost to your model's context | whole pages, ~30k tokens per answer measured | usually whole pages too | a few hundred tokens of structured evidence |
| Who pays those tokens | your API bill | your API bill | retrieval happens outside, off that bill |
| When your channel has no search tool | unavailable (third-party gateways, chat completions endpoints) | works | works |
| Reading one specific URL | usually not offered | depends on the server | `-u`, with an extraction focus |
| Content on X (Twitter) | invisible | invisible | visible with Grok Build installed |
| Setup cost | none | install a server, edit config | one CLI or skill, zero config to start |

The honest weaknesses: agy's free tier is a weekly quota and heavy use will hit the wall (a Tavily key picks up automatically when it does), the X route needs a SuperGrok or X Premium subscription, and the local fetcher runs no JavaScript, so pages rendered entirely client-side come back thin.

## Quick start

**1. Install the skill.** Just tell your agent (Claude Code, Codex, OpenClaw, Cursor, ...):

```text
Install the skill from https://github.com/liustack/modsearch
```

or do it yourself:

```bash
npx -y skills add liustack/modsearch
```

**2. Install Antigravity CLI and sign in** (one-time, no key). It covers both searching and page fetching on its own:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # opens browser sign-in, then exit
```

**3. Use it.** Ask anything time-sensitive, or paste a URL. The skill fires when the model needs the live web.

There is no config step. modsearch uses whatever is on your machine: page fetch needs nothing at all and always works, while search needs either agy or a Tavily key, and tells you about both if neither is there. Touch the config only when you want to change that, see below.

## See it work

Search:

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

`results` is always an array. Add `--source web,x` and you get two entries, one per corpus, with the same shape.

Fetch a page, with a focus for the answer:

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

Here is fetch mode inside the Codex desktop app: drop a blog URL, ask what it says, and get a structured summary back in 25 seconds. No browser tab involved.

![Text-only DeepSeek summarizing a blog URL via ModSearch](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

Open-ended questions work too: ask "anything fun in AI today" and get six sourced stories back in 36 seconds, with an honest note about which details came from aggregated retrieval.

![Text-only DeepSeek running an open-ended news search via ModSearch](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## X (Twitter) search, if you have Grok Build

X locked its doors after the API shutdown: Google's index cannot see inside, so no web search engine can tell you what people are saying on X. The one engine that can is xAI's own [Grok Build CLI](https://x.ai/news/grok-build-cli), included with SuperGrok and X Premium subscriptions.

Install it and it just works. Two conditions decide it: the query mentions X (`twitter`, `tweet`, `x.com`, `on X`, or the Chinese equivalents), and `grok` is installed and signed in on this machine. When both hold, the query goes **to X only**, spending no agy quota.

What comes back is real posts, author handles, and x.com links. Without Grok nothing breaks: web search takes the question and the result says plainly in `uncertainty` that this is second-hand, because the web cannot see inside X. Decide it yourself with `--source x`, `--source web,x`, or `--source web`.

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

Output is always a `results` array, one entry per corpus, length 1 in the common case, so the shape never changes. Full contract: [skills/modsearch/references/output-schema.md](skills/modsearch/references/output-schema.md).

## What it does, and what you need for it

| What you want | What it takes |
| :-- | :-- |
| Search the public web | Antigravity CLI (free, no key), **or** a Tavily key (1,000 free credits a month) |
| Read one URL | Nothing at all. With Antigravity CLI around it also distills the page for you |
| Search X (Twitter) | Grok Build, included with SuperGrok or X Premium |

Searching is the only thing that asks anything of you, and agy or a Tavily key both answer it. With neither, the command names both options instead of failing vaguely. **Reading a page always works**: a wrong setting, a missing agy, an engine that dies mid-run, all of them land on the built-in local fetcher.

```bash
modsearch -q "..."                  # search the web
modsearch -q "..." --source x       # search X only
modsearch -q "..." --source web,x   # both, one entry each in the output
modsearch -u <url>                  # read one page
```

An X-flavored query goes to X on its own and spends no agy quota.

One honest note about quota: agy's free tier is now a one-time weekly grant, pooled across the desktop app, the CLI, and the SDK. Once it is gone you wait out the cycle (we hit that wall ourselves and the message read "94 hours until reset"). A Tavily key gives you an automatic backup: when agy fails, search falls through on its own.

## Configuration (optional)

`~/.modsearch/config.json` holds the one decision worth making: which engine searches.

```bash
modsearch config init                       # starter file, every field optional
modsearch config set tavily.apiKey <key>    # engine credentials, saved 0600
modsearch config set engine tavily          # choose the search engine
modsearch config set engine ""              # clear it, back to automatic
modsearch config show                       # keys come out masked
```

**Page fetch needs no configuration**: the engine you chose does it when it can, and the built-in local fetcher does it when it cannot, so something always can. X needs none either, since only Grok gets in. An empty `engine` means "use whatever works here". Older config shapes are read automatically.

You don't have to remember any of it: the skill carries the full setup guide, so you can just ask your agent "set my Tavily key in modsearch."

## Using it in Codex (DeepSeek and friends)

First, the honest part: DeepSeek's official endpoints ship a server-side `web_search` tool, carried by both the Responses API that Codex speaks and the Anthropic-compatible endpoint that Claude Code speaks, so pointing either at `api.deepseek.com` with `web_search = "live"` already gives you search (see the [official integration guide](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)).

So inside Codex, ModSearch is not about going from nothing to something. It is the bill from earlier: search stops pouring whole pages into your context. To hand it the job, turn the built-in one off in `~/.codex/config.toml`:

```toml
web_search = "disabled"
```

While the built-in tool is on, the model reaches for it first and the skill rarely gets a word in. Switched off, the skill's triggers apply.

A few things built-in search cannot give you at all: the official `/chat/completions` endpoint does not offer the tool (which is what shuts OpenCode and Pi out), and neither do DashScope or most third-party gateways. Reading one specific page and reaching X are outside its scope too.

## Why a bridge instead of a bigger model?

- **Keep your model.** You picked DeepSeek-V4-Flash (or gpt-oss, or whatever else) for its price and its reasoning, not its search skills. ModSearch adds the live web without touching that choice.
- **Evidence beats vibes.** Answers come back with URLs, dates, and an explicit `uncertainty` list, so your agent cites sources instead of guessing.
- **Engines die, the bridge survives.** v1 ran on Gemini CLI's free tier until Google shut it down in June 2026. v2 moved to its successor, Antigravity CLI, behind the same provider interface, so the next engine swap costs one file, not a rewrite.

ModLens, ModSearch's sibling project, plays the same trick for vision: [liustack/modlens](https://github.com/liustack/modlens).

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
