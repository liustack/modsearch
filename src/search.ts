import { engineSettings, loadConfigFile, type ModsearchConfig } from './config.ts';
import type { CooldownController } from './cooldown.ts';
import {
  enginesForRole,
  type EngineOutput,
  type EngineRequest,
  type RunMode,
  type SearchEngine,
  type Source,
} from './providers/index.ts';
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
  /**
   * Quota cooldown for this run: orders the chain away from spent engines and
   * records or clears their state as the run plays out. Absent means the
   * cooldown is off (the switch, or a caller that does not use it), and routing
   * is exactly as it was before cooldowns existed.
   */
  cooldown?: CooldownController;
}

/** How well this entry served the source that was requested. */
export type SourceStatus = 'ok' | 'degraded' | 'unavailable';

/** One try at one engine, in the order they were attempted. */
export interface EngineAttempt {
  engine: string;
  /** True when the engine returned a result, false when it failed or was skipped. */
  ok: boolean;
  /** Present only when `ok` is false: the failure message. */
  error?: string;
  /** How long this attempt took, or null when nothing ran. */
  durationSeconds: number | null;
}

/** One source's answer. Engine result fields are flattened in beside them. */
export interface SourceResult {
  /** The corpus this entry actually came from. May differ from requestedSource. */
  source: Source;
  /** The corpus that was asked for. Equals `source` unless the run degraded. */
  requestedSource: Source;
  /** Which engine answered, or null when the source was unreachable. */
  engine: string | null;
  model?: string;
  /**
   * `ok`: served the requested source. `degraded`: a stand-in corpus answered
   * (e.g. the web answering an X request, so it is second-hand). `unavailable`:
   * nothing could serve the source, and `items` is empty.
   */
  status: SourceStatus;
  /**
   * Routing and runtime warnings for this source: an engine that failed and was
   * replaced, a degrade to a stand-in corpus, a config typo, the http engine's
   * "no synthesis" and "private network allowed" notices. These are about how
   * the answer was produced, not about the facts in it.
   */
  warnings: string[];
  /** Every engine tried for this source, in order, with per-try outcome. */
  attempts: EngineAttempt[];
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

/**
 * A source ran out of engines. Carries the per-engine attempts so a multi-source
 * run can surface them in the source's `attempts` instead of losing them to the
 * throw. Its message is unchanged from the old plain Error, so the single-source
 * path (which lets this reach the CLI) prints exactly what it always did.
 */
class SourceRunError extends Error {
  constructor(
    message: string,
    readonly attempts: EngineAttempt[],
  ) {
    super(message);
    this.name = 'SourceRunError';
  }
}

/** Turn a source that exhausted its engines into an explicit unavailable entry. */
function failedSourceEntry(plan: SourcePlan, error: unknown): SourceResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    source: plan.source,
    requestedSource: plan.source,
    engine: null,
    status: 'unavailable',
    summary: '',
    items: [],
    uncertainty: [],
    warnings: [message],
    attempts: error instanceof SourceRunError ? error.attempts : [],
    durationSeconds: null,
  };
}

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
    requestedSources: options.sources === undefined ? undefined : parseSources(options.sources),
    env,
    cooldown: options.cooldown
      ? { state: options.cooldown.state, now: options.cooldown.now }
      : undefined,
  });

  const context = { mode, query, url, timeoutMs, config, env, options };

  // Run every source's plan concurrently and reassemble in request order, so a
  // web,x run costs about the time of its slowest source, not their sum.
  // Promise.all preserves index order regardless of which settled first.
  const results = await Promise.all(
    plans.map((plan) =>
      runOneSource(plan, context).catch((error): SourceResult => {
        // A single-source run keeps its exact prior behavior: the failure
        // propagates and the CLI exits. With more than one source, one source
        // failing must not sink the others, so it becomes an explicit
        // unavailable entry, matching the router's own unavailable semantics.
        if (plans.length === 1) {
          throw error;
        }
        return failedSourceEntry(plan, error);
      }),
    ),
  );

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

  // The source was asked for but nothing can serve it. Return an explicit
  // empty entry rather than dropping the slot, so a consumer sees it was
  // requested and came back empty on purpose.
  if (plan.unavailable) {
    return {
      source: plan.source,
      requestedSource: plan.source,
      engine: null,
      status: 'unavailable',
      summary: '',
      items: [],
      // The router's notes (e.g. the X-degrade caveat) are about routing, not
      // facts, so they belong in warnings. Nothing ran, so no attempts.
      uncertainty: [],
      warnings: plan.notes,
      attempts: [],
      durationSeconds: null,
    };
  }

  const candidates = [plan.engine, ...plan.fallbacks].filter(Boolean) as SearchEngine[];

  if (candidates.length === 0) {
    const base = noEngineMessage(SOURCE_ROLE[plan.source] === 'social' ? 'social' : mode);
    // A typo in --engine is the actual problem: do not bury it under generic
    // setup advice.
    throw new SourceRunError(plan.notes.length > 0 ? `${plan.notes.join(' ')}\n${base}` : base, []);
  }

  const controller = options.cooldown;
  const failures: string[] = [];
  const attempts: EngineAttempt[] = [];
  // Notes about engines that hit a quota wall this run, surfaced on the entry
  // that finally answers so the reader sees who is now cooling and until when.
  const cooldownNotes: string[] = [];
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
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${engine.name}: ${message}`);
      attempts.push({
        engine: engine.name,
        ok: false,
        error: message,
        durationSeconds: (Date.now() - startedAt) / 1000,
      });
      // A quota-class failure is remembered so a later run fails over first. A
      // transient failure (rate limit, timeout) records nothing.
      if (controller) {
        const entry = controller.record(engine.name, error);
        if (entry) {
          cooldownNotes.push(
            `The ${engine.name} engine hit its quota and is now cooling until ${entry.until}.`,
          );
        }
      }
      continue;
    }

    const durationSeconds = (Date.now() - startedAt) / 1000;
    attempts.push({ engine: engine.name, ok: true, durationSeconds });
    // This engine answered, so clear any cooldown it was carrying from before.
    controller?.clear(engine.name);

    // Routing and runtime warnings, kept apart from the engine's epistemic
    // uncertainty. Config typos and degrade caveats travel on the plan.
    const warnings = [...plan.notes, ...cooldownNotes];
    if (failures.length > 0) {
      warnings.push(`Fell back to ${engine.name} after: ${failures.join(' | ')}`);
      // A web engine answering an X request is second-hand evidence whether the
      // X engine was missing or died mid-run.
      if (plan.degradeNote && !engine.roles.includes('social')) {
        warnings.push(plan.degradeNote);
      }
    }

    // The corpus this answer really came from. An X plan served by a web engine
    // (Grok missing or dead) is second-hand web data: label it `web` with
    // `status: "degraded"` so nobody reads it as X coverage. A social engine
    // answering an X plan is the real thing.
    const requestedSource = plan.source;
    let actualSource: Source = plan.source;
    let status: SourceStatus = 'ok';
    if (plan.source === 'x' && !engine.roles.includes('social')) {
      actualSource = 'web';
      status = 'degraded';
    }

    const body =
      output.result && typeof output.result === 'object'
        ? ({ ...output.result } as Record<string, unknown>)
        : ({ result: output.result } as Record<string, unknown>);

    // The http engine hands its own runtime notices back as `warnings`; merge
    // those in after the routing ones. Other engines emit no warnings key.
    const engineWarnings = Array.isArray(body.warnings)
      ? (body.warnings as unknown[]).filter((line): line is string => typeof line === 'string')
      : [];

    // Routing facts and the warnings/attempts channels are stamped by modsearch,
    // never by the engine: strip any key the engine returned with these names so
    // it cannot rewrite who answered or forge a routing warning.
    delete body.source;
    delete body.requestedSource;
    delete body.engine;
    delete body.model;
    delete body.status;
    delete body.durationSeconds;
    delete body.warnings;
    delete body.attempts;

    return {
      ...body,
      source: actualSource,
      requestedSource,
      engine: engine.name,
      model,
      status,
      warnings: [...warnings, ...engineWarnings],
      attempts,
      durationSeconds,
    };
  }

  throw new SourceRunError(
    `Every engine for the ${plan.source} source failed.\n${failures.map((line) => `  - ${line}`).join('\n')}`,
    attempts,
  );
}

async function callEngine(
  engine: SearchEngine,
  request: EngineRequest,
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

/**
 * Nothing on this machine can do this job. Say what would fix it, one line per
 * engine, instead of naming a single dependency as if it were mandatory.
 */
export function noEngineMessage(role: 'search' | 'fetch' | 'social'): string {
  const options = enginesForRole(role)
    .map((engine) => `  - ${engine.name}: ${engine.requirement}`)
    .join('\n');
  const job = role === 'fetch' ? 'fetch a page' : role === 'social' ? 'search X' : 'search the web';
  return `No engine on this machine can ${job}. Any one of these enables it:\n${options}`;
}
