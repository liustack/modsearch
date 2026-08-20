import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { FETCH_RESULT_SCHEMA, SEARCH_RESULT_SCHEMA } from './schema.ts';

const SEARCH_SCHEMA_PATH = new URL('../dsh/search-schema.json', import.meta.url);
const FETCH_SCHEMA_PATH = new URL('../dsh/fetch-schema.json', import.meta.url);

describe('dsh plugin bundle', () => {
  it('ships tool output schemas in lockstep with the source of truth', () => {
    // dsh/index.js cannot import the TS source, so it carries JSON copies;
    // these are the lockstep checks that keep the copies honest.
    const search = JSON.parse(fs.readFileSync(SEARCH_SCHEMA_PATH, 'utf-8'));
    expect(search.properties.summary).toEqual(SEARCH_RESULT_SCHEMA.properties.summary);
    expect(search.properties.items).toEqual(SEARCH_RESULT_SCHEMA.properties.items);
    expect(search.properties.uncertainty).toEqual(SEARCH_RESULT_SCHEMA.properties.uncertainty);
    expect(search.required).toEqual(
      expect.arrayContaining([...SEARCH_RESULT_SCHEMA.required, 'status', 'source']),
    );

    const fetch = JSON.parse(fs.readFileSync(FETCH_SCHEMA_PATH, 'utf-8'));
    expect(fetch).toEqual(FETCH_RESULT_SCHEMA);
  });

  it('wires the bundle manifest to the patch and the patch to the plugin', () => {
    const pkg = JSON.parse(
      fs.readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as {
      dsh?: {
        bundle?: { patch?: string };
        client?: { inject?: string[]; platform?: string; immediately?: boolean };
      };
      exports?: Record<string, string>;
      files?: string[];
    };
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml');
    // The browser half rides the same manifest: without `dsh.client` the host
    // never loads dsh/client.js and the settings card silently never exists.
    expect(pkg.dsh?.client).toEqual({ inject: [], platform: 'web', immediately: true });
    expect(pkg.exports?.['.']).toBe('./dsh/index.js');
    expect(pkg.exports?.['./dsh']).toBe('./dsh/index.js');
    expect(pkg.exports?.['./client']).toBe('./dsh/client.js');
    expect(pkg.files).toContain('dsh');
    expect(pkg.files).toContain('cordis.patch.yml');
    const patch = fs.readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf-8');
    expect(patch).toContain("name: '@liustack/modsearch'");
    expect(patch).toContain('searchProvider: modsearch');
  });
});

interface RegisteredTool {
  name: string;
  parameters: unknown;
  output: {
    schema: unknown;
    render: (args: unknown, value: never) => Array<{ type: string; text: string }>;
    presentationMeta?: (args: unknown, value: never) => { sources: unknown[] };
  };
  presentResult?: (
    args: unknown,
    result: { content: unknown[]; isError: boolean; meta?: { sources: unknown[] } },
  ) => { card: string; kind: string; sources: unknown[] } | undefined;
  execute: (args: unknown, exec: { signal?: AbortSignal }) => Promise<Record<string, unknown>>;
}

interface RegisteredProvider {
  id: string;
  available: () => boolean;
  search: (
    request: { query: string; maxResults?: number },
    signal?: AbortSignal,
  ) => Promise<{ content: string; sources: Array<Record<string, unknown>>; truncated: boolean }>;
}

async function load(config?: Record<string, unknown>) {
  // The plugin is plain JS by design (no build step, no dsh type deps).
  // @ts-expect-error untyped on purpose
  const plugin = (await import('../dsh/index.js')) as {
    apply: (ctx: unknown, config?: Record<string, unknown>) => void;
  };
  const tools = new Map<string, RegisteredTool>();
  const providers: RegisteredProvider[] = [];
  const ctx = {
    tools: {
      register: (definition: RegisteredTool) => {
        tools.set(definition.name, definition);
      },
    },
    web: {
      registerSearchProvider: (provider: RegisteredProvider) => {
        providers.push(provider);
      },
    },
  };
  plugin.apply(ctx as never, config);
  return { tools, providers };
}

/** The named registered tool, or a loud failure when registration skipped it. */
function toolNamed(tools: Map<string, RegisteredTool>, name: string): RegisteredTool {
  const definition = tools.get(name);
  if (!definition) {
    throw new Error(`tool ${name} was not registered`);
  }
  return definition;
}

const created: string[] = [];
const originalElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;

afterEach(() => {
  delete process.env.MODSEARCH_DSH_CLI;
  if (originalElectronRunAsNode === undefined) {
    delete process.env.ELECTRON_RUN_AS_NODE;
  } else {
    process.env.ELECTRON_RUN_AS_NODE = originalElectronRunAsNode;
  }
  Reflect.deleteProperty(process.versions, 'electron');
  while (created.length > 0) {
    fs.rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

/** Point MODSEARCH_DSH_CLI at a node script whose stdout is this envelope. */
function fakeCli(body: string): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-dsh-cli-'));
  created.push(dir);
  const file = path.join(dir, 'cli.js');
  fs.writeFileSync(file, body);
  process.env.MODSEARCH_DSH_CLI = file;
}

function envelopeCli(entry: Record<string, unknown>): void {
  fakeCli(`console.log(JSON.stringify({ results: [${JSON.stringify(entry)}] }))`);
}

const okSearchEntry = {
  source: 'web',
  requestedSource: 'web',
  engine: 'antigravity-cli',
  status: 'ok',
  warnings: [],
  attempts: [{ engine: 'antigravity-cli', ok: true, durationSeconds: 3 }],
  durationSeconds: 3,
  summary: 'What the web says.',
  items: [
    { title: 'A', url: 'https://a.example', snippet: 'sa', published_at: '2026-08-01' },
    { title: 'B', url: 'https://b.example', snippet: 'sb' },
    { title: 'junk-without-url', snippet: 'dropped' },
  ],
  uncertainty: ['dates approximate'],
};

describe('dsh web search provider', () => {
  it('runs the CLI in Node mode when the plugin is hosted by Electron', async () => {
    delete process.env.ELECTRON_RUN_AS_NODE;
    Object.defineProperty(process.versions, 'electron', {
      value: '43.4.0',
      configurable: true,
    });
    fakeCli(`
      if (process.env.ELECTRON_RUN_AS_NODE !== '1') {
        process.stderr.write('Electron Node mode was not enabled');
        process.exit(1);
      }
      console.log(JSON.stringify({ results: [${JSON.stringify(okSearchEntry)}] }));
    `);

    const { providers } = await load();
    await expect(providers[0].search({ query: 'anything' })).resolves.toMatchObject({
      content: expect.stringContaining('What the web says.'),
    });
  });

  it('maps the CLI envelope to the seam result shape', async () => {
    const { providers } = await load();
    expect(providers).toHaveLength(1);
    expect(providers[0].id).toBe('modsearch');
    expect(providers[0].available()).toBe(true);
    envelopeCli(okSearchEntry);
    const result = await providers[0].search({ query: 'anything', maxResults: 5 });
    expect(result.content).toContain('What the web says.');
    expect(result.content).toContain('Uncertain: dates approximate');
    expect(result.truncated).toBe(false);
    // Junk without a URL is dropped; published_at becomes the seam's camelCase.
    expect(result.sources).toEqual([
      { title: 'A', url: 'https://a.example', snippet: 'sa', publishedAt: '2026-08-01' },
      { title: 'B', url: 'https://b.example', snippet: 'sb' },
    ]);
  });

  it('names the attempt trail when every engine failed', async () => {
    envelopeCli({
      ...okSearchEntry,
      status: 'unavailable',
      summary: '',
      items: [],
      attempts: [{ engine: 'antigravity-cli', ok: false, error: 'not signed in' }],
    });
    const { providers } = await load();
    await expect(providers[0].search({ query: 'anything' })).rejects.toThrow(
      /antigravity-cli: not signed in.*doctor/s,
    );
  });

  it('surfaces a non-zero CLI exit with its stderr', async () => {
    fakeCli(`process.stderr.write('Error: no engines'); process.exit(1)`);
    const { providers } = await load();
    await expect(providers[0].search({ query: 'anything' })).rejects.toThrow(/exit 1.*no engines/s);
  });
});

describe('dsh x_search tool', () => {
  it('returns evidence plus provenance as the canonical value', async () => {
    const { tools } = await load();
    const tool = toolNamed(tools, 'x_search');
    envelopeCli({ ...okSearchEntry, source: 'x', requestedSource: 'x', engine: 'grok-cli' });
    const value = await tool.execute({ query: 'what is @dev saying' }, {});
    expect(value).toEqual({
      status: 'ok',
      source: 'x',
      summary: 'What the web says.',
      items: okSearchEntry.items,
      uncertainty: ['dates approximate'],
    });
  });

  it('marks a web stand-in answer as degraded in value and render', async () => {
    const { tools } = await load();
    const tool = toolNamed(tools, 'x_search');
    envelopeCli({ ...okSearchEntry, requestedSource: 'x', status: 'degraded' });
    const value = await tool.execute({ query: 'reactions to the launch' }, {});
    expect(value.status).toBe('degraded');
    expect(value.source).toBe('web');
    const [block] = tool.output.render({}, value as never);
    expect(block.text).toContain('second-hand');
    expect(block.text).toContain('1. A (2026-08-01) — https://a.example');
  });

  it('projects citation sources for the native web card', async () => {
    const { tools } = await load();
    const tool = toolNamed(tools, 'x_search');
    const value = {
      status: 'ok',
      source: 'x',
      summary: 's',
      items: okSearchEntry.items,
      uncertainty: [],
    };
    const meta = tool.output.presentationMeta?.({}, value as never);
    expect(meta?.sources).toHaveLength(2);
    const card = tool.presentResult?.({}, { content: [], isError: false, meta });
    expect(card).toEqual({
      card: 'web',
      kind: 'search',
      sources: meta?.sources,
      truncated: false,
    });
    expect(tool.presentResult?.({}, { content: [], isError: true })).toBeUndefined();
  });

  it('rejects an empty query before spawning anything', async () => {
    const { tools } = await load();
    await expect(toolNamed(tools, 'x_search').execute({ query: '  ' }, {})).rejects.toThrow(
      /non-empty string "query"/,
    );
  });
});

describe('dsh read_page tool', () => {
  it('returns the fetch evidence fields as the canonical value', async () => {
    const { tools } = await load();
    const tool = toolNamed(tools, 'read_page');
    envelopeCli({
      source: 'web',
      requestedSource: 'web',
      engine: 'antigravity-cli',
      status: 'ok',
      warnings: ['Fetched through Firecrawl in the cloud.'],
      attempts: [],
      durationSeconds: 2,
      summary: 'The page in one line.',
      content: 'Full extracted content.',
      links: [{ text: 'docs', url: 'https://a.example/docs' }],
      uncertainty: [],
    });
    const value = await tool.execute({ url: 'https://a.example', query: 'rate limits' }, {});
    expect(value).toEqual({
      summary: 'The page in one line.',
      content: 'Full extracted content.',
      links: [{ text: 'docs', url: 'https://a.example/docs' }],
      uncertainty: [],
      warnings: ['Fetched through Firecrawl in the cloud.'],
    });
    const [block] = tool.output.render({}, value as never);
    expect(block.text).toContain('Full extracted content.');
    expect(block.text).toContain('- docs — https://a.example/docs');
    expect(block.text).toContain('Fetched through Firecrawl in the cloud.');
  });

  it('rejects a non-http url before spawning anything', async () => {
    const { tools } = await load();
    const tool = toolNamed(tools, 'read_page');
    await expect(tool.execute({ url: 'file:///etc/passwd' }, {})).rejects.toThrow(/http\(s\)/);
  });
});

type RouteHandler = (req: unknown, res: unknown) => Promise<void>;

interface Namespace {
  ns: string;
  schema: ((value: unknown) => unknown) & { toJSON: () => unknown };
  options: unknown;
}

/** A host that offers webServer and settings on scoped injects, like dsh's web profile. */
function house() {
  const routes: Record<string, RouteHandler> = {};
  const namespaces: Namespace[] = [];
  const injected: string[][] = [];
  const ctx = {
    tools: { register: () => {} },
    web: { registerSearchProvider: () => {} },
    inject: (deps: string[], run: (scope: unknown) => void) => {
      injected.push(deps);
      if (deps.includes('webServer')) {
        run({
          webServer: {
            register: (route: { name: string; handler: RouteHandler }) => {
              routes[route.name] = route.handler;
            },
          },
        });
      }
      if (deps.includes('settings')) {
        run({
          settings: {
            register: (ns: string, schema: Namespace['schema'], options: unknown) => {
              namespaces.push({ ns, schema, options });
              return { get: () => ({}), watch: () => () => {} };
            },
          },
        });
      }
    },
  };
  return { routes, namespaces, injected, ctx };
}

async function callRoute(
  handler: RouteHandler,
  req: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  let status = 0;
  let body = '';
  await handler(
    { headers: { host: '127.0.0.1:3080' }, ...req },
    {
      writeHead: (code: number) => {
        status = code;
        return { end: () => {} };
      },
      end: (chunk: string) => {
        body = chunk ?? '';
      },
    },
  );
  return { status, body: body === '' ? {} : JSON.parse(body) };
}

/** A POST request whose body is this JSON payload. */
function postOf(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    method: 'POST',
    url: '/modsearch/config',
    [Symbol.asyncIterator]: async function* () {
      yield Buffer.from(JSON.stringify(payload));
    },
  };
}

/** Run against a temporary HOME holding this config file. */
async function withConfig(
  contents: unknown,
  run: (handler: RouteHandler, file: string, stage: ReturnType<typeof house>) => Promise<void>,
  pluginConfig: Record<string, unknown> = {},
): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-home-'));
  const file = path.join(home, '.modsearch', 'config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  try {
    // @ts-expect-error untyped on purpose
    const plugin = (await import('../dsh/index.js')) as {
      apply: (ctx: unknown, config?: Record<string, unknown>) => void;
    };
    const stage = house();
    plugin.apply(stage.ctx as never, pluginConfig);
    await run(stage.routes['modsearch-config'], file, stage);
  } finally {
    process.env.HOME = realHome.HOME;
    process.env.USERPROFILE = realHome.USERPROFILE;
    fs.rmSync(home, { recursive: true, force: true });
  }
}

describe('dsh settings card route', () => {
  // The card is the browser half; this covers the host half it talks to,
  // where the API keys live. Every assertion here is about a key not leaving,
  // not being lost, and no other setting moving underneath the save.
  it('never puts an API key on the wire, only whether one is stored', async () => {
    await withConfig(
      {
        engine: 'tavily',
        engines: {
          tavily: { apiKey: 'tvly-secret', baseURL: 'https://gw.example' },
          exa: { model: 'unused' },
        },
      },
      async (handler) => {
        const { status, body } = await callRoute(handler, {
          method: 'GET',
          url: '/modsearch/config',
        });
        expect(status).toBe(200);
        expect(JSON.stringify(body)).not.toContain('tvly-secret');
        expect(body.engine).toBe('tavily');
        const engines = body.engines as Record<
          string,
          { hasKey: boolean; keySource: string | null; baseURL: string }
        >;
        expect(engines.tavily.hasKey).toBe(true);
        expect(engines.tavily.keySource).toBe('file');
        expect(engines.tavily.baseURL).toBe('https://gw.example');
        expect(engines.exa.hasKey).toBe(false);
        expect(engines.exa.keySource).toBe(null);
      },
    );
  });

  it('keeps the stored key when the card submits the blank field it was shown', async () => {
    await withConfig(
      { engine: '', engines: { tavily: { apiKey: 'tvly-secret' } } },
      async (handler, file) => {
        const { status } = await callRoute(
          handler,
          postOf({ target: 'tavily', apiKey: '', baseURL: 'https://gw2.example' }),
        );
        expect(status).toBe(200);
        const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
        expect(saved.engines.tavily.apiKey).toBe('tvly-secret');
        expect(saved.engines.tavily.baseURL).toBe('https://gw2.example');
      },
    );
  });

  it('leaves every setting the card does not own exactly as it was', async () => {
    // bin, allowPrivateNetwork, cooldown and keylessFetch are CLI-only on
    // purpose. A card save must be unable to touch them, including the ones
    // sitting on the very engine being edited.
    const before = {
      engine: 'tavily',
      cooldown: 'off',
      allowPrivateNetwork: true,
      engines: {
        tavily: { apiKey: 'tvly-secret', bin: '/opt/tavily' },
        'antigravity-cli': { bin: '/opt/agy' },
        firecrawl: { keylessFetch: false },
      },
    };
    await withConfig(before, async (handler, file) => {
      const { status } = await callRoute(
        handler,
        postOf({
          engine: 'exa',
          target: 'tavily',
          apiKey: '',
          baseURL: 'https://gw.example',
          bin: '/tmp/evil',
          allowPrivateNetwork: true,
          cooldown: 'off',
          keylessFetch: true,
        }),
      );
      expect(status).toBe(200);
      const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
      expect(saved.cooldown).toBe('off');
      expect(saved.allowPrivateNetwork).toBe(true);
      expect(saved.engines['antigravity-cli']).toEqual({ bin: '/opt/agy' });
      expect(saved.engines.firecrawl).toEqual({ keylessFetch: false });
      expect(saved.engines.tavily).toEqual({
        apiKey: 'tvly-secret',
        bin: '/opt/tavily',
        baseURL: 'https://gw.example',
      });
      // Only the two things the card owns moved.
      expect(saved.engine).toBe('exa');
    });
  });

  it('keeps an unknown top-level key rather than migrating the file underneath a save', async () => {
    await withConfig(
      { engine: '', proxy: 'http://127.0.0.1:7890', engines: { agy: { bin: '/opt/agy' } } },
      async (handler, file) => {
        await callRoute(handler, postOf({ target: 'antigravity-cli', model: 'gemini-3-pro' }));
        const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
        expect(saved.proxy).toBe('http://127.0.0.1:7890');
        // The alias entry already holds this engine's settings, so the model
        // lands there instead of in a second entry the CLI would never read.
        expect(saved.engines.agy).toEqual({ bin: '/opt/agy', model: 'gemini-3-pro' });
        expect(saved.engines['antigravity-cli']).toBeUndefined();
      },
    );
  });

  it('writes only the engine it was given, never the one before it', async () => {
    await withConfig(
      {
        engine: 'tavily',
        engines: {
          tavily: { apiKey: 'tvly-a', baseURL: 'https://a.example' },
          exa: { apiKey: 'exa-b' },
        },
      },
      async (handler, file) => {
        await callRoute(handler, postOf({ engine: 'exa', target: 'exa', apiKey: 'exa-c' }));
        const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
        expect(saved.engine).toBe('exa');
        expect(saved.engines.exa).toEqual({ apiKey: 'exa-c' });
        expect(saved.engines.tavily).toEqual({
          apiKey: 'tvly-a',
          baseURL: 'https://a.example',
        });
      },
    );
  });

  it('refuses a base URL that is not http(s), the same rule the CLI applies', async () => {
    await withConfig({ engine: '', engines: {} }, async (handler, file) => {
      const before = fs.readFileSync(file, 'utf-8');
      const { status, body } = await callRoute(
        handler,
        postOf({ target: 'tavily', baseURL: 'javascript:alert(1)' }),
      );
      expect(status).toBe(400);
      expect(String(body.error)).toContain('http');
      expect(fs.readFileSync(file, 'utf-8')).toBe(before);
    });
  });

  it('refuses a key for an engine that has nowhere to put one', async () => {
    await withConfig({ engine: '', engines: {} }, async (handler, file) => {
      const before = fs.readFileSync(file, 'utf-8');
      const { status, body } = await callRoute(
        handler,
        postOf({ target: 'grok-cli', apiKey: 'xai-secret' }),
      );
      expect(status).toBe(400);
      expect(String(body.error)).toContain('grok-cli');
      expect(fs.readFileSync(file, 'utf-8')).toBe(before);
    });
  });

  it('refuses an engine name it does not know', async () => {
    await withConfig({ engine: '' }, async (handler) => {
      expect((await callRoute(handler, postOf({ engine: 'nope' }))).status).toBe(400);
      expect((await callRoute(handler, postOf({ target: 'nope' }))).status).toBe(400);
    });
  });

  it('refuses a cross-origin write, which could repoint an engine at another host', async () => {
    await withConfig({ engine: 'tavily' }, async (handler, file) => {
      const before = fs.readFileSync(file, 'utf-8');
      const { status } = await callRoute(handler, {
        ...postOf({ engine: 'exa' }),
        headers: { host: '127.0.0.1:3080', origin: 'https://evil.example' },
      });
      expect(status).toBe(403);
      expect(fs.readFileSync(file, 'utf-8')).toBe(before);
    });
  });

  it('refuses a Host that is not loopback, which is what rebinding forges', async () => {
    await withConfig({ engine: 'tavily' }, async (handler) => {
      const { status } = await callRoute(handler, {
        method: 'GET',
        url: '/modsearch/config',
        headers: { host: 'evil.example' },
      });
      expect(status).toBe(403);
    });
  });

  it('refuses a cross-site fetch even when the headers otherwise look local', async () => {
    await withConfig({ engine: 'tavily' }, async (handler) => {
      const { status } = await callRoute(handler, {
        method: 'GET',
        url: '/modsearch/config',
        headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' },
      });
      expect(status).toBe(403);
    });
  });

  it('reports a broken config instead of treating it as empty', async () => {
    await withConfig('{ this is not json', async (handler, file) => {
      const read = await callRoute(handler, { method: 'GET', url: '/modsearch/config' });
      expect(read.status).toBe(409);
      expect(String(read.body.error)).toContain('JSON');
      const write = await callRoute(handler, postOf({ target: 'tavily', apiKey: 'x' }));
      expect(write.status).toBe(400);
      expect(fs.readFileSync(file, 'utf-8')).toBe('{ this is not json');
    });
  });

  it('refuses to write through a symlinked config file', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-home-'));
    created.push(home);
    const real = path.join(home, 'real.json');
    const file = path.join(home, '.modsearch', 'config.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(real, JSON.stringify({ engine: 'tavily' }));
    fs.symlinkSync(real, file);
    const realHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    try {
      // @ts-expect-error untyped on purpose
      const plugin = (await import('../dsh/index.js')) as {
        apply: (ctx: unknown, config?: Record<string, unknown>) => void;
      };
      const stage = house();
      plugin.apply(stage.ctx as never, {});
      const { status, body } = await callRoute(
        stage.routes['modsearch-config'],
        postOf({ target: 'tavily', apiKey: 'tvly-x' }),
      );
      expect(status).toBe(400);
      expect(String(body.error)).toContain('symlink');
      expect(JSON.parse(fs.readFileSync(real, 'utf-8'))).toEqual({ engine: 'tavily' });
    } finally {
      process.env.HOME = realHome.HOME;
      process.env.USERPROFILE = realHome.USERPROFILE;
    }
  });

  it('writes with the same 0600 mode the CLI uses', async () => {
    await withConfig({ engine: '' }, async (handler, file) => {
      fs.chmodSync(file, 0o644);
      await callRoute(handler, postOf({ target: 'tavily', apiKey: 'tvly-x' }));
      if (process.platform !== 'win32') {
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }
    });
  });

  it('reads an environment key as present without ever echoing it', async () => {
    process.env.TAVILY_API_KEY = 'tvly-from-env';
    try {
      await withConfig({ engine: '', engines: {} }, async (handler) => {
        const { body } = await callRoute(handler, { method: 'GET', url: '/modsearch/config' });
        expect(JSON.stringify(body)).not.toContain('tvly-from-env');
        const engines = body.engines as Record<string, { hasKey: boolean; keySource: string }>;
        expect(engines.tavily.hasKey).toBe(true);
        expect(engines.tavily.keySource).toBe('env');
      });
    } finally {
      delete process.env.TAVILY_API_KEY;
    }
  });

  it('reports engine readiness from doctor, and says nothing rather than guessing', async () => {
    fakeCli(`
      if (process.argv[2] !== 'doctor' || process.argv[3] !== '--json') {
        process.exit(9);
      }
      console.log(JSON.stringify({
        roles: [
          {
            role: 'search',
            candidates: [
              { engine: 'firecrawl', ready: true, reason: 'keyless', keySource: null },
              { engine: 'tavily', ready: false, reason: 'no API key', keySource: null },
            ],
          },
          {
            role: 'social',
            candidates: [{ engine: 'grok-cli', ready: false, reason: 'binary not found' }],
          },
        ],
      }));
    `);
    await withConfig({ engine: '' }, async (handler) => {
      const { body } = await callRoute(handler, {
        method: 'GET',
        url: '/modsearch/config?doctor=1',
      });
      const readiness = body.readiness as Array<Record<string, unknown>>;
      expect(readiness).toContainEqual(
        expect.objectContaining({ engine: 'firecrawl', ready: true }),
      );
      expect(readiness).toContainEqual(
        expect.objectContaining({ engine: 'tavily', ready: false, keySource: null }),
      );
      expect(readiness).toContainEqual(
        expect.objectContaining({ engine: 'grok-cli', ready: false }),
      );
    });

    fakeCli(`process.stderr.write('doctor exploded'); process.exit(1)`);
    await withConfig({ engine: '' }, async (handler) => {
      const { status, body } = await callRoute(handler, {
        method: 'GET',
        url: '/modsearch/config?doctor=1',
      });
      // A failed probe must not fail the card: the readiness section simply
      // has nothing to show.
      expect(status).toBe(200);
      expect(body.readiness).toBe(null);
    });
  });

  it('serves the settings namespace the card is keyed by', async () => {
    await withConfig({ engine: '' }, async (_handler, _file, stage) => {
      expect(stage.namespaces).toHaveLength(1);
      expect(stage.namespaces[0].ns).toBe('modsearch');
      const schema = stage.namespaces[0].schema;
      expect(schema(undefined)).toEqual({});
      expect(schema({ kept: 1 })).toEqual({ kept: 1 });
      expect(schema.toJSON()).toEqual({
        uid: 0,
        refs: { 0: { type: 'object', meta: { default: {} }, dict: {} } },
      });
      expect(stage.injected).toContainEqual(['webServer']);
      expect(stage.injected).toContainEqual(['settings']);
    });
  });

  it('registers neither the route nor the namespace when the card is switched off', async () => {
    await withConfig(
      { engine: '' },
      async (handler, _file, stage) => {
        // No route means dsh answers 404, which is how the browser half knows
        // to stand down instead of rendering a broken card.
        expect(handler).toBeUndefined();
        expect(stage.namespaces).toEqual([]);
      },
      { settingsCard: false },
    );
  });
});

describe('dsh plugin config switches', () => {
  it('registers nothing when every surface is switched off', async () => {
    const { tools, providers } = await load({
      searchProvider: false,
      xSearch: false,
      readPage: false,
    });
    expect(tools.size).toBe(0);
    expect(providers).toHaveLength(0);
  });

  it('stays a tools-only plugin when the web seam surface moved', async () => {
    // @ts-expect-error untyped on purpose
    const plugin = (await import('../dsh/index.js')) as {
      apply: (ctx: unknown, config?: Record<string, unknown>) => void;
    };
    const tools = new Map<string, RegisteredTool>();
    plugin.apply(
      {
        tools: {
          register: (definition: RegisteredTool) => {
            tools.set(definition.name, definition);
          },
        },
        web: {},
      } as never,
      {},
    );
    expect([...tools.keys()].sort()).toEqual(['read_page', 'x_search']);
  });

  it('keeps search, x_search and read_page on a host with no scoped injects at all', async () => {
    // Headless profiles have neither webServer nor settings, and older hosts
    // have no ctx.inject to hang them on. The settings card is the only thing
    // that may go missing there.
    const { tools, providers } = await load();
    expect([...tools.keys()].sort()).toEqual(['read_page', 'x_search']);
    expect(providers).toHaveLength(1);
  });
});
