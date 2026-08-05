import { engineSettings, loadConfigFile, type ModsearchConfig } from './config.ts';
import { enginesForRole, type EngineOutput, type RunMode, type SearchEngine, type Source } from './providers/index.ts';
import { parseSources, planRun, SOURCE_ROLE, type SourcePlan } from './router.ts';
import { runCommand } from './subprocess.ts';

export interface RunSearchOptions {
  query?: string;
  url?: string;
  /** Engine override for this run, e.g. `tavily`. */
  engine?: string;
  /** Source list, e.g. `web,x`. Undefined decides from the query. */
  sources?: string;
  model?: string;
  prompt?: string;
  timeoutMs?: number;
  maxResults?: number;
  workdir?: string;
  /** One-off override for the http engine's private network guard. */
  allowPrivateNetwork?: boolean;
  /** Injected config, for tests. Loaded from ~/.modsearch/config.json otherwise. */
  config?: ModsearchConfig;
  env?: NodeJS.ProcessEnv;
}

/** One source's answer. Engine result fields are flattened in beside them. */
export interface SourceResult {
  source: Source;
  engine: string;
  model?: string;
  durationSeconds: number | null;
  [resultField: string]: unknown;
}

export interface RunSearchResult {
  mode: RunMode;
  query: string | null;
  url: string | null;
  /** Always an array, one entry per source, so the shape never changes. */
  results: SourceResult[];
  meta: {
    generatedAt: string;
    durationSeconds: number;
  };
}

const DEFAULT_TIMEOUT_MS = 180_000;
// Give the engine's own timeout a chance to fire first; SIGTERM is the backstop.
const KILL_GRACE_MS = 30_000;

export function resolveMode(query?: string, url?: string): RunMode {
  const hasQuery = Boolean(query?.trim());
  const hasUrl = Boolean(url?.trim());

  if (!hasQuery && !hasUrl) {
    throw new Error('Provide a search query (-q) or a URL to fetch (-u).');
  }

  return hasUrl ? 'fetch' : 'search';
}

export function validateUrl(url: string): string {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error(`Fetch URL must start with http:// or https://, got: ${trimmed}`);
  }
  return trimmed;
}

export async function runSearch(options: RunSearchOptions): Promise<RunSearchResult> {
  const startedAt = Date.now();
  const query = options.query?.trim() || undefined;
  const url = options.url?.trim() ? validateUrl(options.url) : undefined;
  const mode = resolveMode(query, url);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = options.env ?? process.env;
  const config = options.config ?? loadConfigFile();

  const plans = planRun({
    mode,
    query,
    config,
    requestedEngine: options.engine,
    requestedSources: options.sources ? parseSources(options.sources) : undefined,
    env,
  });

  const results: SourceResult[] = [];
  for (const plan of plans) {
    results.push(await runOneSource(plan, { mode, query, url, timeoutMs, config, env, options }));
  }

  return {
    mode,
    query: query ?? null,
    url: url ?? null,
    results,
    meta: {
      generatedAt: new Date().toISOString(),
      durationSeconds: (Date.now() - startedAt) / 1000,
    },
  };
}

async function runOneSource(
  plan: SourcePlan,
  context: {
    mode: RunMode;
    query?: string;
    url?: string;
    timeoutMs: number;
    config: ModsearchConfig;
    env: NodeJS.ProcessEnv;
    options: RunSearchOptions;
  },
): Promise<SourceResult> {
  const { mode, query, url, timeoutMs, config, env, options } = context;
  const candidates = [plan.engine, ...plan.fallbacks].filter(Boolean);

  if (candidates.length === 0) {
    throw new Error(noEngineMessage(SOURCE_ROLE[plan.source] === 'social' ? 'social' : mode));
  }

  const failures: string[] = [];
  for (const engine of candidates) {
    const settings = engineSettings(engine.name, config, env);
    if (options.allowPrivateNetwork) {
      settings.allowPrivateNetwork = 'true';
    }
    const model = options.model || settings.model || engine.defaultModel;
    const startedAt = Date.now();

    let output: EngineOutput;
    try {
      output = await callEngine(
        engine,
        {
          mode,
          query,
          url,
          model,
          maxResults: options.maxResults,
          extraPrompt: options.prompt,
          workdir: options.workdir,
          timeoutMs,
          settings,
        },
        timeoutMs,
      );
    } catch (error) {
      failures.push(`${engine.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const notes = [...plan.notes];
    if (failures.length > 0) {
      notes.push(`Fell back to ${engine.name} after: ${failures.join(' | ')}`);
    }

    return {
      source: plan.source,
      engine: engine.name,
      ...(model ? { model } : {}),
      ...withNotes(output.result, notes),
      durationSeconds: (Date.now() - startedAt) / 1000,
    };
  }

  throw new Error(
    `Every engine for the ${plan.source} source failed.\n${failures.map((line) => `  - ${line}`).join('\n')}`,
  );
}

async function callEngine(
  engine: SearchEngine,
  request: Parameters<NonNullable<SearchEngine['execute']>>[0],
  timeoutMs: number,
): Promise<EngineOutput> {
  if (engine.execute) {
    return engine.execute(request);
  }
  if (engine.buildInvocation && engine.parseOutput) {
    const invocation = engine.buildInvocation(request);
    const commandResult = await runCommand(
      engine.name,
      invocation,
      timeoutMs + KILL_GRACE_MS,
      engine.describeFailure,
    );
    return engine.parseOutput(commandResult.stdout);
  }
  throw new Error(`Engine ${engine.name} implements neither execute nor buildInvocation.`);
}

/** Merge routing notes into the result's uncertainty list. */
function withNotes(result: unknown, notes: string[]): Record<string, unknown> {
  const shaped = (result && typeof result === 'object' ? { ...result } : { result }) as Record<
    string,
    unknown
  >;
  if (notes.length === 0) {
    return shaped;
  }
  const existing = Array.isArray(shaped.uncertainty) ? (shaped.uncertainty as unknown[]) : [];
  shaped.uncertainty = [...notes, ...existing];
  return shaped;
}

/**
 * Nothing on this machine can do this job. Say what would fix it, one line per
 * engine, instead of naming a single dependency as if it were mandatory.
 */
export function noEngineMessage(role: 'search' | 'fetch' | 'social'): string {
  const options = enginesForRole(role)
    .map((engine) => `  - ${engine.name}: ${engine.requirement}`)
    .join('\n');
  const job =
    role === 'fetch' ? 'fetch a page' : role === 'social' ? 'search X' : 'search the web';
  return `No engine on this machine can ${job}. Any one of these enables it:\n${options}`;
}
