import { spawn } from 'child_process';
import { grokAvailable, isXQuery } from './providers/grok.ts';
import {
  resolveProvider,
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
 * Pick the provider for this run. Explicit `-p` always wins. Otherwise
 * X-flavored search queries route entirely to Grok Build when it is installed
 * and signed in, so they spend no agy quota at all; everything else goes to
 * the default provider.
 */
export function routeProvider(options: {
  mode: RunMode;
  query?: string;
  provider?: string;
  x?: boolean;
  grokBin?: string;
}): SearchProvider {
  const requested = options.provider?.trim();
  if (requested) {
    return resolveProvider(requested);
  }
  if (
    options.mode === 'search' &&
    options.query &&
    options.x !== false &&
    (options.x === true || isXQuery(options.query)) &&
    grokAvailable(options.grokBin)
  ) {
    return resolveProvider('grok-cli');
  }
  return resolveProvider();
}

export async function runSearch(options: RunSearchOptions): Promise<RunSearchResult> {
  const query = options.query?.trim() || undefined;
  const url = options.url?.trim() ? validateUrl(options.url) : undefined;
  const mode = resolveMode(query, url);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let provider = routeProvider({
    mode,
    query,
    provider: options.provider,
    x: options.x,
    grokBin: options.grokBin,
  });

  const providerOptions = {
    mode,
    query,
    url,
    maxResults: options.maxResults,
    extraPrompt: options.prompt,
    providerBin: options.providerBin,
    grokBin: options.grokBin,
    workdir: options.workdir,
    timeoutMs,
  };

  let model = options.model || provider.defaultModel;
  let parsed: ProviderParsedOutput;
  try {
    parsed = await runProvider(provider, { ...providerOptions, model }, timeoutMs);
  } catch (error) {
    // The grok route is best-effort: when it was chosen by routing (not by an
    // explicit -p) and fails at runtime, fall back to the default provider
    // silently instead of surfacing a broken bonus path.
    if (provider.name === 'grok-cli' && !options.provider?.trim()) {
      provider = resolveProvider();
      model = options.model || provider.defaultModel;
      parsed = await runProvider(provider, { ...providerOptions, model }, timeoutMs);
    } else {
      throw error;
    }
  }

  return {
    mode,
    query: query ?? null,
    url: url ?? null,
    provider: provider.name,
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
