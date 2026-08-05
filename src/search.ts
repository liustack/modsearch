import { spawn } from 'child_process';
import { loadConfigFile, resolveProviderSettings, type ModsearchConfig } from './config.ts';
import { commandOnPath, grokAvailable, isXQuery } from './providers/grok.ts';
import {
  providersForMode,
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
  /** Injected config, for tests. Loaded from ~/.modsearch/config.json otherwise. */
  config?: ModsearchConfig;
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
// After the provider exits, how long to keep draining stdout before giving up
// on the pipe closing. Reset whenever more output arrives.
const DRAIN_GRACE_MS = 500;

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
 * Pick the provider for this run. An explicit `-p`, or a provider pinned in
 * the config file, always wins. Otherwise X-flavored search queries route
 * entirely to Grok Build when it is installed and signed in, so they spend no
 * agy quota at all; everything else goes to the default provider.
 */
export function routeProvider(options: {
  mode: RunMode;
  query?: string;
  provider?: string;
  pinnedProvider?: string;
  x?: boolean;
  grokBin?: string;
}): SearchProvider {
  const requested = options.provider?.trim() || options.pinnedProvider?.trim();
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

  // Layered config: flags > env vars > ~/.modsearch/config.json > built-ins.
  const config: ModsearchConfig = options.config ?? loadConfigFile();
  const settings = (name: string) => resolveProviderSettings(name, config);
  const agyBin = options.providerBin || settings('antigravity-cli').bin || undefined;
  const grokBin = options.grokBin || settings('grok-cli').bin || undefined;
  const tavilyKey = settings('tavily').apiKey;
  if (tavilyKey && !process.env.TAVILY_API_KEY) {
    // The Tavily SDK reads the env var, so bridge the config file into it.
    process.env.TAVILY_API_KEY = tavilyKey;
  }

  let provider = routeProvider({
    mode,
    query,
    provider: options.provider,
    pinnedProvider: config.provider,
    x: options.x,
    grokBin,
  });

  // An engine that cannot serve this mode should say so plainly. Never demand
  // that the user adopt a specific engine they may have skipped on purpose.
  if (!provider.modes.includes(mode)) {
    throw new Error(describeMissingCapability(provider.name, mode, agyBin ?? 'agy'));
  }

  const providerOptions = {
    mode,
    query,
    url,
    maxResults: options.maxResults,
    extraPrompt: options.prompt,
    providerBin: agyBin,
    grokBin,
    workdir: options.workdir,
    timeoutMs,
  };

  let model = options.model || settings(provider.name).model || provider.defaultModel;
  let parsed: ProviderParsedOutput;
  try {
    parsed = await runProvider(provider, { ...providerOptions, model }, timeoutMs);
  } catch (error) {
    // The grok route is best-effort: when it was chosen by routing (not by an
    // explicit -p) and fails at runtime, fall back to the default provider
    // silently instead of surfacing a broken bonus path.
    if (provider.name === 'grok-cli' && !options.provider?.trim() && !config.provider?.trim()) {
      provider = resolveProvider();
      model = options.model || settings(provider.name).model || provider.defaultModel;
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

/**
 * Explain a mode the chosen engine cannot serve, in terms of what is actually
 * on this machine. When nothing installed can do it, say so instead of
 * insisting on a dependency the user never asked for.
 */
export function describeMissingCapability(
  providerName: string,
  mode: RunMode,
  agyBin = 'agy',
  isInstalled: (bin: string) => boolean = commandOnPath,
): string {
  const action = mode === 'fetch' ? 'page fetch (-u)' : 'search (-q)';
  const head = `The ${providerName} engine does not support ${action}.`;
  const usable = providersForMode(mode)
    .map((provider) => provider.name)
    .filter((name) => name !== providerName)
    .filter((name) => (name === 'antigravity-cli' ? isInstalled(agyBin) : true));

  if (usable.length > 0) {
    return `${head} Set up here and able to: ${usable.join(', ')}. Drop -p to let modsearch route, or name one with -p <engine>.`;
  }
  if (mode === 'fetch') {
    return `${head} No engine set up here can fetch a page either: that takes Antigravity CLI (agy). Search with -q instead, or add it when you want fetch: curl -fsSL https://antigravity.google/cli/install.sh | bash`;
  }
  return `${head} No other engine is set up here to do it either.`;
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

/** Exported for tests: the timeout path is otherwise behind a 30s backstop. */
export function runCommand(
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
    let settled = false;
    let drainTimer: NodeJS.Timeout | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    // 'close' waits for every stdio pipe to close, but agy leaves a language
    // server running that inherited the pipe, so its write end never closes
    // and 'close' never fires (modlens issue #1). Settle on 'exit' plus a
    // drain window instead, and drop the pipes afterwards so the lingering
    // descendant cannot keep this process alive either.
    const settle = (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(drainTimer);
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();

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
    };

    let exitCode: number | null = null;
    let exited = false;
    const restartDrain = () => {
      if (!exited || settled) {
        return;
      }
      clearTimeout(drainTimer);
      drainTimer = setTimeout(() => settle(exitCode), DRAIN_GRACE_MS);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      restartDrain();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      restartDrain();
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(drainTimer);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(`Provider CLI not found: ${invocation.command}. Install it and sign in first.`),
        );
        return;
      }
      reject(error);
    });

    child.on('exit', (code) => {
      exitCode = code;
      exited = true;
      restartDrain();
    });

    // Normal providers close their pipes right after exiting: settle at once.
    child.on('close', (code) => settle(code));
  });
}
