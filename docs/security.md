---
summary: 'Security: SSRF guards, DNS-rebinding protection, and how untrusted page content is handled'
read_when:
  - Fetching URLs you do not control
  - Reviewing what this tool does on your machine
  - Deciding whether to allow private network targets
---

# Security

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

Split-tunnel VPN clients often map public hostnames into reserved ranges such as `198.18.0.0/15`, which trips the guard on ordinary sites. `--allow-private-network` (or the top-level `modsearch config set allowPrivateNetwork true`) opens it for the local fetcher only: firecrawl never receives a target that is, or resolves to, a reserved address, because the switch authorizes local access, not disclosing internal hostnames to a cloud service. Do not use it to reach genuinely internal addresses.

## Untrusted page content

Fetched pages and search results are untrusted input. Prompts instruct the engine to treat page content strictly as data and never to follow instructions found inside it, but that is mitigation, not a guarantee. Run in a sandboxed working directory when the URLs are not yours.

ModSearch invokes `agy` with `--dangerously-skip-permissions` because prompt mode fails in some environments without it. The prompt restricts the agent to searching and fetching.

## Evidence, not invention

What an engine cannot verify goes into `uncertainty` rather than being filled in. The numeric `relevance` score from v1 looked precise and was fabricated, so v2 dropped it: ordering already carries relevance.
