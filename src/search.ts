import { spawn } from 'child_process';
import { loadConfigFile, resolveProviderSettings, type ModsearchConfig } from './config.ts';
import { commandOnPath, grokAvailable, isXQuery } from './providers/grok.ts';
import {
  resolveProvider,
  type ProviderClass,
  type ProviderInvocation,
  type ProviderParsedOutput,
  type RunMode,
  type SearchProvider,
} from './providers/index.ts';

export interface RunSearchOptions {
  query?: string;
  url?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  timeoutMs?: number;
  providerBin?: string;
  maxResults?: number;
  workdir?: string;
  /** X routing: true forces the grok route, false disables it, undefined = auto. */
  x?: boolean;
  grokBin?: string;
}

export interface RunSearchResult {
  mode: RunMode;
  query: string | null;
  url: string | null;
  provider: string;
  /** Which class of source answered: 'web' (public web) or 'social' (login-walled data). */
  class: ProviderClass;
  result: unknown;
  meta: {
    generatedAt: string;
    model: string;
    conversationId: string | null;
    durationSeconds: number | null;
    usage: unknown | null;
  };
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 180_000;
// Give the provider's own timeout a chance to fire first; SIGTERM is the backstop.
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

/**
 * Note injected when an X-flavored query has to be answered by a web-class
 * provider because the social chain is empty or failed at runtime.
 */
export const X_DEGRADE_NOTE =
  'X-direct coverage unavailable (Grok Build missing, signed out, or failed). These are second-hand mentions from the public web, which cannot see inside X.';

export interface ChainAvailability {
  agy: boolean;
  grok: boolean;
  tavily: boolean;
}

/**
 * Ordered provider chain for one run. Two classes: 'social' (X via Grok
 * Build) and 'web' (agy first for LLM synthesis, playwright as the free
 * quota-less browser fallback, tavily last because it burns credits). A
 * social request appends the web chain as its degrade path.
 */
export function buildChain(args: {
  mode: RunMode;
  wantSocial: boolean;
  availability: ChainAvailability;
}): SearchProvider[] {
  const { mode, wantSocial, availability } = args;

  const web: SearchProvider[] = [];
  if (availability.agy) {
    web.push(resolveProvider('antigravity-cli'));
  }
  web.push(resolveProvider('playwright'));
  if (mode === 'search' && availability.tavily) {
    web.push(resolveProvider('tavily'));
  }

  if (mode === 'search' && wantSocial) {
    const chain: SearchProvider[] = [];
    if (availability.grok) {
      chain.push(resolveProvider('grok-cli'));
    }
    return [...chain, ...web];
  }
  return web;
}

export async function runSearch(options: RunSearchOptions): Promise<RunSearchResult> {
  const query = options.query?.trim() || undefined;
  const url = options.url?.trim() ? validateUrl(options.url) : undefined;
  const mode = resolveMode(query, url);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const config = loadConfigFile();
  const settings = (name: string) => resolveProviderSettings(name, config);

  const agyBin = options.providerBin || settings('antigravity-cli').bin || 'agy';
  const grokBin = options.grokBin || settings('grok-cli').bin || 'grok';
  const headless = settings('playwright').headless !== 'false';
  const tavilyKey = settings('tavily').apiKey;
  if (tavilyKey && !process.env.TAVILY_API_KEY) {
    // The tavily SDK reads the env var; bridge the config file into it.
    process.env.TAVILY_API_KEY = tavilyKey;
  }

  // Explicit -p, or a provider pinned in the config file, disables routing.
  const pinnedName = options.provider?.trim() || config.provider?.trim() || '';
  let chain: SearchProvider[];
  let wantSocial = false;
  if (pinnedName) {
    chain = [resolveProvider(pinnedName)];
  } else {
    wantSocial =
      mode === 'search' &&
      !!query &&
      options.x !== false &&
      (options.x === true || isXQuery(query));
    chain = buildChain({
      mode,
      wantSocial,
      availability: {
        agy: commandOnPath(agyBin),
        grok: grokAvailable(grokBin),
        tavily: Boolean(tavilyKey || process.env.TAVILY_API_KEY),
      },
    });
  }

  const providerOptions = {
    mode,
    query,
    url,
    maxResults: options.maxResults,
    extraPrompt: options.prompt,
    providerBin: agyBin,
    grokBin,
    headless,
    workdir: options.workdir,
    timeoutMs,
  };

  const failures: string[] = [];
  for (const provider of chain) {
    const model = options.model || settings(provider.name).model || provider.defaultModel;
    let parsed: ProviderParsedOutput;
    try {
      parsed = await runProvider(provider, { ...providerOptions, model }, timeoutMs);
    } catch (error) {
      if (chain.length === 1) {
        throw error;
      }
      failures.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    // A web provider answering an X-flavored query is a degraded answer:
    // say so inside the result instead of pretending Google can see X.
    if (wantSocial && provider.providerClass === 'web') {
      injectUncertainty(parsed.result, X_DEGRADE_NOTE);
    }

    return {
      mode,
      query: query ?? null,
      url: url ?? null,
      provider: provider.name,
      class: provider.providerClass,
      result: parsed.result,
      meta: {
        generatedAt: new Date().toISOString(),
        model,
        conversationId: parsed.meta.conversationId,
        durationSeconds: parsed.meta.durationSeconds,
        usage: parsed.meta.usage,
      },
    };
  }

  throw new Error(
    `Every provider in the chain failed.\n${failures.map((line) => `  - ${line}`).join('\n')}`,
  );
}

function injectUncertainty(result: unknown, note: string): void {
  if (!result || typeof result !== 'object') {
    return;
  }
  const shaped = result as { uncertainty?: unknown };
  if (Array.isArray(shaped.uncertainty)) {
    shaped.uncertainty.unshift(note);
  } else {
    shaped.uncertainty = [note];
  }
}

async function runProvider(
  provider: SearchProvider,
  providerOptions: Parameters<NonNullable<SearchProvider['buildInvocation']>>[0],
  timeoutMs: number,
): Promise<ProviderParsedOutput> {
  if (provider.execute) {
    return provider.execute(providerOptions);
  }
  if (provider.buildInvocation && provider.parseOutput) {
    const invocation = provider.buildInvocation(providerOptions);
    const commandResult = await runCommand(provider.name, invocation, timeoutMs + KILL_GRACE_MS);
    return provider.parseOutput(commandResult.stdout);
  }
  throw new Error(`Provider ${provider.name} implements neither execute nor buildInvocation.`);
}

function runCommand(
  providerName: string,
  invocation: ProviderInvocation,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(
            `Provider CLI not found: ${invocation.command}. Install it and sign in first.`,
          ),
        );
        return;
      }
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new Error(`${providerName} provider timed out after ${timeoutMs} ms.`));
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `${providerName} provider failed with code ${code}.${stderr ? ` stderr: ${stderr.trim()}` : ''}`,
          ),
        );
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}
