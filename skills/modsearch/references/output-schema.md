# ModSearch Output Schema

English | [简体中文](output-schema.zh-CN.md)

The CLI prints one JSON object to stdout. The top-level envelope is the same for
every run:

```json
{
  "mode": "search",
  "query": "current Node.js LTS",
  "url": null,
  "results": [
    {
      "source": "web",
      "requestedSource": "web",
      "engine": "antigravity-cli",
      "model": "gemini-3.6-flash-low",
      "status": "ok",
      "durationSeconds": 5.5,
      "summary": "The current Node.js LTS is v24.19.0 (Krypton), released 2026-08-03.",
      "items": [
        {
          "title": "Node.js v24.19.0 release",
          "url": "https://nodejs.org/en/blog/release/v24.19.0",
          "snippet": "Krypton is the active LTS line.",
          "source": "nodejs.org",
          "published_at": "2026-08-03"
        }
      ],
      "uncertainty": [],
      "warnings": [],
      "attempts": [
        { "engine": "antigravity-cli", "ok": true, "durationSeconds": 5.5 }
      ]
    }
  ],
  "meta": {
    "generatedAt": "2026-08-06T12:00:00.000Z",
    "durationSeconds": 5.6
  }
}
```

Key points:

- `results` is always an array, one entry per source, so the shape never changes
  even for a single-source run.
- `meta` carries only when the run finished and how long the whole run took.
  Per-source timing, the engine, and the model live inside each `results` entry,
  because a run can span more than one engine.
- Routing facts (`source`, `engine`, `model`, `durationSeconds`) are stamped by
  modsearch after the engine answers, so an engine cannot fake who served a
  result.

## The `results` entry

Every entry starts with the same routing fields, then flattens the engine's own
result fields in beside them:

| Field | Meaning |
| :-- | :-- |
| `source` | `web` or `x`, the corpus this entry's evidence actually came from |
| `requestedSource` | `web` or `x`, the corpus that was asked for. Differs from `source` when the run degraded |
| `engine` | which engine actually answered (`antigravity-cli`, `tavily`, `grok-cli`, `local`), or `null` when the source was unreachable |
| `model` | the model used, where the engine has one (empty string when it does not) |
| `status` | `ok`, `degraded`, or `unavailable` (see below) |
| `warnings` | routing and runtime warnings for this source: a fallback, a degrade caveat, a config typo, the local engine's "no synthesis" and "private network allowed" notices. About how the answer was produced, not the facts in it. Always an array, often empty |
| `attempts` | every engine tried for this source, in order: `{ engine, ok, error?, durationSeconds, cost?, credits? }`. `ok: false` entries carry the failure `error`. An engine that reports spend adds `cost` (exa, US dollars) or `credits` (firecrawl). Both are optional and absent on engines that report neither. One `ok: true` entry at the end on a successful run |
| `durationSeconds` | how long this one source took, or `null` when nothing ran |

The remaining fields depend on the mode.

### `uncertainty` vs `warnings`

Two separate lists, and the split matters when you relay a result:

- `uncertainty` is the engine's own epistemic doubt about the **facts**: a gap it
  could not fill, sources that conflict, a figure that might be stale, a page
  that came back too thin to trust. Surface these as caveats on the answer.
- `warnings` is about **how the answer was produced**: an engine failed and
  another stood in, an X request was served by the web, a config key was a typo,
  a fetch followed redirects or ran with the private-network guard off. Surface
  these when they change how much to trust the routing (a degrade especially),
  not as doubt about the facts themselves.

Older versions folded both into `uncertainty`. A consumer that parsed routing
notes out of `uncertainty` should read `warnings` now.

### `status` and degraded X answers

`status` tells a consumer how well the entry served the source that was asked
for:

- `ok`: the requested corpus answered. `source` equals `requestedSource`.
- `degraded`: a stand-in corpus answered. Only X degrades today: when Grok Build
  is missing, signed out, or failing, a web engine answers the X request. The
  entry then reads `requestedSource: "x"`, `source: "web"`, `status: "degraded"`,
  and `warnings` explains that web data cannot see inside X. Do not present a
  degraded entry as X coverage.
- `unavailable`: nothing could serve the source. `engine` is `null`, `items` is
  empty, `attempts` is empty, `durationSeconds` is `null`, and `warnings` says
  why. This appears for the X slot of a `--source web,x` run when X is
  unreachable, so the slot is explicit rather than silently missing:

```json
{
  "source": "x",
  "requestedSource": "x",
  "engine": null,
  "status": "unavailable",
  "summary": "",
  "items": [],
  "uncertainty": [],
  "warnings": [
    "X itself was not reachable here (Grok Build missing, signed out, or failing), so this came from the public web, which cannot see inside X."
  ],
  "attempts": [],
  "durationSeconds": null
}
```

### Engine spend on an attempt

Engines that meter their usage report it on the attempt that ran, so a caller can
track what a run cost. Both fields are optional: they appear only on the engine
that reports them, and never on engines that report neither (agy, tavily, the
local engine).

- `cost`: US dollars, from exa.
- `credits`: firecrawl credits.

```json
{
  "engine": "exa",
  "ok": true,
  "durationSeconds": 1.2,
  "cost": 0.007
}
```

## Search mode (`-q`)

The engine result flattened into the entry:

```json
{
  "summary": "string",
  "items": [
    {
      "title": "string",
      "url": "string",
      "snippet": "string",
      "source": "string (optional)",
      "published_at": "string (optional)"
    }
  ],
  "uncertainty": ["string"]
}
```

- `items` order carries relevance ranking. There is no numeric `relevance`
  score: models fabricate them, and ordering already carries it.
- Empty `items` with a populated `uncertainty` means the search found nothing
  reliable.

## Fetch mode (`-u`)

`items` is replaced by `content` plus `links`:

```json
{
  "mode": "fetch",
  "query": null,
  "url": "https://nodejs.org/en/about",
  "results": [
    {
      "source": "web",
      "requestedSource": "web",
      "engine": "antigravity-cli",
      "model": "gemini-3.6-flash-low",
      "status": "ok",
      "durationSeconds": 8.1,
      "summary": "About page for the Node.js project.",
      "content": "# About Node.js\nNode.js is a JavaScript runtime...",
      "links": [
        { "text": "Downloads", "url": "https://nodejs.org/en/download" }
      ],
      "uncertainty": [],
      "warnings": [],
      "attempts": [
        { "engine": "antigravity-cli", "ok": true, "durationSeconds": 8.1 }
      ]
    }
  ],
  "meta": {
    "generatedAt": "2026-08-06T12:00:00.000Z",
    "durationSeconds": 8.2
  }
}
```

- `content` is the page's main content as markdown (agy) or as served text (the
  local engine, which runs no JavaScript and adds no synthesis).
- `links` is the useful outbound links, at most 20. It can be empty.

## Notes

- `query` and `url` mirror the request: exactly one is non-null.
- The example envelopes above are checked against a real `RunSearchResult` by
  `src/output-schema.test.ts`, so this document cannot drift from the code
  without a test failing.
