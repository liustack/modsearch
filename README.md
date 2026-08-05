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

Install it and it just works: an X-flavored query runs entirely on Grok and comes back with real posts, author handles, and x.com links. Without it nothing breaks. Web search takes the question instead, and the result says plainly in `uncertainty` that this is second-hand, because the web cannot see inside X.

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
| `-e, --engine <name>` | Force one engine for this run | picked per role |
| `-o, --output <path>` | Also write JSON to a file | |
| `-m, --model <name>` | Engine model, where the engine has one | `gemini-3.6-flash-low` |
| `--max-results <n>` | Maximum search results | `8` |
| `--prompt <text>` | Extra constraints | |
| `--timeout <ms>` | Engine timeout | `180000` |
| `--allow-private-network` | Let the http engine reach reserved ranges, for VPNs that map public hosts into them | off |
| `--workdir <path>` | Working directory for engines that run a command | |

Output is always a `results` array, one entry per corpus, length 1 in the common case, so the shape never changes. Full contract: [skills/modsearch/references/output-schema.md](skills/modsearch/references/output-schema.md).

## Three roles, four engines

modsearch does three jobs, and each has its own engines. They are three separate dimensions, not competitors on one list:

| Role | What it does | Engines |
| :-- | :-- | :-- |
| `search` | search the public web | `antigravity-cli` (free, no key), `tavily` (needs a key, has a free tier) |
| `fetch` | read one URL | `antigravity-cli` (LLM extraction), `http` (plain HTTP, no dependencies) |
| `social` | search X (Twitter) | `grok-cli` (Grok Build, included with SuperGrok or X Premium) |

Two guarantees follow, and they answer most questions:

- **Page fetch always works.** The `http` engine needs nothing installed and is the floor for that role. A wrong config, a missing agy, an engine that dies mid-run: all of them land there rather than leaving a URL unreadable.
- **Search needs one engine.** Either agy or a Tavily key. With neither, the command names both options instead of failing vaguely.

X is a separate corpus, not a rival to Google, so it never replaces web search. `--source` picks corpora, `--engine` picks tools, and the two stay apart.

```bash
modsearch -q "..."                  # search the web
modsearch -q "..." --source x       # search X only
modsearch -q "..." --source web,x   # both, one entry each in the output
modsearch -u <url>                  # fetch a page
```

An X-flavored query (twitter, tweet, 推特, 推文, x.com) goes to X on its own and spends no agy quota.

`agy` wins on needing no key and loses on quota: its free tier is now a one-time weekly grant, pooled across the desktop app, the CLI, and the SDK. Once it is gone you wait out the cycle (we hit that wall ourselves and the message read "94 hours until reset"). Adding a Tavily key gives you an automatic backup: when agy fails, search falls through on its own.

## Configuration (optional)

`~/.modsearch/config.json`, organised by role. Environment variables override the file, CLI flags override everything:

```bash
modsearch config init                       # starter file, every field optional
modsearch config set tavily.apiKey <key>    # engine credentials, saved 0600
modsearch config set search.engine tavily   # pin the engine for one role
modsearch config set search.engine ""       # clear it, back to automatic
modsearch config show                       # keys come out masked
```

An empty engine means "use whatever works here". Pinning one role never disturbs the other two. Configs in the old shape (one global `provider` plus a `providers` map) are read and mapped automatically, with nothing to migrate by hand.

You don't have to remember any of it: the skill carries the full setup guide, so you can just ask your agent "set my Tavily key in modsearch."

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

- The `http` engine carries SSRF guards: private addresses (IPv4 and IPv6, including `::ffff:` mapped forms), cloud metadata endpoints, and URLs with embedded credentials are refused, every redirect hop is re-checked, and body size and character counts are capped. **One known gap, stated rather than hidden**: the hostname is resolved for the check and resolved again by `fetch`, so a DNS answer that changes in between (rebinding) can point the connection somewhere the check never saw. Closing it requires pinning the connection to the validated IP, which Node's global `fetch` does not expose. Keep it in mind when fetching links you do not trust.

- ModSearch runs `agy` with `--dangerously-skip-permissions`, because print mode can fail in some setups without it. The prompt keeps the agent to searching and fetching only, and tells it to treat page content as data, never as instructions. Even so, fetched pages are untrusted input, so prefer running inside a sandboxed workspace.
- Search output is evidence. Whatever the engine cannot verify lands in `uncertainty`. The precise-looking but fabricated numeric `relevance` score from v1 is gone, item order carries the ranking.

## Disclaimer

Personal learning and experimentation only, not for commercial use. Antigravity CLI usage runs under your own Google account's terms and quota.

## License

MIT
