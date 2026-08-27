import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { agentCtor, tlsState } = vi.hoisted(() => ({
  agentCtor: vi.fn(),
  tlsState: {
    getCACertificates: undefined as undefined | ((type?: string) => string[]),
  },
}));

vi.mock('undici', () => ({
  Agent: class {
    constructor(opts: unknown) {
      agentCtor(opts);
    }
    close() {
      return Promise.resolve();
    }
  },
}));

vi.mock('node:tls', () => ({
  get getCACertificates() {
    return tlsState.getCACertificates;
  },
}));

const HTML = '<html><body>ok</body></html>';

type ConnectOpts = {
  lookup?: unknown;
  ca?: string[];
  tls?: { ca?: string[] };
};

function stubFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(HTML, {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html' },
        }),
    ),
  );
}

function lastConnect(): ConnectOpts {
  const opts = agentCtor.mock.calls.at(-1)?.[0] as { connect?: ConnectOpts } | undefined;
  const connect = opts?.connect;
  if (!connect) {
    throw new Error('expected Agent to receive connect options');
  }
  return connect;
}

async function loadRunFetch(): Promise<typeof import('./httpFetch.ts').runFetch> {
  vi.resetModules();
  agentCtor.mockClear();
  const { runFetch } = await import('./httpFetch.ts');
  return runFetch;
}

describe('system CA when allowPrivateNetwork is true', () => {
  beforeEach(() => {
    stubFetch();
    agentCtor.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not read the system store when the flag is off', async () => {
    const getCACertificates = vi.fn(() => ['SHOULD_NOT_BE_READ']);
    tlsState.getCACertificates = getCACertificates;
    const runFetch = await loadRunFetch();
    await runFetch({ url: 'http://93.184.216.34/' });
    expect(getCACertificates).not.toHaveBeenCalled();
    expect(lastConnect().ca).toBeUndefined();
  });

  it('passes merged default and system CAs on connect.ca', async () => {
    const getCACertificates = vi.fn((type?: string) => {
      if (type === 'default') {
        return ['CERT_DEFAULT', 'CERT_SHARED'];
      }
      if (type === 'system') {
        return ['CERT_SYSTEM', 'CERT_SHARED'];
      }
      return [];
    });
    tlsState.getCACertificates = getCACertificates;
    const runFetch = await loadRunFetch();
    await runFetch({ url: 'http://127.0.0.1/', allowPrivateNetwork: true });
    const connect = lastConnect();
    expect(connect.ca).toEqual(
      expect.arrayContaining(['CERT_DEFAULT', 'CERT_SYSTEM', 'CERT_SHARED']),
    );
    expect(connect.ca?.filter((cert) => cert === 'CERT_SHARED')).toHaveLength(1);
    expect(connect.tls).toBeUndefined();
  });

  it('skips ca when getCACertificates is missing', async () => {
    tlsState.getCACertificates = undefined;
    const runFetch = await loadRunFetch();
    await expect(
      runFetch({ url: 'http://127.0.0.1/', allowPrivateNetwork: true }),
    ).resolves.toMatchObject({ status: 200 });
    expect(lastConnect().ca).toBeUndefined();
  });

  it('reads the CA lists once per process, not per request', async () => {
    const getCACertificates = vi.fn((type?: string) => {
      if (type === 'default') {
        return ['CERT_DEFAULT'];
      }
      if (type === 'system') {
        return ['CERT_SYSTEM'];
      }
      return [];
    });
    tlsState.getCACertificates = getCACertificates;
    const runFetch = await loadRunFetch();
    await runFetch({ url: 'http://127.0.0.1/', allowPrivateNetwork: true });
    await runFetch({ url: 'http://127.0.0.1/', allowPrivateNetwork: true });
    expect(getCACertificates).toHaveBeenCalledTimes(2);
    expect(getCACertificates).toHaveBeenCalledWith('default');
    expect(getCACertificates).toHaveBeenCalledWith('system');
  });

  it('skips ca when the OS store throws', async () => {
    tlsState.getCACertificates = vi.fn(() => {
      throw new Error('OS cert store unavailable');
    });
    const runFetch = await loadRunFetch();
    await expect(
      runFetch({ url: 'http://127.0.0.1/', allowPrivateNetwork: true }),
    ).resolves.toMatchObject({ status: 200 });
    expect(lastConnect().ca).toBeUndefined();
  });

  it('does not pass an empty ca list', async () => {
    tlsState.getCACertificates = vi.fn(() => []);
    const runFetch = await loadRunFetch();
    await runFetch({ url: 'http://127.0.0.1/', allowPrivateNetwork: true });
    expect(lastConnect().ca).toBeUndefined();
  });
});
