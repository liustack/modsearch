import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModsearchConfig } from './config.ts';
import {
  buildCooldownController,
  emptyCooldownState,
  loadCooldownState,
  recordQuotaCooldown,
} from './cooldown.ts';
import { type EngineAttempt, noEngineMessage, resolveMode, runSearch, validateUrl } from './search.ts';
import { agyQuotaEnvelope, agySearchEnvelope } from './fixtures/index.ts';
import {
  BARE_ENV,
  cleanupTempDirs,
  fakeEngine,
  startLocalPage,
  tempDir,
  withSignedInGrok,
} from './testing/helpers.ts';

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
    // The local engine needs no setup, so -u works out of the box. Point it at a
    // local server rather than the internet: unit tests stay offline.
    const page = await startLocalPage('<html><body><h1>Example Domain</h1></body></html>');
    try {
      const result = await runSearch({
        url: page.url,
        config: { allowPrivateNetwork: true },
        env: BARE_ENV,
        timeoutMs: 30_000,
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].engine).toBe('local');
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
      const config = agyConfig({ code: 1 }, { allowPrivateNetwork: true });
      const result = await runSearch({
        url: page.url,
        config,
        env: BARE_ENV,
        timeoutMs: 30_000,
      });
      expect(result.results[0].engine).toBe('local');
      expect((result.results[0].warnings as string[]).join(' ')).toContain('Fell back to local');
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

describe('multiple sources run concurrently and fail independently', () => {
  afterEach(() => cleanupTempDirs());

  /** A grok envelope carrying one canned structured result. */
  function grokEnvelope(summary: string): string {
    return JSON.stringify({
      structuredOutput: { summary, items: [], uncertainty: [] },
      sessionId: 's',
    });
  }

  it('runs web and X in parallel: total time is near the slower source, not the sum', async () => {
    // Each engine sleeps ~1s. Serial would be ~2s; concurrent is ~1s.
    const { env, restore } = withSignedInGrok();
    const agyBin = fakeEngine({ name: 'agy', stdout: agySearchEnvelope('web'), delaySeconds: 1 });
    const grokBin = fakeEngine({ name: 'grok', stdout: grokEnvelope('x'), delaySeconds: 1 });
    try {
      const result = await runSearch({
        query: 'anything',
        sources: 'web,x',
        config: { engines: { 'antigravity-cli': { bin: agyBin }, 'grok-cli': { bin: grokBin } } },
        env,
        timeoutMs: 20_000,
      });
      expect(result.results.map((r) => r.source)).toEqual(['web', 'x']);
      expect(result.results.every((r) => r.status === 'ok')).toBe(true);
      // Serial execution would put this near 2s. Allow headroom for spawn cost.
      expect(result.meta.durationSeconds).toBeLessThan(1.8);
    } finally {
      restore();
      cleanupTempDirs();
    }
  }, 30_000);

  it('keeps a succeeding source when the other source fails entirely', async () => {
    // web has only a failing agy (no fallback); X is served by a working grok.
    // The web failure must not sink the run: it becomes an unavailable entry
    // while X still returns, and order stays web, x.
    const { env, restore } = withSignedInGrok();
    const agyBin = fakeEngine({ name: 'agy', code: 1 });
    const grokBin = fakeEngine({ name: 'grok', stdout: grokEnvelope('x-sum') });
    try {
      const result = await runSearch({
        query: 'anything',
        sources: 'web,x',
        config: { engines: { 'antigravity-cli': { bin: agyBin }, 'grok-cli': { bin: grokBin } } },
        env,
        timeoutMs: 20_000,
      });
      expect(result.results.map((r) => r.source)).toEqual(['web', 'x']);

      const web = result.results[0];
      expect(web.status).toBe('unavailable');
      expect(web.engine).toBeNull();
      expect((web.attempts as Array<{ engine: string; ok: boolean }>)[0]).toMatchObject({
        engine: 'antigravity-cli',
        ok: false,
      });
      expect((web.warnings as string[]).join(' ')).toContain('Every engine for the web source failed');

      const x = result.results[1];
      expect(x.status).toBe('ok');
      expect(x.engine).toBe('grok-cli');
      expect(x.summary).toBe('x-sum');
    } finally {
      restore();
      cleanupTempDirs();
    }
  }, 30_000);

  it('a single failing source still throws, so its behavior is unchanged', async () => {
    // Only web, and it fails: no other source to protect, so the run errors
    // exactly as before rather than returning an unavailable entry.
    const config = agyConfig({ code: 1 });
    await expect(
      runSearch({ query: 'anything', config, env: BARE_ENV, timeoutMs: 20_000 }),
    ).rejects.toThrow(/Every engine for the web source failed/);
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
      const config = agyConfig({ code: 1 }, { allowPrivateNetwork: true });
      const result = await runSearch({
        url: page.url,
        config,
        env: BARE_ENV,
        timeoutMs: 30_000,
      });
      const entry = result.results[0];
      expect(entry.engine).toBe('local');
      // the local engine's own uncertainty is epistemic only (nothing about routing here).
      expect((entry.uncertainty as string[]).join(' ')).not.toContain('Fell back');
      // Routing + runtime notices live in warnings.
      const warnings = (entry.warnings as string[]).join(' ');
      expect(warnings).toContain('Fell back to local');
      expect(warnings).toContain('no LLM synthesis');
    } finally {
      await page.close();
    }
  }, 40_000);

  it('records every engine attempt in order with per-try outcome', async () => {
    // agy fails, http answers: two attempts, first not ok, second ok.
    const page = await startLocalPage('<html><body><p>a body long enough to not look empty at all</p></body></html>');
    try {
      const config = agyConfig({ code: 1 }, { allowPrivateNetwork: true });
      const result = await runSearch({ url: page.url, config, env: BARE_ENV, timeoutMs: 30_000 });
      const attempts = result.results[0].attempts as Array<{
        engine: string;
        ok: boolean;
        error?: string;
      }>;
      expect(attempts.map((a) => a.engine)).toEqual(['antigravity-cli', 'local']);
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
        config: { allowPrivateNetwork: true },
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

describe('quota cooldown records, clears, and can be switched off', () => {
  afterEach(() => cleanupTempDirs());
  const now = new Date('2026-08-06T00:00:00.000Z');
  const statePath = () => path.join(tempDir('modsearch-state-'), 'state.json');

  it('records a cooling engine when it fails with a quota error', async () => {
    const p = statePath();
    const config = agyConfig({ stdout: agyQuotaEnvelope() });
    const controller = buildCooldownController({}, { now, statePath: p });
    await expect(
      runSearch({ query: 'q', config, env: BARE_ENV, timeoutMs: 20_000, cooldown: controller }),
    ).rejects.toThrow(/Every engine for the web source failed/);
    // agy hit its quota, so it is remembered for the next run.
    const recorded = loadCooldownState(p).engineCooldowns['antigravity-cli'];
    expect(recorded).toBeDefined();
    expect(recorded.until).toBe(new Date(now.getTime() + (94 * 3600 + 19 * 60 + 9) * 1000).toISOString());
  }, 30_000);

  it('still tries a cooling engine, clears it on success, and warns', async () => {
    const p = statePath();
    // Seed: agy is already cooling from a prior run, so it is demoted this run.
    recordQuotaCooldown(emptyCooldownState(), 'antigravity-cli', new Error('out of credits'), now, p);
    const config = agyConfig({ stdout: agySearchEnvelope('back') });
    const controller = buildCooldownController({}, { now, statePath: p });
    const result = await runSearch({
      query: 'q',
      config,
      env: BARE_ENV,
      timeoutMs: 20_000,
      cooldown: controller,
    });
    // It was the only engine, so demoted-not-removed means it is still tried and
    // answers. A successful answer clears its cooldown.
    expect(result.results[0].engine).toBe('antigravity-cli');
    expect(result.results[0].summary).toBe('back');
    expect(loadCooldownState(p).engineCooldowns['antigravity-cli']).toBeUndefined();
    expect((result.results[0].warnings as string[]).join(' ')).toMatch(/cooling until/);
  }, 30_000);

  it('reads and writes nothing when the switch is off', async () => {
    const p = statePath();
    const config = agyConfig({ stdout: agyQuotaEnvelope() }, { cooldown: 'off' });
    const controller = buildCooldownController(config, { now, statePath: p });
    expect(controller).toBeUndefined();
    await expect(
      runSearch({ query: 'q', config, env: BARE_ENV, timeoutMs: 20_000, cooldown: controller }),
    ).rejects.toThrow(/Every engine/);
    // Off means the state file is never created.
    expect(fs.existsSync(p)).toBe(false);
  }, 30_000);
});

describe('engine spend surfaces on the attempt', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cleanupTempDirs();
  });

  /** Stub the global fetch with one JSON response, for the in-process engines. */
  function stubFetchJson(body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body,
        text: async () => JSON.stringify(body),
      })),
    );
  }

  const firstAttempt = (result: Awaited<ReturnType<typeof runSearch>>) =>
    (result.results[0].attempts as EngineAttempt[])[0];

  it('carries exa dollar cost onto the attempt, and no credits', async () => {
    stubFetchJson({
      results: [{ title: 'A', url: 'https://a.example.com/p', highlights: ['h'] }],
      costDollars: { total: 0.007 },
    });
    const result = await runSearch({
      query: 'q',
      engine: 'exa',
      config: { engines: { exa: { apiKey: 'k' } } },
      env: BARE_ENV,
      timeoutMs: 20_000,
    });
    const attempt = firstAttempt(result);
    expect(attempt).toMatchObject({ engine: 'exa', ok: true, cost: 0.007 });
    expect(attempt.credits).toBeUndefined();
  });

  it('carries firecrawl credits onto the attempt, and no cost', async () => {
    stubFetchJson({
      success: true,
      data: { web: [{ title: 'A', url: 'https://a.example.com/p', description: 'd' }] },
      creditsUsed: 3,
    });
    const result = await runSearch({
      query: 'q',
      engine: 'firecrawl',
      config: { engines: { firecrawl: { apiKey: 'k' } } },
      env: BARE_ENV,
      timeoutMs: 20_000,
    });
    const attempt = firstAttempt(result);
    expect(attempt).toMatchObject({ engine: 'firecrawl', ok: true, credits: 3 });
    expect(attempt.cost).toBeUndefined();
  });
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
