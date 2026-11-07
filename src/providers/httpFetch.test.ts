import * as http from 'http';
import * as net from 'net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { planRole } from '../router.ts';
import { cleanupTempDirs, tempConfigPath } from '../testing/helpers.ts';
import { executeHttpFetch, runFetch } from './httpFetch.ts';
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

const PROXY_ENV_KEYS = [
  'http_proxy',
  'https_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'no_proxy',
  'NO_PROXY',
] as const;

function stubEmptyProxyEnv(): void {
  for (const key of PROXY_ENV_KEYS) {
    vi.stubEnv(key, '');
  }
}

interface LocalProxy {
  port: number;
  saw: () => number;
  close: () => Promise<void>;
}

/** Records CONNECT tunnels and absolute-form GETs, then forwards to the origin. */
function startProxy(): Promise<LocalProxy> {
  return new Promise((resolve, reject) => {
    let saw = 0;
    const server = http.createServer((req, res) => {
      saw += 1;
      let target: URL;
      try {
        target = new URL(req.url ?? '');
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      const originReq = http.request(
        {
          hostname: target.hostname,
          port: target.port || 80,
          path: `${target.pathname}${target.search}`,
          method: req.method,
          headers: req.headers,
        },
        (originRes) => {
          res.writeHead(originRes.statusCode ?? 502, originRes.headers);
          originRes.pipe(res);
        },
      );
      originReq.on('error', () => {
        if (!res.headersSent) {
          res.writeHead(502);
        }
        res.end();
      });
      req.pipe(originReq);
    });

    server.on('connect', (req, clientSocket, head) => {
      saw += 1;
      const authority = req.url ?? '';
      const lastColon = authority.lastIndexOf(':');
      const host = lastColon === -1 ? authority : authority.slice(0, lastColon);
      const port =
        lastColon === -1 ? 80 : Number.parseInt(authority.slice(lastColon + 1), 10) || 80;
      const originSocket = net.connect(port, host, () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) {
          originSocket.write(head);
        }
        originSocket.pipe(clientSocket);
        clientSocket.pipe(originSocket);
      });
      originSocket.on('error', () => {
        clientSocket.destroy();
      });
      clientSocket.on('error', () => {
        originSocket.destroy();
      });
    });

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({
        port,
        saw: () => saw,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

const PROXY_PINNING_WARNING =
  'This request went through the system HTTP proxy. The proxy resolved the hostname, so the connection was not pinned to a checked IP.';

const html = (body: string) => `<html><body>${body}</body></html>`;

beforeEach(() => {
  stubEmptyProxyEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('local engine routing', () => {
  it('is registered as a fetch-only engine, canonically named local', () => {
    const engine = resolveEngine('local');
    expect(engine.name).toBe('local');
    expect(engine.roles).toEqual(['fetch']);
    expect(engine.isAvailable({}, {}, 'fetch')).toBe(true);
  });

  it('keeps http and direct as aliases that resolve to local', () => {
    expect(resolveEngine('http').name).toBe('local');
    expect(resolveEngine('direct').name).toBe('local');
  });

  it('takes over page fetch when keyless cloud fetch is opted out', () => {
    const noCloud = planRole(
      'fetch',
      { engines: { firecrawl: { keylessFetch: false } } },
      undefined,
      { PATH: '/nonexistent' } as NodeJS.ProcessEnv,
    );
    expect(noCloud.chain.map((engine) => engine.name)).toEqual(['local']);
  });

  it('never takes over search', () => {
    expect(resolveEngine('local').roles).not.toContain('search');
  });
});

describe('private network escape hatch', () => {
  afterEach(() => cleanupTempDirs());

  it('is off by default and set from the top-level allowPrivateNetwork key', async () => {
    const { allowsPrivateNetwork, loadConfigFile, setConfigValue } = await import('../config.ts');
    const p = tempConfigPath();

    expect(allowsPrivateNetwork(loadConfigFile(p))).toBe(false);
    setConfigValue('allowPrivateNetwork', 'true', p);
    const config = loadConfigFile(p);
    expect(config.allowPrivateNetwork).toBe(true);
    expect(allowsPrivateNetwork(config)).toBe(true);
  });

  it('blocks a private target by default and names the VPN case', async () => {
    await expect(runFetch({ url: 'http://127.0.0.1:1/x' })).rejects.toThrow(
      /Blocked private network target/,
    );
  });
});

describe('pinned fetch (DNS rebinding closed)', () => {
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

describe('system HTTP proxy dispatch', () => {
  it('forwards through the proxy when http_proxy is set', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html('via proxy'));
    });
    expect(origin).not.toBeNull();
    const proxy = await startProxy();
    vi.stubEnv('http_proxy', `http://127.0.0.1:${proxy.port}`);
    try {
      const url = `http://127.0.0.1:${origin?.port}/`;
      const result = await runFetch({ url, allowPrivateNetwork: true });
      expect(result.status).toBe(200);
      expect(result.text).toContain('via proxy');
      expect(result.meta.proxied).toBe(true);
      expect(proxy.saw()).toBeGreaterThan(0);

      const output = await executeHttpFetch({
        mode: 'fetch',
        url,
        timeoutMs: 15_000,
        settings: {},
        allowPrivateNetwork: true,
      });
      const body = output.result as { warnings: string[] };
      expect(body.warnings).toContain(PROXY_PINNING_WARNING);
    } finally {
      await proxy.close();
      await origin?.close();
    }
  }, 15_000);

  it('still blocks a private target when a proxy is configured', async () => {
    vi.stubEnv('http_proxy', 'http://127.0.0.1:9');
    await expect(runFetch({ url: 'http://127.0.0.1:1/x' })).rejects.toThrow(
      /Blocked private network target/,
    );
  });

  it('goes direct when no_proxy excludes the origin host', async () => {
    const origin = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html('direct'));
    });
    expect(origin).not.toBeNull();
    const proxy = await startProxy();
    vi.stubEnv('http_proxy', `http://127.0.0.1:${proxy.port}`);
    vi.stubEnv('no_proxy', '127.0.0.1');
    try {
      const url = `http://127.0.0.1:${origin?.port}/`;
      const result = await runFetch({ url, allowPrivateNetwork: true });
      expect(result.status).toBe(200);
      expect(result.text).toContain('direct');
      expect(result.meta.proxied).toBe(false);
      expect(proxy.saw()).toBe(0);

      const output = await executeHttpFetch({
        mode: 'fetch',
        url,
        timeoutMs: 15_000,
        settings: {},
        allowPrivateNetwork: true,
      });
      const body = output.result as { warnings: string[] };
      expect(body.warnings).not.toContain(PROXY_PINNING_WARNING);
    } finally {
      await proxy.close();
      await origin?.close();
    }
  }, 15_000);
});
