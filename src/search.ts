import { spawn } from 'child_process';
import {
  resolveProvider,
  type ProviderInvocation,
  type ProviderParsedOutput,
  type RunMode,
} from './providers/index.ts';
import { grokAvailable, isXQuery, startXSearch, type XSection } from './xSource.ts';

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
  /** X companion source: true forces it, false disables it, undefined = auto. */
  x?: boolean;
  grokBin?: string;
}

export interface RunSearchResult {
  mode: RunMode;
  query: string | null;
  url: string | null;
  provider: string;
  result: unknown;
  /** Present only when the X companion source ran and succeeded. */
  x?: XSection;
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

export async function runSearch(options: RunSearchOptions): Promise<RunSearchResult> {
  const query = options.query?.trim() || undefined;
  const url = options.url?.trim() ? validateUrl(options.url) : undefined;
  const mode = resolveMode(query, url);

  const provider = resolveProvider(options.provider);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = options.model || provider.defaultModel;

  const providerOptions = {
    mode,
    query,
    url,
    model,
    maxResults: options.maxResults,
    extraPrompt: options.prompt,
    providerBin: options.providerBin,
    workdir: options.workdir,
    timeoutMs,
  };

  // X companion source: runs in parallel with the main provider for X-flavored
  // queries when a signed-in Grok Build CLI is on this machine. Every failure
  // path is silent; the main result never depends on it.
  const wantX =
    mode === 'search' &&
    !!query &&
    options.x !== false &&
    (options.x === true || isXQuery(query)) &&
    grokAvailable(options.grokBin);
  const xRun = wantX
    ? startXSearch({
        query,
        maxPosts: options.maxResults ?? 5,
        timeoutMs,
        grokBin: options.grokBin,
      })
    : null;

  let parsed: ProviderParsedOutput;
  try {
    if (provider.execute) {
      parsed = await provider.execute(providerOptions);
    } else if (provider.buildInvocation && provider.parseOutput) {
      const invocation = provider.buildInvocation(providerOptions);
      const commandResult = await runCommand(provider.name, invocation, timeoutMs + KILL_GRACE_MS);
      parsed = provider.parseOutput(commandResult.stdout);
    } else {
      throw new Error(`Provider ${provider.name} implements neither execute nor buildInvocation.`);
    }
  } catch (error) {
    xRun?.abort();
    throw error;
  }

  const xSection = xRun ? await xRun.result : null;

  return {
    mode,
    query: query ?? null,
    url: url ?? null,
    provider: provider.name,
    result: parsed.result,
    ...(xSection ? { x: xSection } : {}),
    meta: {
      generatedAt: new Date().toISOString(),
      model,
      conversationId: parsed.meta.conversationId,
      durationSeconds: parsed.meta.durationSeconds,
      usage: parsed.meta.usage,
    },
  };
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
            `Provider CLI not found: ${invocation.command}. Install Antigravity CLI and sign in first.`,
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
