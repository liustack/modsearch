# Contributing to ModSearch

First, the policy: **ModSearch does not accept pull requests.** It is a
deliberately small tool with a single maintainer who reviews and owns every
line, and keeping that loop tight is what keeps it dependable.

Two contributions that genuinely help:

- **[Open an issue](https://github.com/liustack/modsearch/issues).** Bugs,
  ideas, a confusing error message, docs that read wrong. Issues get read and
  drive what gets built. The templates tell you what to include.
- **Fork it.** The MIT license means your copy is fully yours: rename it,
  rewire it, publish it. No permission needed.

Everything below is for people working on a fork.

## Getting set up

```bash
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # vite lib build to dist/
pnpm lint        # Biome
```

Requires Node 18+ (macOS or Linux).

## Tests never go online

Unit tests must not touch the network. Tavily is mocked, the `agy` and `grok`
binaries are replaced with tiny shell scripts that echo canned envelopes, and a
page fetch runs against a loopback server from `startLocalPage` in
`src/testing/helpers.ts`. Real `agy`/`grok` calls spend quota and are
end-to-end checks, not unit tests, so they stay out of `pnpm test`. See
`docs/testing.md`.

Tests are co-located: modules have an adjacent `*.test.ts`. Add or update a
test in the same commit as any behavior change.

## Commits

Follow `docs/commit.md`: Conventional Commits, one change per commit, imperative
summary under 72 characters, no trailing period. Do not mix a pure refactor or
formatting pass with a behavior change.

The architecture lives in `AGENTS.md` if you need the lay of the land.
