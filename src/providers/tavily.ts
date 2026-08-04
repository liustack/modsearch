// Community-contributed provider (thanks @mani2001, PR #1), ported to the
// v2 provider contract: schema-shaped result, no fabricated relevance score,
// uncertainty as an array. Search mode only.
import { tavily } from '@tavily/core';
import type {
  BuildProviderInvocationOptions,
  ProviderParsedOutput,
  SearchProvider,
} from './index.ts';

const DEFAULT_MAX_RESULTS = 8;

export async function executeTavilySearch(
  options: BuildProviderInvocationOptions,
): Promise<ProviderParsedOutput> {
  if (options.mode === 'fetch') {
    throw new Error(
      'The tavily provider only supports search mode (-q). Use the default antigravity-cli provider for page fetch (-u).',
    );
  }
  if (!options.query) {
    throw new Error('Search mode requires a query.');
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new Error('TAVILY_API_KEY environment variable is required for the tavily provider.');
  }

  const client = tavily({ apiKey });
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const startedAt = Date.now();

  const response = await client.search(options.query, {
    maxResults,
    searchDepth: 'basic',
    includeAnswer: true,
  });

  const items = (response.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
    source: r.url ? safeHostname(r.url) : undefined,
  }));

  const result = {
    summary:
      response.answer ?? items.map((item) => item.snippet).filter(Boolean).join(' '),
    items,
    uncertainty: items.length === 0 ? ['No results found for this query.'] : [],
  };

  return {
    result,
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { resultCount: items.length },
    },
  };
}

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export const tavilyProvider: SearchProvider = {
  name: 'tavily',
  providerClass: 'web',
  defaultModel: 'tavily-basic',
  execute: executeTavilySearch,
};
