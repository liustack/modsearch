import { describe, expect, it, vi } from 'vitest';

const searchMock = vi.hoisted(() => vi.fn());
vi.mock('@tavily/core', () => ({
  tavily: () => ({ search: searchMock }),
}));

import { executeTavilySearch } from './tavily.ts';
import { resolveProvider } from './index.ts';

describe('tavily provider', () => {
  it('resolves by name and exposes execute instead of buildInvocation', () => {
    const provider = resolveProvider('tavily');
    expect(provider.name).toBe('tavily');
    expect(provider.execute).toBeTypeOf('function');
    expect(provider.buildInvocation).toBeUndefined();
  });

  it('rejects fetch mode', async () => {
    await expect(
      executeTavilySearch({ mode: 'fetch', url: 'https://example.com', timeoutMs: 1000 }),
    ).rejects.toThrow(/does not support page fetch/);
  });

  it('requires TAVILY_API_KEY', async () => {
    const saved = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    try {
      await expect(
        executeTavilySearch({ mode: 'search', query: 'anything', timeoutMs: 1000 }),
      ).rejects.toThrow(/TAVILY_API_KEY|config set tavily.apiKey/);
    } finally {
      if (saved !== undefined) process.env.TAVILY_API_KEY = saved;
    }
  });

  it('maps tavily results into the v2 contract without relevance scores', async () => {
    const saved = process.env.TAVILY_API_KEY;
    process.env.TAVILY_API_KEY = 'tvly-test';
    try {
      searchMock.mockResolvedValueOnce({
        answer: 'synthesized answer',
        results: [
          { title: 'A', url: 'https://a.example.com/page', content: 'snippet a', score: 0.9 },
          { title: 'B', url: 'not a url', content: 'snippet b', score: 0.8 },
        ],
        responseTime: 0.4,
      });

      const parsed = await executeTavilySearch({
        mode: 'search',
        query: 'v2 contract',
        maxResults: 2,
        timeoutMs: 1000,
      });

      const result = parsed.result as {
        summary: string;
        items: Array<Record<string, unknown>>;
        uncertainty: string[];
      };
      expect(result.summary).toBe('synthesized answer');
      expect(result.items).toEqual([
        { title: 'A', url: 'https://a.example.com/page', snippet: 'snippet a', source: 'a.example.com' },
        { title: 'B', url: 'not a url', snippet: 'snippet b', source: undefined },
      ]);
      expect(result.uncertainty).toEqual([]);
      expect(JSON.stringify(result)).not.toContain('relevance');
      expect(parsed.meta.usage).toEqual({ resultCount: 2 });
    } finally {
      if (saved !== undefined) process.env.TAVILY_API_KEY = saved;
      else delete process.env.TAVILY_API_KEY;
    }
  });
});
