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

Firecrawl, Keenable, and You.com all search through keyless endpoints, so a bare installation has an engine. This message now means every candidate failed at runtime. Read the attempt lines for the actual causes, commonly no network, a timeout, exhausted anonymous daily limits, Keenable's hourly keyless pool running out, You.com's daily keyless allowance running out, or a configured engine's quota.

```bash
curl -fsSL https://antigravity.google/cli/install.sh | bash && agy   # then sign in
# or add a personal API quota:
modsearch config set tavily.apiKey <key>
modsearch config set exa.apiKey <key>
modsearch config set firecrawl.apiKey <key>
modsearch config set keenable.apiKey <key>
```

Page fetch (`-u`) still ends at the built-in local engine when cloud engines fail.

## Behind an HTTP proxy

```
firecrawl request failed: fetch failed; cause: getaddrinfo EAI_AGAIN api.firecrawl.dev
firecrawl does not allow keyless use from a proxy or VPN exit IP. Set a free key: modsearch config set firecrawl.apiKey <key>, or use keenable or youcom.
```

modsearch reads `http_proxy` / `https_proxy` / `no_proxy` (either case) for every engine API call and for page fetch, with no extra Node flag. The proxy has to be in the environment of the process that starts modsearch. A harness launched by a service manager, not a login shell, often lacks it, and then the attempt lines show a DNS or connection cause such as `EAI_AGAIN`, `ENOTFOUND`, or `ECONNREFUSED`. Export the variables where the harness starts, or in its service unit. Versions before 5.10.12 honored the proxy only for page fetch, so search failed on every engine with a bare `fetch failed`.

Firecrawl refuses keyless calls from IPs it reads as a VPN or a proxy. Waiting does not help: configure a free Firecrawl key, or let Keenable and You.com answer (they come next in the chain without any change).

## Quota exhausted

```
Individual quota reached. Please upgrade your subscription ... Resets in 94h19m9s.
```

agy's free tier is one weekly grant shared by the Antigravity desktop app, the CLI, and the SDK, and parallel subagents drain it faster. Three ways out:

- Wait for the reset named in the message.
- Add a keyed search engine (Tavily, Exa, Firecrawl, or Keenable). You.com has no key to add. Search then falls through to it automatically, with no further action from you.
- With cooldown on (the default), agy is remembered as spent and moved to the back of the chain until it resets, so later runs fail over first. See "An engine keeps getting skipped" below.

## agy not available in your location

```
Eligibility check failed: Your current account is not eligible for Antigravity, because it is not currently available in your location.
```

Antigravity is not offered in your region, so agy refuses every call, signed in or not. Another search engine picks up the work on its own. With cooldown on (the default), agy is held at the back of the chain for a day, so later runs stop starting it first. If agy will never work on this machine, take it out of the automatic chain for good:

```bash
modsearch config set antigravity-cli.enabled false
```

## A console window flashes on Windows

A black console window can pop up and grab focus while the `antigravity-cli` engine runs, most often right after agy updates itself. modsearch starts agy with its console hidden, and that part stays hidden. The window belongs to a helper process agy starts on its own while it finishes a self-update. That helper opens a fresh console of its own, which no setting on modsearch's side can reach. It happens most often under GUI hosts that have no console of their own, such as DSH Desktop.

The window closes by itself and does not affect results. To avoid it, move agy off the automatic chain as above. An explicit `-e antigravity-cli` still runs it when you want it.

## Exa, Firecrawl, or Keenable authentication rejected

```
exa rejected the API key (401). Fix it: modsearch config set exa.apiKey <key>
firecrawl rejected the API key (401). Fix it: modsearch config set firecrawl.apiKey <key>
keenable rejected the API key (401). Fix it: modsearch config set keenable.apiKey <key>
firecrawl rejected the keyless request (401). Anonymous access may be unavailable or rate-limited.
```

The first three messages mean a configured key is wrong or revoked. Set a valid one with the command in the message, or export `EXA_API_KEY` / `FIRECRAWL_API_KEY` / `KEENABLE_API_KEY`. With several keys configured, a rejected key rotates to the next one first. The keyless message means Firecrawl did not accept anonymous access for this request. Wait for the daily allowance to recover, configure a free key for higher limits, or use another engine. Authentication failures are not put on cooldown.

## Exa, Firecrawl, or Keenable out of credits

```
exa is out of credits: ...
firecrawl is out of credits: ...
keenable is out of credits (HTTP 402). ...
```

The current budget is spent. For Firecrawl this can be an anonymous daily allowance or an account quota. Another search engine picks up the work on its own, and with cooldown on the spent engine is moved to the back of the chain until it recovers. Add credit, switch engines, or wait for the relevant reset. Keenable's keyed allowance is 100,000 requests a month per organization, managed at https://app.keenable.ai.

## Firecrawl keyless allowance used up

```
firecrawl's keyless allowance for this IP is used up. Resets in 23h48m52s. Set a free key: modsearch config set firecrawl.apiKey <key>, or use keenable or youcom.
```

With no key, Firecrawl grants each IP a small daily allowance, shared by everyone on that IP. Once it is spent, Firecrawl says how long until it comes back, and with cooldown on modsearch moves Firecrawl to the back of the chain until then, so later runs go straight to Keenable instead of being refused first. Search and page fetch keep working. For your own allowance, set a free key from https://firecrawl.dev.

## Keenable keyless pool used up for the hour

```
keenable's keyless pool for this IP is used up for the hour (1,000 requests). Set a free key for your own quota: modsearch config set keenable.apiKey <key> ...
keenable's keyless pool for this IP is used up. Resets in 30m0s. Set a free key for your own quota: ...
```

The second form appears when Keenable says how long to wait, and the cooldown holds Keenable until exactly then. With no key, Keenable allows 1,000 requests an hour per IP, and everyone on that IP shares the pool (an office, a VPN exit, a cloud host). It also caps the pool at 10 requests a second. The next search engine in the chain picks up the work on its own. For a quota of your own, take a free key from https://app.keenable.ai: a keyed Keenable has no hourly cap and gives 100,000 requests a month.

```bash
modsearch config set keenable.apiKey <key>
# or: export KEENABLE_API_KEY=<key>
```

## You.com keyless allowance used up for the day

```
youcom's keyless allowance for this IP is used up for the day (100 searches). Search continues with the next engine.
```

You.com's keyless search allows 100 searches a day per IP, and everyone on that IP shares the allowance (an office, a VPN exit, a cloud host). The next search engine in the chain picks up the work on its own, and this error does not put You.com on cooldown. There is no key to add for a bigger allowance, so wait for the next day, or use another engine. Any other failure reads `youcom returned <status> <statusText>. <body>`.

## Tavily out of monthly quota (432/433)

```
tavily is out of monthly quota (HTTP 432). ...
```

Tavily returns 432 (plan usage cap) and 433 (PAYGO cap) when the monthly budget is spent. modsearch reads these as the monthly quota class, so with cooldown on the engine is held for a full day rather than the 45-minute default, since retrying inside the hour just re-hits the same wall. Another search engine picks up the work meanwhile. Add credit at https://app.tavily.com or wait for the monthly reset.

## An engine keeps getting skipped

modsearch is failing over around a cooldown. When an engine hit a quota wall or a region lock, it is remembered in `~/.modsearch/state.json` and tried last until it recovers, and the result's `warnings` name which engine and until when. Run `modsearch doctor` to see what is cooling and how much time is left. To clear it by hand:

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
Blocked private network target: example.com -> 10.0.0.5. If a VPN or proxy on
this machine maps public hosts into reserved ranges outside the 198.18.0.0/15
fake-IP pool, allow it with
--allow-private-network, or: modsearch config set allowPrivateNetwork true
```

```
Blocked private network target: github.com -> 127.0.0.1. If a VPN or proxy on
this machine maps public hosts into reserved ranges outside the 198.18.0.0/15
fake-IP pool, or a hosts-file accelerator (such as Watt Toolkit / Steam++) points
public domains at 127.0.0.1, allow it with
--allow-private-network, or: modsearch config set allowPrivateNetwork true
```

Proxy fake-IP mode in Clash, Clash Verge Rev, mihomo, and Surge works out of the box. DNS answers in `198.18.0.0/15` are treated as fake-IP placeholders and need no `allowPrivateNetwork` switch. This applies only to DNS answers. A literal URL such as `http://198.18.0.5/` is still blocked when the switch is off.

The SSRF guard refused a private or reserved address. Three possible causes:

- **A VPN or proxy** mapping public hostnames into other reserved ranges, such as `10.0.0.0/8`. This can happen with split-tunnel clients. Allow it with the flag or the config setting above.
- **A hosts-file accelerator** such as Watt Toolkit / Steam++. It writes public domains into the hosts file pointing at `127.0.0.1`, and a local process listens on 443 and forwards. Allow it with `modsearch config set allowPrivateNetwork true`. After allowing, modsearch automatically trusts the OS certificate store on Node 22.15+, so a certificate issued by the proxy's locally installed CA can verify. Node 22.13 and 22.14 cannot read the OS store through this API, so upgrade to 22.15+. To enable system CAs for the whole Node process, `NODE_OPTIONS=--use-system-ca` is available on Node 22.15+, while `NODE_USE_SYSTEM_CA=1` requires Node 22.19+ or 24.6+. Firecrawl is a cloud engine and cannot reach loopback on this machine. This case only works with the local engine.
- **A genuinely internal address**, which is exactly what the guard exists for. Do not disable the guard to reach it.

## A cloud engine would not fetch a private target

```
firecrawl does not fetch the private or reserved target intranet.example. Use the local engine instead.
keenable does not fetch the private or reserved target 10.0.0.5. Use the local engine instead.
```

Firecrawl and Keenable read pages on their own servers, so modsearch never sends them a URL that points inside your network. A literal private or reserved address is refused outright. A hostname is refused only when every address it resolves to is private or reserved (the `198.18.0.0/15` fake-IP pool of Clash, Surge, and mihomo does not count). In automatic mode the next engine in the chain takes over and the built-in local engine ends up reading the page. Only a forced `-e firecrawl` or `-e keenable` errors out. `allowPrivateNetwork` does not change this, because it opens private ranges for the local fetcher only.

## Page came back nearly empty

The local engine runs no JavaScript. A page rendered entirely client-side has almost nothing in its HTML, and the result says so in `uncertainty`. Keenable's cloud reader may come back sparse for the same reason (its docs do not say whether it runs JavaScript). Options: fetch it through agy instead (`-e antigravity-cli`), or find a server-rendered URL for the same content.

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

```
Failed to read the project config /path/to/repo/.modsearch/config.json: ... Fix or delete the file.
The project config /path/to/repo/.modsearch/config.json is not a JSON object. Fix or delete the file.
```

A `.modsearch/config.json` found in the current directory or above it is unreadable, not valid JSON, or not a JSON object. Unlike the global file, it fails the run, so a repository's settings never get half-applied. Fix or delete it. To skip the lookup, set `MODSEARCH_PROJECT_CONFIG=off`. `modsearch doctor` names the file in its `project:` line.

```
modsearch: ignored engines.tavily.apiKey, engines.tavily.bin in /path/to/repo/.modsearch/config.json. A project config may set only engine, engines.<name>.enabled false, and engines.<name>.model. ...
```

Not an error. The project file set things a project may not set, so they were left out. The line names paths, never values. Keys, `bin`, `baseURL`, `keylessFetch`, `cooldown`, and `allowPrivateNetwork` belong in `~/.modsearch/config.json`. A project's `engine` that names an engine not set up here (Tavily with no key, say) is skipped with a note, and so is a cloud engine whose `keylessFetch` you turned off.

## Timeouts

```
antigravity-cli engine timed out after 210000 ms.
```

Retry once with `--timeout 300000`. If it still times out, the engine is stuck rather than slow: check `agy` interactively. Engines that ignore SIGTERM are escalated to SIGKILL, so a timeout always returns promptly even when the process does not cooperate.

```
firecrawl: skipped: the run deadline of 55000 ms was used up before it could start.
```

The run was started with `--deadline` (the dsh plugin always passes one) and the engines before this one used up the whole budget, so it never ran. Usually the first engine was slow. Lower `--timeout` so one engine cannot take the whole budget, or raise `--deadline` if the caller can wait longer. In dsh these are `providerTimeoutMs` and `providerDeadlineMs`, see [the dsh doc](dsh.md#configure-the-dsh-plugin).

## Grok Build stopped before searching X

```
Grok Build stopped before searching X (placeholder result). Retry, or update Grok Build.
```

Grok Build ended before it called its X search tools, and returned empty items plus placeholder wording such as "正在检索…". Older modsearch passed `--json-schema`, which cut Grok Build's search loop, so every run came back as a placeholder. Current modsearch omits that flag and reads the result from the final message.

Retry the search. If it keeps happening, update Grok Build (`grok` CLI).

## modsearch refused to run (recursion guard)

```
modsearch refused to run: it was started from inside an engine that modsearch itself spawned (recursion guard). An engine such as Grok Build tried to call modsearch instead of using its own search tools.
```

modsearch started an engine, and that engine tried to launch modsearch again. The CLI stops this loop rather than spend another round of quota.

This is not a config problem. grok-cli already denies the tools that would shell out. Retry the search. If it keeps happening, update Grok Build (`grok` CLI).

## Everything failed

```
Every engine for the web source failed.
  - antigravity-cli: ...
  - tavily: ...
```

Each engine's own failure is listed in order. Act on the first fixable one, usually a quota or a key.

## Still stuck

Re-run with the failing command exactly as modsearch printed it, and include that output in an issue: https://github.com/liustack/modsearch/issues
