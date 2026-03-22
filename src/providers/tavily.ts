import { tavily } from '@tavily/core';
import type {
  BuildProviderInvocationOptions,
  SearchProvider,
} from './index.ts';
import type { RunSearchResult } from '../search.ts';

const DEFAULT_MAX_RESULTS = 8;

export async function executeTavilySearch(
  options: BuildProviderInvocationOptions,
): Promise<RunSearchResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error(
      'TAVILY_API_KEY environment variable is required for the tavily provider.',
    );
  }

  const client = tavily({ apiKey });
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;

  const response = await client.search(options.query, {
    maxResults,
    searchDepth: 'advanced',
    includeAnswer: true,
  });

  const items = (response.results ?? []).map((r, idx) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
    source: new URL(r.url).hostname,
    published_at: null,
    relevance: r.score ?? (1 - idx * 0.05),
  }));

  const structured = {
    summary: response.answer ?? items.map((i) => i.snippet).join(' '),
    items,
    uncertainty:
      items.length === 0 ? 'No results found for this query.' : '',
  };

  return {
    query: options.query,
    provider: 'tavily',
    structured,
    rawText: JSON.stringify(structured, null, 2),
    meta: {
      generatedAt: new Date().toISOString(),
      model: null,
      providerSessionId: null,
      providerStats: {
        responseTime: response.responseTime,
        resultCount: items.length,
      },
    },
  };
}

export const tavilyProvider: SearchProvider = {
  name: 'tavily',
  buildInvocation: () => {
    throw new Error('Tavily provider uses execute(), not buildInvocation().');
  },
  execute: executeTavilySearch,
};
