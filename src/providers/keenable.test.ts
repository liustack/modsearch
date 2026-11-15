import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyQuota } from '../cooldown.ts';
import { isApiKeyFailure } from '../util/apiKeys.ts';
import { resolveEngine } from './index.ts';
import { executeKeenable, markdownLinks } from './keenable.ts';

// Mock DNS so the fetch gate is testable offline: a public-looking host that
// resolves to a reserved IP must never reach the cloud reader.
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock('dns/promises', () => ({ lookup: lookupMock }));

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Mock the global fetch with a JSON response, capturing the request. */
function mockFetchJson(
  body: unknown,
  init: { status?: number; text?: string; headers?: Record<string, string> } = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const status = init.status ?? 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, requestInit: RequestInit) => {
      calls.push({ url, init: requestInit });
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: new Headers(init.headers),
        text: async () => init.text ?? JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

function search(settings: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  return executeKeenable({
    mode: 'search',
    query: 'node 24 lts',
    timeoutMs: 1000,
    settings,
    ...extra,
  });
}

describe('keenable provider', () => {
  it('searches with no setup and fetches keyless unless opted out', () => {
    const engine = resolveEngine('keenable');
    expect(engine.name).toBe('keenable');
    expect(engine.roles).toEqual(['search', 'fetch']);
    expect(engine.isAvailable({}, {}, 'search')).toBe(true);
    expect(engine.isAvailable({ keylessFetch: false }, {}, 'search')).toBe(true);
    expect(engine.isAvailable({}, {}, 'fetch')).toBe(true);
    expect(engine.isAvailable({ keylessFetch: true }, {}, 'fetch')).toBe(true);
    expect(engine.isAvailable({ keylessFetch: false }, {}, 'fetch')).toBe(false);
    // A malformed value fails closed rather than sending URLs to the cloud.
    expect(engine.isAvailable({ keylessFetch: 'false' as unknown as boolean }, {}, 'fetch')).toBe(
      false,
    );
    // A key enables fetch regardless of the switch, from config or env.
    expect(engine.isAvailable({ keylessFetch: false, apiKey: 'keen_x' }, {}, 'fetch')).toBe(true);
    expect(
      engine.isAvailable({ keylessFetch: false }, { KEENABLE_API_KEY: 'keen_x' }, 'fetch'),
    ).toBe(true);
    expect(engine.execute).toBeTypeOf('function');
  });

  it('calls the keyless endpoint with the app identifier when no key is set', async () => {
    const calls = mockFetchJson({ results: [] });
    await search({}, { maxResults: 5 });
    expect(calls[0].url).toBe('https://api.keenable.ai/v1/search/public');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-keenable-title']).toBe('modsearch');
    expect(headers['x-api-key']).toBeUndefined();
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      query: 'node 24 lts',
      max_results: 5,
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('calls the keyed endpoint with only the first configured key', async () => {
    const calls = mockFetchJson({ results: [] });
    await search({ apiKey: 'keen_one, keen_two' });
    expect(calls[0].url).toBe('https://api.keenable.ai/v1/search');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('keen_one');
    expect(headers['x-keenable-title']).toBeUndefined();
  });

  it('posts to a configured baseURL', async () => {
    const calls = mockFetchJson({ results: [] });
    await search({ baseURL: 'https://gateway.example/keen/' });
    expect(calls[0].url).toBe('https://gateway.example/keen/v1/search/public');
  });

  it('defaults to 10 results and caps at the API ceiling of 50', async () => {
    const calls = mockFetchJson({ results: [] });
    await search();
    await search({}, { maxResults: 200 });
    expect(JSON.parse(calls[0].init.body as string).max_results).toBe(10);
    expect(JSON.parse(calls[1].init.body as string).max_results).toBe(50);
  });

  it('maps results into the search contract with a mechanical summary', async () => {
    mockFetchJson({
      query: 'node 24 lts',
      mode: 'pro',
      results: [
        {
          title: 'Node.js 24 LTS',
          url: 'https://releaserun.com/versions/nodejs/24',
          description: '',
          snippet: 'Node.js 24 entered LTS in October 2025.',
          published_at: '2025-05-06T00:00:00Z',
          acquired_at: '2026-07-15T01:02:21Z',
        },
        {
          title: 'Release notes',
          url: 'https://docs.example/notes',
          description: 'Short summary',
        },
      ],
    });
    const output = await search();
    const result = output.result as {
      summary: string;
      items: Array<Record<string, unknown>>;
      uncertainty: string[];
      warnings: string[];
    };
    expect(result.items).toEqual([
      {
        title: 'Node.js 24 LTS',
        url: 'https://releaserun.com/versions/nodejs/24',
        snippet: 'Node.js 24 entered LTS in October 2025.',
        source: 'releaserun.com',
        published_at: '2025-05-06T00:00:00Z',
      },
      {
        title: 'Release notes',
        url: 'https://docs.example/notes',
        snippet: 'Short summary',
        source: 'docs.example',
      },
    ]);
    expect(result.summary).toMatch(/Keenable returned 2 ranked result/);
    expect(result.uncertainty).toEqual([]);
    expect(result.warnings.join(' ')).toMatch(/mechanical/);
    expect(output.meta.usage).toEqual({ resultCount: 2, mode: 'pro' });
  });

  it('reports an empty result set as uncertainty', async () => {
    mockFetchJson({ results: [] });
    const result = (await search()).result as { summary: string; uncertainty: string[] };
    expect(result.summary).toBe('');
    expect(result.uncertainty).toEqual(['No results found for this query.']);
  });

  it('explains a spent keyless pool without blaming a key', async () => {
    mockFetchJson({}, { status: 429, text: '{"error":"Too Many Requests"}' });
    const error = await search().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(isApiKeyFailure(error)).toBe(false);
    expect((error as Error).message).toMatch(/keyless pool.*config set keenable\.apiKey/s);
  });

  it('treats 401 with a key as a key problem with a config-set fix', async () => {
    mockFetchJson({}, { status: 401, text: '{"error":"Invalid API key"}' });
    const error = await search({ apiKey: 'keen_bad' }).catch((caught: unknown) => caught);
    expect(isApiKeyFailure(error)).toBe(true);
    expect((error as Error).message).toMatch(/rejected the API key \(401\).*config set keenable/);
  });

  it('reads 402 as the spent monthly allowance', async () => {
    mockFetchJson({}, { status: 402, text: '{"error":"No credits available"}' });
    const error = await search({ apiKey: 'keen_ok' }).catch((caught: unknown) => caught);
    expect(isApiKeyFailure(error)).toBe(true);
    expect((error as Error).message).toMatch(/out of credits \(HTTP 402\)/);
  });

  it('redacts every configured key from an echoed error body', async () => {
    mockFetchJson({}, { status: 403, text: 'key keen_one and keen_two are revoked' });
    const error = await search({ apiKey: 'keen_one,keen_two' }).catch((caught: unknown) => caught);
    const message = (error as Error).message;
    expect(message).not.toContain('keen_one');
    expect(message).not.toContain('keen_two');
  });

  it('keeps a server error retryable rather than a key failure', async () => {
    mockFetchJson({}, { status: 500, text: '{"error":"Internal server error"}' });
    const error = await search({ apiKey: 'keen_ok' }).catch((caught: unknown) => caught);
    expect(isApiKeyFailure(error)).toBe(false);
    expect((error as Error).message).toMatch(/keenable returned 500/);
  });
});

function fetchPage(
  settings: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
) {
  return executeKeenable({
    mode: 'fetch',
    url: 'https://nodejs.org/en/about/previous-releases',
    timeoutMs: 1000,
    settings,
    ...extra,
  });
}

const PAGE = {
  url: 'https://nodejs.org/en/about/previous-releases',
  title: 'Node.js Releases',
  content:
    '# Node.js Releases\n\nSee the [EOL page](https://nodejs.org/en/about/eol) and [EOL page](https://nodejs.org/en/about/eol) again, plus a [relative](/x) link.\n'.repeat(
      4,
    ),
  author: '@nodejs',
  published_at: '2026-10-29T00:00:00Z',
  truncated: false,
  total_chars: 400,
};

describe('keenable fetch', () => {
  it('reads keyless and live through the public fetch endpoint', async () => {
    const calls = mockFetchJson(PAGE);
    const output = await fetchPage();
    const sent = new URL(calls[0].url);
    expect(`${sent.origin}${sent.pathname}`).toBe('https://api.keenable.ai/v1/fetch/public');
    expect(calls[0].init.method).toBe('GET');
    expect(sent.searchParams.get('url')).toBe(PAGE.url);
    expect(sent.searchParams.get('live')).toBe('true');
    expect(sent.searchParams.get('max_chars')).toBe('50000');
    expect(sent.searchParams.has('prompt')).toBe(false);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-keenable-title']).toBe('modsearch');
    expect(headers['x-api-key']).toBeUndefined();

    const result = output.result as {
      summary: string;
      content: string;
      links: Array<{ text: string; url: string }>;
      warnings: string[];
      uncertainty: string[];
    };
    expect(result.summary).toBe('Node.js Releases');
    expect(result.content).toBe(PAGE.content);
    // Absolute links only, each once.
    expect(result.links).toEqual([{ text: 'EOL page', url: 'https://nodejs.org/en/about/eol' }]);
    expect(result.warnings[0]).toMatch(/Keenable's cloud reader/);
    expect(result.uncertainty).toEqual([]);
  });

  it('uses the keyed endpoint when a key is set', async () => {
    const calls = mockFetchJson(PAGE);
    await fetchPage({ apiKey: 'keen_one,keen_two' });
    expect(new URL(calls[0].url).pathname).toBe('/v1/fetch');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('keen_one');
  });

  it('turns -q into an extraction prompt and says the content is an extract', async () => {
    const calls = mockFetchJson({ ...PAGE, content: 'Node 24 is the Active LTS.' });
    const output = await fetchPage({}, { query: 'current LTS', extraPrompt: 'version only' });
    expect(new URL(calls[0].url).searchParams.get('prompt')).toBe('current LTS\nversion only');
    const result = output.result as { links: unknown[]; warnings: string[]; uncertainty: string[] };
    expect(result.warnings[0]).toMatch(/model extract for the focus/);
    expect(result.links).toEqual([]);
    // A short extract is the point, not a sign of a sparse page.
    expect(result.uncertainty).toEqual([]);
  });

  it('drops a focus over the prompt limit and returns the whole page', async () => {
    const calls = mockFetchJson(PAGE);
    const output = await fetchPage({}, { query: 'x'.repeat(2001) });
    expect(new URL(calls[0].url).searchParams.has('prompt')).toBe(false);
    expect((output.result as { warnings: string[] }).warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/2000-character prompt limit/)]),
    );
  });

  it('notes truncation reported by Keenable', async () => {
    mockFetchJson({ ...PAGE, truncated: true, total_chars: 90_000 });
    const output = await fetchPage();
    expect((output.result as { warnings: string[] }).warnings).toEqual(
      expect.arrayContaining(['Content truncated at 50000 characters.']),
    );
  });

  it('flags a nearly empty page as doubt about the evidence', async () => {
    mockFetchJson({ ...PAGE, content: 'Loading...' });
    const output = await fetchPage();
    expect((output.result as { uncertainty: string[] }).uncertainty[0]).toMatch(
      /Very little content/,
    );
  });

  it('never sends a literal private target to the cloud', async () => {
    const calls = mockFetchJson(PAGE);
    await expect(
      fetchPage({}, { url: 'http://192.168.1.1/admin', allowPrivateNetwork: true }),
    ).rejects.toThrow(/keenable does not fetch the private or reserved target.*local engine/i);
    expect(calls).toHaveLength(0);
  });

  it('never sends a hostname that resolves only to private addresses', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const calls = mockFetchJson(PAGE);
    await expect(fetchPage({}, { url: 'https://intranet.example.com/' })).rejects.toThrow(
      /private or reserved target intranet\.example\.com -> 10\.0\.0\.5/,
    );
    expect(calls).toHaveLength(0);
  });

  it('reads a fake-IP DNS answer as a public placeholder', async () => {
    lookupMock.mockResolvedValue([{ address: '198.18.0.42', family: 4 }]);
    const calls = mockFetchJson(PAGE);
    await fetchPage();
    expect(calls).toHaveLength(1);
  });

  it('does not blame the key when Keenable refuses the target with 403', async () => {
    mockFetchJson(
      {},
      {
        status: 403,
        text: '{"error":"Forbidden","code":"private_url_not_allowed","message":"Fetching from private/internal IP addresses is not allowed"}',
      },
    );
    const error = await fetchPage({ apiKey: 'keen_ok' }).catch((caught: unknown) => caught);
    expect(isApiKeyFailure(error)).toBe(false);
    expect((error as Error).message).toMatch(/keenable returned 403.*private_url_not_allowed/);
  });

  it('still reads a keyed 403 about the key as a key problem', async () => {
    mockFetchJson({}, { status: 403, text: '{"error":"Forbidden","code":"api_key_revoked"}' });
    const error = await fetchPage({ apiKey: 'keen_old' }).catch((caught: unknown) => caught);
    expect(isApiKeyFailure(error)).toBe(true);
  });

  it('explains a spent keyless pool on fetch too', async () => {
    mockFetchJson({}, { status: 429, text: '{"error":"Too Many Requests"}' });
    await expect(fetchPage()).rejects.toThrow(/keyless pool for this IP is used up/);
  });
});

describe('markdownLinks', () => {
  it('keeps absolute links once each, capped at 20', () => {
    const markdown = Array.from({ length: 25 }, (_, i) => `[l${i}](https://e.com/${i})`).join(' ');
    const links = markdownLinks(`${markdown} [dup](https://e.com/0) [rel](/rel)`);
    expect(links).toHaveLength(20);
    expect(links[0]).toEqual({ text: 'l0', url: 'https://e.com/0' });
  });

  it('falls back to the URL when the link text is empty', () => {
    expect(markdownLinks('[](https://e.com/a)')).toEqual([
      { text: 'https://e.com/a', url: 'https://e.com/a' },
    ]);
  });
});

describe('a spent keyless pool', () => {
  const now = new Date('2026-11-15T14:00:00.000Z');

  it('names the reset time from Retry-After so the cooldown holds Keenable until then', async () => {
    mockFetchJson({}, { status: 429, text: '{"error":"Too Many Requests"}', headers: { 'retry-after': '1800' } });
    const error = await search().catch((caught: unknown) => caught);
    expect((error as Error).message).toMatch(/keyless pool for this IP is used up\. Resets in 30m0s\./);
    expect(classifyQuota(error, now)?.getTime()).toBe(now.getTime() + 1800 * 1000);
  });

  it('still cools for the default time when Keenable gives no reset time', async () => {
    // The pool is hourly, so a spent one is not a per-second blip either way.
    mockFetchJson({}, { status: 429, text: '{"error":"Too Many Requests"}' });
    const error = await search().catch((caught: unknown) => caught);
    expect((error as Error).message).toMatch(/keyless pool for this IP is used up for the hour/);
    expect(classifyQuota(error, now)).not.toBeNull();
  });
});
