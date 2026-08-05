import type { EngineSettings, Role } from '../config.ts';
import { antigravityCliProvider } from './antigravity.ts';
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
  isAvailable: (settings: EngineSettings, env: NodeJS.ProcessEnv) => boolean;
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
  'grok-cli': grokCliProvider,
  grok: grokCliProvider,
  http: httpFetchProvider,
  direct: httpFetchProvider,
};

/**
 * Engine preference per role, best first. Availability filters this, so a
 * machine with nothing installed still lands on something that works.
 */
export const ROLE_PREFERENCE: Record<Role, string[]> = {
  // agy synthesizes and cites. tavily is the keyed backup when agy is spent.
  search: ['antigravity-cli', 'tavily'],
  // agy extracts to a focus. http always works and returns the page as served.
  fetch: ['antigravity-cli', 'http'],
  // Only xAI can see inside X.
  social: ['grok-cli'],
};

/** Engine that never needs setup, so page fetch can always fall back to it. */
export const FETCH_FLOOR = 'http';

export function resolveEngine(engineName: string): SearchEngine {
  const engine = ENGINES[engineName.trim().toLowerCase()];
  if (!engine) {
    throw new Error(
      `Unknown engine: ${engineName}. Known engines: ${listEngines().join(', ')}.`,
    );
  }
  return engine;
}

export function findEngine(engineName: string): SearchEngine | undefined {
  return ENGINES[engineName.trim().toLowerCase()];
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
