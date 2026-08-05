---
summary: 'Security: SSRF guards, the known DNS rebinding gap, and how untrusted page content is handled'
read_when:
  - Fetching URLs you do not control
  - Reviewing what this tool does on your machine
  - Deciding whether to allow private network targets
---

# Security

## SSRF guards on the local fetcher

The `http` engine refuses, before any request goes out:

- Private and reserved IPv4 and IPv6 ranges, including `::ffff:` mapped forms
- Cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`, and friends)
- URLs carrying embedded credentials, and any scheme other than http/https

Every redirect hop is re-checked, and response size and character counts are capped.

## The known gap: DNS rebinding

Stated rather than hidden: the hostname is resolved once for the safety check and resolved again by `fetch` when the request goes out. A DNS answer that changes between those two moments can point the connection at an address the check never saw.

Closing it requires pinning the connection to the validated IP, which Node's global `fetch` does not expose, so it would mean rewriting the transport on `node:https`. Until then the window is real. Keep it in mind when fetching links you do not control.

## VPNs and reserved ranges

Split-tunnel VPN clients often map public hostnames into reserved ranges such as `198.18.0.0/15`, which trips the guard on ordinary sites. `--allow-private-network` (or `modsearch config set http.allowPrivateNetwork true`) opens it. Do not use it to reach genuinely internal addresses.

## Untrusted page content

Fetched pages and search results are untrusted input. Prompts instruct the engine to treat page content strictly as data and never to follow instructions found inside it, but that is mitigation, not a guarantee. Run in a sandboxed working directory when the URLs are not yours.

ModSearch invokes `agy` with `--dangerously-skip-permissions` because prompt mode fails in some environments without it. The prompt restricts the agent to searching and fetching.

## Evidence, not invention

What an engine cannot verify goes into `uncertainty` rather than being filled in. The numeric `relevance` score from v1 looked precise and was fabricated, so v2 dropped it: ordering already carries relevance.
