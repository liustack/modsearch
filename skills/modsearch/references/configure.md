# Configuring ModSearch

English | [简体中文](configure.zh-CN.md)

Read this when the user asks how to set up modsearch, wants a key added, wants a different engine, or hits a setup-related failure. Run the commands for them instead of pasting instructions.

## The mental model

Three jobs, called roles. Each role has engines that can do it:

| Job | Engines | Configurable? |
| :-- | :-- | :-- |
| search the public web | `firecrawl`, `keenable`, `youcom`, `antigravity-cli`, `tavily`, `exa` | preferred engine plus per-engine participation |
| read one URL | the preferred engine if it can fetch, then `firecrawl`, `keenable`, `antigravity-cli`, `local` | per-engine participation |
| search X (Twitter) | `grok-cli` | per-engine participation |

The search order is fixed at `firecrawl` then `keenable` then `youcom` then `antigravity-cli` then `tavily` then `exa`, and fetch is `firecrawl` then `keenable` then `antigravity-cli` then `local`. Every engine participates by default. `engines.<name>.enabled: false` filters one out, availability filters what remains, and quota cooldown reorders the ready chain (see below). Firecrawl leads both chains because its keyless tier works on a bare machine, no signup, no key. Keenable comes second in both chains for the same reason, so a bare machine still has a keyless fallback when Firecrawl's allowance runs out. You.com comes third: a smaller keyless pool (100 searches a day per IP) for when both run dry on a busy IP.

Two facts follow from this table, and they answer most questions:

- **Page fetch works with no setup.** The `local` engine needs nothing installed and is the default last resort. It only leaves the automatic chain when the user explicitly disables it.
- **Web search works keyless on Firecrawl's free quota** (1,000 credits/month, no signup), with Keenable's keyless pool (1,000 requests/hour per IP) and You.com's keyless search (100 searches/day per IP) behind it. A configured `engine` choice takes precedence when set. The search chain does not include `local`, because `local` cannot search. If all three keyless engines are rate-limited, search needs at least one keyed engine or `agy` as a fallback. Fetch still has `local` as a floor.

X is a separate corpus, not a competing search engine, so it never replaces web search. `--source` chooses corpora, `--engine` chooses the tool.

## Zero setup

modsearch runs with no config file at all: fetch has `local` as a floor, and search runs on Firecrawl's keyless free quota, then Keenable's, then You.com's. Search has no `local` fallback (`local` cannot search), so when all three keyless engines are rate-limited it needs a keyed engine or `agy`. It looks at what is on the machine and uses the best thing available. Only create a config when the user wants to change that.

Antigravity CLI is the best free upgrade, because it synthesizes cited answers and covers both search and fetch with no key:

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # the user completes a browser sign-in, then exits
```

Sign-in cannot be done non-interactively: ask the user to run `agy` once themselves.

## Config file

`~/.modsearch/config.json`, written 0600, keys masked when shown. Precedence: CLI flags > environment variables > this file > built-in defaults.

```bash
modsearch config init     # starter file, every field optional
modsearch config show     # effective config: file + env merged, each value tagged (file)/(env), keys masked, alias keys shown canonical
```

Full structure. Every field is optional, and so is the file itself:

```json
{
  "engine": "tavily",
  "cooldown": "on",
  "allowPrivateNetwork": false,
  "engines": {
    "antigravity-cli": { "bin": "agy", "model": "gemini-3.8-flash-low" },
    "tavily":          { "apiKey": "tvly-...", "baseURL": "https://gw.example.com/tavily" },
    "exa":             { "apiKey": "...", "enabled": false },
    "firecrawl":       { "apiKey": "fc-...", "keylessFetch": false },
    "keenable":        { "apiKey": "..." },
    "grok-cli":        { "bin": "grok" }
  }
}
```

JSON has no comments, so here is every field:

| Field | Type | Applies to | Meaning |
| :-- | :-- | :-- | :-- |
| `engine` | string | top level | Which engine searches. Empty means automatic (the best available here). One of `antigravity-cli`, `tavily`, `exa`, `firecrawl`, `keenable`, `youcom`. The aliases `agy`, `antigravity`, `grok`, `http`, `direct` are accepted and normalized to the canonical name. |
| `cooldown` | `"on"` / `"off"` | top level | Quota cooldown failover. On by default. Off reads and writes no state and routes exactly as before. |
| `allowPrivateNetwork` | boolean | top level | Allow the local fetcher to reach private or reserved addresses, including other VPN ranges and hosts-file accelerators. Default `false`. DNS answers in `198.18.0.0/15` already pass as fake-IP placeholders without this switch. Literal URLs in that range stay blocked while it is off. This setting never authorizes cloud disclosure (Firecrawl or Keenable). Literal private and reserved targets always stay off the cloud. For DNS answers, the cloud engine withholds the URL only when every address is private or reserved after the fake-IP exemption. |
| `engines` | object | top level | Per-engine settings, keyed by canonical engine name. |
| `engines.<name>.enabled` | boolean | every engine | Whether automatic routing may use this engine. Missing means enabled. Set `false` to exclude it. Setting `true` removes the override and returns to the built-in default. An explicit `--engine` still forces that engine for one run. |
| `engines.<name>.apiKey` | string | `tavily`, `exa`, `firecrawl`, `keenable` | One API key, or multiple keys separated by commas. Whitespace and empty comma items are ignored. Authentication, rate-limit, and quota failures rotate through the keys in order. Network, 5xx, and parsing failures go directly to the next engine. Also settable via `TAVILY_API_KEY` / `EXA_API_KEY` / `FIRECRAWL_API_KEY` / `KEENABLE_API_KEY`, which win over the file. |
| `engines.<name>.baseURL` | string | `tavily`, `exa`, `firecrawl`, `keenable` | Endpoint base replacing the official host: a compatible third-party gateway, a proxy, a self-hosted deployment. Must be a full http(s) URL. Also settable via `TAVILY_BASE_URL` / `EXA_BASE_URL` / `FIRECRAWL_BASE_URL` / `KEENABLE_BASE_URL`. Empty unsets it. See the endpoint section below. |
| `engines.firecrawl.keylessFetch`, `engines.keenable.keylessFetch` | boolean | `firecrawl`, `keenable` | Allow public-page fetch through that engine's cloud without a key. Default `true` (keyless fetch is on as installed). Set `false` to keep automatic page fetch off that engine's cloud. A configured key or an explicit choice of that engine in your own global config still enables it. |
| `engines.<name>.bin` | string | `antigravity-cli`, `grok-cli` | Path to the engine's CLI binary. Defaults to `agy` and `grok` found on `PATH`. |
| `engines.<name>.model` | string | `antigravity-cli` | Model the engine uses. Defaults to `gemini-3.8-flash-low`. |

`local` (the built-in fetcher) and `grok-cli` take no credentials, but both accept the shared `enabled` switch. An old file that kept `allowPrivateNetwork` under `engines.http.allowPrivateNetwork`, or as the string `"true"`/`"false"`, is read and promoted to the top-level boolean automatically.

```bash
modsearch config set engine tavily            # choose the search engine
modsearch config set engine ""                # back to automatic
modsearch config set tavily.apiKey <key>      # engine credentials
modsearch config set tavily.apiKey <key1,key2> # rotate keys in this order
modsearch config set tavily.apiKey            # no value: hidden prompt (see below)
modsearch config set tavily.baseURL <url>     # a compatible third-party endpoint
modsearch config set tavily.enabled false     # keep Tavily out of automatic failover
modsearch config set tavily.enabled true      # remove the opt-out
modsearch config set cooldown off             # turn off quota cooldown failover
modsearch config set allowPrivateNetwork true # reach reserved/private ranges
```

When the user is about to paste a key into the chat, offer the cleaner path
first: run `modsearch config set <engine>.apiKey` with no value in their
terminal, and the CLI prompts with the echo muted, so the key never enters
this conversation, argv, or their shell history (`pbpaste | modsearch config
set tavily.apiKey` pipes it too). If they paste it into the chat anyway, just
save it for them: the offer is for the users who care, not a gate.

The shared `enabled` switch applies to search, fetch, and X. Fetching uses the preferred engine when it can fetch, then the enabled engines in the built-in order. Disabling `local` removes the default fetch floor. Disabling `grok-cli` makes an X request take the documented public-web degrade path. A one-off explicit `--engine` ignores these persistent opt-outs.

A project can also carry a small config of its own. See the next section.

A config written before roles existed (one global `provider` plus a `providers` map) is read and mapped automatically. Nothing to migrate by hand.

## Project config

A project can add a `.modsearch/config.json`. modsearch looks for it from the current directory upward and stops at the home directory. `~/.modsearch/config.json` is never taken for a project file. The nearest one wins and it is laid over the global file.

A project file can only narrow, never widen. It may set three things:

```json
{
  "engine": "tavily",
  "engines": {
    "exa": { "enabled": false },
    "antigravity-cli": { "model": "gemini-3.8-flash-low" }
  }
}
```

- `engine`: the preferred search engine for this project.
- `engines.<name>.enabled: false`: keep an engine out of automatic routing here. `true` cannot switch back on what the global file turned off.
- `engines.<name>.model`: the model for that engine.

Everything else is ignored: `apiKey`, `bin`, `baseURL`, `keylessFetch`, `cooldown`, `allowPrivateNetwork`, `enabled: true`, and engines modsearch does not know. A project directory can be someone else's clone, so a `bin` there would run any program and a `baseURL` would send your key anywhere. Ignored entries are named by path (never by value) on stderr during a search, in `modsearch doctor` (a `project:` line and an `! ignored ...` line, plus `projectConfig` in `--json`), and in `modsearch config show` (values tagged `(project)`).

A project's `engine` is not consent to cloud fetch. If it names a cloud engine whose `keylessFetch` you turned off, or an engine that is not set up (Tavily with no key, say), routing skips it and says so in a note. Only your own global config can opt in.

A broken project file fails the run: `Failed to read the project config <path>: ... Fix or delete the file.` or `The project config <path> is not a JSON object. Fix or delete the file.` `MODSEARCH_PROJECT_CONFIG=off` turns the lookup off. `modsearch config set` still writes only the global file.

The dsh plugin sets `MODSEARCH_PROJECT_CONFIG=off` for the CLI it starts. One dsh process serves every workspace and a tool call does not say which workspace it came from, so the CLI's current directory is dsh's, not the workspace's. Per-workspace config in dsh waits on dsh passing the workspace path to plugins.

## Engine setup

### antigravity-cli (search + fetch, free, no key)

Install and sign in as above. Its free tier is a weekly quota shared with the Antigravity desktop app and SDK, so a heavy day can exhaust it. The error says so plainly when that happens.

```bash
modsearch config set antigravity-cli.model gemini-3.1-pro-high   # harder research questions
modsearch config set antigravity-cli.bin /custom/path/to/agy
```

### tavily (search, free tier)

1,000 credits a month, no credit card, one credit per basic search. Key from https://app.tavily.com.

```bash
modsearch config set tavily.apiKey <key>
# or environment: export TAVILY_API_KEY=<key>
```

Good insurance when the keyless quota and agy both run dry: with a key present, web search falls to Tavily on its own.

### exa (search, free monthly credit)

$10 of recurring monthly credit, about 1,400 searches, no card. Key from https://exa.ai.

```bash
modsearch config set exa.apiKey <key>
# or environment: export EXA_API_KEY=<key>
```

Exa ranks and links with highlight snippets but writes no synthesis, so its summary is mechanical and the evidence is in `items`. It sits after Tavily in the search order.

### firecrawl (search + fetch, keyless by default)

The default engine, and the reason a bare install works: Firecrawl's keyless tier grants [1,000 free credits a month with no signup](https://www.firecrawl.dev/blog/firecrawl-keyless-launch). Keyless requests omit the Authorization header and are metered per IP with daily request and credit caps (Firecrawl does not publish the daily numbers in its [rate-limit documentation](https://docs.firecrawl.dev/rate-limits#keyless-no-api-key)). A free key from https://firecrawl.dev adds a personal 1,000 credits/month and higher limits:

```bash
modsearch config set firecrawl.apiKey <key>
# or environment: export FIRECRAWL_API_KEY=<key>
modsearch config set firecrawl.keylessFetch false   # keep automatic page fetch off the cloud
```

Both roles run keyless out of the box. Fetch is where Firecrawl earns its lead: it runs a real browser in the cloud, so JavaScript-rendered pages come back with content the local engine cannot see. That also means a public URL is sent to a third party, and the result warning names that boundary on every cloud fetch. To keep automatic page fetch local-only, set `firecrawl.keylessFetch false` and `keenable.keylessFetch false` (Keenable's reader is a cloud too, see below): search stays keyless, and fetch skips both unless a key is configured or `-e` selects one explicitly. A literal private or reserved target is always skipped, even with `--allow-private-network` on. Hostname DNS answers use a narrower cloud-disclosure rule. The standard Clash, Surge, and mihomo fake-IP pool `198.18.0.0/15` is treated as a placeholder, and a hostname stays off Firecrawl only when every resolved address is genuinely private or reserved. Any public answer allows the public URL through. This exception is DNS-only. The local SSRF guard still treats `198.18.0.0/15` as private, and the switch only lets that local engine reach it.

Every Firecrawl fetch spends a credit and forces a fresh crawl. modsearch sends `maxAge: 0`, which disables Firecrawl's default multi-day cache, so a fetch can never return stale content. The trade is deliberate: a credit per fetch in exchange for currency, which is the point of the tool. If you would rather trade freshness for credits, Firecrawl is not the engine to reach for.

### keenable (search + fetch, keyless by default)

Works with no key and no signup, and sits second in the search order and in the fetch order, right after Firecrawl. Keyless requests go to Keenable's public endpoint, which allows 1,000 requests an hour per IP (shared by everyone on that IP) and at most 10 a second. A free key from https://app.keenable.ai moves the calls to the keyed endpoint: no hourly cap, 100,000 requests a month per organization.

```bash
modsearch config set keenable.apiKey <key>
# or environment: export KEENABLE_API_KEY=<key>
```

In search it returns ranked links with snippets (and a publish date when Keenable has one) but writes no synthesis, like Exa, so its summary is mechanical, a warning says so, and the evidence is in `items`.

Keenable also reads pages (`-u`). Keyless fetch goes to `/v1/fetch/public` and needs no signup. A key moves it to `/v1/fetch`. Every fetch asks for a live read, not Keenable's indexed copy, and the text comes back as Keenable's markdown extraction, not the page as served. Whether its reader runs JavaScript is not documented, so do not count on it. A public URL is sent to Keenable, so the result carries a warning and the same SSRF rule as Firecrawl applies: a literal private or reserved target, or a hostname whose DNS answers are all private (the `198.18.0.0/15` fake-IP pool counts as a placeholder, not private), never leaves the machine. `-u` with `-q` (or `--prompt`) is sent as Keenable's `prompt`, so the content becomes Keenable's model extract for that focus, not the page text, links come back empty, and a warning says so. A focus over 2,000 characters is dropped with a warning and the full page is returned.

```bash
modsearch config set keenable.keylessFetch false   # keep automatic page fetch off Keenable's cloud
```

`keenable.keylessFetch false` works like Firecrawl's: a configured key or choosing `engine keenable` in your own global config re-enables it.

### youcom (search, keyless only)

Works with no key and no signup, and sits third in the search order, after Firecrawl and Keenable. Requests go to `https://api.you.com/v1/agents/search`, which allows 100 searches a day per IP (shared by everyone on that IP). There is no `apiKey`, `baseURL`, or model setting, and no keyed upgrade. `--max-results` is capped at 50. Turn it off for automatic routing with `engines.youcom.enabled: false`, and `-e youcom` still forces it for one run.

You.com searches only, so `-u` with `-e youcom` is an error. Like Keenable, it returns ranked links with snippets (and a publish date from You.com's `page_age` when it has one) but writes no synthesis, so its summary is mechanical, a warning says so, and the evidence is in `items`.

### Third-party compatible endpoints (tavily, exa, firecrawl, keenable)

The four HTTP engines can point at any endpoint that speaks the same API as the official one: a reseller gateway, a regional proxy, a self-hosted deployment. Set `baseURL` and the engine appends its documented path to it (`/search` for tavily and exa, `/v2/search` and `/v2/scrape` for firecrawl, `/v1/search` and `/v1/fetch` for keyed keenable, `/v1/search/public` and `/v1/fetch/public` for keyless keenable), so a base of `https://gw.example.com/tavily` posts to `https://gw.example.com/tavily/search`.

The official bases are built into the providers: `https://api.tavily.com`, `https://api.exa.ai`, `https://api.firecrawl.dev`, and `https://api.keenable.ai`. They are not copied into `config.json`. An absent or cleared `baseURL` means to use the built-in official base, which lets a later release correct that default without a stale file overriding it. The dsh settings card follows the same rule.

```bash
modsearch config set tavily.baseURL https://gw.example.com/tavily
modsearch config set tavily.baseURL ""        # back to the official endpoint
# or per run: export TAVILY_BASE_URL=... / EXA_BASE_URL=... / FIRECRAWL_BASE_URL=... / KEENABLE_BASE_URL=...
```

The API key is sent to whatever host the base names. That is the point, and it is also the trust decision: only name a host you would hand that key to.

### grok-cli (X, rides a SuperGrok or X Premium subscription)

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok    # the user signs in with SuperGrok or X Premium
```

Nothing else to turn on. An X-flavored query goes to X automatically once `grok` is installed and signed in. Without it, an X question is answered from the public web, and the result says so in `warnings`.

### local (fetch, nothing to install)

The built-in direct fetcher (`http` and `direct` still work as aliases). No setup. It carries SSRF guards (private ranges, cloud metadata, per-hop redirect checks, size caps) and pins each connection to the validated IP, so DNS rebinding cannot slip past. It runs no JavaScript, so it is not a full browser sandbox: still run untrusted URLs in a sandboxed working directory.

Two proxy shapes:

1. TUN + fake-IP (Clash, Clash Verge Rev, mihomo, Surge). DNS answers in `198.18.0.0/15` are treated as fake-IP placeholders, so no switch is needed. The connection stays pinned to the checked fake IP, with the hostname kept for the Host header and TLS SNI. A literal URL such as `http://198.18.0.5/` is still blocked when `allowPrivateNetwork` is off.
2. System HTTP proxy (`http_proxy` / `https_proxy` environment variables, DNS returns real IPs). Set those env vars. The local engine then forwards through the proxy. The proxy resolves the hostname, so the socket is not pinned to a checked IP.

A split-tunnel VPN that maps public hosts into other reserved ranges, or a hosts-file accelerator such as Watt Toolkit / Steam++ that maps them to loopback, still needs the local-only waiver:

```bash
modsearch -u <url> --allow-private-network
modsearch config set allowPrivateNetwork true   # make it permanent (top-level, global)
```

## Quota cooldown failover

When an API key fails with a quota-class error, modsearch remembers that key in `~/.modsearch/state.json` (separate from `config.json`). The next run tries healthy keys in the same engine first. The engine moves to the back of the fallback chain only when every configured key is cooling. Engines without API keys keep one engine-level cooldown. This is a softened circuit breaker, not load sharing: healthy keys and engines keep the whole job, while cooling ones remain available as last attempts.

- A cooling key is never dropped. A success clears that key's cooldown at once. Old engine-level state entries still load and apply to every configured key until a successful key clears the legacy entry.
- A precise reset time in the engine's message (agy's `Resets in 94h19m9s`) is honored. A quota error without one cools for 45 minutes. A per-second rate limit is transient and never recorded.
- An explicit `-e`/`--engine` remains a hard force with no cross-engine fallback. Within a multi-key engine, healthy keys are still tried before cooling keys.
- The result's `warnings` identify the key that entered cooldown. Routing warnings name an engine only when all of its configured keys are cooling and it moves to the back.

The switch is on by default:

```bash
modsearch config set cooldown off   # disable: read and write no state, route exactly as before
modsearch config set cooldown on    # re-enable
modsearch state clear               # forget every cooldown now
```

`modsearch doctor` shows the switch and every engine or key cooling right now, with the time left.

## Troubleshooting

- `firecrawl rejected the keyless request`: anonymous access is unavailable or rate-limited. Set a free Firecrawl key, wait for the daily allowance to recover, or use another engine. Search has no `local` fallback (`local` cannot search).
- Quota errors from agy: the weekly free quota is spent. Add a keyed search engine, or wait for the reset named in the message. With cooldown on, agy is moved to the back on its own until it resets.
- `keenable's keyless pool for this IP is used up for the hour`: the shared keyless pool (1,000 requests/hour per IP) is spent. The next search engine picks up the work. Set a free Keenable key for 100,000 requests a month of your own.
- `youcom's keyless allowance for this IP is used up for the day (100 searches)`: the shared keyless allowance is spent. The next search engine picks up the work, and You.com is not put on cooldown. There is no key to add, so wait for the next day or use another engine. Other failures read `youcom returned <status> <statusText>. <body>`.
- `exa is out of credits` / `firecrawl is out of credits` / `keenable is out of credits`: the current budget is spent. Another search engine picks up the work, and cooldown moves the spent one to the back until it recovers.
- `Blocked private network target`: SSRF guard. If the user is behind a VPN, retry with `--allow-private-network`.
- Wrong engine name in config: modsearch says so in `warnings` and uses a working engine anyway. Fix the name when the user wants that engine back.
- Timeouts: retry once with `--timeout 300000` before reporting failure.
