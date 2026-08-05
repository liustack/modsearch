---
summary: 'Testing Guide: Vitest usage, co-located layout, conventions'
read_when:
  - Running tests
  - Writing tests
  - Troubleshooting test failures
---

# Testing Guide

## Layout

Tests are co-located with sources: every module gets an adjacent `*.test.ts` (for example `src/search.ts` and `src/search.test.ts`, `src/providers/tavily.ts` and `src/providers/tavily.test.ts`). There is no separate `test/` directory. Vite's lib build only follows the import graph from `src/main.ts`, so test files never enter `dist/`.

## Commands

```bash
pnpm test                                   # run everything
pnpm exec vitest run src/xSource.test.ts    # run a single file
pnpm typecheck                              # tsc --noEmit, run before tests
```

## Conventions

- No network in unit tests: Tavily is mocked via `vi.mock('@tavily/core', ...)`; the agy and grok binaries are replaced with tiny shell scripts in a temp dir that echo canned envelopes.
- To fake the home directory or PATH (grok availability checks), set `process.env.HOME` / `process.env.PATH` and restore them in `afterEach`; `os.homedir()` follows `HOME` on POSIX.
- Engines with subprocess transports test `buildInvocation`/`parseOutput` as pure functions. X routing tests the whole route-and-fallback contract through `runSearch` with fake binaries.
- Real `agy`/`grok` calls are end-to-end verification, not unit tests. They consume real quota: keep them out of `pnpm test`.
