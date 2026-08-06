// The `local` engine: direct HTTP page fetch, ported from the retired modfetch
// project. No LLM, no browser, no key, no quota: it opens the URL, strips the
// markup, and hands back the visible text. Quality is below the agy route (no
// synthesis, no focus extraction, and JS-rendered pages come back thin), but it
// is the only fetch engine that works with nothing installed.
//
// This module is the transport and the engine adapter: it drives one fetch
// (with every redirect hop re-validated), reads the body under caps, and maps
// the result onto the shared engine contract. The SSRF guards live in
// ./http/network.ts and the markup handling in ./http/htmlExtract.ts.
import { Agent } from 'undici';
import { assertSafeRemoteTarget, normalizeFetchUrl, type PinnedTarget } from './http/network.ts';
import {
  extractLinks,
  extractVisibleTextFromHtml,
  normalizeWhitespace,
} from './http/htmlExtract.ts';
import type { EngineRequest, EngineOutput, SearchEngine } from './index.ts';

export interface FetchOptions {
  url: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxChars?: number;
  maxRedirects?: number;
  userAgent?: string;
  allowPrivateNetwork?: boolean;
}

export interface FetchResult {
  /** Raw body, kept so callers can pull links out of it. */
  rawHtml?: string;
  requestUrl: string;
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string;
  title: string | null;
  text: string;
  meta: {
    fetchedAt: string;
    bytes: number;
    truncated: boolean;
    redirectChain: string[];
    timeoutMs: number;
    maxBytes: number;
    maxChars: number;
    privateNetworkAllowed: boolean;
  };
}

interface FetchStepResult {
  response: Response;
  elapsedMs: number;
}

interface ReadBodyResult {
  body: Uint8Array;
  bytes: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_BYTES = 2_000_000;
const DEFAULT_MAX_CHARS = 50_000;
const DEFAULT_MAX_REDIRECTS = 4;

export async function runFetch(options: FetchOptions): Promise<FetchResult> {
  const requestUrl = normalizeFetchUrl(options.url);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const allowPrivateNetwork = options.allowPrivateNetwork ?? false;
  const userAgent = options.userAgent ?? 'modsearch (+https://github.com/liustack/modsearch)';

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Invalid timeoutMs. Use a positive integer.');
  }

  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new Error('Invalid maxBytes. Use a positive integer.');
  }

  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    throw new Error('Invalid maxChars. Use a positive integer.');
  }

  if (!Number.isFinite(maxRedirects) || maxRedirects < 0) {
    throw new Error('Invalid maxRedirects. Use a non-negative integer.');
  }

  let currentUrl = requestUrl;
  const redirectChain: string[] = [];
  // One deadline for the whole run: DNS, every redirect hop, and the body.
  const deadline = AbortSignal.timeout(timeoutMs);
  // Every pinned dispatcher created along the way, closed when the run ends.
  const dispatchers: Agent[] = [];

  try {
    for (let i = 0; i <= maxRedirects; i += 1) {
      // Validate, then pin the socket to the exact IP that was validated. Each
      // redirect hop repeats both, so a mid-run DNS change cannot slip through.
      const pinned = await assertSafeRemoteTarget(currentUrl, allowPrivateNetwork);
      const dispatcher = pinnedDispatcher(pinned);
      dispatchers.push(dispatcher);

      const { response } = await fetchOnce(currentUrl, dispatcher, deadline, timeoutMs, userAgent);
      if (isRedirectStatus(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(`Redirect response (${response.status}) missing location header.`);
        }

        if (i === maxRedirects) {
          throw new Error(`Too many redirects. Max redirects: ${maxRedirects}.`);
        }

        const nextUrl = new URL(location, currentUrl);
        redirectChain.push(currentUrl.toString());
        currentUrl = nextUrl;
        continue;
      }

      const contentTypeHeader = response.headers.get('content-type') || '';
      if (!isTextLikeContentType(contentTypeHeader)) {
        throw new Error(
          `Unsupported content-type: ${contentTypeHeader || 'unknown'}. Only text-like content is allowed.`,
        );
      }

      const readBody = await readBodyWithLimit(response, maxBytes, timeoutMs);
      const decoded = decodeBody(readBody.body, contentTypeHeader);

      const normalizedContentType = contentTypeHeader.split(';')[0]?.trim().toLowerCase() || '';
      const extraction =
        normalizedContentType.includes('html') || normalizedContentType.includes('xhtml')
          ? extractVisibleTextFromHtml(decoded)
          : {
              title: null,
              text: normalizeWhitespace(decoded),
            };

      const trimmed = trimToMaxChars(extraction.text, maxChars);

      return {
        rawHtml: normalizedContentType.includes('html') ? decoded : undefined,
        requestUrl: requestUrl.toString(),
        finalUrl: currentUrl.toString(),
        status: response.status,
        statusText: response.statusText,
        contentType: contentTypeHeader,
        title: extraction.title,
        text: trimmed.text,
        meta: {
          fetchedAt: new Date().toISOString(),
          bytes: readBody.bytes,
          truncated: trimmed.truncated,
          redirectChain,
          timeoutMs,
          maxBytes,
          maxChars,
          privateNetworkAllowed: allowPrivateNetwork,
        },
      };
    }

    throw new Error('Failed to fetch target URL.');
  } finally {
    // The body is fully read into memory before we return, so closing the
    // pinned dispatchers here frees their sockets without cutting a live read.
    for (const dispatcher of dispatchers) {
      dispatcher.close().catch(() => {});
    }
  }
}

/**
 * An undici dispatcher whose DNS lookup is hard-wired to the one IP the safety
 * check validated. The connection goes to that IP, while the URL's hostname
 * still drives the Host header and TLS SNI, so a DNS answer that changes after
 * the check cannot redirect the socket.
 */
function pinnedDispatcher(pinned: PinnedTarget): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const record = { address: pinned.address, family: pinned.family };
        // undici asks with { all: true } and expects an array; be tolerant of
        // the single-record signature too.
        if (options && (options as { all?: boolean }).all) {
          (callback as (err: Error | null, addresses: Array<{ address: string; family: number }>) => void)(
            null,
            [record],
          );
        } else {
          (callback as (err: Error | null, address: string, family: number) => void)(
            null,
            pinned.address,
            pinned.family,
          );
        }
      },
    },
  });
}

/**
 * One request against an already validated target. The caller owns the signal
 * so it stays armed while the body streams: aborting only on response headers
 * left a slow body able to hang forever.
 */
async function fetchOnce(
  url: URL,
  dispatcher: Agent,
  signal: AbortSignal,
  timeoutMs: number,
  userAgent: string,
): Promise<FetchStepResult> {
  const started = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal,
      // `dispatcher` is a Node/undici extension to fetch's options, not in the
      // DOM RequestInit type, so it is attached through a cast.
      dispatcher,
      headers: {
        'user-agent': userAgent,
        accept:
          'text/html,application/xhtml+xml,application/json,text/plain,application/xml,text/xml;q=0.9,*/*;q=0.5',
      },
    } as unknown as RequestInit & { dispatcher: Agent });

    return {
      response,
      elapsedMs: Date.now() - started,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(`Request timed out after ${timeoutMs} ms.`);
    }
    throw new Error(`Request failed for ${url.toString()}: ${formatErrorWithCause(error)}`);
  }
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
  timeoutMs: number,
): Promise<ReadBodyResult> {
  const body = response.body;
  if (!body) {
    return {
      body: new Uint8Array(),
      bytes: 0,
    };
  }

  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const contentLength = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`Response body exceeds max size ${maxBytes} bytes.`);
    }
  }

  const reader = body.getReader();
  // The shared deadline aborts this stream too: report it as a timeout rather
  // than as an opaque stream error.
  const asTimeout = (error: unknown) => {
    if (isAbortError(error)) {
      throw new Error(`Request timed out after ${timeoutMs} ms while reading the body.`);
    }
    throw error;
  };
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read().catch(asTimeout);
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    total += value.length;
    if (total > maxBytes) {
      throw new Error(`Response body exceeds max size ${maxBytes} bytes.`);
    }

    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return {
    body: result,
    bytes: total,
  };
}

function decodeBody(body: Uint8Array, contentTypeHeader: string): string {
  const charset = parseCharset(contentTypeHeader) || 'utf-8';
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}

function parseCharset(contentTypeHeader: string): string | null {
  const matched = /charset=([^;]+)/i.exec(contentTypeHeader);
  if (!matched) {
    return null;
  }

  return matched[1].trim().toLowerCase().replace(/^"|"$/g, '');
}

function isTextLikeContentType(contentTypeHeader: string): boolean {
  const normalized = contentTypeHeader.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (normalized.startsWith('text/')) {
    return true;
  }

  return (
    normalized.includes('json') ||
    normalized.includes('xml') ||
    normalized.includes('html') ||
    normalized.includes('javascript') ||
    normalized.includes('x-www-form-urlencoded')
  );
}

function trimToMaxChars(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) {
    return {
      text,
      truncated: false,
    };
  }

  return {
    text: text.slice(0, maxChars),
    truncated: true,
  };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isAbortError(error: unknown): boolean {
  // AbortSignal.timeout rejects with TimeoutError, not AbortError, so a plain
  // name check reported real timeouts as generic request failures.
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return true;
  }
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as { name?: string; code?: string };
  return err.name === 'AbortError' || err.code === 'ABORT_ERR';
}

function formatErrorWithCause(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      return `${error.message}; cause: ${cause.message}`;
    }

    if (cause !== undefined) {
      return `${error.message}; cause: ${String(cause)}`;
    }

    return error.message;
  }

  return String(error);
}

// ---------- modsearch engine surface ----------

export async function executeHttpFetch(options: EngineRequest): Promise<EngineOutput> {
  if (options.mode !== 'fetch' || !options.url) {
    throw new Error(
      'The local engine does not support search (-q). It fetches one page at a time.',
    );
  }

  const startedAt = Date.now();
  const allowPrivate = options.allowPrivateNetwork === true;
  const result = await runFetch({
    url: options.url,
    timeoutMs: Math.min(options.timeoutMs, 60_000),
    allowPrivateNetwork: allowPrivate,
  });

  // How the page was fetched (method, truncation, redirects, private-network
  // override) is a runtime warning, not a fact the page was unsure about.
  const warnings: string[] = [
    'Fetched directly by the local engine with no LLM synthesis: this is the page text as served, not a restructured summary.',
  ];
  if (result.meta.truncated) {
    warnings.push(`Content truncated at ${result.meta.maxChars} characters.`);
  }
  if (result.meta.redirectChain.length > 0) {
    warnings.push(`Followed ${result.meta.redirectChain.length} redirect(s) to ${result.finalUrl}.`);
  }
  if (options.extraPrompt || options.query) {
    warnings.push(
      'This engine cannot narrow the page to a focus. The full text is here, so pick out the relevant parts yourself.',
    );
  }
  if (allowPrivate) {
    warnings.push(
      'Private network protection was disabled for this fetch, so the URL was trusted as given.',
    );
  }

  // A page that came back nearly empty is genuine doubt about the evidence: the
  // content may be incomplete. That is epistemic, so it stays in uncertainty.
  const uncertainty: string[] = [];
  if (result.text.length < 200) {
    uncertainty.push(
      'Very little text came back. The page is probably rendered by JavaScript, which this engine does not run.',
    );
  }

  return {
    result: {
      summary: `${result.title ?? result.finalUrl} (local fetch, ${result.status} ${result.statusText})`,
      content: result.text,
      links: result.rawHtml ? extractLinks(result.rawHtml, result.finalUrl) : [],
      uncertainty,
      warnings,
    },
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { bytes: result.meta.bytes, redirects: result.meta.redirectChain.length },
    },
  };
}

export const httpFetchProvider: SearchEngine = {
  name: 'local',
  roles: ['fetch'],
  requirement: 'nothing, it always works',
  isAvailable: () => true,
  execute: executeHttpFetch,
};
