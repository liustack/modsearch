---
summary: 'Harness setup: dsh, Codex, Claude Code, OpenCode, Pi, and what built-in search covers'
read_when:
  - Setting modsearch up inside a specific coding agent
  - Installing the DeepSeek Harness (dsh) plugin
  - Deciding whether to disable a harness's built-in search
  - A gateway or endpoint has no search tool at all
---

# Harness setup

English | [简体中文](harness-setup.zh-CN.md)

## DeepSeek Harness (dsh)

dsh is different from the other harnesses: modsearch plugs in natively, not as a prompt-triggered skill. The package itself is a dsh bundle, so one command installs it into a profile:

For plugin switches, profile patches, runtime verification, updating, and compatibility checks, use the dedicated [dsh plugin guide](dsh.md).

```sh
npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modsearch@5.6.0
```

Three things land at once:

- **`web_search` starts running on modsearch.** dsh already ships a native `web_search` tool over a provider seam, pinned to DeepSeek's keyed search API. The bundle registers the modsearch engine chain as a provider and repoints the seam at it (`searchProvider: modsearch`), so search works with no API key at all: Firecrawl's keyless free quota answers out of the box, signed-in agy and configured keys take over when present, and the Web UI keeps its native citation cards. To switch back, pin `searchProvider` to another provider in a later profile patch.
- **`x_search`** covers the corpus dsh has no seam for. Routed to Grok Build when it is installed and signed in; a web stand-in answer is marked degraded in the tool output, never silent.
- **`read_page`** reads one URL into structured evidence (summary, extracted content, links, uncertainty), with an optional answer focus. dsh ships its own `web_fetch` disabled because that provider defers SSRF protection. ModSearch blocks private-network targets by default, and the tool exposes no override. Public URLs go through Firecrawl's keyless cloud browser by default, which reads JavaScript-rendered pages; the result carries a warning naming the cloud route, and `modsearch config set firecrawl.keylessFetch false` keeps automatic fetch local instead.

Engines, keys, and routing keep living in `~/.modsearch/config.json`, shared with every other harness. dsh is in developer preview and its plugin surface may change. The plugin keeps its touch small (one provider registration and two raw tool registrations) and degrades loudly in the harness log if any of it moves. If dsh warns `declares no dsh.bundle`, pnpm's release-age gate installed an old version. Reinstall with the named version below.

The plugin also works when dsh runs inside an Electron desktop host. Electron exposes the desktop application as `process.execPath`, so the plugin explicitly starts its CLI child with `ELECTRON_RUN_AS_NODE=1`. The bundled `dist/main.js` then runs under Node instead of being passed back to the desktop application as arguments.

### Keeping it up to date

To install the current release or refresh an existing profile, rerun `add` with the version named:

```sh
npx -y @deepseek-ai/dsh plugin --profile <name> add @liustack/modsearch@5.6.0
```

`npm view @liustack/modsearch version` prints the current version. This page is stamped with the package version by the release process. Reusing `add` is deliberate because it replaces the profile's recorded request with the exact version named above. Do not substitute `update`, which stays inside the recorded semver request and lets pnpm select through its release-age filter again.

The named version rather than `@latest` is deliberate. pnpm 11 holds back releases published in the last 24 hours through `minimumReleaseAge`, which is enabled by default, then resolves the dist-tag against the versions that survive the filter. As a result, `@latest` silently installs an older release instead of skipping the gate. An exact version avoids that dist-tag resolution. Since pnpm 11.1.3, the default loose mode records an immature exact pick under `minimumReleaseAgeExclude` in the profile's `pnpm-workspace.yaml` and continues, while leaving the release-age window in place for everything else.

Restart dsh, then confirm what actually landed:

```sh
npx -y @deepseek-ai/dsh plugin --profile <name> list
```

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
