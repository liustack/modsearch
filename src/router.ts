import { chosenEngine, engineSettings, type ModsearchConfig, type Role } from './config.ts';
import { coolingEntry, type CooldownState } from './cooldown.ts';
import {
  FETCH_FLOOR,
  findEngine,
  listEngines,
  resolveEngine,
  ROLE_PREFERENCE,
  type RunMode,
  type SearchEngine,
  type Source,
} from './providers/index.ts';

/** One run's cooldown snapshot: which engines are cooling, judged against `now`. */
export interface CooldownView {
  state: CooldownState;
  now: Date;
}

// Every decision about which sources run and which engine serves each one
// lives here. Nothing else in the codebase picks an engine.

/** Conservative on purpose: a miss costs a normal web search, a false hit wastes a grok run. */
const X_QUERY_PATTERNS: RegExp[] = [
  /twitter/i,
  /\btweets?\b/i,
  /\btweeted\b/i,
  /\bx\.com\b/i,
  /\bon\s+x\b/i,
  /\bx\s+(?:post|posts|thread|threads|user|users|search|reply|replies|timeline)\b/i,
  /推特/,
  /推文/,
  /发推/,
  /在\s*[Xx]\s*上/,
  /[Xx]\s*(?:平台|帖子)/,
];

export function isXQuery(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length > 0 && X_QUERY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export const SOURCE_ROLE: Record<Source, Role> = { web: 'search', x: 'social' };

/** Note added when the web answers a question that was aimed at X. */
export const X_DEGRADE_NOTE =
  'X itself was not reachable here (Grok Build missing, signed out, or failing), so this came from the public web, which cannot see inside X.';

export interface SourcePlan {
  source: Source;
  /** The engine to try first. Absent on an `unavailable` plan, which runs nothing. */
  engine?: SearchEngine;
  /** Added to the result when a fallback engine, not the first choice, answers. */
  degradeNote?: string;
  /** Engines to try after this one fails, in order. */
  fallbacks: SearchEngine[];
  /** Problems worth telling the user about, e.g. a config typo. */
  notes: string[];
  /**
   * No engine can serve this source. Instead of dropping the slot, emit an
   * explicit empty entry (status "unavailable") so a machine consumer sees the
   * source was asked for and could not be reached.
   */
  unavailable?: boolean;
}

export interface PlanInput {
  mode: RunMode;
  query?: string;
  config: ModsearchConfig;
  /** Explicit --engine, overrides the role's configured engine. */
  requestedEngine?: string;
  /** Explicit --source list. Undefined means decide from the query. */
  requestedSources?: Source[];
  env?: NodeJS.ProcessEnv;
  /** Cooldown snapshot to order the chain by. Absent means cooldown is off. */
  cooldown?: CooldownView;
}

/** Which sources a search should consult when the user did not say. */
export function defaultSources(query: string | undefined): Source[] {
  // An X-flavored question is about X, so going to the web too would spend
  // quota on an index that cannot see the answer.
  return query && isXQuery(query) ? ['x'] : ['web'];
}

/**
 * Pick the engine chain for one role.
 *
 * Only searching takes a configured engine. Fetching follows that same choice
 * when the engine can fetch and lands on the built-in local fetcher when it
 * cannot, so nobody has to configure page fetch separately. Searching X has
 * one possible engine, so there is nothing to choose there either.
 *
 * Page fetch normally ends at the local engine: a wrong engine name in the
 * config, a missing binary, or a runtime failure must never leave a URL
 * unreadable. An explicit --engine is the one exception, see below.
 *
 * An explicit --engine is a hard force: the chain holds exactly that engine,
 * with no preference list appended and no local floor. If it cannot do the job
 * it fails loudly rather than quietly spending another engine's quota. The
 * `engine` in the config file stays a soft preference (still backed by the
 * role defaults and the fetch floor), because a config choice is not a demand.
 */
export function planRole(
  role: Role,
  config: ModsearchConfig,
  requestedEngine: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  cooldown?: CooldownView,
): { chain: SearchEngine[]; notes: string[] } {
  const notes: string[] = [];
  const settingsFor = (name: string) => engineSettings(name, config, env);
  const usable = (engine: SearchEngine) => engine.isAvailable(settingsFor(engine.name), env, role);

  const chain: SearchEngine[] = [];
  const add = (engine: SearchEngine | undefined) => {
    if (engine && !chain.includes(engine)) {
      chain.push(engine);
    }
  };

  const explicit = requestedEngine?.trim();
  if (explicit) {
    // Strict: force exactly this engine, no fallbacks. A silent switch to
    // another engine here is what burned other providers' quotas.
    const engine = findEngine(explicit);
    if (!engine) {
      notes.push(
        `Unknown engine "${explicit}" (--engine). Drop -e to let modsearch pick one that works, or name a known engine: ${listEngines().join(', ')}.`,
      );
    } else if (!engine.roles.includes(role)) {
      notes.push(
        `The ${engine.name} engine cannot ${role} (--engine forces it with no fallback). Drop -e to let modsearch pick an engine that can. ${engine.name} handles: ${engine.roles.join(', ')}.`,
      );
    } else {
      add(engine);
    }
    return { chain, notes };
  }

  // No explicit --engine: the config choice is a preference, backed by the
  // role defaults and (for fetch) the local floor.
  const configured = chosenEngine(config);
  if (configured) {
    const engine = findEngine(configured);
    if (!engine) {
      notes.push(
        `Unknown engine "${configured}" (engine in the config file), so modsearch chose one that works.`,
      );
    } else if (engine.roles.includes(role)) {
      add(engine);
    }
    // A configured search engine that cannot fetch is the normal case, not a
    // misconfiguration, so it earns no complaint.
  }

  for (const name of ROLE_PREFERENCE[role]) {
    const engine = resolveEngine(name);
    if (usable(engine)) {
      add(engine);
    }
  }

  if (role === 'fetch') {
    add(resolveEngine(FETCH_FLOOR));
  }

  // Cooldown only reshuffles this base order, it never changes it: a cooling
  // engine is moved to the back so a healthy one is tried first, but it stays
  // in the chain so it is still reached when everything else fails.
  if (cooldown) {
    return { chain: reorderByCooldown(chain, cooldown, notes), notes };
  }

  return { chain, notes };
}

/**
 * Stable-partition the chain into healthy engines then cooling ones, preserving
 * the base order within each group. Each demoted engine leaves a note so the
 * result can say who is cooling and until when.
 */
function reorderByCooldown(
  chain: SearchEngine[],
  cooldown: CooldownView,
  notes: string[],
): SearchEngine[] {
  const active: SearchEngine[] = [];
  const cooling: SearchEngine[] = [];
  for (const engine of chain) {
    const entry = coolingEntry(cooldown.state, engine.name, cooldown.now);
    if (entry) {
      cooling.push(engine);
      const reason = entry.reason.split('\n')[0].slice(0, 140);
      notes.push(
        `The ${engine.name} engine is cooling until ${entry.until}, so it moves to the back of the fallback chain.${reason ? ` Reason: ${reason}` : ''}`,
      );
    } else {
      active.push(engine);
    }
  }
  return [...active, ...cooling];
}

/** Full plan: which sources to run, and the engine chain for each. */
export function planRun(input: PlanInput): SourcePlan[] {
  const env = input.env ?? process.env;

  if (input.mode === 'fetch') {
    const { chain, notes } = planRole(
      'fetch',
      input.config,
      input.requestedEngine,
      env,
      input.cooldown,
    );
    return [{ source: 'web', engine: chain[0], fallbacks: chain.slice(1), notes }];
  }

  const sources = input.requestedSources ?? defaultSources(input.query);
  // When x degrades to the web and the web is already being consulted, running
  // both plans would issue the same query twice and bill it twice.
  const webRequested = sources.includes('web');
  return sources.flatMap((source): SourcePlan[] => {
    const role = SOURCE_ROLE[source];
    const { chain, notes } = planRole(role, input.config, input.requestedEngine, env, input.cooldown);

    if (source === 'x') {
      // X has one engine. When it is unusable, the web is the only thing left,
      // and the answer must say it is second-hand. An explicit --engine carries
      // into that fallback too, so a hard force stays a hard force.
      const web = planRole('search', input.config, input.requestedEngine, env, input.cooldown);
      const social = chain.filter((engine) => engine.roles.includes('social'));
      if (social.length === 0) {
        if (webRequested) {
          // The web entry already answers this ground, so do not run a second
          // identical search. But do not silently drop the X slot either: emit
          // an explicit empty entry marked unavailable, so nobody mistakes the
          // web result for X coverage.
          return [
            {
              source: 'x' as Source,
              fallbacks: [],
              notes: [...notes, X_DEGRADE_NOTE],
              unavailable: true,
            },
          ];
        }
        return [
          {
            source: 'x' as Source,
            engine: web.chain[0],
            fallbacks: web.chain.slice(1),
            notes: [...notes, X_DEGRADE_NOTE],
          },
        ];
      }
      return [
        {
          source: 'x' as Source,
          engine: social[0],
          fallbacks: [...social.slice(1), ...web.chain],
          // Falling back to a web engine mid-run is still second-hand evidence,
          // so the caveat has to travel with the plan, not just the no-grok case.
          degradeNote: X_DEGRADE_NOTE,
          notes,
        },
      ];
    }

    // A web result answering a web request is not degraded. When X was also
    // asked for and is unreachable, the explicit unavailable X entry above
    // carries that caveat, so this entry stays a clean web answer.
    return [{ source, engine: chain[0], fallbacks: chain.slice(1), notes }];
  });
}

/** Parse a `--source web,x` value. */
export function parseSources(value: string): Source[] {
  const parsed = value
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

  const sources: Source[] = [];
  for (const part of parsed) {
    if (part !== 'web' && part !== 'x') {
      throw new Error(`Unknown source: ${part}. Use web, x, or web,x.`);
    }
    if (!sources.includes(part)) {
      sources.push(part);
    }
  }
  if (sources.length === 0) {
    throw new Error('No sources given. Use --source web, --source x, or --source web,x.');
  }
  return sources;
}
