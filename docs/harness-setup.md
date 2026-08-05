---
summary: 'Harness setup: Codex, Claude Code, OpenCode, Pi, and what built-in search covers'
read_when:
  - Setting modsearch up inside a specific coding agent
  - Deciding whether to disable a harness's built-in search
  - A gateway or endpoint has no search tool at all
---

# Harness setup

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

Symlinks work in all of them, so linking the skill folder once keeps every agent on the latest version.
