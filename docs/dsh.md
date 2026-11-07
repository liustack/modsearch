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

The current bundle has been checked against `@deepseek-ai/dsh 0.1.7-alpha.1`, and its settings card against `0.1.5-rc.2` too. These releases keep the surfaces ModSearch uses:

- npm bundles still declare `dsh.bundle.patch`.
- The web seam still accepts `ctx.web.registerSearchProvider(...)`.
- Tools still register through `ctx.tools.register(...)`.
- A bundle can show its own settings card. From 0.1.6-alpha.2 on it goes on the bundle's page in the Plugins panel, through the `plugins.bundle.config` slot. Earlier releases show it in Settings, through `settings.plugin.item`.

dsh is still a preview release, so check again after each dsh update. A quick composition check needs no model, API key, or quota:

```sh
npx -y @deepseek-ai/dsh --version
npx -y @deepseek-ai/dsh --profile web --dump-config
```

The dump should contain both `searchProvider: modsearch` and a plugin row named `@liustack/modsearch`.

## Install

Install into the profile you actually start. `web` is the normal browser UI profile:

```sh
npx -y @deepseek-ai/dsh plugin --profile web add @liustack/modsearch@5.10.12
```

Restart dsh after installation, then confirm the resolved package:

```sh
npx -y @deepseek-ai/dsh plugin --profile web list --depth 0
```

The exact version is intentional. pnpm 11 can hold back very recent releases through `minimumReleaseAge`, which can make `@latest` resolve to an older package. The release process keeps the version in this command synchronized with `package.json`.

The desktop app's `desktop` profile is installed only from its own window: the dsh CLI rejects it with `profile "desktop" is managed exclusively by the Electron application`. In the **Add plugin** dialog, enter the package name `@liustack/modsearch`, not the GitHub repository URL. Only the npm package ships the built CLI. A GitHub install brings source only, and pnpm blocks the build step that would fill in the gap.

## What the bundle changes

The bundle contributes two patch operations:

1. It sets the dsh web seam's `searchProvider` to `modsearch` and keeps the shipped `fetchProvider: http`, since the row replaces the host's whole web config.
2. It mounts the package root as the `modsearch` plugin.

The plugin then exposes:

| Capability | dsh surface | Behavior |
| :-- | :-- | :-- |
| Web search | Built-in `web_search` | Runs the ModSearch web engine chain and keeps native citation cards. |
| X search | Added `x_search` tool | Uses Grok Build when available. A web substitute is labeled degraded. |
| Focused page read | Added `read_page` tool | Reads one URL, optionally focused by a question. Private-network targets stay blocked. dsh's own `web_fetch` stays on for raw page text and status codes. |

## Configure search engines

The dsh plugin does not keep a second engine config. It inherits the same environment and reads the same `~/.modsearch/config.json` as the CLI and skill.

Start with the offline health check:

```sh
npx -y @liustack/modsearch@5.10.12 doctor
```

Common settings:

```sh
modsearch config set engine antigravity-cli
modsearch config set tavily.apiKey <key>
modsearch config set exa.apiKey <key>
modsearch config set firecrawl.apiKey <key>
modsearch config set keenable.apiKey <key>
modsearch config set firecrawl.keylessFetch false
modsearch config set cooldown off
```

No setting is required to start: search and page fetch run on Firecrawl's keyless free quota (1,000 free credits/month, no signup), and search falls back to Keenable's keyless pool (1,000 requests/hour per IP, no signup), then to You.com's keyless search (100 searches/day per IP, no signup). Keyless public-page fetch is on by default. It sends the requested URL to Firecrawl's cloud crawler, and the result warning names that route. `firecrawl.keylessFetch false` keeps automatic fetch local-only. Private and reserved targets are never sent to Firecrawl and fall through to the local fetcher.

See the [full engine configuration reference](../skills/modsearch/references/configure.md) and [security model](security.md).

## Configure from the web UI

The dsh web UI has no terminal, so the plugin brings its own settings card. On dsh 0.1.6-alpha.2 and later it sits on the plugin's page: open **Plugins** in the sidebar and pick `@liustack/modsearch`. Earlier dsh releases show it as a **Search engine (ModSearch)** card under Settings → Plugins → Plugin config. Either way it edits the same `~/.modsearch/config.json` as the CLI, through a route the plugin registers at `/modsearch/config`. That file belongs to your user account, not to a dsh profile, so every dsh profile on this machine and the CLI share one set of engine settings.

The card holds three things:

- The preferred engine: automatic, or one of `antigravity-cli`, `tavily`, `exa`, `firecrawl`, `keenable`, `youcom`, `grok-cli`. The `firecrawl`, `keenable`, and `youcom` options are labelled as the keyless free tier. `local` fetches single pages and searches nothing, so it is not offered, unless the config file already names it as `engine`, in which case it stays listed rather than let the card disagree with the file.
- The selected engine's own settings: API key and base URL for the HTTP engines (`tavily`, `exa`, `firecrawl`, `keenable`), and the model for `antigravity-cli`. Engines that sign in through their own command-line tool, and the built-in fetcher, show a line saying they need neither. Selecting `firecrawl` or `keenable` with no key stored adds a line saying it runs on the keyless free tier by default. Selecting `youcom` shows a note instead of a key field, since it is keyless only.
- The automatic engine chain: one checkbox per search engine `modsearch doctor` found ready on this machine. Checked means automatic routing may use it. Engines this machine cannot run are left out, since they are not a decision to make, and so is `local`, which fetches pages rather than searching. `grok-cli` carries an "X search only" note, since it serves the social role alone. When doctor's answer never arrives, every search engine is listed with a line saying the status is unknown. A successful save re-reads doctor, so an engine the save just made ready gets its checkbox straight away.

Every engine is checked by default. Unchecking one writes only `enabled: false`. Checking it again deletes that override instead of storing a redundant `true`. Unchecking the current preference returns the preference to automatic. The card only edits engines it lists: the `enabled` of an engine with no checkbox (one this machine cannot run, and `local`) is copied through untouched, and `modsearch config set <engine>.enabled` is the only way to change it. When no engine is ready here, the row of checkboxes is replaced by a line reading "No engine is ready on this machine yet."

Official Tavily, Exa, Firecrawl, and Keenable endpoints live in the provider code. The base URL field is an override only. Leaving it blank or clearing it uses the built-in official address and writes no default URL into the config file.

Everything else stays CLI only, including `bin`, `allowPrivateNetwork`, `cooldown` and `keylessFetch`. A card save copies them through untouched, and cannot create them.

Key handling:

- The browser is never sent a stored key, only whether one exists. Leaving the key box empty keeps the stored key.
- Enter multiple keys as one comma-separated value. ModSearch tries them in order and rotates after authentication, rate-limit, or quota failures. Other failures continue through the engine fallback chain without trying every key.
- A key from an environment variable still wins over the file at run time, and the card says so instead of pretending a save changed the answer.
- The plugin does not restrict Host, Origin, or Fetch Metadata headers, so domain-based and LAN deployments can read and save settings. Deployment authentication must cover `/modsearch/config` as well as dsh itself. This raw plugin route does not automatically inherit dsh Connection authentication.
- The file is rewritten as a fresh `0600` file renamed into place, the same way the CLI writes it.
- The route exists only while the plugin is on. Switching the bundle off on the Plugins page takes it down, and switching it back on serves it again without a restart.

## Configure the dsh plugin

Plugin switches live in the profile patch, normally `~/.dsh/profiles/<name>/cordis.patch.yml`. A later profile patch overrides the bundle row:

```yaml
- id: modsearch
  config:
    searchProvider: true
    xSearch: true
    readPage: true
    settingsCard: true
    providerTimeoutMs: 40000
    providerDeadlineMs: 55000
```

All fields are optional:

| Field | Default | Effect |
| :-- | :-- | :-- |
| `searchProvider` | `true` | Register ModSearch with the dsh web seam. |
| `xSearch` | `true` | Register `x_search`. |
| `readPage` | `true` | Register `read_page`. |
| `settingsCard` | `true` | Serve the settings card and its `/modsearch/config` route. Off removes both, and the browser half stands down. |
| `providerTimeoutMs` | `40000` | Time one engine may take on the `web_search` provider path (the CLI's `--timeout`). Keep it well below `providerDeadlineMs` so a fallback engine still gets a turn. |
| `providerDeadlineMs` | `55000` | Time the whole `web_search` run may take, every engine included (the CLI's `--deadline`). Keep it below dsh's tool budget, 60s for the shipped search route. |

Disabling only `x_search` or `read_page` is safe. If `searchProvider` is disabled, also point the web seam at another registered provider. Otherwise dsh is still configured to select `modsearch`, but the provider is absent:

```yaml
- id: web
  config:
    searchProvider: deepseek-official
    fetchProvider: http

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
npx -y @deepseek-ai/dsh plugin --profile <name> add @liustack/modsearch@5.10.12
```

Remove it with:

```sh
npx -y @deepseek-ai/dsh plugin --profile <name> remove @liustack/modsearch
```

If a user patch still names `searchProvider: modsearch`, change or remove that override after uninstalling.

## Troubleshooting

- `declares no dsh.bundle`: an older ModSearch release landed. Reinstall the exact version shown above.
- `modsearch's CLI build is missing`, or `Cannot find module .../dist/main.js` on 5.10.6 and older: the plugin was installed from the GitHub repository, which ships no build. Remove it and add it again by package name, `@liustack/modsearch`.
- `web seam has no registerSearchProvider`: dsh moved a developer-preview interface. `x_search` and `read_page` still register, while web search is skipped with a visible log message. Check the latest dsh release before changing the plugin.
- `modsearch failed (exit ...)`: run `modsearch doctor`. The error includes the engine attempts made by the CLI.
- The package appears in `plugin list` but not `--dump-config`: verify it appears in `dsh.profile.bundles` inside `~/.dsh/profiles/<name>/package.json`.
- Electron opens another app process instead of running the CLI: use ModSearch 5.4.3 or newer. The plugin sets `ELECTRON_RUN_AS_NODE=1` for its child process.
- `settings namespace skipped: TypeError: scope.settings.register is not a function`: ModSearch 5.10.3 or older on dsh 0.1.7 or newer. Search and both tools keep working, but the settings card is missing. Update ModSearch to 5.10.4 or newer.
- No ModSearch settings on the plugin's page: dsh 0.1.6-alpha.2 moved plugin settings there, and ModSearch 5.10.3 or older only offers its card to the old Settings slot. Update ModSearch to 5.10.4 or newer. With `settingsCard: false` the card is off on purpose.
- `settings card route skipped: Error: webserver: duplicate exact route "/modsearch/config"`: ModSearch 5.10.3 or older left its route behind when the plugin was switched off on the Plugins page. Restart dsh, or update ModSearch to 5.10.4 or newer.

For errors emitted by the CLI itself, use [Troubleshooting](troubleshooting.md).
