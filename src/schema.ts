// JSON schemas enforced on the engine via structured output.
// Numeric relevance scores were dropped: models fabricate them, and item
// order already carries ranking.

export const SEARCH_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          snippet: { type: 'string' },
          source: { type: 'string' },
          published_at: { type: 'string' },
        },
        required: ['title', 'url', 'snippet'],
      },
    },
    uncertainty: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'items', 'uncertainty'],
} as const;

export const FETCH_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    content: { type: 'string' },
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          url: { type: 'string' },
        },
        required: ['text', 'url'],
      },
    },
    uncertainty: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'content', 'uncertainty'],
} as const;

export function searchResultSchemaJson(): string {
  return JSON.stringify(SEARCH_RESULT_SCHEMA);
}

export function fetchResultSchemaJson(): string {
  return JSON.stringify(FETCH_RESULT_SCHEMA);
}
