# ModSearch Output Schema

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
      "engine": "antigravity-cli",
      "model": "gemini-3.6-flash-low",
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
      "uncertainty": []
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

Every entry starts with the same four routing fields, then flattens the engine's
own result fields in beside them:

| Field | Meaning |
| :-- | :-- |
| `source` | `web` or `x`, the corpus this entry answers for |
| `engine` | which engine actually answered (`antigravity-cli`, `tavily`, `grok-cli`, `http`) |
| `model` | the model used, where the engine has one (empty string when it does not) |
| `durationSeconds` | how long this one source took |

The remaining fields depend on the mode.

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
      "engine": "antigravity-cli",
      "model": "gemini-3.6-flash-low",
      "durationSeconds": 8.1,
      "summary": "About page for the Node.js project.",
      "content": "# About Node.js\nNode.js is a JavaScript runtime...",
      "links": [
        { "text": "Downloads", "url": "https://nodejs.org/en/download" }
      ],
      "uncertainty": []
    }
  ],
  "meta": {
    "generatedAt": "2026-08-06T12:00:00.000Z",
    "durationSeconds": 8.2
  }
}
```

- `content` is the page's main content as markdown (agy) or as served text (the
  local `http` engine, which runs no JavaScript and adds no synthesis).
- `links` is the useful outbound links, at most 20. It can be empty.

## Notes

- `query` and `url` mirror the request: exactly one is non-null.
- The example envelopes above are checked against a real `RunSearchResult` by
  `src/output-schema.test.ts`, so this document cannot drift from the code
  without a test failing.
