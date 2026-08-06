import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeFirecrawl } from './firecrawl.ts';
import { resolveEngine } from './index.ts';

// Mock DNS so the fake-ip case (a public-looking host that resolves to a
// reserved IP) is testable offline. Literal-IP targets never reach it.
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock('dns/promises', () => ({ lookup: lookupMock }));

beforeEach(() => {
  lookupMock.mockReset();
  // Default: an incidental lookup resolves to a public IP. Only the tests that
  // opt in resolve to a reserved one.
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Mock the global fetch with a JSON response, capturing each request. */
function mockFetchJson(
  body: unknown,
  init: { ok?: boolean; status?: number; text?: string } = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, requestInit: RequestInit) => {
    calls.push({ url, init: requestInit });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => init.text ?? JSON.stringify(body),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

describe('firecrawl provider registration', () => {
  it('resolves by name and serves both search and fetch', () => {
    const engine = resolveEngine('firecrawl');
    expect(engine.name).toBe('firecrawl');
    expect(engine.roles).toEqual(['search', 'fetch']);
    expect(engine.execute).toBeTypeOf('function');
    expect(engine.buildInvocation).toBeUndefined();
  });
});

describe('firecrawl search path', () => {
  it('requires an API key', async () => {
    await expect(
      executeFirecrawl({ mode: 'search', query: 'anything', timeoutMs: 1000, settings: {} }),
    ).rejects.toThrow(/FIRECRAWL_API_KEY|config set firecrawl\.apiKey/);
  });

  it('posts to the v2 search endpoint with a Bearer key and the search body', async () => {
    const calls = mockFetchJson({ success: true, data: { web: [] }, creditsUsed: 2 });
    await executeFirecrawl({
      mode: 'search',
      query: 'v2 contract',
      maxResults: 10,
      timeoutMs: 30000,
      settings: { apiKey: 'fc-test' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.firecrawl.dev/v2/search');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer fc-test');
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.query).toBe('v2 contract');
    expect(sent.limit).toBe(10);
    expect(sent.sources).toEqual(['web']);
    expect(sent.timeout).toBeGreaterThan(0);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps web results into the search contract with description as snippet', async () => {
    mockFetchJson({
      success: true,
      data: {
        web: [
          { title: 'A', description: 'desc a', url: 'https://a.example.com/p' },
          { title: 'B', description: 'desc b', url: 'not a url' },
        ],
      },
      creditsUsed: 2,
    });
    const parsed = await executeFirecrawl({
      mode: 'search',
      query: 'q',
      timeoutMs: 30000,
      settings: { apiKey: 'fc-test' },
    });
    const result = parsed.result as {
      summary: string;
      items: Array<Record<string, unknown>>;
      uncertainty: string[];
      warnings: string[];
    };
    expect(result.items).toEqual([
      { title: 'A', url: 'https://a.example.com/p', snippet: 'desc a', source: 'a.example.com' },
      { title: 'B', url: 'not a url', snippet: 'desc b', source: undefined },
    ]);
    expect(result.warnings.join(' ')).toMatch(/read items|without.*summary|no.*synthes/i);
    expect(result.uncertainty).toEqual([]);
  });

  it('reports an empty search result set as uncertainty', async () => {
    mockFetchJson({ success: true, data: { web: [] } });
    const parsed = await executeFirecrawl({
      mode: 'search',
      query: 'nothing',
      timeoutMs: 30000,
      settings: { apiKey: 'fc-test' },
    });
    const result = parsed.result as { items: unknown[]; uncertainty: string[] };
    expect(result.items).toEqual([]);
    expect(result.uncertainty.join(' ')).toMatch(/No results/i);
  });

  it('aborts the underlying request on timeout and reports it', async () => {
    let sawAbort = false;
    const fn = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            sawAbort = true;
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        }),
    );
    vi.stubGlobal('fetch', fn);
    await expect(
      executeFirecrawl({ mode: 'search', query: 'q', timeoutMs: 20, settings: { apiKey: 'fc-test' } }),
    ).rejects.toThrow(/firecrawl timed out after 20 ms/);
    expect(sawAbort).toBe(true);
  });
});

describe('firecrawl fetch path', () => {
  it('posts to the v2 scrape endpoint and maps markdown, links, and metadata', async () => {
    const links = Array.from({ length: 25 }, (_, i) => `https://a.example.com/l${i}`);
    const calls = mockFetchJson({
      success: true,
      data: {
        markdown: '# Title\n\nBody text long enough to not look empty at all here.',
        links,
        metadata: {
          title: 'Title',
          description: 'desc',
          statusCode: 200,
          sourceURL: 'https://93.184.216.34/page',
        },
      },
    });
    // A public IP literal so the reserved-target check needs no DNS.
    const parsed = await executeFirecrawl({
      mode: 'fetch',
      url: 'http://93.184.216.34/page',
      timeoutMs: 30000,
      settings: { apiKey: 'fc-test' },
    });
    expect(calls[0].url).toBe('https://api.firecrawl.dev/v2/scrape');
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.url).toBe('http://93.184.216.34/page');
    expect(sent.formats).toEqual(['markdown', 'links']);
    expect(sent.onlyMainContent).toBe(true);
    expect(sent.timeout).toBeGreaterThan(0);
    // Force fresh: no Firecrawl cache, so stale content can never come back.
    expect(sent.maxAge).toBe(0);

    const result = parsed.result as {
      summary: string;
      content: string;
      links: Array<{ text: string; url: string }>;
      uncertainty: string[];
      warnings: string[];
    };
    expect(result.content).toContain('Body text');
    // Links are trimmed to 20 to match the http engine.
    expect(result.links).toHaveLength(20);
    expect(result.links[0]).toEqual({ text: 'https://a.example.com/l0', url: 'https://a.example.com/l0' });
    expect(result.summary).toContain('Title');
    expect(result.warnings.join(' ')).toMatch(/Firecrawl|JavaScript|cloud/i);
  });

  it('treats a non-2xx page statusCode as a failure', async () => {
    mockFetchJson({
      success: true,
      data: { markdown: '', links: [], metadata: { statusCode: 404, sourceURL: 'http://93.184.216.34/x' } },
    });
    await expect(
      executeFirecrawl({
        mode: 'fetch',
        url: 'http://93.184.216.34/x',
        timeoutMs: 30000,
        settings: { apiKey: 'fc-test' },
      }),
    ).rejects.toThrow(/404/);
  });

  it('skips a literal private target without calling the API', async () => {
    const calls = mockFetchJson({ success: true, data: {} });
    await expect(
      executeFirecrawl({
        mode: 'fetch',
        url: 'http://192.168.1.10/admin',
        timeoutMs: 30000,
        settings: { apiKey: 'fc-test' },
      }),
    ).rejects.toThrow(/private|reserved/i);
    // The cloud crawler was never contacted for a private address.
    expect(calls).toHaveLength(0);
  });

  it('still skips a literal private target even when the private network is allowed', async () => {
    // The leak fix: a private IP written straight into the URL is never handed to
    // the cloud, switch or not, so an internal address cannot leak to Firecrawl.
    const calls = mockFetchJson({ success: true, data: {} });
    await expect(
      executeFirecrawl({
        mode: 'fetch',
        url: 'http://10.0.0.5/admin',
        timeoutMs: 30000,
        settings: { apiKey: 'fc-test' },
        allowPrivateNetwork: true,
      }),
    ).rejects.toThrow(/private|reserved/i);
    expect(calls).toHaveLength(0);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('sends a public host that resolves to a reserved IP up when the switch is on', async () => {
    // VPN fake-ip: a public-looking name resolves into a reserved range, but the
    // user waived the guard, so firecrawl still tries the cloud.
    lookupMock.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    const calls = mockFetchJson({
      success: true,
      data: { markdown: 'ok content here that is long enough', links: [], metadata: { statusCode: 200 } },
    });
    await executeFirecrawl({
      mode: 'fetch',
      url: 'http://internal.example.com/admin',
      timeoutMs: 30000,
      settings: { apiKey: 'fc-test' },
      allowPrivateNetwork: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.firecrawl.dev/v2/scrape');
  });

  it('skips a public host that resolves to a reserved IP when the switch is off', async () => {
    lookupMock.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
    const calls = mockFetchJson({ success: true, data: {} });
    await expect(
      executeFirecrawl({
        mode: 'fetch',
        url: 'http://internal.example.com/admin',
        timeoutMs: 30000,
        settings: { apiKey: 'fc-test' },
      }),
    ).rejects.toThrow(/private|reserved/i);
    expect(calls).toHaveLength(0);
    expect(lookupMock).toHaveBeenCalled();
  });
});

describe('firecrawl error classification', () => {
  it('recognizes a 402 or credits-exhausted response as a quota error', async () => {
    mockFetchJson(
      { error: 'Payment Required: insufficient credits' },
      { ok: false, status: 402, text: 'insufficient credits' },
    );
    await expect(
      executeFirecrawl({ mode: 'search', query: 'q', timeoutMs: 30000, settings: { apiKey: 'fc-test' } }),
    ).rejects.toThrow(/credit|quota|payment/i);
  });

  it('treats 401 as a key problem with a config-set fix', async () => {
    mockFetchJson({ error: 'unauthorized' }, { ok: false, status: 401, text: 'unauthorized' });
    await expect(
      executeFirecrawl({ mode: 'search', query: 'q', timeoutMs: 30000, settings: { apiKey: 'bad' } }),
    ).rejects.toThrow(/config set firecrawl\.apiKey/);
  });
});
