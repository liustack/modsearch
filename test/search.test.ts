import { describe, expect, it } from 'vitest';
import {
  extractSearchPayload,
  parseProviderJsonOutput,
  runSearch,
} from '../src/search.ts';
import { buildGeminiInvocation } from '../src/providers/geminiCli.ts';
import { resolveProvider } from '../src/providers/index.ts';

describe('buildGeminiInvocation', () => {
  it('builds gemini command for search with json output mode', () => {
    const invocation = buildGeminiInvocation({
      query: 'OpenAI latest news',
      providerBin: 'gemini',
      model: 'gemini-2.5-flash',
      maxResults: 5,
      extraPrompt: '优先最近7天',
      workdir: '/Users/leon/projects/modsearch',
    });

    expect(invocation.command).toBe('gemini');
    expect(invocation.args).toContain('-p');
    expect(invocation.args).toContain('--output-format');
    expect(invocation.args).toContain('json');
    expect(invocation.args).toContain('-m');
    expect(invocation.args).toContain('gemini-2.5-flash');
    expect(invocation.cwd).toBe('/Users/leon/projects/modsearch');

    const prompt = invocation.args[invocation.args.indexOf('-p') + 1] as string;
    expect(prompt).toContain('请搜索：OpenAI latest news');
    expect(prompt).toContain('最多返回 5 条结果');
    expect(prompt).toContain('优先最近7天');
  });
});

describe('resolveProvider', () => {
  it('returns gemini-cli provider', () => {
    const provider = resolveProvider('gemini-cli');
    expect(provider.name).toBe('gemini-cli');
  });

  it('throws for unknown provider', () => {
    expect(() => resolveProvider('unknown-provider')).toThrow();
  });
});

describe('parseProviderJsonOutput', () => {
  it('parses provider json output', () => {
    const parsed = parseProviderJsonOutput(
      JSON.stringify({ session_id: 'sid', response: '{"summary":"ok"}' }),
    );

    expect(parsed.session_id).toBe('sid');
    expect(parsed.response).toBe('{"summary":"ok"}');
  });

  it('throws for malformed payload', () => {
    expect(() => parseProviderJsonOutput('oops')).toThrow();
  });

  it('parses json payload even with leading logs', () => {
    const parsed = parseProviderJsonOutput(
      `Loaded cached credentials.\n${JSON.stringify({ session_id: 'sid', response: '{"summary":"ok"}' })}`,
    );

    expect(parsed.session_id).toBe('sid');
    expect(parsed.response).toBe('{"summary":"ok"}');
  });
});

describe('extractSearchPayload', () => {
  it('extracts direct json', () => {
    const result = extractSearchPayload('{"summary":"ok","items":[]}');
    expect(result.structured).toEqual({ summary: 'ok', items: [] });
  });

  it('extracts fenced json', () => {
    const result = extractSearchPayload('```json\n{"summary":"ok","items":[]}\n```');
    expect(result.structured).toEqual({ summary: 'ok', items: [] });
  });

  it('falls back to null structured for plain text', () => {
    const result = extractSearchPayload('plain text');
    expect(result.structured).toBeNull();
    expect(result.rawText).toBe('plain text');
  });
});

describe('runSearch', () => {
  it('validates empty query', async () => {
    await expect(
      runSearch({
        query: '   ',
      }),
    ).rejects.toThrow('Search query is required');
  });
});
