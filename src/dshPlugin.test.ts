import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('keeps every key of the base web row when repointing search (#43)', () => {
    // A patch row replaces the target row's whole config. dsh-base ships the
    // web row as `searchProvider: deepseek-official` + `fetchProvider: http`,
    // so dropping fetchProvider leaves two usable fetch backends once the host
    // also registers deepseek-fetch-api, and web_fetch fails as ambiguous.
    const patch = fs.readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf-8');
    const webRow = /^- id: web\n {2}config:\n((?: {4}\S.*\n)+)/m.exec(patch);
    expect(webRow).not.toBeNull();
    const config = Object.fromEntries(
      webRow![1]
        .trim()
        .split('\n')
        .map((line) => line.trim().split(/:\s*/)),
    );
    expect(config).toEqual({ searchProvider: 'modsearch', fetchProvider: 'http' });
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

  it('switches off project config, since the CLI runs in the dsh cwd, not the workspace', async () => {
    fakeCli(`
      if (process.env.MODSEARCH_PROJECT_CONFIG !== 'off') {
        process.stderr.write('project config was left on');
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

  it('says how to reinstall when the CLI build is missing, as after a GitHub source install', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-dsh-cli-'));
    created.push(dir);
    process.env.MODSEARCH_DSH_CLI = path.join(dir, 'dist', 'main.js');
    const { providers } = await load();
    await expect(providers[0].search({ query: 'anything' })).rejects.toThrow(
      /build is missing.*GitHub.*@liustack\/modsearch/s,
    );
  });
});

/** A fake CLI that answers with its own argv as the summary. */
function argvEchoCli(): void {
  fakeCli(`
    const entry = ${JSON.stringify(okSearchEntry)};
    entry.summary = JSON.stringify(process.argv.slice(2));
    entry.content = '';
    console.log(JSON.stringify({ results: [entry] }));
  `);
}

/** The value following a flag in an echoed argv. */
function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

describe('dsh CLI budgets', () => {
  it('passes 40s per engine and a 55s run deadline on the provider path', async () => {
    argvEchoCli();
    const { providers } = await load();
    const result = await providers[0].search({ query: 'anything' });
    const argv = JSON.parse(result.content.split('\n')[0]) as string[];
    // One engine may take 40s, the whole chain 55s. Even an engine that
    // ignores its own timeout is stopped 5s past it, which leaves a fast
    // fallback 10s, and the run ends before the host's 60s abort.
    expect(flag(argv, '--timeout')).toBe('40000');
    expect(flag(argv, '--deadline')).toBe('55000');
  });

  it('lets the plugin config move both provider budgets', async () => {
    argvEchoCli();
    const { providers } = await load({ providerTimeoutMs: 30_000, providerDeadlineMs: 50_000 });
    const result = await providers[0].search({ query: 'anything' });
    const argv = JSON.parse(result.content.split('\n')[0]) as string[];
    expect(flag(argv, '--timeout')).toBe('30000');
    expect(flag(argv, '--deadline')).toBe('50000');
  });

  it('bounds x_search and read_page by a run deadline inside their own backstop', async () => {
    argvEchoCli();
    const { tools } = await load();
    for (const [name, args] of [
      ['x_search', { query: 'anything' }],
      ['read_page', { url: 'https://a.example' }],
    ] as const) {
      const tool = toolNamed(tools, name) as RegisteredTool & { timeoutMs: number };
      const value = await tool.execute(args, {});
      const argv = JSON.parse(String(value.summary)) as string[];
      const engineTimeout = Number(flag(argv, '--timeout'));
      const deadline = Number(flag(argv, '--deadline'));
      // A slow first engine leaves time for the next, and the whole run ends
      // before the harness backstop fires its bare abort.
      expect(engineTimeout).toBeLessThan(deadline);
      expect(deadline).toBeLessThan(tool.timeoutMs);
    }
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
  // dsh exposes its own web_fetch by default (#47). Both tools take a URL, so
  // the description has to tell the model which one fits which job.
  it('tells the model when to pick read_page over web_fetch', async () => {
    const { tools } = await load();
    const { description } = toolNamed(tools, 'read_page') as unknown as { description: string };
    expect(description).toMatch(/web_fetch/);
    expect(description).toMatch(/JavaScript/);
    expect(description).toMatch(/raw/i);
  });

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

/**
 * A host that offers webServer and settings on scoped injects, like dsh's web
 * profile. Each scope collects what its `effect` calls return and runs them
 * on `unload()`, the way cordis tears down a plugin that is switched off, and
 * the route table refuses a second route on one path, as dsh's does. The
 * webServer outlives the plugin, so a later `apply` models switching it back
 * on. `settings` replaces the service: dsh before 0.1.7 served the namespace
 * registry recorded here, 0.1.7 serves Config forms with no register at all,
 * and `null` is a host that serves no settings service.
 */
function house(options: { settings?: Record<string, unknown> | null } = {}) {
  const routes: Record<string, RouteHandler> = {};
  const namespaces: Namespace[] = [];
  const injected: string[][] = [];
  const tools = new Map<string, RegisteredTool>();
  const providers: RegisteredProvider[] = [];
  let disposers: Array<() => void> = [];
  const scope = (services: Record<string, unknown>) => ({
    ...services,
    effect: (execute: () => () => void) => {
      const dispose = execute();
      disposers.push(dispose);
      return dispose;
    },
  });
  const webServer = {
    register: (route: { name: string; path: string; handler: RouteHandler }) => {
      if (Object.hasOwn(routes, route.name)) {
        throw new Error(`webserver: duplicate exact route "${route.path}"`);
      }
      routes[route.name] = route.handler;
      return () => {
        delete routes[route.name];
      };
    },
  };
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
    inject: (deps: string[], run: (scope: unknown) => void) => {
      injected.push(deps);
      if (deps.includes('webServer')) {
        run(scope({ webServer }));
      }
      if (deps.includes('settings') && options.settings !== null) {
        run(
          scope({
            settings: options.settings ?? {
              register: (ns: string, schema: Namespace['schema'], registered: unknown) => {
                namespaces.push({ ns, schema, options: registered });
                return { get: () => ({}), watch: () => () => {} };
              },
            },
          }),
        );
      }
    },
  };
  const unload = () => {
    for (const dispose of disposers.splice(0).reverse()) {
      dispose();
    }
    disposers = [];
  };
  return { routes, namespaces, injected, tools, providers, ctx, unload };
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
          exa: { model: 'unused', enabled: false },
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
          { hasKey: boolean; keySource: string | null; baseURL: string; enabled: boolean }
        >;
        expect(engines.tavily.hasKey).toBe(true);
        expect(engines.tavily.keySource).toBe('file');
        expect(engines.tavily.baseURL).toBe('https://gw.example');
        expect(engines.tavily.enabled).toBe(true);
        expect(engines.exa.hasKey).toBe(false);
        expect(engines.exa.keySource).toBe(null);
        expect(engines.exa.enabled).toBe(false);
      },
    );
  });

  it('does not report comma-only API key settings as stored keys', async () => {
    await withConfig(
      { engine: 'tavily', engines: { tavily: { apiKey: ', ,' } } },
      async (handler) => {
        const { body } = await callRoute(handler, { method: 'GET', url: '/modsearch/config' });
        const engines = body.engines as Record<
          string,
          { hasKey: boolean; keySource: string | null }
        >;
        expect(engines.tavily.hasKey).toBe(false);
        expect(engines.tavily.keySource).toBeNull();
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

  it('stores a comma-separated key list as one trimmed setting', async () => {
    await withConfig({ engine: '', engines: {} }, async (handler, file) => {
      const { status } = await callRoute(
        handler,
        postOf({ target: 'tavily', apiKey: ' first-key, second-key ' }),
      );
      expect(status).toBe(200);
      const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
      expect(saved.engines.tavily.apiKey).toBe('first-key, second-key');
    });
  });

  it('stores only disabled engine overrides and removes them when re-enabled', async () => {
    await withConfig(
      {
        engine: 'tavily',
        engines: {
          tavily: { apiKey: 'tvly-secret', enabled: false },
          exa: { apiKey: 'exa-secret' },
          local: { enabled: false },
          firecrawl: { keylessFetch: false },
        },
      },
      async (handler, file) => {
        const { status } = await callRoute(
          handler,
          postOf({ enabled: { tavily: true, exa: false, local: true } }),
        );
        expect(status).toBe(200);
        const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
        expect(saved.engine).toBe('tavily');
        expect(saved.engines.tavily).toEqual({ apiKey: 'tvly-secret' });
        expect(saved.engines.exa).toEqual({ apiKey: 'exa-secret', enabled: false });
        expect(saved.engines.local).toBeUndefined();
        expect(saved.engines.firecrawl).toEqual({ keylessFetch: false });
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

  it('leaves an engine the card never showed exactly as the file had it', async () => {
    // The card's chain lists only the search engines doctor found ready here,
    // so an engine this machine cannot run has no row, and neither has `local`,
    // which fetches pages rather than searching. Their stored `enabled: false`
    // must survive a save that was about something else: out of sight is not
    // the same as given up.
    const before = {
      engine: '',
      engines: {
        tavily: { apiKey: 'tvly-secret' },
        exa: { apiKey: 'exa-secret', enabled: false, baseURL: 'https://exa.example' },
        local: { enabled: false },
      },
    };
    await withConfig(before, async (handler, file) => {
      const { status } = await callRoute(handler, postOf({ enabled: { tavily: false } }));
      expect(status).toBe(200);
      const saved = JSON.parse(fs.readFileSync(file, 'utf-8'));
      expect(saved.engines.exa).toEqual(before.engines.exa);
      expect(saved.engines.local).toEqual(before.engines.local);
      expect(saved.engines.tavily).toEqual({ apiKey: 'tvly-secret', enabled: false });
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

  it('removes a cleared endpoint override instead of writing an official default', async () => {
    await withConfig(
      {
        engine: 'tavily',
        engines: { tavily: { apiKey: 'tvly-secret', baseURL: 'https://gw.example' } },
      },
      async (handler, file) => {
        const { status } = await callRoute(
          handler,
          postOf({ target: 'tavily', apiKey: '', baseURL: '' }),
        );
        expect(status).toBe(200);
        const savedText = fs.readFileSync(file, 'utf-8');
        const saved = JSON.parse(savedText);
        expect(saved.engines.tavily).toEqual({ apiKey: 'tvly-secret' });
        expect(savedText).not.toContain('api.tavily.com');
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

  it.each([
    { host: 'dsh.example.com', origin: 'https://dsh.example.com' },
    { host: '192.168.1.10:3080', origin: 'http://192.168.1.10:3080' },
    { host: '127.0.0.1:3080', origin: 'https://dsh.example.com' },
    { host: 'dsh.example.com' },
    {
      host: '127.0.0.1:3080',
      origin: 'https://dsh.example.com',
      'sec-fetch-site': 'cross-site',
    },
  ])('reads and saves settings without a plugin host/origin policy: %j', async (headers) => {
    await withConfig(
      { engine: 'tavily', engines: { tavily: { apiKey: 'tvly-secret' } } },
      async (handler, file) => {
        const read = await callRoute(handler, {
          method: 'GET',
          url: '/modsearch/config',
          headers,
        });
        expect(read.status).toBe(200);
        expect(read.body.engine).toBe('tavily');
        expect(JSON.stringify(read.body)).not.toContain('tvly-secret');

        const write = await callRoute(handler, {
          ...postOf({ engine: 'exa' }),
          headers,
        });
        expect(write.status).toBe(200);
        expect(write.body.engine).toBe('exa');
        expect(JSON.stringify(write.body)).not.toContain('tvly-secret');
        expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({
          engine: 'exa',
          engines: { tavily: { apiKey: 'tvly-secret' } },
        });
      },
    );
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

  it('forgets the cached doctor verdict once a save has rewritten the config', async () => {
    // The probe costs a process start, so its answer is cached for a minute.
    // That minute is exactly when a user saves the key that makes an engine
    // ready, and a stale verdict would tell the card the engine is still unset.
    fakeCli(`
      const fs = require('fs');
      const path = require('path');
      const counter = path.join(__dirname, 'calls');
      const calls = (fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf-8')) : 0) + 1;
      fs.writeFileSync(counter, String(calls));
      console.log(JSON.stringify({
        roles: [{
          role: 'search',
          candidates: [{ engine: 'tavily', ready: calls > 1, reason: 'probe ' + calls, keySource: null }],
        }],
      }));
    `);
    await withConfig({ engine: '' }, async (handler) => {
      const probe = { method: 'GET', url: '/modsearch/config?doctor=1' };
      const first = await callRoute(handler, probe);
      expect(first.body.readiness).toContainEqual(
        expect.objectContaining({ engine: 'tavily', ready: false }),
      );
      // Second read inside the window: the same answer, without paying again.
      const cached = await callRoute(handler, probe);
      expect(cached.body.readiness).toEqual(first.body.readiness);

      await callRoute(handler, postOf({ target: 'tavily', apiKey: 'tvly-new' }));
      const after = await callRoute(handler, probe);
      expect(after.body.readiness).toContainEqual(
        expect.objectContaining({ engine: 'tavily', ready: true }),
      );
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

  it('serves no namespace on dsh 0.1.7, which dropped the registry, and logs nothing', async () => {
    // 0.1.7's settings service only projects volatile Config fields, and the
    // card has been keyed by package name since 0.1.6-alpha.2. Calling the
    // removed register put a TypeError in every harness log.
    // @ts-expect-error untyped on purpose
    const plugin = (await import('../dsh/index.js')) as {
      apply: (ctx: unknown, config?: Record<string, unknown>) => void;
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const stage = house({ settings: { describe: () => [], configure: () => () => {} } });
      plugin.apply(stage.ctx as never, {});
      expect(stage.injected).toContainEqual(['settings']);
      expect(stage.routes['modsearch-config']).toBeDefined();
      expect([...stage.tools.keys()].sort()).toEqual(['read_page', 'x_search']);
      expect(stage.providers).toHaveLength(1);
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it('keeps search and both tools on a host that serves no settings service', async () => {
    // The settings service is optional: a profile may leave it out, and the
    // scoped inject then never runs. Nothing else may hang on it.
    // @ts-expect-error untyped on purpose
    const plugin = (await import('../dsh/index.js')) as {
      apply: (ctx: unknown, config?: Record<string, unknown>) => void;
    };
    const stage = house({ settings: null });
    plugin.apply(stage.ctx as never, {});
    expect(stage.injected).toContainEqual(['settings']);
    expect(stage.namespaces).toEqual([]);
    expect(stage.routes['modsearch-config']).toBeDefined();
    expect([...stage.tools.keys()].sort()).toEqual(['read_page', 'x_search']);
    expect(stage.providers).toHaveLength(1);
  });

  it('takes the route down with the plugin, so switching it back on serves it again', async () => {
    // The Plugins page switches a bundle off and on without restarting dsh.
    // A route left behind kept reading and writing the config file for a
    // plugin that was off, and made the next registration a duplicate.
    // @ts-expect-error untyped on purpose
    const plugin = (await import('../dsh/index.js')) as {
      apply: (ctx: unknown, config?: Record<string, unknown>) => void;
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const stage = house();
      plugin.apply(stage.ctx as never, {});
      expect(stage.routes['modsearch-config']).toBeDefined();
      stage.unload();
      expect(stage.routes['modsearch-config']).toBeUndefined();
      plugin.apply(stage.ctx as never, {});
      expect(stage.routes['modsearch-config']).toBeDefined();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
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
