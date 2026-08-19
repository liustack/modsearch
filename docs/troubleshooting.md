---
summary: 'Troubleshooting: every error modsearch can print, what causes it, what to do'
read_when:
  - A run failed and the message is not self-explanatory
  - Results came back from an engine you did not expect
  - Deciding whether a failure is setup, quota, or a bug
---

# Troubleshooting

English | [简体中文](troubleshooting.zh-CN.md)

Every message below is one modsearch actually prints. Search this file for the words you saw.

## First: run `modsearch doctor`

Before decoding a message, run `modsearch doctor`. It reports your Node version, every engine's readiness per role and why (binary on PATH, key from env or file, Grok login file present), where your config comes from, its file permissions, and the private-network state, all without spending quota or making a request. Missing pieces come with a copyable fix command. Most setup problems are visible there at a glance. Add `--json` to feed the report to a tool.

## Every search engine failed

```
Every engine for the web source failed.
  - firecrawl: ...
```

Firecrawl closes the normal search chain with a keyless endpoint, so a bare installation has an engine. This message now means every candidate failed at runtime. Read the attempt lines for the actual causes, commonly no network, a timeout, exhausted anonymous daily limits, or a configured engine's quota.

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash && agy   # then sign in
# or add a personal API quota:
modsearch config set tavily.apiKey <key>
modsearch config set exa.apiKey <key>
modsearch config set firecrawl.apiKey <key>
```

Page fetch (`-u`) still ends at the built-in local engine when cloud engines fail.

## Quota exhausted

```
Individual quota reached. Please upgrade your subscription ... Resets in 94h19m9s.
```

agy's free tier is one weekly grant shared by the Antigravity desktop app, the CLI, and the SDK, and parallel subagents drain it faster. Three ways out:

- Wait for the reset named in the message.
- Add a keyed search engine (Tavily, Exa, or Firecrawl). Search then falls through to it automatically, with no further action from you.
- With cooldown on (the default), agy is remembered as spent and moved to the back of the chain until it resets, so later runs fail over first. See "An engine keeps getting skipped" below.

## Exa or Firecrawl authentication rejected

```
exa rejected the API key (401). Fix it: modsearch config set exa.apiKey <key>
firecrawl rejected the API key (401). Fix it: modsearch config set firecrawl.apiKey <key>
firecrawl rejected the keyless request (401). Anonymous access may be unavailable or rate-limited.
```

The first two messages mean a configured key is wrong or revoked. Set a valid one with the command in the message, or export `EXA_API_KEY` / `FIRECRAWL_API_KEY`. The keyless message means Firecrawl did not accept anonymous access for this request. Wait for the daily allowance to recover, configure a free key for higher limits, or use another engine. Authentication failures are not put on cooldown.

## Exa or Firecrawl out of credits

```
exa is out of credits: ...
firecrawl is out of credits: ...
```

The current budget is spent. For Firecrawl this can be an anonymous daily allowance or an account quota. Another search engine picks up the work on its own, and with cooldown on the spent engine is moved to the back of the chain until it recovers. Add credit, switch engines, or wait for the relevant reset.

## Tavily out of monthly quota (432/433)

```
tavily is out of monthly quota (HTTP 432). ...
```

Tavily returns 432 (plan usage cap) and 433 (PAYGO cap) when the monthly budget is spent. modsearch reads these as the monthly quota class, so with cooldown on the engine is held for a full day rather than the 45-minute default, since retrying inside the hour just re-hits the same wall. Another search engine picks up the work meanwhile. Add credit at https://app.tavily.com or wait for the monthly reset.

## An engine keeps getting skipped

modsearch is failing over around a cooldown. When an engine hit a quota wall, it is remembered in `~/.modsearch/state.json` and tried last until it recovers, and the result's `warnings` name which engine and until when. Run `modsearch doctor` to see what is cooling and how much time is left. To clear it by hand:

```bash
modsearch state clear
```

To turn the behavior off entirely, so routing is exactly as it was before: `modsearch config set cooldown off`. A cooling engine is never removed, only reordered, so it is still tried when everything else fails.

## The wrong engine answered

Read `results[].engine` in the output. Engines are chosen per run from what is installed, so this is usually correct rather than broken:

- Expected agy, got `tavily`: agy failed or is unavailable, and Tavily picked up the work. The `warnings` list names the fallback and `attempts` carries agy's exact failure.
- Expected agy, got `local` on a fetch: same story, and the page came back as served with no summary or focus narrowing (`warnings` says so).
- Asked about X, got `antigravity-cli` or `tavily`: Grok Build is missing or signed out, so this is second-hand web evidence. The `warnings` list says so explicitly.

Force one engine with `-e <name>` when you need to be sure.

## Blocked private network target

```
Blocked private network target: example.com -> 198.18.91.58. If a VPN or proxy on
this machine maps public hosts into reserved ranges, allow it with
--allow-private-network, or: modsearch config set allowPrivateNetwork true
```

The SSRF guard refused an address in a reserved range. Two very different causes:

- **A VPN or proxy** mapping public hostnames into ranges like `198.18.0.0/15`. Common with split-tunnel clients. Allow it with the flag or the config setting above.
- **A genuinely internal address**, which is exactly what the guard exists for. Do not disable the guard to reach it.

## Page came back nearly empty

The local engine runs no JavaScript. A page rendered entirely client-side has almost nothing in its HTML, and the result says so in `uncertainty`. Options: fetch it through agy instead (`-e antigravity-cli`), or find a server-rendered URL for the same content.

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

The file exists but cannot be read. A missing file is fine (that is the zero-config path), so this is a real permissions or file-type problem worth fixing rather than something to ignore. On Windows the file lives at `%USERPROFILE%\.modsearch\config.json`.

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
