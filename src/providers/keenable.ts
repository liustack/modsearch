// Keenable (https://docs.keenable.ai). In-process engine, two roles: search
// and page fetch, in the same shape as firecrawl.ts. With no key it calls the
// keyless `/public` twin of each endpoint, which Keenable caps at 1,000
// requests an hour per IP and which needs an `X-Keenable-Title` header naming
// the calling app. A key moves the call to the authenticated path: no hourly
// cap, 100,000 free requests a month per organization. Search results are
// ranked pages with snippets and no written answer, so the summary is
// mechanical.
//
// Fetch sends the URL to Keenable's cloud reader, so it passes the same gate
// as Firecrawl first: literal private targets and hostnames proven private
// never leave the machine. Keyless fetch is on by default and switched off
// with `keenable.keylessFetch false`.
import { ApiKeyFailureError, isQuotaFailureMessage, splitApiKeys } from '../util/apiKeys.ts';
import { redactSecrets } from '../util/redact.ts';
import { resetClause, retryAfterSeconds, SPENT_ALLOWANCE_MIN_SECONDS } from '../util/retryAfter.ts';
import { requestText } from '../util/timedRequest.ts';
import { resolveEndpoint } from './endpoint.ts';
import { assertCloudDisclosable, normalizeFetchUrl } from './http/network.ts';
import type { EngineOutput, EngineRequest, SearchEngine } from './index.ts';
import { MAX_CONTENT_CHARS } from './limits.ts';

const DEFAULT_MAX_RESULTS = 10;
/** Keenable rejects max_results outside 1-50. */
const MAX_RESULTS_CEILING = 50;
const KEENABLE_DEFAULT_BASE = 'https://api.keenable.ai';
/** Required on keyless calls: how Keenable attributes anonymous traffic. */
const APP_TITLE = 'modsearch';
/** Keenable rejects a fetch `prompt` longer than this. */
const PROMPT_CEILING = 2000;
const MAX_LINKS = 20;

interface KeenableResult {
  title?: string;
  url?: string;
  description?: string;
  snippet?: string;
  published_at?: string;
}

interface KeenableResponse {
  mode?: string;
  results?: KeenableResult[];
}

interface KeenableFetchResponse {
  url?: string;
  title?: string;
  content?: string;
  author?: string;
  published_at?: string;
  truncated?: boolean;
  total_chars?: number;
}

export async function executeKeenable(options: EngineRequest): Promise<EngineOutput> {
  return options.mode === 'fetch' ? keenableFetch(options) : keenableSearch(options);
}

/** Headers for one call: the key when there is one, else the keyless app title. */
function keenableHeaders(apiKey: string | null): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  } else {
    headers['x-keenable-title'] = APP_TITLE;
  }
  return headers;
}

/**
 * Turn a non-2xx response into an actionable error. Keenable answers every
 * error with `{ error, message, code, fix, retryable }`. The code tells a key
 * problem apart from a fetch refusal that also arrives as 403 (a private
 * target, or a site that blocks the reader).
 */
function ensureOk(
  response: Response,
  text: string,
  apiKey: string | null,
  secrets: ReadonlyArray<string | undefined>,
): void {
  if (response.ok) {
    return;
  }
  // The gateway's error body is foreign text; scrub it before it travels
  // into messages.
  const detail = redactSecrets(text.trim(), secrets);
  const message = `keenable returned ${response.status} ${response.statusText}.${detail ? ` ${detail}` : ''}`;
  if (response.status >= 500) {
    throw new Error(message);
  }
  if (!apiKey) {
    // The keyless pool is shared by everyone on this IP, so a 429 here is
    // not about anything the user configured. The pool is hourly, so the
    // wording reads as quota class either way, and a Retry-After of a minute
    // or more becomes the exact reset the cooldown holds Keenable until.
    if (response.status === 429) {
      const wait = retryAfterSeconds(response);
      const when =
        wait !== null && wait >= SPENT_ALLOWANCE_MIN_SECONDS
          ? `. ${resetClause(wait)}.`
          : ' for the hour (1,000 requests).';
      throw new Error(
        `keenable's keyless pool for this IP is used up${when} Set a free key for your own quota: modsearch config set keenable.apiKey <key> (100,000 requests/month, https://app.keenable.ai)`,
      );
    }
    throw new Error(message);
  }
  // 402 is the spent monthly allowance: the quota class the cooldown layer
  // holds for a day rather than re-hitting.
  if (response.status === 402 || isQuotaFailureMessage(detail)) {
    throw new ApiKeyFailureError(
      `keenable is out of credits (HTTP ${response.status}).${detail ? ` ${detail}` : ''} Buy credits at https://app.keenable.ai/console, wait for the monthly reset, or use another engine.`,
    );
  }
  if (response.status === 429) {
    throw new ApiKeyFailureError(message);
  }
  if (response.status === 401 || (response.status === 403 && isKeyRefusal(text))) {
    throw new ApiKeyFailureError(
      `keenable rejected the API key (${response.status}). Fix it: modsearch config set keenable.apiKey <key>${detail ? ` (${detail})` : ''}`,
    );
  }
  throw new Error(message);
}

/**
 * Is this 403 about the key? A body whose `code` names something else (a
 * private target, a blocked site) is not. A body with no readable code keeps
 * the older reading of a keyed 403 as a key problem.
 */
function isKeyRefusal(text: string): boolean {
  let code: unknown;
  try {
    code = (JSON.parse(text) as { code?: unknown }).code;
  } catch {
    return true;
  }
  return typeof code !== 'string' || /key|auth/i.test(code);
}

async function keenableSearch(options: EngineRequest): Promise<EngineOutput> {
  if (!options.query) {
    throw new Error('Search mode requires a query.');
  }

  const apiKeys = splitApiKeys(options.settings.apiKey);
  const apiKey = apiKeys[0] ?? null;
  const apiKeySecrets = [...new Set([...apiKeys, ...(options.apiKeySecrets ?? [])])];
  const secrets = [...apiKeySecrets, options.settings.baseURL];
  const maxResults = Math.min(options.maxResults ?? DEFAULT_MAX_RESULTS, MAX_RESULTS_CEILING);
  const startedAt = Date.now();

  const { response, text } = await requestText(
    'keenable',
    resolveEndpoint(
      options.settings.baseURL,
      KEENABLE_DEFAULT_BASE,
      apiKey ? '/v1/search' : '/v1/search/public',
    ),
    {
      method: 'POST',
      headers: keenableHeaders(apiKey),
      body: JSON.stringify({ query: options.query, max_results: maxResults }),
    },
    AbortSignal.timeout(options.timeoutMs),
    options.timeoutMs,
    secrets,
  );
  ensureOk(response, text, apiKey, secrets);

  const data = JSON.parse(text) as KeenableResponse;

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
      // The snippet is the page excerpt; the description is often empty.
      snippet: r.snippet || r.description || '',
      source: r.url ? safeHostname(r.url) : undefined,
    };
    if (r.published_at) {
      item.published_at = r.published_at;
    }
    return item;
  });

  const summary =
    items.length > 0
      ? `Keenable returned ${items.length} ranked result(s) for "${options.query}". Read items for the sources.`
      : '';

  return {
    result: {
      summary,
      items,
      uncertainty: items.length === 0 ? ['No results found for this query.'] : [],
      warnings: [
        'Keenable returns ranked results without an LLM summary, so the summary is mechanical: read items directly for the evidence.',
      ],
    },
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { resultCount: items.length, mode: data.mode ?? null },
    },
  };
}

async function keenableFetch(options: EngineRequest): Promise<EngineOutput> {
  if (!options.url) {
    throw new Error('Fetch mode requires a URL.');
  }
  const apiKeys = splitApiKeys(options.settings.apiKey);
  const apiKey = apiKeys[0] ?? null;
  const apiKeySecrets = [...new Set([...apiKeys, ...(options.apiKeySecrets ?? [])])];
  const secrets = [...apiKeySecrets, options.settings.baseURL];
  const target = normalizeFetchUrl(options.url);
  // One deadline for the DNS check, the request, and the body.
  const deadline = AbortSignal.timeout(options.timeoutMs);

  await assertCloudDisclosable('keenable', target, deadline, options.timeoutMs);

  // `-u` with `-q` asks for one part of the page. Keenable's `prompt` has a
  // model extract that part, so the content becomes its answer, not the page.
  const warnings: string[] = [];
  const focus = [options.query?.trim(), options.extraPrompt?.trim()].filter(Boolean).join('\n');
  let prompt: string | undefined;
  if (focus.length > PROMPT_CEILING) {
    warnings.push(
      `The focus is longer than Keenable's ${PROMPT_CEILING}-character prompt limit, so the whole page was returned instead of an extract.`,
    );
  } else if (focus) {
    prompt = focus;
  }

  const params = new URLSearchParams({
    url: target.toString(),
    max_chars: String(MAX_CONTENT_CHARS),
    // Read the page now rather than Keenable's indexed copy: stale content is
    // fatal for a tool whose whole point is current information.
    live: 'true',
  });
  if (prompt) {
    params.set('prompt', prompt);
  }

  const startedAt = Date.now();
  const { response, text } = await requestText(
    'keenable',
    `${resolveEndpoint(
      options.settings.baseURL,
      KEENABLE_DEFAULT_BASE,
      apiKey ? '/v1/fetch' : '/v1/fetch/public',
    )}?${params.toString()}`,
    { method: 'GET', headers: keenableHeaders(apiKey) },
    deadline,
    options.timeoutMs,
    secrets,
  );
  ensureOk(response, text, apiKey, secrets);

  const data = JSON.parse(text) as KeenableFetchResponse;
  // Keenable cuts at max_chars already. The local slice keeps the shared cap
  // true even for a gateway behind baseURL that ignores the parameter.
  const rawContent = data.content ?? '';
  const content = rawContent.slice(0, MAX_CONTENT_CHARS);
  const truncated = data.truncated === true || rawContent.length > MAX_CONTENT_CHARS;
  const finalUrl = data.url || target.toString();

  if (prompt) {
    warnings.unshift(
      `Content is Keenable's model extract for the focus "${prompt}", not the page text. Fetch without -q for the full page.`,
    );
  } else {
    warnings.unshift(
      "Fetched through Keenable's cloud reader. The content is its markdown extraction, not the raw page as served.",
    );
  }
  if (truncated) {
    warnings.push(`Content truncated at ${MAX_CONTENT_CHARS} characters.`);
  }

  const uncertainty: string[] = [];
  if (!prompt && content.length < 200) {
    uncertainty.push(
      'Very little content came back from Keenable. The page may be sparse, or built by browser-side JavaScript the reader did not run.',
    );
  }

  return {
    result: {
      summary: data.title || finalUrl,
      content,
      links: prompt ? [] : markdownLinks(content),
      uncertainty,
      warnings,
    },
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: {
        url: finalUrl,
        totalChars: data.total_chars ?? null,
        publishedAt: data.published_at ?? null,
      },
    },
  };
}

/** Absolute http(s) links written in the markdown, first occurrence of each. */
export function markdownLinks(markdown: string): Array<{ text: string; url: string }> {
  const out: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(/\[([^\]]*)\]\((https?:\/\/[^\s)]+)/gi)) {
    const url = match[2];
    if (seen.has(url)) {
      continue;
    }
    seen.add(url);
    out.push({ text: (match[1].trim() || url).slice(0, 100), url });
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

export const keenableProvider: SearchEngine = {
  name: 'keenable',
  roles: ['search', 'fetch'],
  requirement:
    'nothing: search and public-page fetch work keyless (1,000 requests/hour per IP, no signup). A free key lifts the hourly cap (100,000 requests/month). Opt out of cloud fetch with keenable.keylessFetch false',
  // Keyless search needs nothing. Keyless fetch is on by default and the
  // check is strict on purpose, as in firecrawl.ts: a malformed value counts
  // as off, so a broken config fails closed rather than sending URLs to the
  // cloud on a guess. A configured key always enables fetch.
  isAvailable: (settings, env, role) =>
    role === 'search' ||
    splitApiKeys(settings.apiKey).length > 0 ||
    splitApiKeys(env.KEENABLE_API_KEY).length > 0 ||
    settings.keylessFetch === undefined ||
    settings.keylessFetch === true,
  execute: executeKeenable,
};
