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

ModSearch fixes this the lightest way possible: it never touches your config, never adds a local proxy, and is just a search plug-in you can run as a CLI or install as an Agent Skill. What it hands back is not a scraped blob of page text but structured search evidence: a summary, a source list with titles, links and dates, and an honest list of what it could not pin down. Searching and page fetching live in one tool, `-q` searches, `-u` fetches. The default engine is [Antigravity CLI](https://antigravity.google) (`agy`), running on Google's own index, with no key required. How it works:

```text
your text-only model ──▶ modsearch skill (auto-triggers on fresh-info needs)
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
              -q "query"            -u <url>
               web search           page fetch
                    └─────────┬─────────┘
                              ▼
                   agy · Gemini 3.6 Flash (free quota)
                              │
                              ▼
              structured JSON evidence ──▶ model answers with sources
```

Install the skill once and your agent starts searching and reading the web on its own. No model swap, no API key, no prompt surgery.

## Quick start

**1. Install Antigravity CLI and sign in** (one-time, no key):

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # opens browser sign-in, then exit
```

The free quota covers everyday use, but it is not unlimited (see Three engines below).

**2. Install the skill.** Just tell your agent (Claude Code, Codex, OpenClaw, Cursor, ...):

```text
Install the skill from https://github.com/liustack/modsearch
```

or do it yourself:

```bash
npx -y skills add liustack/modsearch
```

**3. Use it.** Ask anything time-sensitive, or paste in a URL. The skill fires whenever the model needs the live web.

## See it work

Search:

```bash
npx @liustack/modsearch -q "DeepSeek V4 Flash release date and context window" --max-results 3
```

Real output, truncated:

```json
{
  "mode": "search",
  "provider": "antigravity-cli",
  "result": {
    "summary": "DeepSeek V4 Flash was initially released as a preview on April 24, 2026, followed by its official production API release (DeepSeek-V4-Flash-0731) on July 31, 2026. Across both releases it features a 1 million (1M) token context window.",
    "items": [
      {
        "title": "DeepSeek-V4-Flash Official Release & API Specs",
        "url": "https://deepseek.com",
        "snippet": "...284B total parameters and 13B active parameters with enhanced post-training.",
        "published_at": "2026-07-31"
      }
    ],
    "uncertainty": []
  },
  "meta": { "model": "gemini-3.6-flash-low", "durationSeconds": 5.5 }
}
```

Fetch a page, with a focus for the answer:

```bash
npx @liustack/modsearch -u "https://github.com/liustack/liustack" -q "what skills does it ship"
```

```json
{
  "mode": "fetch",
  "result": {
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
}
```

Here is fetch mode inside the Codex desktop app: drop a blog URL, ask what it says, and get a structured summary back in 25 seconds. No browser tab involved.

![Text-only DeepSeek summarizing a blog URL via ModSearch](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-fetch.png)

Open-ended questions work too: ask "anything fun in AI today" and get six sourced stories back in 36 seconds, with an honest note about which details came from aggregated retrieval.

![Text-only DeepSeek running an open-ended news search via ModSearch](https://raw.githubusercontent.com/liustack/modsearch/main/assets/demo-codex-search.png)

## X (Twitter) search, if you have Grok Build

X locked its doors after the API shutdown: Google's index cannot see inside, so no web search engine can tell you what people are saying on X. The one engine that can is xAI's own [Grok Build CLI](https://x.ai/news/grok-build-cli), included with SuperGrok and X Premium subscriptions.

ModSearch handles it by routing, not by piling engines up. When a query smells like X (twitter, tweet, 推特, 推文, x.com, "on X") and a signed-in `grok` binary is on the machine, the whole search runs on Grok instead of agy: real posts, author handles, x.com status links, in the exact same JSON shape as every other search, and zero agy quota spent (that quota is thin, save it for what Google is actually good at). No Grok Build, or grok stumbles mid-run: the query silently falls back to the normal engine. Nothing to configure.

```bash
modsearch -q "DeepSeek V4 Flash 在推特上的评价"       # routes to grok-cli on its own
modsearch -q "community mood about the release" --x   # force the route without keywords
modsearch -q "..." --no-x                             # pin the default engine
```

## CLI reference

```bash
modsearch -q "<query>"              # search mode
modsearch -u <url> [-q "<focus>"]   # fetch mode
```

| Flag | Meaning | Default |
| :-- | :-- | :-- |
| `-q, --query <text>` | Search query, or answer focus with `-u` | |
| `-u, --url <url>` | Fetch this page instead of searching | |
| `-o, --output <path>` | Also write JSON to a file | |
| `-m, --model <name>` | Provider model | `gemini-3.6-flash-low` |
| `-p, --provider <name>` | Provider | `antigravity-cli` |
| `--max-results <n>` | Max search results | `8` |
| `--prompt <text>` | Extra constraints | |
| `--timeout <ms>` | Provider timeout | `180000` |
| `--provider-bin <path>` | Provider binary | `agy` |
| `--workdir <path>` | Working directory for the provider | |

Reach for `-m gemini-3.1-pro-high` on harder research questions. Output contract: [skills/modsearch/references/output-schema.md](skills/modsearch/references/output-schema.md).

## Three engines

| Engine | Search `-q` | Fetch `-u` | Needs |
| :-- | :-- | :-- | :-- |
| `antigravity-cli` (default) | yes, on Google's index | yes | a signed-in `agy`, no key |
| `tavily` | yes | no | a Tavily key ([free tier](https://app.tavily.com): 1,000 credits/month, no card, one credit per basic search) |
| `grok-cli` | yes, X content only | no | a signed-in Grok Build (SuperGrok or X Premium) |

Page fetch runs on `antigravity-cli` alone today. If you only set up Tavily, `-u` tells you straight out that this engine cannot fetch and names what else is set up here. It will not insist you install agy.

Config lives in `~/.modsearch/config.json`. Environment variables override the file (`TAVILY_API_KEY`), and CLI flags override everything:

```bash
modsearch config init                        # write a starter config
modsearch config set tavily.apiKey <key>     # saved with 0600 perms
modsearch config set provider tavily         # pin one engine, turns routing off
modsearch config set provider ""             # clear it, routing is back
modsearch config show                        # keys come out masked
```

You don't have to remember any of that. The skill carries these instructions, so once it's installed you can just ask your agent: "set my Tavily key in modsearch," "how do I configure modsearch."

`agy` wins on needing no key and loses on quota. Its free tier is now a one-time weekly grant, pooled across the desktop app, the CLI, and the SDK, and parallel subagents drain it faster. Once it's gone you wait out the cycle: we hit that wall ourselves and the message read "94 hours until reset." If you search a lot, keep a `TAVILY_API_KEY` around as backup. The X route spends no agy quota at all.

## Using it in Codex (DeepSeek and friends)

DeepSeek's official endpoints ship a server-side `web_search` tool, carried by both the Responses API that Codex speaks and the Anthropic-compatible endpoint that Claude Code speaks, so pointing either at `api.deepseek.com` with `web_search = "live"` already covers plain searching (see the [official integration guide](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)). ModSearch earns its keep elsewhere: your channel has no built-in search (DashScope and most third-party gateways, and also the official `/chat/completions` endpoint, which simply does not offer the tool, which is what shuts OpenCode and Pi out), you need to read one specific page (`-u` fetch, which built-in search cannot do), you need something from X (Google's index cannot see inside), or your harness has no native search tools at all.

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

- ModSearch runs `agy` with `--dangerously-skip-permissions`, because print mode can fail in some setups without it. The prompt keeps the agent to searching and fetching only, and tells it to treat page content as data, never as instructions. Even so, fetched pages are untrusted input, so prefer running inside a sandboxed workspace.
- Search output is evidence. Whatever the engine cannot verify lands in `uncertainty`. The precise-looking but fabricated numeric `relevance` score from v1 is gone, item order carries the ranking.

## Disclaimer

Personal learning and experimentation only, not for commercial use. Antigravity CLI usage runs under your own Google account's terms and quota.

## License

MIT
