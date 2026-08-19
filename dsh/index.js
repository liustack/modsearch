// DeepSeek Harness (dsh) plugin: routes the harness's web capability through
// the modsearch CLI that ships in this very package. dsh already owns a web
// seam (`ctx.web`) with a native `web_search` tool over pluggable providers,
// so search plugs in as a provider instead of a competing tool: the model
// keeps the stable `web_search` schema and the UI keeps its citation cards,
// while the backend becomes modsearch's keyless engine chain. The two corpora
// dsh has no seam for, X and focused page reading, are registered as tools of
// their own; like modlens's `read_image`, a registered tool schema reaches
// the model on every request, so there is no trigger gamble. The engine is
// spawned from ../dist/main.js inside this package: no PATH lookup, no npx,
// the plugin and its engine version-lock together.
//
// Loaded via the cordis.patch.yml rows (see the package.json `dsh.bundle`
// manifest): one row mounts this plugin, one repoints the `web` seam's
// `searchProvider` at it. Engines, keys, and routing keep living in
// ~/.modsearch/config.json, shared with every harness.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLI_PATH = fileURLToPath(new URL('../dist/main.js', import.meta.url));
// Kept in lockstep with src/schema.ts by a repo test; the plugin file cannot
// import the TS source and stays fully dependency-free (node builtins only).
const SEARCH_OUTPUT_SCHEMA = JSON.parse(
  readFileSync(new URL('./search-schema.json', import.meta.url), 'utf8'),
);
const FETCH_OUTPUT_SCHEMA = JSON.parse(
  readFileSync(new URL('./fetch-schema.json', import.meta.url), 'utf8'),
);

// Own tools get the CLI's full default budget plus a cooperative backstop.
const CLI_TIMEOUT_MS = 180_000;
// The provider path runs under tool-web's budget (60s for the shipped search
// route), so its CLI deadline stays just below it: the engine's own timeout
// fires first and produces a descriptive error instead of a bare abort.
const PROVIDER_TIMEOUT_MS = 55_000;

export const name = 'modsearch';
export const inject = ['tools', 'web'];

export function apply(ctx, config = {}) {
  if (config.searchProvider !== false) {
    registerSearchProvider(ctx, config);
  }
  // Registered as raw JSON-Schema tool definitions (no dsh package imports:
  // the developer-preview registry accepts these and out-of-tree resolution
  // of @deepseek-ai/dsh-tools is not yet reliable), so this plugin owns its
  // own argument validation inside execute.
  if (config.xSearch !== false) {
    registerXSearchTool(ctx);
  }
  if (config.readPage !== false) {
    registerReadPageTool(ctx);
  }
}

/**
 * The web seam's search capability, backed by the modsearch engine chain
 * (Firecrawl keyless by default with no signup, agy by sign-in, Tavily and Exa
 * by key, with cooldown-aware fallback). `available()` must stay cheap and
 * offline, and the CLI plus its
 * router always ship, so it answers true and leaves the honest verdict to
 * execution: a run with no usable engine fails with the per-engine attempt
 * list, which beats a silent false here.
 */
function registerSearchProvider(ctx, config) {
  if (typeof ctx.web?.registerSearchProvider !== 'function') {
    // A developer-preview surface move: degrade to the tools-only plugin,
    // but say so in the harness log instead of vanishing.
    console.error('[modsearch] web seam has no registerSearchProvider; search provider skipped');
    return;
  }
  const timeoutMs = config.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
  ctx.web.registerSearchProvider({
    id: 'modsearch',
    available: () => true,
    async search(request, signal) {
      const args = ['-q', request.query, '--source', 'web', '--timeout', String(timeoutMs)];
      if (typeof request.maxResults === 'number') {
        args.push('--max-results', String(request.maxResults));
      }
      const entry = await runCli(args, signal);
      const lines = [entry.summary];
      const uncertainty = Array.isArray(entry.uncertainty) ? entry.uncertainty : [];
      if (uncertainty.length > 0) {
        lines.push(`Uncertain: ${uncertainty.join('; ')}`);
      }
      return {
        content: lines.filter(Boolean).join('\n'),
        sources: toSources(entry.items),
        // The CLI already enforces --max-results; the seam re-caps regardless.
        truncated: false,
      };
    },
  });
}

/**
 * X (Twitter) search: the corpus the web seam has no notion of. Routed by the
 * CLI to Grok Build when it is installed and signed in; otherwise a web
 * engine stands in and the answer is marked degraded, so second-hand evidence
 * is explicit in the canonical value, never silent.
 */
function registerXSearchTool(ctx) {
  ctx.tools.register({
    name: 'x_search',
    description:
      'Search X (Twitter) posts through the modsearch bridge. Use for questions about posts, threads, accounts, or discussions on X: what someone posted, reactions to an event, sentiment in a community. Returns structured evidence with a summary, per-post items with URLs, and an uncertainty list. A degraded status means X itself was unreachable and a keyless web search answered second-hand. Run `npx @liustack/modsearch doctor` to inspect the resolved engines.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'What to look for on X (accounts, topics, time bounds in plain words)',
        },
        max_results: {
          type: 'number',
          description: 'Maximum number of result items (default 8)',
        },
      },
      required: ['query'],
    },
    output: {
      schema: SEARCH_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderSearchEvidence(value) }],
      // Durable projection for the native citation card; derived only from
      // the canonical value, so it replays without re-running anything.
      presentationMeta: (_args, value) => ({ sources: toSources(value.items) }),
    },
    // The CLI enforces its own deadline; this is the cooperative backstop.
    timeoutMs: CLI_TIMEOUT_MS + 20_000,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: 'x_search',
      kind: 'search',
      rawInput: args,
    }),
    presentResult: (_args, result) => {
      if (result.isError || !result.meta || !Array.isArray(result.meta.sources)) {
        return undefined;
      }
      return { card: 'web', kind: 'search', sources: result.meta.sources, truncated: false };
    },
    async execute(args, exec) {
      if (typeof args?.query !== 'string' || args.query.trim() === '') {
        throw new Error('x_search needs a non-empty string "query".');
      }
      const cliArgs = ['-q', args.query, '--source', 'x', '--timeout', String(CLI_TIMEOUT_MS)];
      if (typeof args.max_results === 'number' && args.max_results > 0) {
        cliArgs.push('--max-results', String(Math.floor(args.max_results)));
      }
      const entry = await runCli(cliArgs, exec.signal);
      // The canonical value is the evidence plus its provenance; routing
      // details (attempts, durations, engine spend) stay operational.
      return {
        status: entry.status,
        source: entry.source,
        summary: entry.summary,
        items: Array.isArray(entry.items) ? entry.items : [],
        uncertainty: Array.isArray(entry.uncertainty) ? entry.uncertainty : [],
      };
    },
  });
}

/**
 * Focused page reading: fetch one URL and return evidence, optionally shaped
 * by an answer focus. Deliberately a tool of its own rather than a web-seam
 * fetch provider: the seam's fetch contract is safe raw retrieval (real
 * status code, undigested body) and excludes reading focus by design, while
 * this is an LLM-processed read with a summary, extracted content, links,
 * an uncertainty list, and operational warnings. The CLI blocks private-network
 * targets by default, and this tool exposes no override for that.
 */
function registerReadPageTool(ctx) {
  ctx.tools.register({
    name: 'read_page',
    description:
      'Read one web page through the modsearch bridge. Use when a message references a specific http(s) URL whose content matters: docs, an article, a changelog, a thread. Returns structured evidence with a summary, the extracted content, outgoing links, uncertainty, and operational warnings such as cloud fetching. Pass "query" to focus the reading on one question. Page reading needs no engine setup. Run `npx @liustack/modsearch doctor` to inspect the resolved route.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The http(s) URL to read',
        },
        query: {
          type: 'string',
          description:
            'Optional question to focus the reading on (e.g. "what are the rate limits")',
        },
      },
      required: ['url'],
    },
    output: {
      schema: FETCH_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: renderFetchEvidence(value) }],
    },
    timeoutMs: CLI_TIMEOUT_MS + 20_000,
    isConcurrencySafe: () => true,
    presentCall: (args) => ({
      card: 'generic',
      title: 'read_page',
      kind: 'fetch',
      rawInput: args,
    }),
    async execute(args, exec) {
      if (typeof args?.url !== 'string' || !/^https?:\/\//i.test(args.url.trim())) {
        throw new Error('read_page needs an http(s) "url".');
      }
      const cliArgs = ['-u', args.url, '--timeout', String(CLI_TIMEOUT_MS)];
      if (typeof args.query === 'string' && args.query.trim() !== '') {
        cliArgs.push('-q', args.query);
      }
      const entry = await runCli(cliArgs, exec.signal);
      return {
        summary: entry.summary,
        content: typeof entry.content === 'string' ? entry.content : '',
        ...(Array.isArray(entry.links) ? { links: entry.links } : {}),
        uncertainty: Array.isArray(entry.uncertainty) ? entry.uncertainty : [],
        warnings: Array.isArray(entry.warnings) ? entry.warnings : [],
      };
    },
  });
}

/**
 * Run the CLI once and return the single source entry from its envelope.
 * Throws with the per-engine attempt trail when the run failed or the source
 * came back unavailable, so the harness error names what was actually tried.
 */
async function runCli(args, signal) {
  const cli = process.env.MODSEARCH_DSH_CLI || CLI_PATH;
  // Electron exposes the desktop executable as process.execPath. Its child
  // must enter Node mode or the CLI path and flags are handed back to the app.
  const env = process.versions.electron
    ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    : process.env;
  const { stdout, stderr, code } = await run(process.execPath, [cli, ...args], signal, env);
  if (code !== 0) {
    throw new Error(`modsearch failed (exit ${code}): ${(stderr || stdout).trim().slice(0, 500)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`modsearch produced no JSON: ${stdout.trim().slice(0, 300)}`);
  }
  const entry = Array.isArray(parsed.results) ? parsed.results[0] : undefined;
  if (!entry || typeof entry.summary !== 'string') {
    throw new Error('modsearch returned an envelope without a usable source entry');
  }
  if (entry.status === 'unavailable') {
    const attempts = (Array.isArray(entry.attempts) ? entry.attempts : [])
      .map((attempt) => `${attempt.engine}: ${attempt.error ?? 'skipped'}`)
      .join('; ');
    throw new Error(
      `modsearch could not reach the requested source${attempts ? ` (${attempts})` : ''}. ` +
        'Run `npx @liustack/modsearch doctor` in a terminal to check the engine setup.',
    );
  }
  return entry;
}

/** Map CLI result items to the seam's citeable-source shape, dropping junk. */
function toSources(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return items
    .filter((item) => item && typeof item.url === 'string' && item.url !== '')
    .map((item) => ({
      url: item.url,
      ...(typeof item.title === 'string' && item.title !== '' ? { title: item.title } : {}),
      ...(typeof item.snippet === 'string' && item.snippet !== '' ? { snippet: item.snippet } : {}),
      ...(typeof item.published_at === 'string' && item.published_at !== ''
        ? { publishedAt: item.published_at }
        : {}),
    }));
}

function renderSearchEvidence(value) {
  const lines = [];
  if (value.status === 'degraded') {
    lines.push(
      `[X was unreachable; a ${value.source} search answered second-hand. Treat as indirect evidence.]`,
    );
  }
  lines.push(value.summary);
  const items = value.items ?? [];
  if (items.length > 0) {
    lines.push('', 'Results:');
    items.forEach((item, index) => {
      const dated = item.published_at ? ` (${item.published_at})` : '';
      lines.push(`${index + 1}. ${item.title}${dated} — ${item.url}`);
      if (item.snippet) {
        lines.push(`   ${item.snippet}`);
      }
    });
  }
  const uncertainty = value.uncertainty ?? [];
  if (uncertainty.length > 0) {
    lines.push('', `Uncertain: ${uncertainty.join('; ')}`);
  }
  return lines.join('\n');
}

const RENDER_CONTENT_CAP = 20_000;
const RENDER_LINK_CAP = 20;

function renderFetchEvidence(value) {
  const lines = [value.summary];
  const content = value.content?.trim();
  if (content) {
    lines.push(
      '',
      'Content:',
      content.length > RENDER_CONTENT_CAP ? `${content.slice(0, RENDER_CONTENT_CAP)}…` : content,
    );
  }
  const links = Array.isArray(value.links) ? value.links.slice(0, RENDER_LINK_CAP) : [];
  if (links.length > 0) {
    lines.push('', 'Links:');
    for (const link of links) {
      lines.push(`- ${link.text} — ${link.url}`);
    }
  }
  const uncertainty = value.uncertainty ?? [];
  if (uncertainty.length > 0) {
    lines.push('', `Uncertain: ${uncertainty.join('; ')}`);
  }
  const warnings = value.warnings ?? [];
  if (warnings.length > 0) {
    lines.push('', `Warnings: ${warnings.join('; ')}`);
  }
  return lines.join('\n');
}

function run(command, args, signal, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], signal, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code }));
  });
}
