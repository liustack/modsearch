import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeExaSearch } from './exa.ts';
import { resolveEngine } from './index.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Mock the global fetch with a JSON response, capturing the request. */
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

describe('exa provider', () => {
  it('resolves by name and exposes execute instead of buildInvocation', () => {
    const engine = resolveEngine('exa');
    expect(engine.name).toBe('exa');
    expect(engine.roles).toEqual(['search']);
    expect(engine.execute).toBeTypeOf('function');
    expect(engine.buildInvocation).toBeUndefined();
  });

  it('rejects fetch mode', async () => {
    await expect(
      executeExaSearch({
        mode: 'fetch',
        url: 'https://example.com',
        timeoutMs: 1000,
        settings: {},
      }),
    ).rejects.toThrow(/does not support page fetch/);
  });

  it('requires an API key', async () => {
    await expect(
      executeExaSearch({ mode: 'search', query: 'anything', timeoutMs: 1000, settings: {} }),
    ).rejects.toThrow(/EXA_API_KEY|config set exa\.apiKey/);
  });

  it('posts to the REST endpoint with an x-api-key header and the search body', async () => {
    const calls = mockFetchJson({ results: [] });
    await executeExaSearch({
      mode: 'search',
      query: 'v3 contract',
      maxResults: 5,
      timeoutMs: 1000,
      settings: { apiKey: 'exa-test' },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.exa.ai/search');
    expect(calls[0].init.method).toBe('POST');
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('exa-test');
    expect(headers.authorization).toBeUndefined();
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      query: 'v3 contract',
      numResults: 5,
      contents: { highlights: true },
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps exa results into the search contract with a mechanical summary', async () => {
    mockFetchJson({
      results: [
        {
          title: 'A',
          url: 'https://a.example.com/page',
          publishedDate: '2026-01-02',
          author: 'someone',
          highlights: ['highlight a', 'second'],
        },
        // no highlights, no date: snippet falls back to empty, no published_at key
        { title: 'B', url: 'not a url' },
      ],
      costDollars: { total: 0.007 },
    });

    const parsed = await executeExaSearch({
      mode: 'search',
      query: 'contract',
      maxResults: 2,
      timeoutMs: 1000,
      settings: { apiKey: 'exa-test' },
    });

    const result = parsed.result as {
      summary: string;
      items: Array<Record<string, unknown>>;
      uncertainty: string[];
      warnings: string[];
    };
    expect(result.items).toEqual([
      {
        title: 'A',
        url: 'https://a.example.com/page',
        snippet: 'highlight a',
        source: 'a.example.com',
        published_at: '2026-01-02',
      },
      { title: 'B', url: 'not a url', snippet: '', source: undefined },
    ]);
    // Exa does not synthesize: the summary is mechanical and a warning says so.
    expect(result.summary).toMatch(/contract/);
    expect(result.warnings.join(' ')).toMatch(/read items|without.*summary|no.*synthes/i);
    expect(result.uncertainty).toEqual([]);
    // No fabricated relevance score.
    expect(JSON.stringify(result)).not.toContain('relevance');
    // The cost is diagnostic, surfaced in meta.
    expect(parsed.meta.usage).toMatchObject({ resultCount: 2 });
  });

  it('reports an empty result set as uncertainty', async () => {
    mockFetchJson({ results: [] });
    const parsed = await executeExaSearch({
      mode: 'search',
      query: 'nothing here',
      timeoutMs: 1000,
      settings: { apiKey: 'exa-test' },
    });
    const result = parsed.result as { items: unknown[]; uncertainty: string[] };
    expect(result.items).toEqual([]);
    expect(result.uncertainty.join(' ')).toMatch(/No results/i);
  });

  it('defaults numResults to 10 when --max-results is not given', async () => {
    const calls = mockFetchJson({ results: [] });
    await executeExaSearch({
      mode: 'search',
      query: 'q',
      timeoutMs: 1000,
      settings: { apiKey: 'exa-test' },
    });
    expect(JSON.parse(calls[0].init.body as string).numResults).toBe(10);
  });

  it('treats 401/403 as a key problem with a config-set fix, not a quota error', async () => {
    mockFetchJson({ error: 'invalid api key' }, { ok: false, status: 401, text: 'invalid api key' });
    await expect(
      executeExaSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: { apiKey: 'bad' },
      }),
    ).rejects.toThrow(/config set exa\.apiKey/);
  });

  it('recognizes a balance-exhausted response as a quota error', async () => {
    mockFetchJson(
      { error: 'insufficient balance' },
      { ok: false, status: 402, text: 'insufficient balance, please add credits' },
    );
    await expect(
      executeExaSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 1000,
        settings: { apiKey: 'exa-test' },
      }),
    ).rejects.toThrow(/credit|balance|quota/i);
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
      executeExaSearch({
        mode: 'search',
        query: 'q',
        timeoutMs: 20,
        settings: { apiKey: 'exa-test' },
      }),
    ).rejects.toThrow(/exa timed out after 20 ms/);
    expect(sawAbort).toBe(true);
  });
});
