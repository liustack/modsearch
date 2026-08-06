---
summary: 'Troubleshooting: every error modsearch can print, what causes it, what to do'
read_when:
  - A run failed and the message is not self-explanatory
  - Results came back from an engine you did not expect
  - Deciding whether a failure is setup, quota, or a bug
---

# Troubleshooting

Every message below is one modsearch actually prints. Search this file for the words you saw.

## First: run `modsearch doctor`

Before decoding a message, run `modsearch doctor`. It reports your Node version, every engine's readiness per role and why (binary on PATH, key from env or file, Grok login file present), where your config comes from, its file permissions, and the private-network state, all without spending quota or making a request. Missing pieces come with a copyable fix command. Most setup problems are visible there at a glance. Add `--json` to feed the report to a tool.

## Nothing can search

```
No engine on this machine can search the web. Any one of these enables it:
  - antigravity-cli: install Antigravity CLI and sign in once (free, no key)
  - tavily: set a Tavily key (free tier: 1,000 credits/month, no card)
```

Neither search engine is set up. Both fixes are listed because both are real: agy needs no key but has a weekly quota, Tavily needs a key but has its own budget.

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash && agy   # then sign in
# or
modsearch config set tavily.apiKey <key>
```

Page fetch (`-u`) is unaffected by this: it always works.

## Quota exhausted

```
Individual quota reached. Please upgrade your subscription ... Resets in 94h19m9s.
```

agy's free tier is one weekly grant shared by the Antigravity desktop app, the CLI, and the SDK, and parallel subagents drain it faster. Two ways out:

- Wait for the reset named in the message.
- Add a Tavily key. Search then falls through to it automatically, with no further action from you.

## The wrong engine answered

Read `results[].engine` in the output. Engines are chosen per run from what is installed, so this is usually correct rather than broken:

- Expected agy, got `tavily`: agy failed or is unavailable, and Tavily picked up the work. The `warnings` list names the fallback and `attempts` carries agy's exact failure.
- Expected agy, got `http` on a fetch: same story, and the page came back as served with no summary or focus narrowing (`warnings` says so).
- Asked about X, got `antigravity-cli` or `tavily`: Grok Build is missing or signed out, so this is second-hand web evidence. The `warnings` list says so explicitly.

Force one engine with `-e <name>` when you need to be sure.

## Blocked private network target

```
Blocked private network target: example.com -> 198.18.91.58. If a VPN or proxy on
this machine maps public hosts into reserved ranges, allow it with
--allow-private-network, or: modsearch config set http.allowPrivateNetwork true
```

The SSRF guard refused an address in a reserved range. Two very different causes:

- **A VPN or proxy** mapping public hostnames into ranges like `198.18.0.0/15`. Common with split-tunnel clients. Allow it with the flag or the config setting above.
- **A genuinely internal address**, which is exactly what the guard exists for. Do not disable the guard to reach it.

## Page came back nearly empty

The local `http` engine runs no JavaScript. A page rendered entirely client-side has almost nothing in its HTML, and the result says so in `uncertainty`. Options: fetch it through agy instead (`-e antigravity-cli`), or find a server-rendered URL for the same content.

## A forced engine that cannot run

`-e`/`--engine` is a hard force: it uses exactly that engine, with no fallback. When the forced engine is a typo, cannot do the job, or fails at runtime, the run errors rather than quietly switching to another engine and spending its quota.

```
Unknown engine "tavil" (--engine). Drop -e to let modsearch pick one that works, or name a known engine: ...
```

A typo. Fix the spelling, or drop `-e` to let modsearch choose automatically.

```
The tavily engine cannot fetch (--engine forces it with no fallback). Drop -e to let modsearch pick an engine that can. ...
```

You forced a search-only engine to read a page. Drop `-e` and let modsearch route, or force `-e antigravity-cli` (which can fetch).

## Config file problems

```
Cannot read /Users/you/.modsearch/config.json: EACCES ... Fix the file or its permissions.
```

The file exists but cannot be read. A missing file is fine (that is the zero-config path), so this is a real permissions or file-type problem worth fixing rather than something to ignore.

```
Failed to parse ... Fix or delete the file.
```

Invalid JSON. `modsearch config init --force` rewrites a clean one, losing whatever was in it.

## Timeouts

```
antigravity-cli engine timed out after 210000 ms.
```

Retry once with `--timeout 300000`. If it still times out, the engine is stuck rather than slow: check `agy` interactively. Engines that ignore SIGTERM are escalated to SIGKILL, so a timeout always returns promptly even when the process does not cooperate.

## Everything failed

```
Every engine for the web source failed.
  - antigravity-cli: ...
  - tavily: ...
```

Each engine's own failure is listed in order. Act on the first fixable one, usually a quota or a key.

## Still stuck

Re-run with the failing command exactly as modsearch printed it, and include that output in an issue: https://github.com/liustack/modsearch/issues
