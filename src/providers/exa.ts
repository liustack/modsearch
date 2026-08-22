// Exa search (https://docs.exa.ai). In-process fetch engine, search only, in
// the same shape as tavily.ts: one POST with the built-in fetch, an
// AbortController that genuinely cancels on timeout, and no fabricated relevance
// score. Exa returns ranked links with highlight snippets but writes no answer,
// so the summary here is mechanical and a warning tells the reader to work from
// items directly.
import { redactSecrets } from '../util/redact.ts';
import { ApiKeyFailureError, isQuotaFailureMessage, splitApiKeys } from '../util/apiKeys.ts';
import type { EngineRequest, EngineOutput, SearchEngine } from './index.ts';
import { resolveEndpoint } from './endpoint.ts';

const DEFAULT_NUM_RESULTS = 10;
const EXA_DEFAULT_BASE = 'https://api.exa.ai';

interface ExaResult {
  title?: string;
  url?: string;
  publishedDate?: string;
  author?: string;
  highlights?: string[];
}

interface ExaResponse {
  results?: ExaResult[];
  /** Total dollar cost of this call, useful only as a diagnostic. */
  costDollars?: { total?: number };
}

export async function executeExaSearch(options: EngineRequest): Promise<EngineOutput> {
  if (options.mode === 'fetch') {
    throw new Error('The exa engine does not support page fetch (-u). It searches only.');
  }
  if (!options.query) {
    throw new Error('Search mode requires a query.');
  }

  const apiKeys = splitApiKeys(options.settings.apiKey);
  const apiKey = apiKeys[0];
  const apiKeySecrets = [...new Set([...apiKeys, ...(options.apiKeySecrets ?? [])])];
  if (!apiKey) {
    throw new Error(
      'The exa provider needs an API key. Set EXA_API_KEY, or run: modsearch config set exa.apiKey <key> ($10/month recurring free credit, ~1,400 searches, no card at https://exa.ai)',
    );
  }

  const numResults = options.maxResults ?? DEFAULT_NUM_RESULTS;
  const startedAt = Date.now();

  // Own the abort signal so a --timeout shorter than any server-side ceiling is
  // enforced here, and cancelling truly tears down the underlying request.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  timer.unref?.();

  let response: Response;
  try {
    response = await fetch(resolveEndpoint(options.settings.baseURL, EXA_DEFAULT_BASE, '/search'), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({
        query: options.query,
        numResults,
        contents: { highlights: true },
      }),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`exa timed out after ${options.timeoutMs} ms.`);
    }
    throw new Error(
      `exa request failed: ${redactSecrets(error instanceof Error ? error.message : String(error), [
        ...apiKeySecrets,
        options.settings.baseURL,
      ])}`,
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
    if (response.status >= 500) {
      throw new Error(
        `exa returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`,
      );
    }
    // A spent balance is a quota error, not a broken key: judge by the response
    // text first, since Exa can return it under several status codes. The
    // cooldown layer reads this wording to recognize the quota class.
    if (isQuotaFailureMessage(detail)) {
      throw new ApiKeyFailureError(
        `exa is out of credits: ${detail || `HTTP ${response.status}`}. Add credit at https://exa.ai, or search with another engine.`,
      );
    }
    if (response.status === 401 || response.status === 403 || response.status === 429) {
      throw new ApiKeyFailureError(
        `exa rejected the API key (${response.status}). Fix it: modsearch config set exa.apiKey <key>${detail ? ` (${detail})` : ''}`,
      );
    }
    throw new Error(
      `exa returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`,
    );
  }

  const data = (await response.json()) as ExaResponse;

  const items = (data.results ?? []).map((r) => {
    const item: {
      title: string;
      url: string;
      snippet: string;
      source: string | undefined;
      published_at?: string;
    } = {
      title: r.title ?? '',
      url: r.url ?? '',
      snippet: r.highlights?.[0] ?? '',
      source: r.url ? safeHostname(r.url) : undefined,
    };
    // Defensive: only carry a date when Exa actually returned one.
    if (r.publishedDate) {
      item.published_at = r.publishedDate;
    }
    return item;
  });

  const summary =
    items.length > 0
      ? `Exa returned ${items.length} ranked result(s) for "${options.query}". Read items for the sources.`
      : '';

  const result = {
    summary,
    items,
    uncertainty: items.length === 0 ? ['No results found for this query.'] : [],
    // Exa ranks and links but writes no synthesis, so the summary above is
    // mechanical. Same shape as the local engine's "read it yourself" notice.
    warnings: [
      'Exa returns ranked results without an LLM summary, so the summary is mechanical: read items directly for the evidence.',
    ],
  };

  return {
    result,
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { resultCount: items.length, costDollars: data.costDollars?.total ?? null },
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

export const exaProvider: SearchEngine = {
  name: 'exa',
  roles: ['search'],
  requirement: 'set an Exa key ($10/month recurring free credit, ~1,400 searches, no card)',
  isAvailable: (settings, env) =>
    splitApiKeys(settings.apiKey).length > 0 || splitApiKeys(env.EXA_API_KEY).length > 0,
  defaultModel: undefined,
  execute: executeExaSearch,
};
