// Direct HTTP page fetch, ported from the retired modfetch project. No LLM,
// no browser, no key, no quota: it opens the URL, strips the markup, and hands
// back the visible text. Quality is below the agy route (no synthesis, no
// focus extraction, and JS-rendered pages come back thin), but it is the only
// fetch engine that works with nothing installed.
//
// The SSRF guards are the load-bearing part: an agent will happily fetch a URL
// that appeared inside a web page, so blocked hostnames, private address
// ranges, and every redirect hop are checked before a request goes out.
import * as dns from 'dns/promises';
import { isIP } from 'net';
import type {
  EngineRequest,
  EngineOutput,
  SearchEngine,
} from './index.ts';

export interface FetchOptions {
  url: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxChars?: number;
  maxRedirects?: number;
  userAgent?: string;
  allowPrivateNetwork?: boolean;
}

export interface HtmlExtractionResult {
  title: string | null;
  text: string;
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

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.amazonaws.com',
  'metadata.azure.internal',
]);

export function normalizeFetchUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Fetch URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid URL: ${trimmed}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URL with embedded credentials is not allowed.');
  }

  return parsed;
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }

  if (normalized.endsWith('.localhost')) {
    return true;
  }

  return false;
}

export function isPrivateIpAddress(ipAddress: string): boolean {
  const normalized = ipAddress.trim().toLowerCase();
  const family = isIP(normalized);

  if (family === 4) {
    return isPrivateIPv4(normalized);
  }

  if (family === 6) {
    return isPrivateIPv6(normalized);
  }

  return true;
}

/**
 * Drop `<tag>...</tag>` spans by scanning, not by regex. The nested-quantifier
 * patterns this replaces took 14 seconds on a 200 KB page of malformed markup,
 * and bodies here can reach 2 MB, so a remote page could hang the CLI.
 */
export function stripElement(html: string, tag: string): string {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const haystack = html.toLowerCase();
  let out = '';
  let cursor = 0;

  for (;;) {
    const start = haystack.indexOf(open, cursor);
    if (start === -1) {
      return out + html.slice(cursor);
    }
    const boundary = haystack[start + open.length];
    if (boundary !== undefined && !/[\s/>]/.test(boundary)) {
      // Something like <scripting>: not the tag we are looking for.
      out += html.slice(cursor, start + open.length);
      cursor = start + open.length;
      continue;
    }
    out += `${html.slice(cursor, start)} `;
    const end = haystack.indexOf(close, start);
    if (end === -1) {
      // Unclosed: the rest of the document belongs to this element.
      return out;
    }
    cursor = end + close.length;
  }
}

function stripComments(html: string): string {
  let out = '';
  let cursor = 0;
  for (;;) {
    const start = html.indexOf('<!--', cursor);
    if (start === -1) {
      return out + html.slice(cursor);
    }
    out += `${html.slice(cursor, start)} `;
    const end = html.indexOf('-->', start + 4);
    if (end === -1) {
      return out;
    }
    cursor = end + 3;
  }
}

export function extractVisibleTextFromHtml(html: string): HtmlExtractionResult {
  const title = extractTitle(html);
  let withoutHidden = html;
  for (const tag of ['head', 'script', 'style', 'noscript', 'template']) {
    withoutHidden = stripElement(withoutHidden, tag);
  }
  withoutHidden = stripComments(withoutHidden);

  const withBreaks = withoutHidden
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/(address|article|aside|blockquote|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tr|td|th|ul)>/gi,
      '\n',
    );

  const withoutTags = withBreaks.replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(withoutTags);
  const text = normalizeWhitespace(decoded);

  return {
    title,
    text,
  };
}

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

  for (let i = 0; i <= maxRedirects; i += 1) {
    await assertSafeRemoteTarget(currentUrl, allowPrivateNetwork);

    const { response } = await fetchOnce(currentUrl, deadline, timeoutMs, userAgent);
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
}

async function assertSafeRemoteTarget(url: URL, allowPrivateNetwork: boolean): Promise<void> {
  if (isBlockedHostname(url.hostname)) {
    throw new Error(`Blocked hostname: ${url.hostname}`);
  }

  if (allowPrivateNetwork) {
    return;
  }

  const hostname = stripIpv6Brackets(url.hostname);
  const ipFamily = isIP(hostname);
  if (ipFamily > 0) {
    if (isPrivateIpAddress(hostname)) {
      throw new Error(`Blocked private network target: ${hostname}`);
    }
    return;
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(
      `DNS lookup failed for host ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (resolved.length === 0) {
    throw new Error(`Host ${hostname} did not resolve to any IP address.`);
  }

  const blocked = resolved.find((record) => isPrivateIpAddress(record.address));
  if (blocked) {
    // VPN and proxy clients routinely map public hosts into reserved ranges
    // (198.18/15 especially), so a real site can look private from here.
    throw new Error(
      `Blocked private network target: ${hostname} -> ${blocked.address}. If a VPN or proxy on this machine maps public hosts into reserved ranges, allow it with --allow-private-network, or: modsearch config set http.allowPrivateNetwork true`,
    );
  }
}

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * One request against an already validated target. The caller owns the signal
 * so it stays armed while the body streams: aborting only on response headers
 * left a slow body able to hang forever.
 */
async function fetchOnce(
  url: URL,
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
      headers: {
        'user-agent': userAgent,
        accept:
          'text/html,application/xhtml+xml,application/json,text/plain,application/xml,text/xml;q=0.9,*/*;q=0.5',
      },
    });

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

function extractTitle(html: string): string | null {
  const matched = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!matched) {
    return null;
  }

  const decoded = decodeHtmlEntities(matched[1]);
  const normalized = normalizeWhitespace(decoded);
  return normalized || null;
}

/** Code points a remote page can name but JavaScript cannot build. */
function safeFromCodePoint(codePoint: number): string | null {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return null;
  }
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    return null;
  }
  return String.fromCodePoint(codePoint);
}

function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    const lower = entity.toLowerCase();

    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return safeFromCodePoint(code) ?? full;
    }

    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return safeFromCodePoint(code) ?? full;
    }

    return namedEntities[lower] ?? full;
  });
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isAbortError(error: unknown): boolean {
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

function isPrivateIPv4(ipAddress: string): boolean {
  const octets = ipAddress.split('.').map((part) => Number.parseInt(part, 10));
  if (octets.length !== 4 || octets.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    return true;
  }

  const value =
    octets[0] * 256 ** 3 + octets[1] * 256 ** 2 + octets[2] * 256 + octets[3];

  return (
    inRange(value, '0.0.0.0', '0.255.255.255') ||
    inRange(value, '10.0.0.0', '10.255.255.255') ||
    inRange(value, '100.64.0.0', '100.127.255.255') ||
    inRange(value, '127.0.0.0', '127.255.255.255') ||
    inRange(value, '169.254.0.0', '169.254.255.255') ||
    inRange(value, '172.16.0.0', '172.31.255.255') ||
    inRange(value, '192.0.0.0', '192.0.0.255') ||
    inRange(value, '192.168.0.0', '192.168.255.255') ||
    inRange(value, '198.18.0.0', '198.19.255.255') ||
    inRange(value, '224.0.0.0', '255.255.255.255')
  );
}

function inRange(value: number, start: string, end: string): boolean {
  return value >= ipv4ToNumber(start) && value <= ipv4ToNumber(end);
}

function ipv4ToNumber(ipAddress: string): number {
  const octets = ipAddress.split('.').map((part) => Number.parseInt(part, 10));
  return octets[0] * 256 ** 3 + octets[1] * 256 ** 2 + octets[2] * 256 + octets[3];
}

function isPrivateIPv6(ipAddress: string): boolean {
  // ::ffff:127.0.0.1 normalizes to ::ffff:7f00:1, whose last two groups are
  // the IPv4 address in hex. Judging it as IPv6 would wave through loopback.
  const groups = expandIpv6(ipAddress);
  if (
    groups &&
    groups.slice(0, 5).every((group) => group === 0) &&
    groups[5] === 0xffff
  ) {
    const mapped = [
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ].join('.');
    return isPrivateIPv4(mapped);
  }

  const normalized = ipAddress.split('%')[0];
  const mapped = extractMappedIpv4(normalized);
  if (mapped && isPrivateIPv4(mapped)) {
    return true;
  }

  const value = ipv6ToBigInt(normalized);
  if (value === null) {
    return true;
  }

  return (
    inIpv6Range(value, '::', 128) ||
    inIpv6Range(value, '::1', 128) ||
    inIpv6Range(value, 'fc00::', 7) ||
    inIpv6Range(value, 'fe80::', 10) ||
    inIpv6Range(value, 'ff00::', 8) ||
    inIpv6Range(value, '2001:db8::', 32)
  );
}

function extractMappedIpv4(ipAddress: string): string | null {
  const lower = ipAddress.toLowerCase();
  const marker = '::ffff:';
  if (!lower.startsWith(marker)) {
    return null;
  }

  const candidate = lower.slice(marker.length);
  return isIP(candidate) === 4 ? candidate : null;
}

function inIpv6Range(value: bigint, start: string, prefixLength: number): boolean {
  const startValue = ipv6ToBigInt(start);
  if (startValue === null) {
    return false;
  }

  const mask = prefixLength === 0 ? 0n : ((1n << BigInt(prefixLength)) - 1n) << BigInt(128 - prefixLength);
  return (value & mask) === (startValue & mask);
}

function ipv6ToBigInt(ipAddress: string): bigint | null {
  const expanded = expandIpv6(ipAddress);
  if (!expanded) {
    return null;
  }

  return expanded.reduce((acc, group) => (acc << 16n) + BigInt(group), 0n);
}

function expandIpv6(ipAddress: string): number[] | null {
  const value = ipAddress.toLowerCase();
  if (value.includes('::')) {
    const [left, right] = value.split('::');
    const leftGroups = left ? left.split(':').filter(Boolean) : [];
    const rightGroups = right ? right.split(':').filter(Boolean) : [];

    if (leftGroups.length + rightGroups.length > 8) {
      return null;
    }

    const middle = new Array(8 - leftGroups.length - rightGroups.length).fill('0');
    const allGroups = [...leftGroups, ...middle, ...rightGroups];
    return parseIpv6Groups(allGroups);
  }

  return parseIpv6Groups(value.split(':'));
}

function parseIpv6Groups(groups: string[]): number[] | null {
  if (groups.length !== 8) {
    return null;
  }

  const parsed = groups.map((group) => Number.parseInt(group || '0', 16));
  if (parsed.some((value) => !Number.isFinite(value) || value < 0 || value > 0xffff)) {
    return null;
  }

  return parsed;
}

// ---------- modsearch provider surface ----------

const MAX_LINKS = 20;

/** Absolute outbound links, deduped, in document order. */
export function extractLinks(html: string, baseUrl: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  // A document's own <base href> decides what relative links mean, not the URL
  // we happened to land on.
  const baseTag = /<base\b[^>]*href=["']([^"']+)["']/i.exec(html);
  let resolvedBase = baseUrl;
  if (baseTag) {
    try {
      resolvedBase = new URL(decodeHtmlEntities(baseTag[1]), baseUrl).toString();
    } catch {
      // keep the response URL
    }
  }
  const seen = new Set<string>();
  const anchor = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null && links.length < MAX_LINKS) {
    const href = decodeHtmlEntities(match[1]);
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) {
      continue;
    }
    let absolute: string;
    try {
      absolute = new URL(href, resolvedBase).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(absolute) || seen.has(absolute)) {
      continue;
    }
    const text = normalizeWhitespace(decodeHtmlEntities(match[2].replace(/<[^>]+>/g, ' ')))
      .trim()
      .slice(0, 100);
    if (!text) {
      continue;
    }
    seen.add(absolute);
    links.push({ text, url: absolute });
  }
  return links;
}

export async function executeHttpFetch(
  options: EngineRequest,
): Promise<EngineOutput> {
  if (options.mode !== 'fetch' || !options.url) {
    throw new Error('The http engine does not support search (-q). It fetches one page at a time.');
  }

  const startedAt = Date.now();
  const allowPrivate = options.settings.allowPrivateNetwork === 'true';
  const result = await runFetch({
    url: options.url,
    timeoutMs: Math.min(options.timeoutMs, 60_000),
    allowPrivateNetwork: allowPrivate,
  });

  const uncertainty: string[] = [
    'Fetched directly over HTTP with no LLM synthesis: this is the page text as served, not a restructured summary.',
  ];
  if (result.meta.truncated) {
    uncertainty.push(`Content truncated at ${result.meta.maxChars} characters.`);
  }
  if (result.meta.redirectChain.length > 0) {
    uncertainty.push(`Followed ${result.meta.redirectChain.length} redirect(s) to ${result.finalUrl}.`);
  }
  if (options.extraPrompt || options.query) {
    uncertainty.push(
      'This engine cannot narrow the page to a focus. The full text is here, so pick out the relevant parts yourself.',
    );
  }
  if (allowPrivate) {
    uncertainty.push(
      'Private network protection was disabled for this fetch, so the URL was trusted as given.',
    );
  }
  if (result.text.length < 200) {
    uncertainty.push(
      'Very little text came back. The page is probably rendered by JavaScript, which this engine does not run.',
    );
  }

  return {
    result: {
      summary: `${result.title ?? result.finalUrl} (direct HTTP fetch, ${result.status} ${result.statusText})`,
      content: result.text,
      links: result.rawHtml ? extractLinks(result.rawHtml, result.finalUrl) : [],
      uncertainty,
    },
    meta: {
      conversationId: null,
      durationSeconds: (Date.now() - startedAt) / 1000,
      usage: { bytes: result.meta.bytes, redirects: result.meta.redirectChain.length },
    },
  };
}

export const httpFetchProvider: SearchEngine = {
  name: 'http',
  roles: ['fetch'],
  requirement: 'nothing, it always works',
  isAvailable: () => true,
  execute: executeHttpFetch,
};
