import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveMode, routeProvider, runCommand, runSearch, validateUrl } from './search.ts';

describe('resolveMode', () => {
  it('is search when only a query is given', () => {
    expect(resolveMode('latest node lts', undefined)).toBe('search');
  });

  it('is fetch when a url is given, with or without a query', () => {
    expect(resolveMode(undefined, 'https://example.com')).toBe('fetch');
    expect(resolveMode('pricing details', 'https://example.com')).toBe('fetch');
  });

  it('rejects runs with neither query nor url', () => {
    expect(() => resolveMode(undefined, undefined)).toThrow(
      'Provide a search query (-q) or a URL to fetch (-u).',
    );
  });
});

describe('validateUrl', () => {
  it('accepts http and https urls', () => {
    expect(validateUrl(' https://example.com/page ')).toBe('https://example.com/page');
  });

  it('rejects other schemes', () => {
    expect(() => validateUrl('ftp://example.com')).toThrow('must start with http');
  });
});

describe('provider subprocess handling', () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.();
    }
  });

  function fakeProvider(script: string) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-proc-'));
    const bin = path.join(dir, 'fake-agy');
    fs.writeFileSync(bin, script, { mode: 0o755 });
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    return bin;
  }

  it('returns as soon as the provider exits, even when a descendant holds the stdout pipe open', async () => {
    // agy leaves a language server running that inherited the pipe, so the
    // child's 'close' event never fires and the run used to hang until the
    // timeout killed it (modlens issue #1).
    const bin = fakeProvider(`#!/bin/sh\necho 'hello there'\nsleep 30 &\nexit 0\n`);
    const startedAt = Date.now();
    const result = await runCommand('fake', { command: bin, args: [], cwd: os.tmpdir() }, 20_000);
    expect(result.stdout.trim()).toBe('hello there');
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 30_000);

  it('still reports a non-zero exit with its stderr', async () => {
    const bin = fakeProvider('#!/bin/sh\necho "boom" >&2\nsleep 30 &\nexit 3\n');
    await expect(
      runCommand('fake', { command: bin, args: [], cwd: os.tmpdir() }, 20_000),
    ).rejects.toThrow(/failed with code 3.*boom/s);
  }, 30_000);

  it('reports a timeout when the provider never exits', async () => {
    const bin = fakeProvider('#!/bin/sh\nsleep 30\n');
    await expect(
      runCommand('fake', { command: bin, args: [], cwd: os.tmpdir() }, 1_000),
    ).rejects.toThrow(/timed out after 1000 ms/);
  }, 20_000);
});

describe('config file wiring', () => {
  it('lets a pinned provider in the config beat X routing', () => {
    const routed = routeProvider({ mode: 'search', query: 'tweets about deepseek' });
    const pinned = routeProvider({
      mode: 'search',
      query: 'tweets about deepseek',
      pinnedProvider: 'tavily',
    });
    expect(pinned.name).toBe('tavily');
    // -p still outranks the pinned value
    expect(
      routeProvider({
        mode: 'search',
        query: 'anything',
        provider: 'antigravity-cli',
        pinnedProvider: 'tavily',
      }).name,
    ).toBe('antigravity-cli');
    expect(routed.name).not.toBe('tavily');
  });

  it('takes the agy binary and model from the config file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-cfg-'));
    const bin = path.join(dir, 'fake-agy');
    // Echo the model we were invoked with so the assertion sees it.
    fs.writeFileSync(
      bin,
      `#!/bin/sh\nmodel=""\nwhile [ $# -gt 0 ]; do [ "$1" = "--model" ] && model="$2"; shift; done\nprintf '{"status":"SUCCESS","structured_output":{"summary":"%s","items":[],"uncertainty":[]}}' "$model"\n`,
      { mode: 0o755 },
    );
    try {
      const result = await runSearch({
        query: 'plain query',
        timeoutMs: 20_000,
        config: {
          providers: { 'antigravity-cli': { bin, model: 'gemini-3.1-pro-high' } },
        },
      });
      expect(result.provider).toBe('antigravity-cli');
      expect((result.result as { summary: string }).summary).toBe('gemini-3.1-pro-high');
      expect(result.meta.model).toBe('gemini-3.1-pro-high');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('bridges the tavily key from the config file into the env var', async () => {
    const saved = process.env.TAVILY_API_KEY;
    delete process.env.TAVILY_API_KEY;
    try {
      // tavily fails on fetch mode before touching the network, which is
      // enough to prove the key made it through to the provider.
      await expect(
        runSearch({
          url: 'https://example.com',
          provider: 'tavily',
          timeoutMs: 5_000,
          config: { providers: { tavily: { apiKey: 'tvly-from-config' } } },
        }),
      ).rejects.toThrow(/only supports search mode/);
      expect(process.env.TAVILY_API_KEY).toBe('tvly-from-config');
    } finally {
      if (saved === undefined) {
        delete process.env.TAVILY_API_KEY;
      } else {
        process.env.TAVILY_API_KEY = saved;
      }
    }
  });
});
