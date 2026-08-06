import * as http from 'http';
import { afterEach, describe, expect, it } from 'vitest';
import { planRole } from '../router.ts';
import { cleanupTempDirs, tempConfigPath } from '../testing/helpers.ts';
import { runFetch } from './httpFetch.ts';
import { resolveEngine } from './index.ts';

interface LocalServer {
  port: number;
  close: () => Promise<void>;
}

/** A loopback server on the given host, or null when that host cannot bind. */
function startServer(
  handler: http.RequestListener,
  host = '127.0.0.1',
): Promise<LocalServer | null> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.once('error', () => resolve(null));
    server.listen(0, host, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({ port, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

describe('local engine routing', () => {
  it('is registered as a fetch-only engine, canonically named local', () => {
    const engine = resolveEngine('local');
    expect(engine.name).toBe('local');
    expect(engine.roles).toEqual(['fetch']);
    expect(engine.isAvailable({}, {})).toBe(true);
  });

  it('keeps http and direct as aliases that resolve to local', () => {
    expect(resolveEngine('http').name).toBe('local');
    expect(resolveEngine('direct').name).toBe('local');
  });

  it('takes over page fetch when agy is not installed', () => {
    const bare = planRole('fetch', {}, undefined, { PATH: '/nonexistent' } as NodeJS.ProcessEnv);
    expect(bare.chain[0].name).toBe('local');
  });

  it('never takes over search', () => {
    expect(resolveEngine('local').roles).not.toContain('search');
  });
});

describe('private network escape hatch', () => {
  afterEach(() => cleanupTempDirs());

  it('is off by default and settable from the config file', async () => {
    const { loadConfigFile, setConfigValue } = await import('../config.ts');
    const p = tempConfigPath();

    expect(loadConfigFile(p).engines?.http?.allowPrivateNetwork).toBeUndefined();
    setConfigValue('http.allowPrivateNetwork', 'true', p);
    expect(loadConfigFile(p).engines?.http?.allowPrivateNetwork).toBe('true');
  });

  it('blocks a private target by default and names the VPN case', async () => {
    await expect(runFetch({ url: 'http://127.0.0.1:1/x' })).rejects.toThrow(
      /Blocked private network target/,
    );
  });
});

describe('pinned fetch (DNS rebinding closed)', () => {
  const html = (body: string) => `<html><body>${body}</body></html>`;

  it('connects to the pinned IPv4 target and keeps the Host header', async () => {
    const server = await startServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html(`host=${req.headers.host}`));
    });
    expect(server).not.toBeNull();
    try {
      const result = await runFetch({
        url: `http://127.0.0.1:${server?.port}/`,
        allowPrivateNetwork: true,
      });
      expect(result.status).toBe(200);
      // Host header carries the original hostname:port, proving SNI/Host survive
      // the pin to the validated IP.
      expect(result.text).toContain(`host=127.0.0.1:${server?.port}`);
    } finally {
      await server?.close();
    }
  }, 15_000);

  it('connects to the pinned IPv6 target when IPv6 loopback is available', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html('ipv6 ok'));
    }, '::1');
    if (!server) {
      // No IPv6 loopback on this box (some CI): nothing to prove here.
      return;
    }
    try {
      const result = await runFetch({
        url: `http://[::1]:${server.port}/`,
        allowPrivateNetwork: true,
      });
      expect(result.status).toBe(200);
      expect(result.text).toContain('ipv6 ok');
    } finally {
      await server.close();
    }
  }, 15_000);

  it('re-validates and re-pins on each redirect hop, following to the new target', async () => {
    const target = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html('final page'));
    });
    expect(target).not.toBeNull();
    const redirector = await startServer((_req, res) => {
      res.writeHead(302, { location: `http://127.0.0.1:${target?.port}/dest` });
      res.end();
    });
    expect(redirector).not.toBeNull();
    try {
      const result = await runFetch({
        url: `http://127.0.0.1:${redirector?.port}/`,
        allowPrivateNetwork: true,
      });
      expect(result.text).toContain('final page');
      expect(result.finalUrl).toBe(`http://127.0.0.1:${target?.port}/dest`);
      expect(result.meta.redirectChain).toHaveLength(1);
    } finally {
      await redirector?.close();
      await target?.close();
    }
  }, 15_000);
});
