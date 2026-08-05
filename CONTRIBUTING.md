# Contributing to ModSearch

Thanks for helping. This is a small, focused CLI, so the bar is simple: keep it
correct, keep it offline in tests, and keep commits atomic.

## Getting set up

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # vite lib build to dist/
```

Requires Node 18+ (macOS or Linux). Run all four before opening a pull request.

## Tests never go online

Unit tests must not touch the network. Tavily is mocked, the `agy` and `grok`
binaries are replaced with tiny shell scripts that echo canned envelopes, and a
page fetch runs against a loopback server from `startLocalPage` in
`src/testing/helpers.ts`. Real `agy`/`grok` calls spend the user's quota and are
end-to-end checks, not unit tests, so they stay out of `pnpm test`. See
`docs/testing.md`.

Tests are co-located: every module has an adjacent `*.test.ts`. Add or update a
test in the same commit as any behavior change.

## Commits

Follow `docs/commit.md`: Conventional Commits, one change per commit, imperative
summary under 72 characters, no trailing period. Do not mix a pure refactor or
formatting pass with a behavior change.

## Before you open a PR

- `pnpm typecheck && pnpm test && pnpm build` all green.
- Lint clean: `pnpm lint` (Biome).
- New behavior comes with a test; a bug fix comes with the test that was red.
- The architecture lives in `AGENTS.md` if you need the lay of the land.

## Security

Please do not file security issues in public. See `SECURITY.md`.
