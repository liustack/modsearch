import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModsearchConfig } from './config.ts';
import { noEngineMessage, resolveMode, runSearch, validateUrl } from './search.ts';

const BARE: NodeJS.ProcessEnv = { PATH: '/nonexistent' };

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
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  function fakeAgy(body: string): { bin: string; config: ModsearchConfig } {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-run-'));
    const bin = path.join(dir, 'fake-agy');
    fs.writeFileSync(bin, body, { mode: 0o755 });
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    return { bin, config: { engines: { 'antigravity-cli': { bin } } } };
  }

  it('tells the user how to enable search rather than crashing', async () => {
    // Nothing installed, no keys, no config file.
    await expect(
      runSearch({ query: 'anything', config: {}, env: BARE, timeoutMs: 5_000 }),
    ).rejects.toThrow(/No engine on this machine can search the web/);

    const message = noEngineMessage('search');
    expect(message).toContain('antigravity-cli:');
    expect(message).toContain('tavily:');
  });

  it('still fetches a page with nothing installed', async () => {
    // The http engine needs no setup, so -u works out of the box. This one
    // hits a real URL through the local engine.
    const result = await runSearch({
      url: 'https://example.com',
      config: { engines: { http: { allowPrivateNetwork: 'true' } } },
      env: BARE,
      timeoutMs: 30_000,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].engine).toBe('http');
    expect(String(result.results[0].content)).toContain('Example Domain');
  }, 40_000);

  it('always returns an array of results, one per source', async () => {
    const { bin, config } = fakeAgy(
      `#!/bin/sh\necho '{"status":"SUCCESS","structured_output":{"summary":"web-sum","items":[],"uncertainty":[]}}'\n`,
    );
    const result = await runSearch({
      query: 'node lts',
      config,
      env: { PATH: path.dirname(bin) },
      timeoutMs: 20_000,
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      source: 'web',
      engine: 'antigravity-cli',
      summary: 'web-sum',
    });
    expect(result.mode).toBe('search');
  }, 30_000);

  it('falls through to the next engine and says so', async () => {
    const { bin } = fakeAgy('#!/bin/sh\nexit 1\n');
    const result = await runSearch({
      url: 'https://example.com',
      config: {
        engines: { 'antigravity-cli': { bin }, http: { allowPrivateNetwork: 'true' } },
      },
      env: { PATH: path.dirname(bin) },
      timeoutMs: 30_000,
    });
    expect(result.results[0].engine).toBe('http');
    expect((result.results[0].uncertainty as string[]).join(' ')).toContain('Fell back to http');
  }, 40_000);
});

describe('routing facts cannot be faked by an engine', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  it('overwrites source, engine, and model even when the engine has no model', () => {
    // A conditional spread left `model` writable whenever the engine's default
    // model was empty, so a result could claim to come from somewhere else.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-spoof-'));
    const bin = path.join(dir, 'fake-agy');
    fs.writeFileSync(
      bin,
      `#!/bin/sh\necho '{"status":"SUCCESS","structured_output":{"summary":"s","items":[],"uncertainty":[],"source":"x","engine":"spoofed","model":"spoof-model","durationSeconds":999}}'\n`,
      { mode: 0o755 },
    );
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));

    return runSearch({
      query: 'plain query',
      config: { engines: { 'antigravity-cli': { bin } } },
      env: { PATH: dir },
      timeoutMs: 20_000,
    }).then((result) => {
      expect(result.results[0].source).toBe('web');
      expect(result.results[0].engine).toBe('antigravity-cli');
      expect(result.results[0].model).toBe('gemini-3.6-flash-low');
      expect(result.results[0].durationSeconds).toBeLessThan(100);
    });
  }, 30_000);
});
