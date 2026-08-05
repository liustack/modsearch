import { engineSettings, roleEngine, type ModsearchConfig, type Role } from './config.ts';
import {
  FETCH_FLOOR,
  findEngine,
  resolveEngine,
  ROLE_PREFERENCE,
  type RunMode,
  type SearchEngine,
  type Source,
} from './providers/index.ts';

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
  engine: SearchEngine;
  /** Added to the result when a fallback engine, not the first choice, answers. */
  degradeNote?: string;
  /** Engines to try after this one fails, in order. */
  fallbacks: SearchEngine[];
  /** Problems worth telling the user about, e.g. a config typo. */
  notes: string[];
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
}

/** Which sources a search should consult when the user did not say. */
export function defaultSources(query: string | undefined): Source[] {
  // An X-flavored question is about X, so going to the web too would spend
  // quota on an index that cannot see the answer.
  return query && isXQuery(query) ? ['x'] : ['web'];
}

/**
 * Pick the engine chain for one role: the configured engine first (or the
 * preference order when unset), then everything else that is usable.
 *
 * Page fetch always ends at the local HTTP engine. A wrong engine name, a
 * missing binary, or a runtime failure should never leave a URL unreadable.
 */
export function planRole(
  role: Role,
  config: ModsearchConfig,
  requestedEngine: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): { chain: SearchEngine[]; notes: string[] } {
  const notes: string[] = [];
  const settingsFor = (name: string) => engineSettings(name, config, env);
  const usable = (engine: SearchEngine) => engine.isAvailable(settingsFor(engine.name), env);

  const chain: SearchEngine[] = [];
  const add = (engine: SearchEngine | undefined) => {
    if (engine && !chain.includes(engine)) {
      chain.push(engine);
    }
  };

  const namedBy = requestedEngine ? '--engine' : `${role}.engine in the config file`;
  const named = requestedEngine?.trim() || roleEngine(config, role);
  if (named) {
    const engine = findEngine(named);
    if (!engine) {
      notes.push(`Unknown engine "${named}" (${namedBy}), so modsearch chose one that works.`);
    } else if (!engine.roles.includes(role)) {
      notes.push(
        `The ${engine.name} engine cannot do ${role} (${namedBy}), so modsearch chose one that can. ${engine.name} handles: ${engine.roles.join(', ')}.`,
      );
    } else {
      add(engine);
    }
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

  return { chain, notes };
}

/** Is an engine for X usable right now? */
function socialAvailable(input: PlanInput, env: NodeJS.ProcessEnv): boolean {
  return planRole('social', input.config, undefined, env).chain.some((engine) =>
    engine.roles.includes('social'),
  );
}

/** Full plan: which sources to run, and the engine chain for each. */
export function planRun(input: PlanInput): SourcePlan[] {
  const env = input.env ?? process.env;

  if (input.mode === 'fetch') {
    const { chain, notes } = planRole('fetch', input.config, input.requestedEngine, env);
    return [{ source: 'web', engine: chain[0], fallbacks: chain.slice(1), notes }];
  }

  const sources = input.requestedSources ?? defaultSources(input.query);
  // When x degrades to the web and the web is already being consulted, running
  // both plans would issue the same query twice and bill it twice.
  const webRequested = sources.includes('web');
  return sources.flatMap((source) => {
    const role = SOURCE_ROLE[source];
    const { chain, notes } = planRole(role, input.config, input.requestedEngine, env);

    if (source === 'x') {
      // X has one engine. When it is unusable, the web is the only thing left,
      // and the answer must say it is second-hand.
      const web = planRole('search', input.config, undefined, env);
      const social = chain.filter((engine) => engine.roles.includes('social'));
      if (social.length === 0) {
        if (webRequested) {
          // The web entry already covers this ground: drop the duplicate and
          // let that entry carry the caveat.
          return [];
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

    const webNotes = [...notes];
    if (webRequested && sources.includes('x') && !socialAvailable(input, env)) {
      webNotes.push(X_DEGRADE_NOTE);
    }
    return [{ source, engine: chain[0], fallbacks: chain.slice(1), notes: webNotes }];
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
