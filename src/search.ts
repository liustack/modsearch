import { spawn } from 'child_process';
import { resolveProvider, type ProviderInvocation, type RunMode } from './providers/index.ts';

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

export async function runSearch(options: RunSearchOptions): Promise<RunSearchResult> {
  const query = options.query?.trim() || undefined;
  const url = options.url?.trim() ? validateUrl(options.url) : undefined;
  const mode = resolveMode(query, url);

  const provider = resolveProvider(options.provider);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = options.model || provider.defaultModel;

  const invocation = provider.buildInvocation({
    mode,
    query,
    url,
    model,
    maxResults: options.maxResults,
    extraPrompt: options.prompt,
    providerBin: options.providerBin,
    workdir: options.workdir,
    timeoutMs,
  });

  const commandResult = await runCommand(provider.name, invocation, timeoutMs + KILL_GRACE_MS);
  const parsed = provider.parseOutput(commandResult.stdout);

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
