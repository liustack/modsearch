---
summary: 'DeepSeek Harness plugin: install, configure, verify, update, and troubleshoot modsearch'
read_when:
  - Installing or updating modsearch in a dsh profile
  - Configuring the dsh plugin switches or modsearch engines
  - Verifying web_search, x_search, or read_page in dsh
  - Checking compatibility after a dsh release
---

# DeepSeek Harness plugin

English | [简体中文](dsh.zh-CN.md)

ModSearch is a native dsh bundle. It keeps dsh's built-in `web_search` tool and citation cards, replaces only the search provider behind them, and adds `x_search` plus `read_page` for capabilities the dsh web seam does not expose.

## Compatibility

The current bundle has been checked against `@deepseek-ai/dsh 0.1.0-rc.7`. That release keeps the three surfaces ModSearch uses unchanged:

- npm bundles still declare `dsh.bundle.patch`.
- The web seam still accepts `ctx.web.registerSearchProvider(...)`.
- Tools still register through `ctx.tools.register(...)`.

dsh is still a release candidate, so check again after each dsh update. A quick composition check needs no model, API key, or quota:

```sh
npx -y @deepseek-ai/dsh --version
npx -y @deepseek-ai/dsh --profile web --dump-config
```

The dump should contain both `searchProvider: modsearch` and a plugin row named `@liustack/modsearch`.

## Install

Install into the profile you actually start. `web` is the normal browser UI profile:

```sh
npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modsearch@5.6.0
```

Restart dsh after installation, then confirm the resolved package:

```sh
npx -y @deepseek-ai/dsh plugin --profile web list --depth 0
```

The exact version is intentional. pnpm 11 can hold back very recent releases through `minimumReleaseAge`, which can make `@latest` resolve to an older package. The release process keeps the version in this command synchronized with `package.json`.

## What the bundle changes

The bundle contributes two patch operations:

1. It sets the dsh web seam's `searchProvider` to `modsearch`.
2. It mounts the package root as the `modsearch` plugin.

The plugin then exposes:

| Capability | dsh surface | Behavior |
| :-- | :-- | :-- |
| Web search | Built-in `web_search` | Runs the ModSearch web engine chain and keeps native citation cards. |
| X search | Added `x_search` tool | Uses Grok Build when available. A web substitute is labeled degraded. |
| Focused page read | Added `read_page` tool | Reads one URL, optionally focused by a question. Private-network targets stay blocked. |

## Configure search engines

The dsh plugin does not keep a second engine config. It inherits the same environment and reads the same `~/.modsearch/config.json` as the CLI and skill.

Start with the offline health check:

```sh
npx -y @liustack/modsearch@5.6.0 doctor
```

Common settings:

```sh
modsearch config set engine antigravity-cli
modsearch config set tavily.apiKey <key>
modsearch config set exa.apiKey <key>
modsearch config set firecrawl.apiKey <key>
modsearch config set firecrawl.keylessFetch false
modsearch config set cooldown off
```

No setting is required to start: search and page fetch run on Firecrawl's keyless free quota (1,000 free credits/month, no signup). Keyless public-page fetch is on by default; it sends the requested URL to Firecrawl's cloud crawler, and the result warning names that route. `firecrawl.keylessFetch false` keeps automatic fetch local-only. Private and reserved targets are never sent to Firecrawl and fall through to the local fetcher.

See the [full engine configuration reference](../skills/modsearch/references/configure.md) and [security model](security.md).

## Configure the dsh plugin

Plugin switches live in the profile patch, normally `~/.dsh/profiles/<name>/cordis.patch.yml`. A later profile patch overrides the bundle row:

```yaml
- id: modsearch
  config:
    searchProvider: true
    xSearch: true
    readPage: true
    providerTimeoutMs: 55000
```

All fields are optional:

| Field | Default | Effect |
| :-- | :-- | :-- |
| `searchProvider` | `true` | Register ModSearch with the dsh web seam. |
| `xSearch` | `true` | Register `x_search`. |
| `readPage` | `true` | Register `read_page`. |
| `providerTimeoutMs` | `55000` | Deadline passed to the CLI for the `web_search` provider path. Keep it below dsh's tool budget. |

Disabling only `x_search` or `read_page` is safe. If `searchProvider` is disabled, also point the web seam at another registered provider. Otherwise dsh is still configured to select `modsearch`, but the provider is absent:

```yaml
- id: web
  config:
    searchProvider: deepseek-official

- id: modsearch
  config:
    searchProvider: false
```

Run `--dump-config` after editing a patch. dsh patch rows replace the target row's whole `config`, so include every value you need on that row.

## Verify at runtime

Start the profile with dsh's documented launcher:

```sh
npx -y @deepseek-ai/dsh --profile web
```

Use three small prompts:

1. `Search the web for the current Node.js LTS release and cite the sources.`
2. `Search X for recent posts from @deepseek_ai.`
3. `Read https://example.com and summarize the page.`

The first call should use dsh's native `web_search` card. The other two should appear as `x_search` and `read_page`. Run `modsearch doctor` if a tool exists but its engine fails.

## Update or remove

Refresh the recorded request with the exact current version:

```sh
npx -y @deepseek-ai/dsh plugin --profile <name> add @liustack/modsearch@5.6.0
```

Remove it with:

```sh
npx -y @deepseek-ai/dsh plugin --profile <name> remove @liustack/modsearch
```

If a user patch still names `searchProvider: modsearch`, change or remove that override after uninstalling.

## Troubleshooting

- `declares no dsh.bundle`: an older ModSearch release landed. Reinstall the exact version shown above.
- `web seam has no registerSearchProvider`: dsh moved a developer-preview interface. `x_search` and `read_page` still register, while web search is skipped with a visible log message. Check the latest dsh release before changing the plugin.
- `modsearch failed (exit ...)`: run `modsearch doctor`. The error includes the engine attempts made by the CLI.
- The package appears in `plugin list` but not `--dump-config`: verify it appears in `dsh.profile.bundles` inside `~/.dsh/profiles/<name>/package.json`.
- Electron opens another app process instead of running the CLI: use ModSearch 5.4.3 or newer. The plugin sets `ELECTRON_RUN_AS_NODE=1` for its child process.

For errors emitted by the CLI itself, use [Troubleshooting](troubleshooting.md).
