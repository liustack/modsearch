<div align="center">
  <h1>ModSearch</h1>
  <p><b>Plug-in web search and page fetch for text-only LLMs. Free.</b></p>
  <p>
    <a href="https://www.npmjs.com/package/@liustack/modsearch"><img src="https://img.shields.io/npm/v/@liustack/modsearch" alt="npm"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  </p>
  <p><a href="./README.zh-CN.md">简体中文</a></p>
</div>

Your favorite model is brilliant but stuck in the past. DeepSeek-V4-Flash reasons beautifully at a bargain price, but ask it about anything after its training cutoff and it guesses. Running inside Claude Code, OpenClaw, Codex, or any harness without search tools, it cannot look anything up, and it cannot read a URL you paste.

ModSearch fixes both with one command. Give it a query and it returns real, current search results as structured JSON. Give it a URL and it fetches the page as clean markdown evidence. The browsing is done by [Antigravity CLI](https://antigravity.google) (`agy`), so it rides Google's free quota, not your API bill.

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

Install the skill once, and your agent searches and reads the web by itself. No model switch, no API key, no prompt surgery.

## Quick start

**1. Install Antigravity CLI and sign in** (one-time):

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # opens browser sign-in, then exit
```

**2. Install the skill** — tell your agent (Claude Code, Codex, OpenClaw, Cursor, ...):

```text
Install the skill from https://github.com/liustack/modsearch
```

or do it yourself:

```bash
npx -y skills add liustack/modsearch
```

**3. Use it.** Ask your agent anything time-sensitive, or paste a URL. The skill triggers automatically whenever the model needs the live web.

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

Fetch a page, with an answer focus:

```bash
npx @liustack/modsearch -u "https://github.com/liustack/liustack" -q "what skills does it ship"
```

```json
{
  "mode": "fetch",
  "result": {
    "summary": "Extracted structured evidence from liustack/liustack GitHub README focused on the skills shipped by the package.",
    "content": "#### Shipped Skills\n1. **`shaping`** (Before you start) ...\n2. **`coding`** (While coding) ...\n3. **`dig`** (When there's a bug) ...\n4. **`snapshot`** (When handing off) ...",
    "links": [ { "text": "shaping SKILL.md", "url": "https://github.com/liustack/liustack/blob/main/skills/shaping/SKILL.md" } ],
    "uncertainty": []
  }
}
```

A search takes 5-20 seconds, a fetch 10-30. The JSON structure is enforced by schema at the provider level, so your agent never has to fish JSON out of markdown again.

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

Use `-m gemini-3.1-pro-high` for hard research questions. Output contract: [skills/modsearch/references/output-schema.md](skills/modsearch/references/output-schema.md).

## Why a bridge instead of a bigger model?

- **Keep your model.** You picked DeepSeek-V4-Flash (or gpt-oss, or whatever) for its price and reasoning. ModSearch adds the live web without touching that choice.
- **Evidence beats vibes.** Answers come back with URLs, dates, and an explicit `uncertainty` list, so your agent cites instead of guessing.
- **Engines die, the bridge survives.** v1 ran on Gemini CLI's free tier until Google shut it down in June 2026. v2 runs on its successor, Antigravity CLI, behind the same provider interface, so the next engine swap is one file, not a rewrite. v2 also absorbed page fetching, which used to be a separate project (modfetch, now retired).

ModLens, the sibling project, does the same trick for vision: [liustack/modlens](https://github.com/liustack/modlens).

## Built with liustack

ModSearch v2 was shaped, coded, and shipped with **[liustack](https://github.com/liustack/liustack)** — four Agent Skills, one loop: `shaping` before you build, `coding` while you build, `dig` when it breaks, `snapshot` when you hand off. A lighter, sharper alternative to Superpowers.

**If ModSearch just gave your model a network cable, liustack gives your whole workflow discipline:**

```bash
npx -y skills add liustack/liustack -g
```

⭐ Like the idea? [Star ModSearch](https://github.com/liustack/modsearch) and [star liustack](https://github.com/liustack/liustack). Stars are how the next developer finds them.

## Security notes

- ModSearch invokes `agy` with `--dangerously-skip-permissions`, because print mode skips tool calls without it. The prompt restricts the agent to searching and fetching, and instructs it to treat page content as data, never as instructions. Still, fetched pages are untrusted input: prefer running inside a sandboxed workspace.
- Search output is evidence, not gospel: results the engine could not verify land in `uncertainty`. The fabricated-looking numeric `relevance` score from v1 was removed, item order carries the ranking.

## Disclaimer

Personal learning and experimentation only. Not for commercial use. Antigravity CLI usage falls under your own Google account terms and quota.

## License

MIT
