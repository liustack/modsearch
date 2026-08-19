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
  Environment variables (`TAVILY_API_KEY`, `EXA_API_KEY`, `FIRECRAWL_API_KEY`)
  work as an alternative to the file and are never written to disk.

## SSRF guards on the local fetcher

The `local` engine refuses, before any request goes out:

- Private and reserved IPv4 and IPv6 ranges, including `::ffff:` mapped forms
- Cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`, and friends)
- URLs carrying embedded credentials, and any scheme other than http/https

Every redirect hop is re-checked, and response size and character counts are capped.

## DNS rebinding is closed

The safety check resolves the hostname, validates every address it maps to, and then returns the exact IP it approved. The connection is pinned to that IP through an `undici` dispatcher with a custom lookup, so the socket goes to the address the check saw and nothing else. A DNS answer that changes between the check and the connect can no longer swap in an address the guard never inspected. The Host header and TLS SNI still carry the original hostname, so ordinary sites work unchanged. Every redirect hop repeats the check and re-pins to the new target.

The pin is IP-level, not port-level, and only the local engine is affected. The engine-driven fetch (agy) runs in its own sandbox and is out of scope here.

## VPNs and reserved ranges

Firecrawl public-page fetch is a cloud boundary: the URL of a public page is sent to Firecrawl's service, which reads it with a cloud browser. This is on by default (it is what makes a bare install fetch JavaScript pages), and every cloud-fetched result carries a warning naming the route. To keep automatic page fetch local-only, run `modsearch config set firecrawl.keylessFetch false`; a configured Firecrawl key or an explicit Firecrawl engine choice still enables it. Private and reserved targets never go to the cloud in any configuration, as described below.

Split-tunnel VPN clients often map public hostnames into reserved ranges such as `198.18.0.0/15`, which trips the guard on ordinary sites. `--allow-private-network` (or the top-level `modsearch config set allowPrivateNetwork true`) opens it for the local fetcher only: firecrawl never receives a target that is, or resolves to, a reserved address, because the switch authorizes local access, not disclosing internal hostnames to a cloud service. Do not use it to reach genuinely internal addresses.

## Untrusted page content

Fetched pages and search results are untrusted input. Prompts instruct the engine to treat page content strictly as data and never to follow instructions found inside it, but that is mitigation, not a guarantee. Run in a sandboxed working directory when the URLs are not yours.

ModSearch invokes `agy` with `--dangerously-skip-permissions` because prompt mode fails in some environments without it. The prompt restricts the agent to searching and fetching.

## Evidence, not invention

What an engine cannot verify goes into `uncertainty` rather than being filled in. The numeric `relevance` score from v1 looked precise and was fabricated, so v2 dropped it: ordering already carries relevance.
