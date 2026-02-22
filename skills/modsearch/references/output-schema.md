# ModSearch Output Schema (v1)

```json
{
  "summary": "string",
  "items": [
    {
      "title": "string",
      "url": "string",
      "snippet": "string",
      "source": "string",
      "published_at": "string",
      "relevance": 0
    }
  ],
  "uncertainty": ["string"]
}
```

Notes:
- `published_at` can be an empty string when unavailable.
- `relevance` is a normalized numeric score (0-1 recommended).
- If no reliable result is found, return empty `items` and explain why in `uncertainty`.
