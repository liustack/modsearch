// Firecrawl (https://docs.firecrawl.dev). One file, two roles: search and fetch.
// Both talk to the Firecrawl v2 REST API directly with the built-in fetch and an
// AbortController that cancels on timeout. Search maps ranked results in the
// same shape as the other keyed engines. Fetch is the point of this engine: it
// runs a real browser in the cloud, so JavaScript-rendered pages come back with
// content the local engine cannot see.
//
// The fetch path validates the target with the network module first: a private
// or reserved address is meaningless to a cloud crawler, so firecrawl declines
// it and the local engine reads it instead. --allow-private-network does not
// carry through: it authorizes local access, never cloud disclosure.
import { isLiteralReservedTarget, isReservedTarget, normalizeFetchUrl } from './http/network.ts';
import type { EngineRequest, EngineOutput, SearchEngine } from './index.ts';
import { MAX_CONTENT_CHARS } from './limits.ts';

const DEFAULT_LIMIT = 10;
const FIRECRAWL_SEARCH_URL = 'https://api.firecrawl.dev/v2/search';
const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v2/scrape';
const MAX_LINKS = 20;
// Firecrawl's documented timeout contract is 1000-300000 ms; clamp both ends
// so a caller's tighter --timeout cannot produce a request Firecrawl rejects.
const TIMEOUT_CEILING_MS = 300_000;
const TIMEOUT_FLOOR_MS = 1_000;

function clampTimeout(timeoutMs: number): number {
  return Math.min(Math.max(timeoutMs, TIMEOUT_FLOOR_MS), TIMEOUT_CEILING_MS);
}

interface FirecrawlWebResult {
  title?: string;
  description?: string;
  url?: string;
}

interface FirecrawlSearchResponse {
  success?: boolean;
  data?: { web?: FirecrawlWebResult[] };
  creditsUsed?: number;
}

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    links?: unknown;
    metadata?: {
      title?: string;
      description?: string;
      statusCode?: number;
      sourceURL?: string;
    };
  };
}

export async function executeFirecrawl(options: EngineRequest): Promise<EngineOutput> {
  return options.mode === 'fetch' ? firecrawlFetch(options) : firecrawlSearch(options);
}

function requireKey(options: EngineRequest): string {
  const apiKey = options.settings.apiKey;
  if (!apiKey) {
    throw new Error(
      'The firecrawl provider needs an API key. Set FIRECRAWL_API_KEY, or run: modsearch config set firecrawl.apiKey <key> (1,000 free credits/month, no card at https://firecrawl.dev)',
    );
  }
  return apiKey;
}

async function firecrawlPost(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`firecrawl timed out after ${timeoutMs} ms.`);
    }
    throw new Error(
      `firecrawl request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Turn a non-2xx API response into an actionable error, quota class included. */
async function ensureOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  const detail = (await response.text().catch(() => '')).trim();
  // A 402 or a credit/quota message is the quota class the cooldown layer reads.
  if (
    response.status === 402 ||
    /credit|quota|insufficient|payment required/i.test(detail)
  ) {
    throw new Error(
      `firecrawl is out of credits: ${detail || `HTTP ${response.status}`}. Add credit at https://firecrawl.dev, or search with another engine.`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `firecrawl rejected the API key (${response.status}). Fix it: modsearch config set firecrawl.apiKey <key>${detail ? ` (${detail})` : ''}`,
    );
  }
  throw new Error(
    `firecrawl returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`,
  );
}

async function firecrawlSearch(options: EngineRequest): Promise<EngineOutput> {
  if (!options.query) {
    throw new Error('Search mode requires a query.');
  }
  const apiKey = requireKey(options);
  const limit = options.maxResults ?? DEFAULT_LIMIT;
  const startedAt = Date.now();

  const response = await firecrawlPost(
    FIRECRAWL_SEARCH_URL,
    apiKey,
    {
      query: options.query,
      limit,
      sources: ['web'],
      timeout: clampTimeout(options.timeoutMs),
    },
    options.timeoutMs,
  );
  await ensureOk(response);
  const data = (await response.json()) as FirecrawlSearchResponse;

  const items = (data.data?.web ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
    source: r.url ? safeHostname(r.url) : undefined,
  }));

  const summary =
    items.length > 0
      ? `Firecrawl returned ${items.length} ranked result(s) for "${options.query}". Read items for the sources.`
      : '';

  return {
    result: {
      summary,
      items,
      uncertainty: items.length === 0 ? ['No results found for this query.'] : [],
      warnings: [
        'Firecrawl search returns ranked results without an LLM summary, so the summary is mechanical: read items directly for the evidence.',
      ],
    },
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { resultCount: items.length, creditsUsed: data.creditsUsed ?? null },
    },
  };
}

async function firecrawlFetch(options: EngineRequest): Promise<EngineOutput> {
  if (!options.url) {
    throw new Error('Fetch mode requires a URL.');
  }
  const apiKey = requireKey(options);
  const target = normalizeFetchUrl(options.url);

  // The cloud crawler never receives a target that is, or resolves to, a
  // private or reserved address, and --allow-private-network does not change
  // that: the switch authorizes LOCAL access to such addresses, not disclosing
  // an internal hostname, path, and query to a third-party cloud service. A
  // VPN fake-ip cannot be told apart from a real internal name from here, so
  // both are kept off the wire. The run falls through to the local engine,
  // which can reach the target (with the switch, when it is reserved).
  if (isLiteralReservedTarget(target) || (await isReservedTarget(target))) {
    throw new Error(
      `firecrawl does not fetch the private or reserved target ${target.hostname}. The local engine will read it instead.`,
    );
  }

  const startedAt = Date.now();
  const response = await firecrawlPost(
    FIRECRAWL_SCRAPE_URL,
    apiKey,
    {
      url: target.toString(),
      formats: ['markdown', 'links'],
      onlyMainContent: true,
      // Always scrape fresh, and leave nothing behind. maxAge: 0 only refuses
      // to READ Firecrawl's multi-day cache (stale content is fatal for a tool
      // whose whole point is current information); storeInCache: false keeps
      // the scraped page from being WRITTEN into Firecrawl's cache and index,
      // which its API defaults to doing. And skipTlsVerification defaults to
      // true upstream, so certificate checks are explicitly switched back on.
      maxAge: 0,
      storeInCache: false,
      skipTlsVerification: false,
      timeout: clampTimeout(options.timeoutMs),
    },
    options.timeoutMs,
  );
  await ensureOk(response);
  const data = (await response.json()) as FirecrawlScrapeResponse;

  const metadata = data.data?.metadata ?? {};
  const statusCode = metadata.statusCode;
  if (typeof statusCode === 'number' && (statusCode < 200 || statusCode >= 300)) {
    throw new Error(
      `firecrawl fetched ${target.toString()} but the page returned ${statusCode}.`,
    );
  }

  // Cap the markdown at the same ceiling the local engine uses, so a huge page
  // cannot flood a model's context no matter which fetch engine served it.
  const rawContent = data.data?.markdown ?? '';
  const truncated = rawContent.length > MAX_CONTENT_CHARS;
  const content = truncated ? rawContent.slice(0, MAX_CONTENT_CHARS) : rawContent;
  const links = normalizeLinks(data.data?.links);
  const summary =
    metadata.title ||
    metadata.description ||
    `${target.toString()} (Firecrawl scrape${typeof statusCode === 'number' ? `, ${statusCode}` : ''})`;

  // A page that came back nearly empty from a real browser is genuine doubt
  // about the evidence, so it stays in uncertainty.
  const uncertainty: string[] = [];
  if (content.length < 200) {
    uncertainty.push(
      'Very little content came back from Firecrawl, so the page may be genuinely sparse.',
    );
  }

  const warnings = [
    'Fetched through Firecrawl in the cloud, which runs JavaScript. The content is Firecrawl markdown extraction, not the raw page as served.',
  ];
  if (truncated) {
    warnings.push(`Content truncated at ${MAX_CONTENT_CHARS} characters.`);
  }

  return {
    result: {
      summary,
      content,
      links,
      uncertainty,
      warnings,
    },
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { statusCode: statusCode ?? null },
    },
  };
}

/** Firecrawl returns links as bare URL strings; map them to the {text, url} shape. */
function normalizeLinks(raw: unknown): Array<{ text: string; url: string }> {
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: Array<{ text: string; url: string }> = [];
  for (const entry of raw) {
    let url: string | undefined;
    let text: string | undefined;
    if (typeof entry === 'string') {
      url = entry;
      text = entry;
    } else if (entry && typeof entry === 'object') {
      const record = entry as { url?: unknown; text?: unknown };
      url = typeof record.url === 'string' ? record.url : undefined;
      text = typeof record.text === 'string' && record.text ? record.text : url;
    }
    if (!url || !/^https?:/i.test(url)) {
      continue;
    }
    out.push({ text: (text ?? url).slice(0, 100), url });
    if (out.length >= MAX_LINKS) {
      break;
    }
  }
  return out;
}

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export const firecrawlProvider: SearchEngine = {
  name: 'firecrawl',
  roles: ['search', 'fetch'],
  requirement: 'set a Firecrawl key (1,000 free credits/month, no card)',
  isAvailable: (settings, env) => Boolean(settings.apiKey || env.FIRECRAWL_API_KEY),
  execute: executeFirecrawl,
};
