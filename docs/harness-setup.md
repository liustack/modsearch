---
summary: 'Harness setup: dsh, Codex, Claude Code, OpenCode, Pi, and what built-in search covers'
read_when:
  - Setting modsearch up inside a specific coding agent
  - Installing the DeepSeek Harness (dsh) plugin
  - Deciding whether to disable a harness's built-in search
  - A gateway or endpoint has no search tool at all
---

# Harness setup

## DeepSeek Harness (dsh)

dsh is different from the other harnesses: modsearch plugs in natively, not as a prompt-triggered skill. The package itself is a dsh bundle, so one command installs it into a profile:

```sh
npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modsearch@latest
```

Three things land at once:

- **`web_search` starts running on modsearch.** dsh already ships a native `web_search` tool over a provider seam, pinned to DeepSeek's keyed search API. The bundle registers the modsearch engine chain as a provider and repoints the seam at it (`searchProvider: modsearch`), so search works with no API key wherever agy is signed in, and the Web UI keeps its native citation cards. To switch back, pin `searchProvider` to another provider in a later profile patch.
- **`x_search`** covers the corpus dsh has no seam for. Routed to Grok Build when it is installed and signed in; a web stand-in answer is marked degraded in the tool output, never silent.
- **`read_page`** reads one URL into structured evidence (summary, extracted content, links, uncertainty), with an optional answer focus. dsh ships its own `web_fetch` disabled because that provider defers SSRF protection; modsearch's fetch blocks private-network targets by default, and the tool exposes no override for that.

Engines, keys, and routing keep living in `~/.modsearch/config.json`, shared with every other harness. dsh is in developer preview and its plugin surface may change; the plugin keeps its touch small (one provider registration, two raw tool registrations) and degrades loudly in the harness log if any of it moves. If dsh warns `declares no dsh.bundle`, pnpm's release-age gate installed an old version: repeat the command with the explicit `@latest`.

## Codex (and other DeepSeek setups)

DeepSeek's official endpoints ship a server-side `web_search` tool, carried by the Responses API that Codex speaks and the Anthropic-compatible endpoint that Claude Code speaks. Point either at `api.deepseek.com` with `web_search = "live"` and you already have search (see the [official integration guide](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)).

So inside Codex, ModSearch is not about going from nothing to something. It is about the context bill: built-in search pushes whole pages into your model's context, measured at about 30,000 tokens for one search-heavy answer, against a few hundred for structured evidence.

To hand it the job, turn the built-in one off in `~/.codex/config.toml`, or the model reaches for that one first and the skill never gets a word in:

```toml
web_search = "disabled"
```

## Where built-in search does not exist at all

- The official `/chat/completions` endpoint does not offer the tool, which is what shuts **OpenCode** and **Pi** out.
- DashScope and most third-party gateways expose the model's reasoning and nothing else.
- Reading one specific page, and reaching X, are outside built-in search's scope everywhere.

## Skill locations per harness

| Harness | Reads skills from |
| :-- | :-- |
| Claude Code | `~/.claude/skills/` |
| Codex | `~/.codex/skills/` |
| Pi, OpenCode | `~/.agents/skills/` |

On Windows, `~` is the user profile, so these are `%USERPROFILE%\.claude\skills\` and the like.

Symlinks work in all of them, so linking the skill folder once keeps every agent on the latest version.
