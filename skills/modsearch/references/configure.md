# Configuring ModSearch

Read this when the user asks how to set up modsearch, wants a key added, wants a different engine, or hits a setup-related failure. Run the commands for them instead of pasting instructions.

## The mental model

Three jobs, called roles. Each role has engines that can do it:

| Role | What it does | Engines |
| :-- | :-- | :-- |
| `search` | search the public web | `antigravity-cli`, `tavily` |
| `fetch` | read one URL | `antigravity-cli`, `http` |
| `social` | search X (Twitter) | `grok-cli` |

Two facts follow from this table, and they answer most questions:

- **Page fetch always works.** The `http` engine needs nothing installed, and it is the last resort for `fetch` no matter what else is configured or broken.
- **Web search needs one engine.** Either Antigravity CLI (free, no key) or a Tavily key. With neither, `-q` explains both options instead of failing silently.

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
modsearch config show     # effective config, keys masked
```

Shape:

```json
{
  "search": { "engine": "" },
  "fetch":  { "engine": "" },
  "social": { "engine": "" },
  "engines": {
    "antigravity-cli": { "bin": "agy", "model": "gemini-3.6-flash-low" },
    "tavily":          { "apiKey": "" },
    "grok-cli":        { "bin": "grok" },
    "http":            { "allowPrivateNetwork": "false" }
  }
}
```

An empty `engine` means "use the best available one". Setting it pins that role only, and never disturbs the others.

```bash
modsearch config set search.engine tavily     # pin web search to Tavily
modsearch config set search.engine ""         # back to automatic
modsearch config set tavily.apiKey <key>      # engine credentials
```

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

### grok-cli (X, rides a SuperGrok or X Premium subscription)

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok    # the user signs in with SuperGrok or X Premium
```

Nothing else to turn on. An X-flavored query goes to X automatically once `grok` is installed and signed in. Without it, an X question is answered from the public web, and the result says so in `uncertainty`.

### http (fetch, nothing to install)

No setup. It carries SSRF guards (private ranges, cloud metadata, per-hop redirect checks, size caps) with one documented gap: DNS answers are resolved twice, so rebinding can slip past. Do not present this engine as safe for arbitrary untrusted URLs.

A VPN that maps public hosts into reserved ranges will trip those guards:

```bash
modsearch -u <url> --allow-private-network
modsearch config set http.allowPrivateNetwork true   # make it permanent
```

## Troubleshooting

- `No engine on this machine can search the web`: neither agy nor a Tavily key is set up. The message lists both fixes. Offer, do not insist.
- Quota errors from agy: the weekly free quota is spent. Add a Tavily key, or wait for the reset named in the message.
- `Blocked private network target`: SSRF guard. If the user is behind a VPN, retry with `--allow-private-network`.
- Wrong engine name in config: modsearch says so in `uncertainty` and uses a working engine anyway. Fix the name when the user wants that engine back.
- Timeouts: retry once with `--timeout 300000` before reporting failure.
