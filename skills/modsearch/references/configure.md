# Configuring ModSearch

Read this when the user asks how to set up modsearch, wants to add a key, switch engines, or asks why a run failed for setup reasons. Run the commands for them instead of pasting instructions.

## Where config lives

`~/.modsearch/config.json`, written with 0600 permissions and printed with keys masked.

Precedence: CLI flags > environment variables > this file > built-in defaults.

```bash
modsearch config init     # write a starter file
modsearch config show     # effective config, keys masked
```

## What each engine can do

| Engine | Search (`-q`) | Fetch (`-u`) | Needs |
| :-- | :-- | :-- | :-- |
| `antigravity-cli` (default) | yes | yes | `agy` installed and signed in, no key |
| `tavily` | yes | no | a Tavily key |
| `grok-cli` | X posts only | no | Grok Build installed and signed in |

Page fetch only exists on `antigravity-cli` today. If the user has no agy and asks you to read a URL, say that plainly: fetching is not available with their current setup, and offer to search instead. Do not tell them they must install agy unless they ask how to enable fetching.

## Engine setup

### antigravity-cli (default, free, no key)

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash
agy    # the user completes a browser sign-in, then exits
```

Sign-in cannot be done non-interactively: ask the user to run `agy` once themselves. Its free tier is a weekly quota shared with the Antigravity desktop app and SDK, so heavy days can exhaust it. When they do, the error says so and the fix is to wait for the reset or use another engine.

```bash
modsearch config set antigravity-cli.model gemini-3.1-pro-high   # harder research questions
modsearch config set antigravity-cli.bin /custom/path/to/agy
```

### tavily (search only, free tier)

Free tier is 1,000 credits a month with no credit card, and a basic search costs one credit. Key from https://app.tavily.com.

```bash
modsearch config set tavily.apiKey <key>
# or environment: export TAVILY_API_KEY=<key>
modsearch -q "<query>" -p tavily
```

Good backup when agy's quota is spent. It cannot fetch pages.

### grok-cli (X/Twitter, rides a SuperGrok or X Premium subscription)

```bash
curl -fsSL https://x.ai/cli/install.sh | bash
grok    # the user signs in with SuperGrok or X Premium
modsearch config set grok-cli.bin /custom/path/to/grok
```

No modsearch setting turns this on: X-flavored queries route here automatically once `grok` is installed and signed in. `--x` forces the route, `--no-x` keeps it off.

## Pinning an engine

Leave `provider` empty to keep routing (X queries to `grok-cli`, everything else to `antigravity-cli`). Set it to pin one engine and turn routing off.

```bash
modsearch config set provider tavily   # pin
modsearch config set provider ""       # back to routing
```

Pinning a search-only engine means `-u` page fetch stops working. Say so before pinning if the user fetches pages.

## Troubleshooting

- `Provider CLI not found: agy`: Antigravity CLI is not installed, or `antigravity-cli.bin` points somewhere wrong.
- Quota errors from agy: the weekly free quota is spent. Wait for the reset in the message, or switch to `tavily` for search.
- `does not support page fetch`: the selected engine only searches. The message lists what else is set up here. Do not push agy on a user who has not asked for fetching.
- `The tavily engine needs an API key`: set it with the command above.
- Timeouts: retry once with `--timeout 300000` before reporting failure.
