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
      dsh?: { bundle?: { patch?: string } };
      exports?: Record<string, string>;
      files?: string[];
    };
    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml');
    expect(pkg.exports?.['.']).toBe('./dsh/index.js');
    expect(pkg.exports?.['./dsh']).toBe('./dsh/index.js');
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

afterEach(() => {
  delete process.env.MODSEARCH_DSH_CLI;
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
      warnings: [],
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
    });
    const [block] = tool.output.render({}, value as never);
    expect(block.text).toContain('Full extracted content.');
    expect(block.text).toContain('- docs — https://a.example/docs');
  });

  it('rejects a non-http url before spawning anything', async () => {
    const { tools } = await load();
    const tool = toolNamed(tools, 'read_page');
    await expect(tool.execute({ url: 'file:///etc/passwd' }, {})).rejects.toThrow(/http\(s\)/);
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
});
