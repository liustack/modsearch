import * as http from 'node:http';
import * as net from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestText } from './timedRequest.ts';

const PROXY_ENV_KEYS = [
  'http_proxy',
  'https_proxy',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'no_proxy',
  'NO_PROXY',
] as const;

interface Server {
  port: number;
  close: () => Promise<void>;
}

function listen(server: http.Server): Promise<Server> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({ port, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

/** The engine API stand-in. */
function startOrigin(): Promise<Server> {
  return listen(
    http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"from":"origin"}');
    }),
  );
}

/**
 * Accepts every CONNECT, records the requested authority, and tunnels it to
 * the loopback origin whatever host was asked for. A name that never resolves
 * still gets an answer this way, so the test needs no DNS.
 */
async function startProxy(originPort: number): Promise<Server & { seen: string[] }> {
  const seen: string[] = [];
  const server = http.createServer((_req, res) => {
    res.writeHead(405);
    res.end();
  });
  server.on('connect', (req, clientSocket, head) => {
    seen.push(req.url ?? '');
    const upstream = net.connect(originPort, '127.0.0.1', () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
  });
  const listening = await listen(server);
  return { ...listening, seen };
}

/** A loopback port with nothing listening on it. */
async function closedPort(): Promise<number> {
  const server = await listen(http.createServer());
  await server.close();
  return server.port;
}

function call(url: string) {
  return requestText('engine', url, { method: 'GET' }, AbortSignal.timeout(5_000), 5_000, []);
}

describe('requestText and the system HTTP proxy', () => {
  let origin: Server;
  let proxy: Server & { seen: string[] };

  beforeEach(async () => {
    for (const key of PROXY_ENV_KEYS) {
      vi.stubEnv(key, '');
    }
    origin = await startOrigin();
    proxy = await startProxy(origin.port);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await proxy.close();
    await origin.close();
  });

  it('sends the engine call through http_proxy when one is set', async () => {
    vi.stubEnv('http_proxy', `http://127.0.0.1:${proxy.port}`);
    const { response, text } = await call('http://engine-api.invalid/search');
    expect(response.status).toBe(200);
    expect(text).toBe('{"from":"origin"}');
    expect(proxy.seen).toEqual(['engine-api.invalid:80']);
  });

  it('goes direct for a host listed in NO_PROXY', async () => {
    vi.stubEnv('http_proxy', `http://127.0.0.1:${proxy.port}`);
    vi.stubEnv('no_proxy', '127.0.0.1');
    const { text } = await call(`http://127.0.0.1:${origin.port}/search`);
    expect(text).toBe('{"from":"origin"}');
    expect(proxy.seen).toEqual([]);
  });

  it('names the underlying cause when the transport fails', async () => {
    const port = await closedPort();
    await expect(call(`http://127.0.0.1:${port}/search`)).rejects.toThrow(
      /^engine request failed: fetch failed; cause: .*ECONNREFUSED/,
    );
  });
});
