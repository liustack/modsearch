# Configuring ModSearch

Read this when the user asks how to set up modsearch, wants a key added, wants a different engine, or hits a setup-related failure. Run the commands for them instead of pasting instructions.

## The mental model

Three jobs, called roles. Each role has engines that can do it:

| Job | Engines | Configurable? |
| :-- | :-- | :-- |
| search the public web | `antigravity-cli`, `tavily`, `exa`, `firecrawl` | yes, this is the one `engine` setting |
| read one URL | the chosen engine if it can fetch, then `firecrawl` when keyed, else `local` | no, it follows the choice above |
| search X (Twitter) | `grok-cli` | no, nothing else can see inside X |

The search order is fixed at `antigravity-cli` then `tavily` then `exa` then `firecrawl`, best first, and fetch is `antigravity-cli` then `firecrawl` then `local`. Availability filters the list, and quota cooldown reorders it (see below), but the base order does not change.

Two facts follow from this table, and they answer most questions:

- **Page fetch always works.** The `local` engine needs nothing installed, and it is the last resort for `fetch` no matter what else is configured or broken.
- **Web search needs one engine.** Antigravity CLI (free, no key), or a Tavily, Exa, or Firecrawl key. With none of them, `-q` explains the options instead of failing silently.

X is a separate corpus, not a competing search engine, so it never replaces web search. `--source` chooses corpora, `--engine` chooses the tool.

## Zero setup

modsearch runs with no config file at all. It looks at what is on the machine and uses the best thing available. Only create a config when the user wants to change that.

The fastest path to a fully working setup is Antigravity CLI, because it covers both search and fetch with no key:

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

Shape:

```json
{
  "engine": "",
  "cooldown": "on",
  "engines": {
    "antigravity-cli": { "bin": "agy", "model": "gemini-3.6-flash-low" },
    "tavily":          { "apiKey": "" },
    "exa":             { "apiKey": "" },
    "firecrawl":       { "apiKey": "" },
    "grok-cli":        { "bin": "grok" },
    "local":           { "allowPrivateNetwork": "false" }
  }
}
```

An empty `engine` means "use the best available one". `cooldown` is `on` unless you set it to `off`.

```bash
modsearch config set engine tavily            # choose the search engine
modsearch config set engine ""                # back to automatic
modsearch config set tavily.apiKey <key>      # engine credentials
modsearch config set cooldown off             # turn off quota cooldown failover
```

Nothing configures page fetch or X, on purpose. Fetching uses the chosen engine when that engine can fetch, and the built-in local fetcher otherwise. X has exactly one possible engine, so there is no choice to store.

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

Good insurance when agy's quota runs dry: with a key present, web search falls to Tavily on its own.

### exa (search, free monthly credit)

$10 of recurring monthly credit, about 1,400 searches, no card. Key from https://exa.ai.

```bash
modsearch config set exa.apiKey <key>
# or environment: export EXA_API_KEY=<key>
```

Exa ranks and links with highlight snippets but writes no synthesis, so its summary is mechanical and the evidence is in `items`. It sits after Tavily in the search order.

### firecrawl (search + fetch, free monthly credits)

1,000 credits a month, no card. Key from https://firecrawl.dev.

```bash
modsearch config set firecrawl.apiKey <key>
# or environment: export FIRECRAWL_API_KEY=<key>
```

Firecrawl earns its place on fetch: it runs a real browser in the cloud, so it reads JavaScript-rendered pages the local engine cannot. On a fetch it sits between agy and the `local` floor. A private or reserved target is skipped, because a cloud crawler cannot reach it, and the local engine reads it instead (the `--allow-private-network` waiver carries through). On search it sits last.

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
modsearch config set http.allowPrivateNetwork true   # make it permanent
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

- `No engine on this machine can search the web`: no search engine is set up. The message lists every fix (agy, Tavily, Exa, Firecrawl). Offer, do not insist.
- Quota errors from agy: the weekly free quota is spent. Add a keyed search engine, or wait for the reset named in the message. With cooldown on, agy is moved to the back on its own until it resets.
- `exa is out of credits` / `firecrawl is out of credits`: the keyed budget for the period is spent. Another search engine picks up the work, and cooldown moves the spent one to the back until it recovers.
- `Blocked private network target`: SSRF guard. If the user is behind a VPN, retry with `--allow-private-network`.
- Wrong engine name in config: modsearch says so in `warnings` and uses a working engine anyway. Fix the name when the user wants that engine back.
- Timeouts: retry once with `--timeout 300000` before reporting failure.
