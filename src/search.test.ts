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
      expect((result.results[0].warnings as string[]).join(' ')).toContain('Fell back to http');
    } finally {
      await page.close();
    }
  }, 40_000);
});

describe('a forced --engine is strict', () => {
  afterEach(() => cleanupTempDirs());

  it('errors instead of silently spending another engine when the forced one fails', async () => {
    // agy is forced and fails. A Tavily key is present, so the old behavior
    // would have quietly run Tavily (a real network call) and billed it. Strict
    // forcing must error here and never touch another engine.
    const config = agyConfig({ code: 1 }, { engines: { tavily: { apiKey: 'k' } } });
    await expect(
      runSearch({
        query: 'q',
        engine: 'antigravity-cli',
        config,
        env: BARE_ENV,
        timeoutMs: 20_000,
      }),
    ).rejects.toThrow(/Every engine for the web source failed/);
  }, 30_000);
});

describe('X degrade is labeled, never silently mislabeled', () => {
  afterEach(() => cleanupTempDirs());

  it('marks a web-served X answer as degraded web while keeping requestedSource x', async () => {
    // No Grok on this machine, so a web engine answers the X request. The entry
    // must not claim source "x": a consumer would read web hearsay as X data.
    const config = agyConfig({ stdout: agySearchEnvelope('web-sum') });
    const result = await runSearch({
      query: '推特上怎么说',
      sources: 'x',
      config,
      env: BARE_ENV,
      timeoutMs: 20_000,
    });
    expect(result.results).toHaveLength(1);
    const entry = result.results[0];
    expect(entry.source).toBe('web');
    expect(entry.requestedSource).toBe('x');
    expect(entry.status).toBe('degraded');
    expect(entry.engine).toBe('antigravity-cli');
    expect((entry.warnings as string[]).join(' ')).toContain('X itself was not reachable');
    // The degrade reason is a routing warning, not epistemic uncertainty.
    expect((entry.uncertainty as string[]).join(' ')).not.toContain('X itself was not reachable');
  }, 30_000);

  it('emits an explicit empty unavailable X entry for web,x when X is unreachable', async () => {
    const config = agyConfig({ stdout: agySearchEnvelope('web-sum') });
    const result = await runSearch({
      query: 'node lts',
      sources: 'web,x',
      config,
      env: BARE_ENV,
      timeoutMs: 20_000,
    });
    expect(result.results.map((r) => r.source)).toEqual(['web', 'x']);

    const web = result.results[0];
    expect(web.status).toBe('ok');
    expect(web.requestedSource).toBe('web');

    const x = result.results[1];
    expect(x.status).toBe('unavailable');
    expect(x.requestedSource).toBe('x');
    expect(x.engine).toBeNull();
    expect(x.items).toEqual([]);
    expect(x.attempts).toEqual([]);
    expect((x.uncertainty as string[])).toEqual([]);
    expect((x.warnings as string[]).join(' ')).toContain('X itself was not reachable');
  }, 30_000);
});

describe('uncertainty, warnings, and attempts are separate channels', () => {
  afterEach(() => cleanupTempDirs());

  it('keeps the engine epistemic uncertainty, routing goes to warnings', async () => {
    // The engine reports a real gap; the run also falls back. The two must not
    // mix: uncertainty is the engine's own doubt, warnings is how we routed.
    const page = await startLocalPage('<html><body><p>fallback body here</p></body></html>');
    try {
      // agy fails on the first (config) engine, http answers the fetch.
      const config = agyConfig({ code: 1 }, { engines: { http: { allowPrivateNetwork: 'true' } } });
      const result = await runSearch({
        url: page.url,
        config,
        env: BARE_ENV,
        timeoutMs: 30_000,
      });
      const entry = result.results[0];
      expect(entry.engine).toBe('http');
      // http's own uncertainty is epistemic only (nothing about routing here).
      expect((entry.uncertainty as string[]).join(' ')).not.toContain('Fell back');
      // Routing + runtime notices live in warnings.
      const warnings = (entry.warnings as string[]).join(' ');
      expect(warnings).toContain('Fell back to http');
      expect(warnings).toContain('no LLM synthesis');
    } finally {
      await page.close();
    }
  }, 40_000);

  it('records every engine attempt in order with per-try outcome', async () => {
    // agy fails, http answers: two attempts, first not ok, second ok.
    const page = await startLocalPage('<html><body><p>a body long enough to not look empty at all</p></body></html>');
    try {
      const config = agyConfig({ code: 1 }, { engines: { http: { allowPrivateNetwork: 'true' } } });
      const result = await runSearch({ url: page.url, config, env: BARE_ENV, timeoutMs: 30_000 });
      const attempts = result.results[0].attempts as Array<{
        engine: string;
        ok: boolean;
        error?: string;
      }>;
      expect(attempts.map((a) => a.engine)).toEqual(['antigravity-cli', 'http']);
      expect(attempts[0].ok).toBe(false);
      expect(typeof attempts[0].error).toBe('string');
      expect(attempts[1].ok).toBe(true);
      expect(attempts[1].error).toBeUndefined();
    } finally {
      await page.close();
    }
  }, 40_000);

  it('http sorts a thin page into uncertainty and its method notice into warnings', async () => {
    const page = await startLocalPage('<html><body>hi</body></html>');
    try {
      const result = await runSearch({
        url: page.url,
        config: { engines: { http: { allowPrivateNetwork: 'true' } } },
        env: BARE_ENV,
        timeoutMs: 30_000,
      });
      const entry = result.results[0];
      expect((entry.uncertainty as string[]).join(' ')).toContain('JavaScript');
      const warnings = (entry.warnings as string[]).join(' ');
      expect(warnings).toContain('Private network protection was disabled');
      expect(warnings).not.toContain('JavaScript');
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
