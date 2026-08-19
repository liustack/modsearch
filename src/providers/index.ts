import type { EngineSettings, Role } from '../config.ts';
import { antigravityCliProvider } from './antigravity.ts';
import { exaProvider } from './exa.ts';
import { firecrawlProvider } from './firecrawl.ts';
import { grokCliProvider } from './grok.ts';
import { httpFetchProvider } from './httpFetch.ts';
import { tavilyProvider } from './tavily.ts';

export type RunMode = 'search' | 'fetch';

/** Where evidence comes from. `web` is the public index, `x` is X/Twitter. */
export type Source = 'web' | 'x';

export interface ProviderInvocation {
  command: string;
  args: string[];
  cwd: string;
}

/**
 * One unit of work handed to an engine. Engine-specific knobs (binary paths,
 * API keys, network policy) are not fields here: each engine reads what it
 * needs from `settings`, which the config layer resolved from flags,
 * environment, and file.
 */
export interface EngineRequest {
  mode: RunMode;
  query?: string;
  url?: string;
  model?: string;
  maxResults?: number;
  extraPrompt?: string;
  workdir?: string;
  timeoutMs: number;
  settings: EngineSettings;
  /**
   * Global network policy for this run: allow the local fetcher to reach
   * reserved and private ranges. Firecrawl never receives those targets.
   * Resolved from config and --allow-private-network. Off when absent.
   */
  allowPrivateNetwork?: boolean;
}

export interface EngineOutput {
  result: unknown;
  meta: {
    conversationId: string | null;
    durationSeconds: number | null;
    usage: unknown | null;
  };
}

/** Everything an engine needs to explain a non-zero exit. */
export interface EngineFailureContext {
  stdout: string;
  stderr: string;
  code: number | null;
}

export interface SearchEngine {
  name: string;
  /** Jobs this engine can do. */
  roles: Role[];
  /** Model used when nothing else specifies one. Absent when it has no model. */
  defaultModel?: string;
  /** Is this engine usable right now (installed, signed in, keyed)? */
  isAvailable: (settings: EngineSettings, env: NodeJS.ProcessEnv, role: Role) => boolean;
  /** One line for humans: what this engine needs to become available. */
  requirement: string;
  // Subprocess engines implement buildInvocation + parseOutput.
  // In-process engines (tavily, http) implement execute instead.
  buildInvocation?: (request: EngineRequest) => ProviderInvocation;
  parseOutput?: (stdout: string) => EngineOutput;
  execute?: (request: EngineRequest) => Promise<EngineOutput>;
  /** Turn a non-zero exit into an actionable message, or null for the default. */
  describeFailure?: (context: EngineFailureContext) => string | null;
}

const ENGINES: Record<string, SearchEngine> = {
  'antigravity-cli': antigravityCliProvider,
  antigravity: antigravityCliProvider,
  agy: antigravityCliProvider,
  tavily: tavilyProvider,
  exa: exaProvider,
  firecrawl: firecrawlProvider,
  'grok-cli': grokCliProvider,
  grok: grokCliProvider,
  // The built-in direct fetcher, canonically `local`. `http` and `direct` stay
  // as aliases so old flags and configs keep resolving to it.
  local: httpFetchProvider,
  http: httpFetchProvider,
  direct: httpFetchProvider,
};

/**
 * Engine preference per role, best first. Availability filters this, so a
 * machine with nothing installed still lands on something that works.
 */
export const ROLE_PREFERENCE: Record<Role, string[]> = {
  // Firecrawl leads: its keyless allowance works on a bare machine with no
  // signup, which is the product's zero-setup promise. agy synthesizes and
  // cites but its weekly quota is small, so it backs Firecrawl up rather than
  // fronting the chain. Tavily and Exa are keyed backups.
  search: ['firecrawl', 'antigravity-cli', 'tavily', 'exa'],
  // Firecrawl runs a cloud browser for JS-heavy pages, keyless by default
  // (opt out with firecrawl.keylessFetch false). agy extracts to a focus. The
  // local engine always works and returns the page as served, so it stays the
  // floor.
  fetch: ['firecrawl', 'antigravity-cli', 'local'],
  // Only xAI can see inside X.
  social: ['grok-cli'],
};

/** Engine that never needs setup, so page fetch can always fall back to it. */
export const FETCH_FLOOR = 'local';

export function resolveEngine(engineName: string): SearchEngine {
  const engine = findEngine(engineName);
  if (!engine) {
    throw new Error(`Unknown engine: ${engineName}. Known engines: ${listEngines().join(', ')}.`);
  }
  return engine;
}

export function findEngine(engineName: string): SearchEngine | undefined {
  // Own properties only: the registry is a plain object, and a bare index
  // walks the prototype chain, so a name like "constructor" would come back
  // as Object's constructor function and read as a truthy "engine".
  const key = engineName.trim().toLowerCase();
  return Object.hasOwn(ENGINES, key) ? ENGINES[key] : undefined;
}

/** Every registered engine, once each, in registration order. */
export function allEngines(): SearchEngine[] {
  return [...new Set(Object.values(ENGINES))];
}

export function enginesForRole(role: Role): SearchEngine[] {
  return allEngines().filter((engine) => engine.roles.includes(role));
}

export function listEngines(): string[] {
  return allEngines().map((engine) => engine.name);
}
