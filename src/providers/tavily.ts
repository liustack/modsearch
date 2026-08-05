// Community-contributed engine (thanks @mani2001, PR #1), ported to the
// engine contract: schema-shaped result, no fabricated relevance score,
// uncertainty as an array. Search mode only.
import { tavily } from '@tavily/core';
import type {
  EngineRequest,
  EngineOutput,
  SearchEngine,
} from './index.ts';

const DEFAULT_MAX_RESULTS = 8;

export async function executeTavilySearch(
  options: EngineRequest,
): Promise<EngineOutput> {
  if (options.mode === 'fetch') {
    throw new Error(
      'The tavily engine does not support page fetch (-u). It searches only.',
    );
  }
  if (!options.query) {
    throw new Error('Search mode requires a query.');
  }

  const apiKey = options.settings.apiKey;
  if (!apiKey) {
    throw new Error(
      'The tavily provider needs an API key. Set TAVILY_API_KEY, or run: modsearch config set tavily.apiKey <key> (free tier: 1,000 credits/month at https://app.tavily.com)',
    );
  }

  const client = tavily({ apiKey });
  // The SDK falls back to its own 60s ceiling, so a shorter --timeout has to be
  // enforced out here or it means nothing.
  let deadlineTimer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    deadlineTimer = setTimeout(
      () => reject(new Error(`tavily timed out after ${options.timeoutMs} ms.`)),
      options.timeoutMs,
    );
    deadlineTimer.unref();
  });
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const startedAt = Date.now();

  const response = await Promise.race([client.search(options.query, {
    maxResults,
    searchDepth: 'basic',
    includeAnswer: true,
  }), deadline]).finally(
    () => clearTimeout(deadlineTimer),
  );

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

export const tavilyProvider: SearchEngine = {
  name: 'tavily',
  roles: ['search'],
  requirement: 'set a Tavily key (free tier: 1,000 credits/month, no card)',
  isAvailable: (settings, env) => Boolean(settings.apiKey || env.TAVILY_API_KEY),
  defaultModel: 'tavily-basic',
  execute: executeTavilySearch,
};
