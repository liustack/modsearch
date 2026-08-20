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
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
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
  // The settings card. dsh web users have no terminal, so `modsearch config
  // set` is out of reach there and an engine key had no way in. The card the
  // browser half (dsh/client.js) contributes talks to the loopback route
  // below rather than to a settings schema, because the values live in
  // ~/.modsearch/config.json, shared with the CLI and every other harness.
  //
  // webServer exists only under the web profile, and this cordis has no
  // optional-inject form, so both halves ride scoped ctx.inject calls: the
  // closure runs where the service exists and never runs where it does not.
  // A headless profile keeps the plugin's tools and search provider untouched.
  if (config.settingsCard !== false && typeof ctx.inject === 'function') {
    ctx.inject(['webServer'], (scope) => {
      try {
        registerConfigRoute(scope);
      } catch (error) {
        console.error(`[modsearch] settings card route skipped: ${error}`);
      }
    });
    // Since rc.7 the settings page dispatches plugin cards by served settings
    // namespace: a card renders only when its slot key matches a namespace the
    // host answers for. The namespace registered here is an empty
    // pass-through, because its whole job is to make the card dispatchable;
    // the values stay in the config file behind the route above. The schema is
    // duck-typed to what the seam calls on it, callable plus toJSON, so this
    // plugin needs no dsh package import to describe nothing.
    ctx.inject(['settings'], (scope) => {
      try {
        const passThrough = (value) => ({ ...(value ?? {}) });
        passThrough.toJSON = () => ({
          uid: 0,
          refs: { 0: { type: 'object', meta: { default: {} }, dict: {} } },
        });
        scope.settings.register('modsearch', passThrough, { base: {} });
      } catch (error) {
        console.error(`[modsearch] settings namespace skipped: ${error}`);
      }
    });
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
/**
 * The environment a spawned CLI needs. Electron exposes the desktop
 * executable as process.execPath, and its child must enter Node mode or the
 * CLI path and flags are handed back to the app.
 */
function childEnv() {
  return process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env;
}

async function runCli(args, signal) {
  const cli = process.env.MODSEARCH_DSH_CLI || CLI_PATH;
  const { stdout, stderr, code } = await run(process.execPath, [cli, ...args], signal, childEnv());
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

// ---------------------------------------------------------------------------
// Settings card, host half: it reads and writes ~/.modsearch/config.json, the
// same file the CLI edits, so a key set in the browser is the key every other
// harness uses. The browser never receives a key, only whether one is stored.
// ---------------------------------------------------------------------------

/** The engines the card offers, in the order the docs introduce them. */
const CARD_ENGINES = ['antigravity-cli', 'tavily', 'exa', 'firecrawl', 'grok-cli', 'local'];
/** The HTTP engines: the only ones with a key and an endpoint to configure. */
const KEYED_ENGINES = ['tavily', 'exa', 'firecrawl'];
/**
 * Engines whose `model` setting a run actually reads. The others are shown
 * without the field rather than with one nothing is behind: tavily, exa and
 * firecrawl ignore it, and grok-cli follows whatever Grok Build is signed in
 * with.
 */
const MODEL_ENGINES = ['antigravity-cli'];
/**
 * Every accepted spelling, mirroring CANONICAL_ENGINE in src/config.ts.
 * Settings saved under an alias are the same engine's settings, so the card
 * has to read and write them where they already are.
 */
const ENGINE_ALIASES = {
  antigravity: 'antigravity-cli',
  agy: 'antigravity-cli',
  grok: 'grok-cli',
  http: 'local',
  direct: 'local',
};
/**
 * The variables that override the file per field, mirroring ENV_BINDINGS in
 * src/config.ts. A card that read only the file would show an empty form for
 * a container that exports its key, and call a working engine unconfigured.
 */
const ENGINE_ENV_BINDINGS = {
  tavily: { apiKey: 'TAVILY_API_KEY', baseURL: 'TAVILY_BASE_URL' },
  exa: { apiKey: 'EXA_API_KEY', baseURL: 'EXA_BASE_URL' },
  firecrawl: { apiKey: 'FIRECRAWL_API_KEY', baseURL: 'FIRECRAWL_BASE_URL' },
};

/** The canonical engine a stored name means, or '' when it names none. */
function canonicalEngine(name) {
  if (typeof name !== 'string') {
    return '';
  }
  const trimmed = name.trim().toLowerCase();
  if (CARD_ENGINES.includes(trimmed)) {
    return trimmed;
  }
  // Own properties only: a bare index walks the prototype chain, so
  // "constructor" would come back as a function and read as an engine.
  return Object.hasOwn(ENGINE_ALIASES, trimmed) ? ENGINE_ALIASES[trimmed] : '';
}

/** JSON objects only: null, arrays and prototype residents are not settings. */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** ~/.modsearch/config.json, the one file every harness shares. */
function modsearchConfigPath() {
  return join(homedir(), '.modsearch', 'config.json');
}

/**
 * The shared config, verbatim. Only a missing file reads as empty: a file
 * that exists but cannot be parsed is somebody's configuration, and a card
 * that treated it as empty would overwrite it on the next save.
 *
 * Deliberately not the CLI's loadConfigFile: that one migrates legacy shapes
 * on the way in, and a save is not the moment to rewrite a file the user did
 * not ask about. What the card does not own, it does not touch.
 */
function readModsearchConfig() {
  const file = modsearchConfigPath();
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw new Error(`cannot read ${file}: ${error?.message ?? error}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error?.message ?? error}`);
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${file} does not hold a JSON object`);
  }
  return parsed;
}

/** The file entry keys holding one engine's settings: its own, plus aliases. */
function fileKeysFor(engine, config) {
  const engines = isPlainObject(config.engines) ? config.engines : {};
  return Object.keys(engines).filter((key) => canonicalEngine(key) === engine);
}

/**
 * One engine's file settings, alias entries merged the way the CLI merges
 * them: in file order, so a later entry wins, exactly as migrateLegacyConfig
 * folds them.
 */
function fileSettingsFor(engine, config) {
  const engines = isPlainObject(config.engines) ? config.engines : {};
  let settings = {};
  for (const key of fileKeysFor(engine, config)) {
    if (isPlainObject(engines[key])) {
      settings = { ...settings, ...engines[key] };
    }
  }
  return settings;
}

/** One engine's environment settings, per field, as engineSettings applies them. */
function envSettingsFor(engine, env = process.env) {
  const settings = {};
  const bindings = Object.hasOwn(ENGINE_ENV_BINDINGS, engine) ? ENGINE_ENV_BINDINGS[engine] : {};
  for (const [field, variable] of Object.entries(bindings)) {
    const value = typeof env[variable] === 'string' ? env[variable].trim() : '';
    if (value !== '') {
      settings[field] = value;
    }
  }
  return settings;
}

/**
 * What the card is allowed to know: every engine's endpoint and model, plus
 * whether a key is stored and where it came from, and never the key itself. A
 * browser that cannot read a secret cannot leak one, and cannot write a blank
 * one back over it either.
 */
function engineSummary(config = readModsearchConfig(), env = process.env) {
  const engines = {};
  for (const name of CARD_ENGINES) {
    const fromFile = fileSettingsFor(name, config);
    const fromEnv = envSettingsFor(name, env);
    const fileKey = typeof fromFile.apiKey === 'string' && fromFile.apiKey.trim() !== '';
    const envKey = typeof fromEnv.apiKey === 'string';
    engines[name] = {
      baseURL: fromEnv.baseURL ?? (typeof fromFile.baseURL === 'string' ? fromFile.baseURL : ''),
      model: typeof fromFile.model === 'string' ? fromFile.model : '',
      hasKey: envKey || fileKey,
      // An environment key wins over a file key at run time, so a card that
      // reported the file's would explain the wrong thing when a save appears
      // to change nothing.
      keySource: envKey ? 'env' : fileKey ? 'file' : null,
    };
  }
  return {
    // Three states kept apart: pinned to an engine, pinned by one of its
    // aliases (reported canonically), or not pinned at all, which means the
    // chain picks by availability.
    engine: canonicalEngine(config.engine),
    engines,
    keyed: KEYED_ENGINES,
    models: MODEL_ENGINES,
  };
}

/**
 * Apply one card submission to the shared file. Only the two things the card
 * owns can move: the engine pin, and the named engine's own key, endpoint and
 * model. `bin`, `allowPrivateNetwork`, `cooldown` and `keylessFetch` stay CLI
 * only, and every other key in the file is copied through untouched.
 *
 * An absent or empty `apiKey` leaves the stored one alone: the card never
 * receives a key, so it must never be able to clear one by submitting the
 * blank field it was shown.
 */
function applyCardSettings(patch) {
  const config = readModsearchConfig();
  if (patch?.engine !== undefined) {
    const pin = typeof patch.engine === 'string' ? patch.engine.trim() : '';
    if (pin === '') {
      // Empty is the CLI's own spelling of automatic, not a missing value.
      config.engine = '';
    } else {
      const engine = canonicalEngine(pin);
      if (!CARD_ENGINES.includes(engine)) {
        throw new Error(`unknown engine: ${patch.engine}`);
      }
      config.engine = engine;
    }
  }
  // Engine fields are edited one engine at a time, named by `target`. Absent
  // means this save touched no engine settings, which is what a pin-only save
  // looks like.
  if (patch?.target !== undefined) {
    const engine = canonicalEngine(patch.target);
    if (!CARD_ENGINES.includes(engine)) {
      throw new Error(`unknown engine: ${patch.target}`);
    }
    if (
      !KEYED_ENGINES.includes(engine) &&
      (patch.apiKey !== undefined || patch.baseURL !== undefined)
    ) {
      throw new Error(`${engine} takes no API key or base URL`);
    }
    if (!MODEL_ENGINES.includes(engine) && patch.model !== undefined) {
      throw new Error(`${engine} takes no model setting`);
    }
    if (config.engines !== undefined && !isPlainObject(config.engines)) {
      throw new Error('the "engines" section of the config file is not an object');
    }
    // Write where the read takes effect: the last entry holding this engine's
    // settings is the one the merge lets win, so a key saved under an alias is
    // updated rather than shadowed by a second copy the CLI never reads.
    const holders = fileKeysFor(engine, config);
    const target = holders.length > 0 ? holders[holders.length - 1] : engine;
    config.engines = { ...config.engines };
    if (config.engines[target] !== undefined && !isPlainObject(config.engines[target])) {
      throw new Error(`the "engines.${target}" entry of the config file is not an object`);
    }
    const settings = { ...config.engines[target] };
    if (patch.baseURL !== undefined) {
      const baseURL = typeof patch.baseURL === 'string' ? patch.baseURL.trim() : '';
      if (baseURL === '') {
        // Empty unsets the override, back to the official endpoint.
        delete settings.baseURL;
      } else if (!/^https?:\/\//i.test(baseURL)) {
        // The same rule the CLI applies, and for the same reason: this host
        // receives the engine's API key.
        throw new Error(
          `invalid base URL: ${baseURL}. Use a full http(s) URL, e.g. https://api.example.com`,
        );
      } else {
        settings.baseURL = baseURL;
      }
    }
    if (patch.model !== undefined) {
      const model = typeof patch.model === 'string' ? patch.model.trim() : '';
      if (model === '') {
        delete settings.model;
      } else {
        settings.model = model;
      }
    }
    const apiKey = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : '';
    if (apiKey !== '') {
      settings.apiKey = apiKey;
    }
    config.engines[target] = settings;
  }
  writeConfigFile(config);
}

/**
 * Write the config back the way src/config.ts writes it: a fresh 0600 file in
 * the same directory, renamed into place. writeFileSync's mode only applies
 * when it CREATES the file, so rewriting an existing 0644 config would land
 * the new key world-readable until the chmod.
 */
function writeConfigFile(config) {
  const file = modsearchConfigPath();
  // A symlink here would write through to wherever it points, so it is
  // refused rather than followed: the CLI writes a real file, and anything
  // else is a setup this card should not silently honor.
  try {
    if (lstatSync(file).isSymbolicLink()) {
      throw new Error(`${file} is a symlink; edit the file it points at instead`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const tmp = join(dir, `.config.${unique}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    renameSync(tmp, file);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // the rename failure is the error worth reporting
    }
    throw error;
  }
  try {
    chmodSync(file, 0o600);
  } catch {
    // best effort on platforms without POSIX modes
  }
}

/**
 * The read-only readiness list behind the card's auto-mode section: which
 * engines are set up on this machine. `doctor --json` already answers that
 * without network or quota, so the route spawns the CLI this package ships
 * and lifts the per-engine verdicts out of its roles. Cached briefly, since
 * one probe costs a process start and re-expanding the card should not re-pay
 * it, and keyed by the CLI path so a different binary is a different answer.
 */
const READINESS_TTL_MS = 60_000;
const READINESS_TIMEOUT_MS = 20_000;
/** Search first: the card is about searching, and it is the configured role. */
const READINESS_ROLES = ['search', 'social', 'fetch'];
let readinessCache = null;

async function engineReadiness() {
  const cli = process.env.MODSEARCH_DSH_CLI || CLI_PATH;
  if (readinessCache !== null && readinessCache.cli === cli) {
    if (Date.now() - readinessCache.at < READINESS_TTL_MS) {
      return readinessCache.value;
    }
  }
  try {
    // Bounded and abortable: a probe that hung would hang the card's expand,
    // and the card can live without this section.
    const { stdout, code } = await run(
      process.execPath,
      [cli, 'doctor', '--json'],
      AbortSignal.timeout(READINESS_TIMEOUT_MS),
      childEnv(),
    );
    if (code !== 0) {
      return null;
    }
    const roles = JSON.parse(stdout)?.roles;
    if (!Array.isArray(roles)) {
      return null;
    }
    const found = new Map();
    const ordered = [...roles].sort(
      (a, b) => READINESS_ROLES.indexOf(a?.role) - READINESS_ROLES.indexOf(b?.role),
    );
    for (const role of ordered) {
      for (const candidate of Array.isArray(role?.candidates) ? role.candidates : []) {
        const engine = canonicalEngine(candidate?.engine);
        // An engine judged by its own role, once: firecrawl serves search and
        // fetch with different verdicts, and the card is about search.
        if (!CARD_ENGINES.includes(engine) || found.has(engine)) {
          continue;
        }
        found.set(engine, {
          engine,
          role: typeof role.role === 'string' ? role.role : '',
          ready: candidate.ready === true,
          reason: typeof candidate.reason === 'string' ? candidate.reason : '',
          keySource: candidate.keySource ?? null,
        });
      }
    }
    const value = CARD_ENGINES.filter((name) => found.has(name)).map((name) => found.get(name));
    readinessCache = { cli, at: Date.now(), value };
    return value;
  } catch {
    return null;
  }
}

/** localhost, ::1, or anything in 127/8, matching dsh's own /api fence. */
function isLoopbackHost(hostname) {
  if (hostname === 'localhost' || hostname === '[::1]') {
    return true;
  }
  const parts = hostname.split('.');
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

/**
 * The same fence dsh puts in front of its own /api, for the same two
 * confused-deputy paths. Host is the header DNS rebinding cannot forge, so it
 * must name a loopback authority: a rebound page reaches this socket carrying
 * its own domain there. Origin and Sec-Fetch-Site then rule out a cross-site
 * page on the machine itself. A read is refused the same way as a write,
 * though it carries no key: nothing about editing engine settings wants a
 * wider door.
 */
function isTrustedRequest(req) {
  const host = req.headers?.host;
  if (typeof host !== 'string' || host === '') {
    return false;
  }
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!isLoopbackHost(hostUrl.hostname)) {
    return false;
  }
  if (req.headers?.['sec-fetch-site'] === 'cross-site') {
    return false;
  }
  const origin = req.headers?.origin;
  if (origin === undefined) {
    return true;
  }
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

/** GET /modsearch/config: the summary above. POST: one card submission. */
function registerConfigRoute(ctx) {
  ctx.webServer.register({
    name: 'modsearch-config',
    kind: 'exact',
    path: '/modsearch/config',
    handler: async (req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (!isTrustedRequest(req)) {
        send(403, { error: 'request refused: this route answers same-origin loopback only' });
        return;
      }
      if (req.method === 'GET') {
        try {
          const summary = engineSummary();
          if (new URL(req.url, 'http://localhost').searchParams.has('doctor')) {
            // null when the probe failed: the card then shows no readiness
            // section rather than inventing one.
            summary.readiness = await engineReadiness();
          }
          send(200, summary);
        } catch (error) {
          send(409, { error: String(error?.message ?? error) });
        }
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      try {
        const chunks = [];
        let total = 0;
        for await (const chunk of req) {
          total += chunk.length;
          if (total > 64 * 1024) {
            send(413, { error: 'config payload too large' });
            req.destroy();
            return;
          }
          chunks.push(chunk);
        }
        applyCardSettings(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        send(200, engineSummary());
      } catch (error) {
        send(400, { error: String(error?.message ?? error) });
      }
    },
  });
}

// The half of the settings card that lives on this side of the socket,
// reachable from the test suite the way client.js exposes `__card`. It reads
// and writes a real file and a real environment, so it is tested against both
// rather than only through the HTTP route.
export const __config = { engineSummary, applyCardSettings, modsearchConfigPath };

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
