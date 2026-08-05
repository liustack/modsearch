import { afterEach, describe, expect, it } from 'vitest';
import type { ModsearchConfig } from './config.ts';
import { noEngineMessage, resolveMode, runSearch, validateUrl } from './search.ts';
import { agySearchEnvelope } from './fixtures/index.ts';
import { BARE_ENV, cleanupTempDirs, fakeEngine, startLocalPage } from './testing/helpers.ts';

/** A config whose agy engine is the given fake binary (full path, so PATH is irrelevant). */
function agyConfig(
  fake: { stdout?: string; code?: number },
  extra: ModsearchConfig = {},
): ModsearchConfig {
  const bin = fakeEngine({ name: 'agy', ...fake });
  return {
    ...extra,
    engines: { ...extra.engines, 'antigravity-cli': { bin } },
  };
}

describe('mode resolution', () => {
  it('is search for a query, fetch for a url', () => {
    expect(resolveMode('latest node lts', undefined)).toBe('search');
    expect(resolveMode(undefined, 'https://example.com')).toBe('fetch');
    expect(resolveMode('pricing', 'https://example.com')).toBe('fetch');
  });

  it('rejects runs with neither', () => {
    expect(() => resolveMode(undefined, undefined)).toThrow('Provide a search query');
  });

  it('validates fetch urls', () => {
    expect(validateUrl(' https://example.com/a ')).toBe('https://example.com/a');
    expect(() => validateUrl('ftp://example.com')).toThrow('must start with http');
  });
});

describe('zero-config machine', () => {
  afterEach(() => cleanupTempDirs());

  it('tells the user how to enable search rather than crashing', async () => {
    // Nothing installed, no keys, no config file.
    await expect(
      runSearch({ query: 'anything', config: {}, env: BARE_ENV, timeoutMs: 5_000 }),
    ).rejects.toThrow(/No engine on this machine can search the web/);

    const message = noEngineMessage('search');
    expect(message).toContain('antigravity-cli:');
    expect(message).toContain('tavily:');
  });

  it('still fetches a page with nothing installed', async () => {
    // The http engine needs no setup, so -u works out of the box. Point it at a
    // local server rather than the internet: unit tests stay offline.
    const page = await startLocalPage('<html><body><h1>Example Domain</h1></body></html>');
    try {
      const result = await runSearch({
        url: page.url,
        config: { engines: { http: { allowPrivateNetwork: 'true' } } },
        env: BARE_ENV,
        timeoutMs: 30_000,
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].engine).toBe('http');
      expect(String(result.results[0].content)).toContain('Example Domain');
    } finally {
      await page.close();
    }
  }, 40_000);

  it('always returns an array of results, one per source', async () => {
    const config = agyConfig({ stdout: agySearchEnvelope('web-sum') });
    const result = await runSearch({ query: 'node lts', config, env: BARE_ENV, timeoutMs: 20_000 });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      source: 'web',
      engine: 'antigravity-cli',
      summary: 'web-sum',
    });
    expect(result.mode).toBe('search');
  }, 30_000);

  it('falls through to the next engine and says so', async () => {
    const page = await startLocalPage('<html><body><p>fallback body</p></body></html>');
    try {
      const config = agyConfig({ code: 1 }, { engines: { http: { allowPrivateNetwork: 'true' } } });
      const result = await runSearch({
        url: page.url,
        config,
        env: BARE_ENV,
        timeoutMs: 30_000,
      });
      expect(result.results[0].engine).toBe('http');
      expect((result.results[0].uncertainty as string[]).join(' ')).toContain('Fell back to http');
    } finally {
      await page.close();
    }
  }, 40_000);
});

describe('routing facts cannot be faked by an engine', () => {
  afterEach(() => cleanupTempDirs());

  it('overwrites source, engine, and model even when the engine has no model', async () => {
    // A conditional spread left `model` writable whenever the engine's default
    // model was empty, so a result could claim to come from somewhere else.
    const config = agyConfig({
      stdout:
        '{"status":"SUCCESS","structured_output":{"summary":"s","items":[],"uncertainty":[],"source":"x","engine":"spoofed","model":"spoof-model","durationSeconds":999}}',
    });
    const result = await runSearch({
      query: 'plain query',
      config,
      env: BARE_ENV,
      timeoutMs: 20_000,
    });
    expect(result.results[0].source).toBe('web');
    expect(result.results[0].engine).toBe('antigravity-cli');
    expect(result.results[0].model).toBe('gemini-3.6-flash-low');
    expect(result.results[0].durationSeconds).toBeLessThan(100);
  }, 30_000);
});
