// Firecrawl (https://docs.firecrawl.dev). One file, two roles: search and fetch.
// Both talk to the Firecrawl v2 REST API directly with the built-in fetch and an
// AbortController that cancels on timeout. Search maps ranked results in the
// same shape as the other HTTP engines. Fetch is the point of this engine: it
// runs a real browser in the cloud, so JavaScript-rendered pages come back with
// content the local engine cannot see.
//
// The fetch path validates the target with the network module first: a private
// or reserved address is meaningless to a cloud crawler, so firecrawl declines
// it. An automatic chain can then try local. A forced run returns an error.
// --allow-private-network authorizes local access, never cloud disclosure.
import { redactSecrets } from '../util/redact.ts';
import { isLiteralReservedTarget, isReservedTarget, normalizeFetchUrl } from './http/network.ts';
import type { EngineRequest, EngineOutput, SearchEngine } from './index.ts';
import { resolveEndpoint } from './endpoint.ts';
import { MAX_CONTENT_CHARS } from './limits.ts';

const DEFAULT_LIMIT = 10;
const FIRECRAWL_DEFAULT_BASE = 'https://api.firecrawl.dev';
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

async function firecrawlPost(
  url: string,
  apiKey: string | null,
  body: unknown,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    // No key means keyless mode: the endpoint accepts requests with no
    // Authorization header under Firecrawl's free keyless allowance (1,000
    // credits/month per their announcement, metered as per-IP daily caps).
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }
    return await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers,
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
async function ensureOk(response: Response, apiKey: string | null): Promise<void> {
  if (response.ok) {
    return;
  }
  // The API's error body is foreign text that loves to echo the Authorization
  // header; scrub it before it travels into messages.
  const detail = redactSecrets((await response.text().catch(() => '')).trim(), [apiKey]);
  // A 402 or a credit/quota message is the quota class the cooldown layer reads.
  if (response.status === 402 || /credit|quota|insufficient|payment required/i.test(detail)) {
    throw new Error(
      `firecrawl is out of credits: ${detail || `HTTP ${response.status}`}. Add credit or set your own key at https://firecrawl.dev, or use another engine.`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    if (!apiKey) {
      throw new Error(
        `firecrawl rejected the keyless request (${response.status}). Anonymous access may be unavailable or rate-limited. Set your own key: modsearch config set firecrawl.apiKey <key>${detail ? ` (${detail})` : ''}`,
      );
    }
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
  // Search runs keyless when no key is configured: Firecrawl's REST API
  // accepts unauthenticated calls against the free keyless allowance.
  const apiKey = options.settings.apiKey || null;
  const limit = options.maxResults ?? DEFAULT_LIMIT;
  const startedAt = Date.now();

  const response = await firecrawlPost(
    resolveEndpoint(options.settings.baseURL, FIRECRAWL_DEFAULT_BASE, '/v2/search'),
    apiKey,
    {
      query: options.query,
      limit,
      sources: ['web'],
      timeout: clampTimeout(options.timeoutMs),
    },
    options.timeoutMs,
  );
  await ensureOk(response, apiKey);
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
  const apiKey = options.settings.apiKey || null;
  const target = normalizeFetchUrl(options.url);

  // The cloud crawler never receives a target that is, or resolves to, a
  // private or reserved address, and --allow-private-network does not change
  // that: the switch authorizes LOCAL access to such addresses, not disclosing
  // an internal hostname, path, and query to a third-party cloud service. A
  // VPN fake-ip cannot be told apart from a real internal name from here, so
  // both are kept off the wire. An automatic chain may fall through to the
  // local engine. A forced Firecrawl run instead returns the actionable error.
  if (isLiteralReservedTarget(target) || (await isReservedTarget(target))) {
    throw new Error(
      `firecrawl does not fetch the private or reserved target ${target.hostname}. Use the local engine instead.`,
    );
  }

  const startedAt = Date.now();
  const response = await firecrawlPost(
    resolveEndpoint(options.settings.baseURL, FIRECRAWL_DEFAULT_BASE, '/v2/scrape'),
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
  await ensureOk(response, apiKey);
  const data = (await response.json()) as FirecrawlScrapeResponse;

  const metadata = data.data?.metadata ?? {};
  const statusCode = metadata.statusCode;
  if (typeof statusCode === 'number' && (statusCode < 200 || statusCode >= 300)) {
    throw new Error(`firecrawl fetched ${target.toString()} but the page returned ${statusCode}.`);
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
  requirement:
    'nothing: search and public-page fetch work keyless (free, no signup). Opt out of cloud fetch with firecrawl.keylessFetch false',
  // Keyless fetch is on by default and switched off with an explicit
  // `keylessFetch: false`. The check is strict on purpose: any malformed value
  // (a hand-written string that config coercion did not normalize) counts as
  // off, so a broken config fails closed to the local engine rather than
  // sending URLs to the cloud on a guess. A configured key always enables it.
  isAvailable: (settings, env, role) =>
    role === 'search' ||
    Boolean(settings.apiKey || env.FIRECRAWL_API_KEY) ||
    settings.keylessFetch === undefined ||
    settings.keylessFetch === true,
  execute: executeFirecrawl,
};
