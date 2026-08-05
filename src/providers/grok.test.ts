import { describe, expect, it } from 'vitest';
import { grokSalvageEnvelope } from '../fixtures/index.ts';
import { SEARCH_RESULT_SCHEMA } from '../schema.ts';
import { buildGrokInvocation, buildXSearchPrompt, grokAvailable, parseGrokOutput } from './grok.ts';
import { resolveEngine } from './index.ts';

describe('grok engine', () => {
  it('is registered for the social role only', () => {
    const engine = resolveEngine('grok-cli');
    expect(engine.roles).toEqual(['social']);
    expect(resolveEngine('grok').name).toBe('grok-cli');
  });

  it('builds a headless run with the shared search schema', () => {
    const invocation = buildGrokInvocation({
      mode: 'search',
      query: 'grok build feedback',
      maxResults: 4,
      timeoutMs: 60_000,
      settings: {},
    });
    expect(invocation.command).toBe('grok');
    expect(invocation.args).toContain('--always-approve');
    expect(JSON.parse(invocation.args[invocation.args.indexOf('--json-schema') + 1])).toEqual(
      SEARCH_RESULT_SCHEMA,
    );
    const prompt = invocation.args[invocation.args.indexOf('-p') + 1];
    expect(prompt).toContain('Search X (formerly Twitter) for: grok build feedback');
    expect(prompt).toContain('up to 4 items');
  });

  it('falls back to the shared default post count when none is given', () => {
    const invocation = buildGrokInvocation({
      mode: 'search',
      query: 'x',
      timeoutMs: 1000,
      settings: {},
    });
    const prompt = invocation.args[invocation.args.indexOf('-p') + 1];
    expect(prompt).toContain('up to 8 items');
  });

  it('takes its binary from engine settings', () => {
    const invocation = buildGrokInvocation({
      mode: 'search',
      query: 'x',
      timeoutMs: 1000,
      settings: { bin: '/opt/grok' },
    });
    expect(invocation.command).toBe('/opt/grok');
  });

  it('rejects page fetch', () => {
    expect(() =>
      buildGrokInvocation({ mode: 'fetch', url: 'https://e.com', timeoutMs: 1000, settings: {} }),
    ).toThrow(/does not support page fetch/);
  });

  it('needs both a binary and a signed-in state', () => {
    expect(grokAvailable('definitely-not-a-real-binary')).toBe(false);
  });

  it('instructs the x.com item mapping', () => {
    expect(buildXSearchPrompt('anything', 3)).toContain('source is "x.com"');
  });

  it('salvages the last valid object when grok validates the schema too late', () => {
    const parsed = parseGrokOutput(grokSalvageEnvelope('real'));
    expect((parsed.result as { summary: string }).summary).toBe('real');
  });

  it('prefers structuredOutput and keeps usage', () => {
    const parsed = parseGrokOutput(
      JSON.stringify({
        structuredOutput: { summary: 'ok', items: [], uncertainty: [] },
        sessionId: 'sid',
        modelUsage: { m: 1 },
      }),
    );
    expect((parsed.result as { summary: string }).summary).toBe('ok');
    expect(parsed.meta.conversationId).toBe('sid');
    expect(parsed.meta.usage).toEqual({ m: 1 });
  });

  it('throws for garbage and for nothing salvageable', () => {
    expect(() => parseGrokOutput('not json')).toThrow('Failed to parse Grok Build JSON output.');
    expect(() =>
      parseGrokOutput(JSON.stringify({ structuredOutput: null, text: 'no objects' })),
    ).toThrow('no structured result');
  });
});
