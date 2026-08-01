# ModSearch Output Schema (v2)

The CLI prints one JSON object to stdout:

```json
{
  "mode": "search | fetch",
  "query": "string|null",
  "url": "string|null",
  "provider": "antigravity-cli",
  "result": { "...": "see below" },
  "meta": {
    "generatedAt": "2026-08-01T12:00:00.000Z",
    "model": "gemini-3.6-flash-low",
    "conversationId": "string|null",
    "durationSeconds": 12.3,
    "usage": {}
  }
}
```

`result` is enforced by JSON schema on the provider side (`--json-schema`).

Search mode (`-q`):

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

Fetch mode (`-u`):

```json
{
  "summary": "string",
  "content": "string (main page content as markdown)",
  "links": [
    { "text": "string", "url": "string" }
  ],
  "uncertainty": ["string"]
}
```

Notes:

- `items` order carries relevance ranking. The numeric `relevance` score from v1 was removed because models fabricate it.
- Empty `items` plus a populated `uncertainty` means the search found nothing reliable.
- `links` is optional in fetch mode.
