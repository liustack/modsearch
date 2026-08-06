import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeTavilySearch } from './tavily.ts';
import { resolveEngine } from './index.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Mock the global fetch with a JSON response, capturing the request. */
function mockFetchJson(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string, requestInit: RequestInit) => {
    calls.push({ url, init: requestInit });
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: 'OK',
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

describe('tavily provider', () => {
  it('resolves by name and exposes execute instead of buildInvocation', () => {
    const engine = resolveEngine('tavily');
    expect(engine.name).toBe('tavily');
    expect(engine.roles).toEqual(['search']);
    expect(engine.execute).toBeTypeOf('function');
    expect(engine.buildInvocation).toBeUndefined();
  });

  it('rejects fetch mode', async () => {
    await expect(
      executeTavilySearch({
        mode: 'fetch',
        url: 'https://example.com',
        timeoutMs: 1000,
        settings: {},
      }),
    ).rejects.toThrow(/does not support page fetch/);
  });

  it('requires an API key', async () => {
    await expect(
      executeTavilySearch({ mode: 'search', query: 'anything', timeoutMs: 1000, settings: {} }),
    ).rejects.toThrow(/TAVILY_API_KEY|config set tavily.apiKey/);
  });

  it('posts to the REST endpoint with a Bearer key and the search body', async () => {
    const calls = mockFetchJson({ answer: 'a', results: [], responseTime: 0.1 });
    await executeTavilySearch({
      mode: 'search',
      query: 'v3 contract',
      maxResults: 3,
      timeoutMs: 1000,
      settings: { apiKey: 'tvly-test' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.tavily.com/search');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer tvly-test');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      query: 'v3 contract',
      search_depth: 'basic',
      include_answer: true,
      max_results: 3,
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps tavily results into the v2 contract without relevance scores', async () => {
    mockFetchJson({
      answer: 'synthesized answer',
      results: [
        { title: 'A', url: 'https://a.example.com/page', content: 'snippet a', score: 0.9 },
        { title: 'B', url: 'not a url', content: 'snippet b', score: 0.8 },
      ],
      response_time: 0.4,
    });

    const parsed = await executeTavilySearch({
      mode: 'search',
      query: 'v2 contract',
      maxResults: 2,
      timeoutMs: 1000,
      settings: { apiKey: 'tvly-test' },
    });

    const result = parsed.result as {
      summary: string;
      items: Array<Record<string, unknown>>;
      uncertainty: string[];
    };
    expect(result.summary).toBe('synthesized answer');
    expect(result.items).toEqual([
      {
        title: 'A',
        url: 'https://a.example.com/page',
        snippet: 'snippet a',
        source: 'a.example.com',
      },
      { title: 'B', url: 'not a url', snippet: 'snippet b', source: undefined },
    ]);
    expect(result.uncertainty).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('relevance');
    expect(parsed.meta.usage).toEqual({ resultCount: 2 });
  });

  it('surfaces a non-2xx response as an error', async () => {
    mockFetchJson({ detail: 'invalid key' }, { ok: false, status: 401 });
    await expect(
      executeTavilySearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: { apiKey: 'bad' },
      }),
    ).rejects.toThrow(/tavily returned 401/);
  });

  it.each([432, 433])(
    'maps a %i plan-cap response to a monthly quota message the cooldown layer reads',
    async (status) => {
      mockFetchJson({ error: 'usage limit reached' }, { ok: false, status });
      await expect(
        executeTavilySearch({
          mode: 'search',
          query: 'q',
          timeoutMs: 1000,
          settings: { apiKey: 'tvly-test' },
        }),
      ).rejects.toThrow(new RegExp(`monthly quota.*HTTP ${status}`, 'i'));
    },
  );

  it('aborts the underlying request on timeout and reports it', async () => {
    let sawAbort = false;
    // A fetch that never resolves on its own: only the abort signal ends it,
    // which proves the timeout truly cancels the request rather than dangling.
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
      executeTavilySearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 20,
        settings: { apiKey: 'tvly-test' },
      }),
    ).rejects.toThrow(/tavily timed out after 20 ms/);
    expect(sawAbort).toBe(true);
  });
});
