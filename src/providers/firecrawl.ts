// Firecrawl (https://docs.firecrawl.dev). One file, two roles: search and fetch.
// Both talk to the Firecrawl v2 REST API directly with the built-in fetch and an
// AbortController that cancels on timeout. Search maps ranked results in the
// same shape as the other HTTP engines. Fetch is the point of this engine: it
// runs a real browser in the cloud, so JavaScript-rendered pages come back with
// content the local engine cannot see.
//
// The fetch path validates the target with the network module first. Literal
// private targets and hostnames proven private by the cloud-disclosure policy
// are declined. An automatic chain can then try local. A forced run returns an
// error. --allow-private-network authorizes local access, never cloud disclosure.
import { ApiKeyFailureError, isQuotaFailureMessage, splitApiKeys } from '../util/apiKeys.ts';
import { redactSecrets } from '../util/redact.ts';
import { requestText } from '../util/timedRequest.ts';
import {
  type CloudDisclosureInspection,
  inspectCloudDisclosureTarget,
  isLiteralReservedTarget,
  normalizeFetchUrl,
} from './http/network.ts';
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

/**
 * POST to the Firecrawl API and read the whole body under `signal`, so the
 * timeout covers the body as well as the headers. Non-2xx responses become
 * actionable errors here. Returns the parsed JSON of a 2xx response.
 */
async function firecrawlPost<T>(
  url: string,
  apiKey: string | null,
  apiKeySecrets: readonly string[],
  body: unknown,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  // No key means keyless mode: the endpoint accepts requests with no
  // Authorization header under Firecrawl's free keyless allowance (1,000
  // credits/month per their announcement, metered as per-IP daily caps).
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  const { response, text } = await requestText(
    'firecrawl',
    url,
    { method: 'POST', headers, body: JSON.stringify(body) },
    signal,
    timeoutMs,
    apiKeySecrets,
  );
  ensureOk(response, text, apiKey, apiKeySecrets);
  return JSON.parse(text) as T;
}

/** Turn a non-2xx API response into an actionable error, quota class included. */
function ensureOk(
  response: Response,
  text: string,
  apiKey: string | null,
  apiKeySecrets: readonly string[],
): void {
  if (response.ok) {
    return;
  }
  // The API's error body is foreign text that loves to echo the Authorization
  // header; scrub it before it travels into messages.
  const detail = redactSecrets(text.trim(), apiKeySecrets);
  const message = `firecrawl returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`;
  if (response.status >= 500) {
    throw new Error(message);
  }
  // A 402 or a credit/quota message is the quota class the cooldown layer reads.
  if (response.status === 402 || isQuotaFailureMessage(detail)) {
    throw new ApiKeyFailureError(
      `firecrawl is out of credits: ${detail || `HTTP ${response.status}`}. Add credit or set your own key at https://firecrawl.dev, or use another engine.`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    if (!apiKey) {
      // Firecrawl turns anonymous calls away from IPs it reads as a VPN or a
      // proxy, which a machine behind a corporate or Clash-style proxy always
      // is. Waiting does not help there, so say what does.
      if (/VPN or proxy/i.test(detail)) {
        throw new Error(
          `firecrawl does not allow keyless use from a proxy or VPN exit IP. Set a free key: modsearch config set firecrawl.apiKey <key>, or use keenable or youcom. (${detail})`,
        );
      }
      throw new Error(
        `firecrawl rejected the keyless request (${response.status}). Anonymous access may be unavailable or rate-limited. Set your own key: modsearch config set firecrawl.apiKey <key>${detail ? ` (${detail})` : ''}`,
      );
    }
    throw new ApiKeyFailureError(
      `firecrawl rejected the API key (${response.status}). Fix it: modsearch config set firecrawl.apiKey <key>${detail ? ` (${detail})` : ''}`,
    );
  }
  if (apiKey && response.status === 429) {
    throw new ApiKeyFailureError(message);
  }
  throw new Error(message);
}

async function firecrawlSearch(options: EngineRequest): Promise<EngineOutput> {
  if (!options.query) {
    throw new Error('Search mode requires a query.');
  }
  // Search runs keyless when no key is configured: Firecrawl's REST API
  // accepts unauthenticated calls against the free keyless allowance.
  const apiKeys = splitApiKeys(options.settings.apiKey);
  const apiKey = apiKeys[0] ?? null;
  const apiKeySecrets = [...new Set([...apiKeys, ...(options.apiKeySecrets ?? [])])];
  const limit = options.maxResults ?? DEFAULT_LIMIT;
  const startedAt = Date.now();

  const data = await firecrawlPost<FirecrawlSearchResponse>(
    resolveEndpoint(options.settings.baseURL, FIRECRAWL_DEFAULT_BASE, '/v2/search'),
    apiKey,
    apiKeySecrets,
    {
      query: options.query,
      limit,
      sources: ['web'],
      timeout: clampTimeout(options.timeoutMs),
    },
    AbortSignal.timeout(options.timeoutMs),
    options.timeoutMs,
  );

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
  const apiKeys = splitApiKeys(options.settings.apiKey);
  const apiKey = apiKeys[0] ?? null;
  const apiKeySecrets = [...new Set([...apiKeys, ...(options.apiKeySecrets ?? [])])];
  const target = normalizeFetchUrl(options.url);
  // One deadline for the DNS check, the request, and the body.
  const deadline = AbortSignal.timeout(options.timeoutMs);

  // A literal private target never leaves the machine. DNS-only classification
  // is advisory for cloud disclosure: standard 198.18/15 proxy fake IPs count
  // as public placeholders, and one real public answer makes the hostname
  // public. --allow-private-network remains local-only and never bypasses this.
  if (isLiteralReservedTarget(target)) {
    throw new Error(
      `firecrawl does not fetch the private or reserved target ${target.hostname}. Use the local engine instead.`,
    );
  }
  let disclosure: CloudDisclosureInspection;
  try {
    disclosure = await inspectCloudDisclosureTarget(target, deadline);
  } catch (error) {
    if (deadline.aborted) {
      throw new Error(`firecrawl timed out after ${options.timeoutMs} ms.`);
    }
    throw error;
  }
  if (disclosure.reserved) {
    const resolved =
      disclosure.addresses.length > 0 ? ` -> ${disclosure.addresses.join(', ')}` : '';
    throw new Error(
      `firecrawl does not fetch the private or reserved target ${target.hostname}${resolved}. If a VPN or proxy on this machine uses fake-IP DNS, a public hostname may look reserved here. Use the local engine instead.`,
    );
  }

  const startedAt = Date.now();
  const data = await firecrawlPost<FirecrawlScrapeResponse>(
    resolveEndpoint(options.settings.baseURL, FIRECRAWL_DEFAULT_BASE, '/v2/scrape'),
    apiKey,
    apiKeySecrets,
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
    deadline,
    options.timeoutMs,
  );

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
      looksLikeClientRenderedShell(content)
        ? 'The page content is likely generated by browser-side JavaScript, but this fetch captured only the page shell. Missing content does not mean the page itself is empty.'
        : 'Very little content came back from Firecrawl, so the page may be genuinely sparse.',
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

/**
 * The requested formats provide markdown, not HTML or hydration data. After
 * excluding headings, links with zero body text suggest a page skeleton whose
 * content did not render, regardless of language or site. One link is enough
 * because zero body text is already a strong condition. Genuinely sparse pages
 * usually have some body text without links, not links without body text.
 */
export function looksLikeClientRenderedShell(markdown: string): boolean {
  let linkCount = 0;

  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim().replace(/^[-*+]\s+/, '');
    if (/^#{1,6}(?:\s|$)/.test(line)) {
      continue;
    }
    const remainder = line.replace(/\[([^\]]+)\](?:\([^)]*\))?/g, () => {
      linkCount += 1;
      return '';
    });
    if (!/^[\s|]*$/.test(remainder)) {
      return false;
    }
  }

  return linkCount >= 1;
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
    splitApiKeys(settings.apiKey).length > 0 ||
    splitApiKeys(env.FIRECRAWL_API_KEY).length > 0 ||
    settings.keylessFetch === undefined ||
    settings.keylessFetch === true,
  execute: executeFirecrawl,
};
