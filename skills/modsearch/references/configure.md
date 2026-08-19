# Configuring ModSearch

English | [简体中文](configure.zh-CN.md)

Read this when the user asks how to set up modsearch, wants a key added, wants a different engine, or hits a setup-related failure. Run the commands for them instead of pasting instructions.

## The mental model

Three jobs, called roles. Each role has engines that can do it:

| Job | Engines | Configurable? |
| :-- | :-- | :-- |
| search the public web | `firecrawl`, `antigravity-cli`, `tavily`, `exa` | yes, this is the one `engine` setting |
| read one URL | the chosen engine if it can fetch, then keyless `firecrawl`, then `local` | no, it follows the choice above |
| search X (Twitter) | `grok-cli` | no, nothing else can see inside X |

The search order is fixed at `firecrawl` then `antigravity-cli` then `tavily` then `exa`, and fetch is `firecrawl` then `antigravity-cli` then `local`. Availability filters the list, and quota cooldown reorders it (see below), but the base order does not change. Firecrawl leads both chains because its keyless tier works on a bare machine, no signup, no key.

Two facts follow from this table, and they answer most questions:

- **Page fetch always works.** The `local` engine needs nothing installed, and it is the last resort for `fetch` no matter what else is configured or broken.
- **Web search needs no setup.** Firecrawl's keyless free quota (1,000 credits/month, no signup) serves it out of the box. A configured `engine` choice takes precedence when set.

X is a separate corpus, not a competing search engine, so it never replaces web search. `--source` chooses corpora, `--engine` chooses the tool.

## Zero setup

modsearch runs with no config file at all: search and fetch work as installed on Firecrawl's keyless free quota. It looks at what is on the machine and uses the best thing available. Only create a config when the user wants to change that.

Antigravity CLI is the strongest free upgrade, because it synthesizes cited answers and covers both search and fetch with no key:

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
    "antigravity-cli": { "bin": "agy", "model": "gemini-3.6-flash-low" },
    "tavily":          { "apiKey": "tvly-...", "baseURL": "https://gw.example.com/tavily" },
    "exa":             { "apiKey": "..." },
    "firecrawl":       { "apiKey": "fc-...", "keylessFetch": false },
    "grok-cli":        { "bin": "grok" }
  }
}
```

JSON has no comments, so here is every field:

| Field | Type | Applies to | Meaning |
| :-- | :-- | :-- | :-- |
| `engine` | string | top level | Which engine searches. Empty means automatic (the best available here). One of `antigravity-cli`, `tavily`, `exa`, `firecrawl`. The aliases `agy`, `antigravity`, `grok`, `http`, `direct` are accepted and normalized to the canonical name. |
| `cooldown` | `"on"` / `"off"` | top level | Quota cooldown failover. On by default. Off reads and writes no state and routes exactly as before. |
| `allowPrivateNetwork` | boolean | top level | Local network policy: allow the local fetcher to reach reserved and private address ranges. It never affects firecrawl: a target that is, or resolves to, a reserved address is kept off the cloud regardless, because the switch authorizes local access, not disclosing internal hostnames to a third-party service. `false` by default. |
| `engines` | object | top level | Per-engine settings, keyed by canonical engine name. |
| `engines.<name>.apiKey` | string | `tavily`, `exa`, `firecrawl` | The engine's API key. Also settable via `TAVILY_API_KEY` / `EXA_API_KEY` / `FIRECRAWL_API_KEY`, which win over the file. |
| `engines.<name>.baseURL` | string | `tavily`, `exa`, `firecrawl` | Endpoint base replacing the official host: a compatible third-party gateway, a proxy, a self-hosted deployment. Must be a full http(s) URL. Also settable via `TAVILY_BASE_URL` / `EXA_BASE_URL` / `FIRECRAWL_BASE_URL`. Empty unsets it. See the endpoint section below. |
| `engines.firecrawl.keylessFetch` | boolean | `firecrawl` | Allow public-page fetch through Firecrawl without a key. Default `true` (keyless fetch is on as installed). Set `false` to keep automatic page fetch off Firecrawl's cloud; a configured key or an explicit Firecrawl engine choice still enables it. |
| `engines.<name>.bin` | string | `antigravity-cli`, `grok-cli` | Path to the engine's CLI binary. Defaults to `agy` and `grok` found on `PATH`. |
| `engines.<name>.model` | string | `antigravity-cli` | Model the engine uses. Defaults to `gemini-3.6-flash-low`. |

`local` (the built-in fetcher) and `grok-cli` take no credentials, so they carry no per-engine settings worth storing. An old file that kept `allowPrivateNetwork` under `engines.http.allowPrivateNetwork`, or as the string `"true"`/`"false"`, is read and promoted to the top-level boolean automatically.

```bash
modsearch config set engine tavily            # choose the search engine
modsearch config set engine ""                # back to automatic
modsearch config set tavily.apiKey <key>      # engine credentials
modsearch config set tavily.apiKey            # no value: hidden prompt (see below)
modsearch config set tavily.baseURL <url>     # a compatible third-party endpoint
modsearch config set cooldown off             # turn off quota cooldown failover
modsearch config set allowPrivateNetwork true # reach reserved/private ranges
```

When the user is about to paste a key into the chat, offer the cleaner path
first: run `modsearch config set <engine>.apiKey` with no value in their
terminal, and the CLI prompts with the echo muted, so the key never enters
this conversation, argv, or their shell history (`pbpaste | modsearch config
set tavily.apiKey` pipes it too). If they paste it into the chat anyway, just
save it for them: the offer is for the users who care, not a gate.

Page fetch has one switch (`firecrawl.keylessFetch`, above) and X has none, on purpose. Fetching uses the chosen engine when that engine can fetch, then keyless Firecrawl, then the built-in local fetcher. X has exactly one possible engine, so there is no choice to store.

A config written before roles existed (one global `provider` plus a `providers` map) is read and mapped automatically. Nothing to migrate by hand.

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

Both roles run keyless out of the box. Fetch is where Firecrawl earns its lead: it runs a real browser in the cloud, so JavaScript-rendered pages come back with content the local engine cannot see. That also means a public URL is sent to a third party, and the result warning names that boundary on every cloud fetch. To keep automatic page fetch local-only, set `firecrawl.keylessFetch false`: search stays keyless, and fetch skips Firecrawl unless a key is configured or `-e firecrawl` selects it explicitly. Any private or reserved target is always skipped and read by the local engine instead, even with `--allow-private-network` on: a literal one (an IP written into the URL that lands in a reserved range, or an inherently local name like `localhost`, `*.local`, `*.internal`) and equally a public-looking host that resolves to a reserved IP. A VPN fake-ip and a real internal name cannot be told apart from here, so neither is handed to the cloud. The switch only lets the local engine reach them.

Every Firecrawl fetch spends a credit and forces a fresh crawl. modsearch sends `maxAge: 0`, which disables Firecrawl's default multi-day cache, so a fetch can never return stale content. The trade is deliberate: a credit per fetch in exchange for currency, which is the point of the tool. If you would rather trade freshness for credits, Firecrawl is not the engine to reach for.

### Third-party compatible endpoints (tavily, exa, firecrawl)

The three HTTP engines can point at any endpoint that speaks the same API as the official one: a reseller gateway, a regional proxy, a self-hosted deployment. Set `baseURL` and the engine appends its documented path to it (`/search` for tavily and exa, `/v2/search` and `/v2/scrape` for firecrawl), so a base of `https://gw.example.com/tavily` posts to `https://gw.example.com/tavily/search`.

```bash
modsearch config set tavily.baseURL https://gw.example.com/tavily
modsearch config set tavily.baseURL ""        # back to the official endpoint
# or per run: export TAVILY_BASE_URL=... / EXA_BASE_URL=... / FIRECRAWL_BASE_URL=...
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

A VPN that maps public hosts into reserved ranges will trip those guards:

```bash
modsearch -u <url> --allow-private-network
modsearch config set allowPrivateNetwork true   # make it permanent (top-level, global)
```

## Quota cooldown failover

When an engine fails with a quota-class error, modsearch remembers it in `~/.modsearch/state.json` (separate from `config.json`) and moves it to the back of the fallback chain until it recovers, so the next run fails over to a healthy engine first instead of hitting the same wall. This is a softened circuit breaker, not load sharing: healthy engines keep the whole job, a spent one is only tried last.

- The spent engine is never dropped. If everything else fails or is unavailable, it is still tried, and a success clears its cooldown at once.
- A precise reset time in the engine's message (agy's `Resets in 94h19m9s`) is honored. A quota error without one cools for 45 minutes. A per-second rate limit is transient and never recorded.
- An explicit `-e`/`--engine` ignores cooldown entirely, matching the hard-force rule.
- The result's `warnings` name any engine that is cooling and until when.

The switch is on by default:

```bash
modsearch config set cooldown off   # disable: read and write no state, route exactly as before
modsearch config set cooldown on    # re-enable
modsearch state clear               # forget every cooldown now
```

`modsearch doctor` shows the switch and anything cooling right now, with the time left.

## Troubleshooting

- `firecrawl rejected the keyless request`: anonymous access is unavailable or rate-limited. Set a free Firecrawl key, wait for the daily allowance to recover, or use another engine.
- Quota errors from agy: the weekly free quota is spent. Add a keyed search engine, or wait for the reset named in the message. With cooldown on, agy is moved to the back on its own until it resets.
- `exa is out of credits` / `firecrawl is out of credits`: the current budget is spent. Another search engine picks up the work, and cooldown moves the spent one to the back until it recovers.
- `Blocked private network target`: SSRF guard. If the user is behind a VPN, retry with `--allow-private-network`.
- Wrong engine name in config: modsearch says so in `warnings` and uses a working engine anyway. Fix the name when the user wants that engine back.
- Timeouts: retry once with `--timeout 300000` before reporting failure.
