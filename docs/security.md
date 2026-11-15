---
summary: 'Security: SSRF guards, DNS-rebinding protection, and how untrusted page content is handled'
read_when:
  - Fetching URLs you do not control
  - Reviewing what this tool does on your machine
  - Deciding whether to allow private network targets
---

# Security

English | [简体中文](security.zh-CN.md)

## How your API keys are stored and protected

- Keys live in `~/.modsearch/config.json`, written with mode 0600 in a 0700
  directory. `modsearch doctor` judges the file's permissions and prints the
  exact `chmod` fix when they are too open (the check is skipped on Windows,
  where POSIX modes do not apply).
- `modsearch config set <engine>.apiKey` with no value prompts with the echo
  muted (or reads one line from a pipe), so the key never enters argv, shell
  history, or an agent conversation's transcript.
- `config show` is safe to paste into an issue: keys are masked in their own
  field, scrubbed from every other string in the view, URL credentials are
  masked through a real URL parser, and token-shaped strings (`sk-...`,
  `api_key=...`) are removed even when nothing declared them as a key. The one
  honest limit: a secret with no recognizable shape that lives only in a
  non-secret field (say, a bare token pasted into `model`) cannot be told
  apart from data, so do not store secrets in fields that are not `apiKey`.
- Error messages that quote foreign text (gateway error bodies, subprocess
  stderr) pass through a shared redactor before reaching terminals, the JSON
  output's `attempts` and `warnings`, or the cooldown state file.
- There is no keychain or credential-manager integration, and no encryption at
  rest: the protection is file permissions plus the output boundaries above.
  Environment variables (`TAVILY_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`,
  `KEENABLE_API_KEY`) work as an alternative to the file and are never written to disk.
  You.com search has no key at all, so nothing of yours is stored for it.

## Outbound hosts for the HTTP engines

The HTTP search engines call only their own official hosts, unless a `baseURL` override says otherwise: `api.tavily.com`, `api.exa.ai`, `api.firecrawl.dev`, `api.keenable.ai`, and `api.you.com`. The You.com engine sends your search query to `api.you.com` with no key and no account. It has no `baseURL` setting.

## SSRF guards on the local fetcher

The `local` engine refuses, before any request goes out:

- Private and reserved IPv4 and IPv6 ranges, including `::ffff:` mapped forms, with the DNS fake-IP exception described below
- Cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`, and friends)
- URLs carrying embedded credentials, and any scheme other than http/https

Every redirect hop is re-checked, and response size and character counts are capped.

## DNS rebinding is closed

The safety check resolves the hostname, validates every address it maps to, and then returns the exact IP it approved. On the direct path, the connection is pinned to that IP through an `undici` dispatcher with a custom lookup, so the socket goes to the address the check saw and nothing else. A DNS answer that changes between the check and the connect can no longer swap in an address the guard never inspected. The Host header and TLS SNI still carry the original hostname, so ordinary sites work unchanged. Every redirect hop repeats the check and re-pins to the new target.

When the local fetcher uses the system HTTP proxy (`http_proxy` / `https_proxy`), IP pinning does not apply. The proxy resolves the hostname, and the socket connects to the proxy rather than to a checked IP. The preflight `assertSafeRemoteTarget` check still runs on every hop, including when proxied.

The pin is IP-level, not port-level, and only the local engine is affected. The engine-driven fetch (agy) runs in its own sandbox and is out of scope here.

## VPNs and reserved ranges

Public-page fetch through Firecrawl or Keenable is a cloud boundary: the URL of a public page is sent to that service, which reads it in the cloud (Firecrawl with a cloud browser, Keenable with its cloud reader). Both are on by default (Firecrawl is what makes a bare install fetch JavaScript pages), and every cloud-fetched result carries a warning naming the route. To keep automatic page fetch local-only, turn off both: `modsearch config set firecrawl.keylessFetch false` and `modsearch config set keenable.keylessFetch false`. A configured key for that engine, or choosing that engine in your own global config, still enables it. When `-u` comes with `-q`, Keenable also receives the focus text as its `prompt`. Literal private and reserved targets never go to the cloud in any configuration. DNS-derived addresses follow the narrower disclosure rule below.

Proxy fake-IP mode in Clash, Clash Verge Rev, mihomo, and Surge works out of the box. Both the local guard and the cloud-disclosure check shared by Firecrawl and Keenable treat DNS answers in `198.18.0.0/15` as proxy fake-IP placeholders, so no `allowPrivateNetwork` switch is needed. The local socket stays pinned to the checked fake IP, and the Host header and TLS SNI keep the hostname. This exemption applies only to DNS answers. A literal URL such as `http://198.18.0.5/` stays blocked when `allowPrivateNetwork` is off and never goes to a cloud engine.

Split-tunnel VPNs that map public hostnames into other reserved ranges, and hosts-file accelerators such as Watt Toolkit / Steam++ that map them to loopback, still need `--allow-private-network` or the top-level `modsearch config set allowPrivateNetwork true`. This switch opens those addresses for the local fetcher only. When it is on, the local fetcher also trusts the OS certificate store, so it can accept a certificate issued by a local forwarding proxy's installed CA. It does not authorize cloud disclosure. Do not use it to reach genuinely internal addresses.

A cloud engine withholds a hostname only when every resolved address is private or reserved after the fake-IP exemption. Any public or fake-IP answer allows the public URL to be sent. The local guard still blocks a hostname if any other DNS answer is private or reserved, even alongside a fake-IP or public answer.

## Project config is a trust boundary

A project directory can be someone else's clone, so a `.modsearch/config.json` in it is not trusted the way your own `~/.modsearch/config.json` is. modsearch reads it (walking up from the current directory, stopping at your home directory) but lets it only narrow: pick the preferred search engine, switch an engine off, or set an engine's model. Keys, `bin`, `baseURL`, `keylessFetch`, `cooldown`, `allowPrivateNetwork`, and `enabled: true` are ignored and reported by path on stderr, in `modsearch doctor`, and in `modsearch config show`. Otherwise a `bin` would run any program of the repository's choosing, and a `baseURL` would send your key to any host. A project's `engine` is also not consent to cloud fetch: it cannot turn back on a cloud engine whose `keylessFetch` you switched off. `MODSEARCH_PROJECT_CONFIG=off` disables the lookup.

## Untrusted page content

Fetched pages and search results are untrusted input. Prompts instruct the engine to treat page content strictly as data and never to follow instructions found inside it, but that is mitigation, not a guarantee. Run in a sandboxed working directory when the URLs are not yours.

ModSearch invokes `agy` with `--dangerously-skip-permissions` because prompt mode fails in some environments without it. The prompt restricts the agent to searching and fetching.

## Evidence, not invention

What an engine cannot verify goes into `uncertainty` rather than being filled in. The numeric `relevance` score from v1 looked precise and was fabricated, so v2 dropped it: ordering already carries relevance.
