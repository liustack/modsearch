# ModSearch evals (v1)

A small, honest harness for checking that modsearch behaves against the real
world, not just against mocks. Unit tests stay offline and prove the routing and
parsing logic. These evals run the built CLI end to end, so they exercise the
actual engines, the network, and the SSRF guard, and they leave behind an
evidence trail you can read later.

Run them locally, on demand. They are **not** in CI: most cases spend real
engine quota, and results depend on what is installed on the machine.

```bash
pnpm build   # evals run the built dist/main.js
pnpm eval
```

The runner reads `modsearch doctor --json` first and skips any case whose engine
is not set up here. The SSRF case needs nothing and always runs.

## Layout

```
evals/
├── README.md            # this file
├── run.mjs              # the runner: run cases, write artifacts, print a summary
├── cases/               # one file per case, each exporting a default case object
└── results/<date>/      # evidence artifacts, one JSON per case (gitignored)
```

## A case

Each file in `cases/` default-exports one object:

| Field | Meaning |
| :-- | :-- |
| `id` | Short slug, also the artifact filename |
| `title` | One line describing what is being checked |
| `requirement` | `none`, `fetch`, `search`, or `search-no-social`. Decides when the case is skipped |
| `args` | The CLI arguments, e.g. `['-q', 'current Node.js LTS version']` |
| `expectError` | `true` when a non-zero exit is the expected outcome (the SSRF case) |
| `expectation` | Plain-language statement of what a correct run looks like |
| `check(result, run)` | Returns `{ pass, detail }`. For `expectError` cases it receives the raw `run` (`{ stdout, stderr, code }`), otherwise the parsed result envelope, plus `run` |

`requirement` semantics:

- `none` — no engine, no network, no quota. Always runs (SSRF).
- `fetch` — uses the built-in local engine, so it always runs, but it needs
  network. A network failure is recorded as a fail with the error.
- `search` — runs only when a search engine (agy or a Tavily key) is set up.
- `search-no-social` — runs only when search is set up **and** Grok is not, since
  the point is to observe the degrade. Skipped where Grok is signed in.

## The evidence artifact

One JSON per case, written to `results/<date>/<id>.json`. It is the record you
can come back to and trust, capturing:

- `command` and `runAt` — exactly what ran, and when.
- `tool` — `{ version, commit }`, so a result is tied to a build.
- `requirement`, `expectation` — what was being checked and the bar for passing.
- `query` / `url` — the request the CLI parsed.
- `pass`, `detail`, `exitCode` — the scored outcome.
- `engine`, `model`, `status` — who answered and how well.
- `uncertainty`, `warnings`, `attempts` — the three result channels, carried
  straight through so degrades and fallbacks are visible.
- `latencyMs` (measured wall time) and `metaDurationSeconds` (the CLI's own
  figure). `tokens` is a placeholder: the CLI envelope does not surface usage
  today, so it stays `null` until it does.
- `rawStdout`, `rawStderr` — the unedited output, so nothing is taken on trust.

A skipped case writes a short artifact with `skipped: true` and the reason.

## Seed cases

| Case | What it proves |
| :-- | :-- |
| `ssrf-localhost` | A `localhost` URL is refused before any request goes out. Always runs |
| `fetch-readme` | A real page (this repo's README) reads back with content |
| `search-timely` | A time-sensitive answer carries a date and a source link |
| `x-degrade` | With no Grok, an X query is answered by the web and says so |
| `js-render` | A client-rendered page comes back thin and the result flags it |
| `search-exa` | A forced `-e exa` search returns ranked results with links (when exa is keyed) |
| `fetch-firecrawl` | A forced `-e firecrawl` fetch reads a page as markdown (when firecrawl is keyed) |

`search-exa` and `fetch-firecrawl` force one specific engine. The runner has no per-engine skip, so when that engine is not keyed on the machine the forced run errors on the missing key, and the case's own check treats that as "not exercised" (a pass with a note) rather than a red, so a normal `pnpm eval` run stays green. They only exercise the engine when its key is present.

## Adding a case

Drop a new `cases/<id>.mjs` exporting a case object. Keep the assertion
structural (shape, presence of links and dates, a status, a warning), not an
exact-string match on a synthesized summary: models phrase things differently
run to run.
