---
name: Bug report
about: A command failed, or an engine returned something wrong
title: ""
labels: bug
assignees: ""
---

<!--
docs/troubleshooting.md catalogs every error this CLI prints, with its cause and
fix. Please check it first: most messages already name the fix.
-->

## What happened

A clear description of the problem.

## The exact command

Paste the command you ran, verbatim (redact any API keys):

```bash
modsearch ...
```

## The complete error or output

Paste the full stderr/stdout, not a paraphrase. Include the `Known engines:`
line the CLI prints, and `results[].engine` from the JSON when a run succeeded
but answered wrong.

```
(full output here)
```

## Environment

- `modsearch --version`:
- Node version (`node --version`):
- OS (macOS / Linux + version):
- Which engine you expected (agy / tavily / grok-cli / http):

## Anything else

Config (with keys masked, from `modsearch config show`), whether a VPN or proxy
is active, or anything else that might matter.

---

Not sure it is a bug, or just want to talk it through? Find me on X: [@liustack](https://x.com/liustack).
