// Community-contributed engine (thanks @mani2001, PR #1), ported to the
// engine contract: schema-shaped result, no fabricated relevance score,
// uncertainty as an array. Search mode only.
//
// This talks to the Tavily REST API directly with the built-in fetch. The
// official @tavily/core SDK dragged in ~30 production dependencies (an axios
// chain with known advisories) to wrap a single POST, so it is gone. See
// https://docs.tavily.com/documentation/api-reference/endpoint/search
import { ApiKeyFailureError, isQuotaFailureMessage, splitApiKeys } from '../util/apiKeys.ts';
import { redactSecrets } from '../util/redact.ts';
import type { EngineRequest, EngineOutput, SearchEngine } from './index.ts';
import { resolveEndpoint } from './endpoint.ts';

const DEFAULT_MAX_RESULTS = 8;
const TAVILY_DEFAULT_BASE = 'https://api.tavily.com';

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface TavilyResponse {
  answer?: string;
  results?: TavilyResult[];
}

export async function executeTavilySearch(options: EngineRequest): Promise<EngineOutput> {
  if (options.mode === 'fetch') {
    throw new Error('The tavily engine does not support page fetch (-u). It searches only.');
  }
  if (!options.query) {
    throw new Error('Search mode requires a query.');
  }

  const apiKeys = splitApiKeys(options.settings.apiKey);
  const apiKey = apiKeys[0];
  const apiKeySecrets = [...new Set([...apiKeys, ...(options.apiKeySecrets ?? [])])];
  if (!apiKey) {
    throw new Error(
      'The tavily provider needs an API key. Set TAVILY_API_KEY, or run: modsearch config set tavily.apiKey <key> (free tier: 1,000 credits/month at https://app.tavily.com)',
    );
  }

  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const startedAt = Date.now();

  // Own the abort signal so a --timeout shorter than any server-side ceiling is
  // enforced here, and cancelling truly tears down the underlying request
  // instead of leaving it running while we walk away.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  timer.unref?.();

  let response: Response;
  try {
    response = await fetch(
      resolveEndpoint(options.settings.baseURL, TAVILY_DEFAULT_BASE, '/search'),
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          query: options.query,
          search_depth: 'basic',
          include_answer: true,
          max_results: maxResults,
        }),
      },
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`tavily timed out after ${options.timeoutMs} ms.`);
    }
    throw new Error(
      `tavily request failed: ${redactSecrets(
        error instanceof Error ? error.message : String(error),
        [...apiKeySecrets, options.settings.baseURL],
      )}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // The gateway's error body is foreign text that loves to echo the
    // Authorization header; scrub it before it travels into messages.
    const detail = redactSecrets((await response.text().catch(() => '')).trim(), [
      ...apiKeySecrets,
      options.settings.baseURL,
    ]);
    const message = `tavily returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`;
    // Server failures are not evidence that the selected key is bad, even if
    // an upstream error page happens to mention quota.
    if (response.status >= 500) {
      throw new Error(message);
    }
    // Tavily returns 432 (plan usage cap) and 433 (PAYGO cap) for a spent monthly
    // budget. Carry the status code into the message so the cooldown layer reads
    // it as the monthly quota class and holds the engine for a day, not the
    // 45-minute default, instead of re-hitting the same wall every run.
    if (response.status === 432 || response.status === 433) {
      throw new ApiKeyFailureError(
        `tavily is out of monthly quota (HTTP ${response.status}).${detail ? ` ${detail}` : ''} Add credit at https://app.tavily.com, or search with another engine.`,
      );
    }
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 429 ||
      isQuotaFailureMessage(detail)
    ) {
      throw new ApiKeyFailureError(message);
    }
    throw new Error(message);
  }

  const data = (await response.json()) as TavilyResponse;

  const items = (data.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
    source: r.url ? safeHostname(r.url) : undefined,
  }));

  const result = {
    summary:
      data.answer ??
      items
        .map((item) => item.snippet)
        .filter(Boolean)
        .join(' '),
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
  isAvailable: (settings, env) =>
    splitApiKeys(settings.apiKey).length > 0 || splitApiKeys(env.TAVILY_API_KEY).length > 0,
  defaultModel: 'tavily-basic',
  execute: executeTavilySearch,
};
