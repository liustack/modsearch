import { describe, expect, it } from 'vitest';
import { FETCH_RESULT_SCHEMA, SEARCH_RESULT_SCHEMA } from '../schema.ts';
import {
  buildAntigravityInvocation,
  parseAntigravityOutput,
  DEFAULT_MODEL,
} from './antigravity.ts';

describe('buildAntigravityInvocation (search mode)', () => {
  it('builds agy print invocation with the search schema', () => {
    const invocation = buildAntigravityInvocation({
      mode: 'search',
      query: 'TypeScript 5.9 release highlights',
      model: 'gemini-3.1-pro-high',
      maxResults: 5,
      extraPrompt: 'Prefer official sources',
      timeoutMs: 120_000,
      settings: {},
    });

    expect(invocation.command).toBe('agy');
    expect(invocation.args).toContain('--dangerously-skip-permissions');
    expect(invocation.args).toContain('--output-format');
    expect(invocation.args).toContain('json');
    expect(invocation.args).toContain('--model');
    expect(invocation.args).toContain('gemini-3.1-pro-high');
    expect(invocation.args[invocation.args.indexOf('--print-timeout') + 1]).toBe('120s');

    const schemaArg = invocation.args[invocation.args.indexOf('--json-schema') + 1] as string;
    expect(JSON.parse(schemaArg)).toEqual(SEARCH_RESULT_SCHEMA);

    const prompt = invocation.args[invocation.args.indexOf('-p') + 1] as string;
    expect(prompt).toContain('Search the web for: TypeScript 5.9 release highlights');
    expect(prompt).toContain('up to 5 results');
    expect(prompt).toContain('Prefer official sources');
  });

  it('requires a query', () => {
    expect(() => buildAntigravityInvocation({ mode: 'search', timeoutMs: 1000,
      settings: {},
    })).toThrow(
      'Search mode requires a query.',
    );
  });
});

describe('buildAntigravityInvocation (fetch mode)', () => {
  it('builds agy print invocation with the fetch schema and query focus', () => {
    const invocation = buildAntigravityInvocation({
      mode: 'fetch',
      url: 'https://example.com/docs',
      query: 'rate limits',
      timeoutMs: 180_000,
      settings: {},
    });

    expect(invocation.args).toContain(DEFAULT_MODEL);

    const schemaArg = invocation.args[invocation.args.indexOf('--json-schema') + 1] as string;
    expect(JSON.parse(schemaArg)).toEqual(FETCH_RESULT_SCHEMA);

    const prompt = invocation.args[invocation.args.indexOf('-p') + 1] as string;
    expect(prompt).toContain(
      'Fetch this web page and convert it into structured evidence: https://example.com/docs',
    );
    expect(prompt).toContain('rate limits');
  });

  it('requires a url', () => {
    expect(() => buildAntigravityInvocation({ mode: 'fetch', timeoutMs: 1000,
      settings: {},
    })).toThrow(
      'Fetch mode requires a URL.',
    );
  });
});

describe('parseAntigravityOutput', () => {
  const structured = { summary: 'ok', items: [], uncertainty: [] };

  it('prefers structured_output from the envelope', () => {
    const parsed = parseAntigravityOutput(
      JSON.stringify({
        conversation_id: 'cid',
        status: 'SUCCESS',
        response: JSON.stringify(structured),
        structured_output: structured,
        duration_seconds: 9.9,
        usage: { total_tokens: 7 },
      }),
    );

    expect(parsed.result).toEqual(structured);
    expect(parsed.meta.conversationId).toBe('cid');
    expect(parsed.meta.durationSeconds).toBe(9.9);
    expect(parsed.meta.usage).toEqual({ total_tokens: 7 });
  });

  it('falls back to parsing the response string', () => {
    const parsed = parseAntigravityOutput(
      JSON.stringify({ status: 'SUCCESS', response: JSON.stringify(structured) }),
    );
    expect(parsed.result).toEqual(structured);
  });

  it('throws on non-success status', () => {
    expect(() =>
      parseAntigravityOutput(JSON.stringify({ status: 'FAILED', response: '' })),
    ).toThrow('status FAILED');
  });

  it('throws when no structured result is present', () => {
    expect(() =>
      parseAntigravityOutput(JSON.stringify({ status: 'SUCCESS', response: '' })),
    ).toThrow('no structured result');
  });

  it('recovers the envelope from noisy stdout', () => {
    const noisy = `WARN something\n${JSON.stringify({
      status: 'SUCCESS',
      structured_output: structured,
    })}`;
    expect(parseAntigravityOutput(noisy).result).toEqual(structured);
  });

  it('throws for unparseable stdout', () => {
    expect(() => parseAntigravityOutput('not json')).toThrow(
      'Failed to parse Antigravity CLI JSON output.',
    );
  });
});
