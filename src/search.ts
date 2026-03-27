import { spawn } from 'child_process';
import { resolveProvider } from './providers/index.ts';

export interface ProviderJsonOutput {
  session_id?: string;
  response: string;
  stats?: unknown;
  [key: string]: unknown;
}

export interface ExtractedSearchPayload {
  structured: unknown | null;
  rawText: string;
}

export interface RunSearchOptions {
  query: string;
  provider?: string;
  model?: string;
  prompt?: string;
  timeoutMs?: number;
  providerBin?: string;
  maxResults?: number;
  workdir?: string;
}

export interface RunSearchResult {
  query: string;
  provider: string;
  structured: unknown | null;
  rawText: string;
  meta: {
    generatedAt: string;
    model: string | null;
    providerSessionId: string | null;
    providerStats: unknown | null;
  };
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT_MS = 180_000;

export function parseProviderJsonOutput(stdout: string): ProviderJsonOutput {
  const trimmed = stdout.trim();
  let parsed = tryParseJson(trimmed);

  if (parsed === null) {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      parsed = tryParseJson(trimmed.slice(firstBrace, lastBrace + 1));
    }
  }

  if (parsed === null) {
    throw new Error('Failed to parse provider JSON output.');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { response?: unknown }).response !== 'string'
  ) {
    throw new Error('Provider JSON output is missing a string `response` field.');
  }

  return parsed as ProviderJsonOutput;
}

export function extractSearchPayload(text: string): ExtractedSearchPayload {
  const rawText = text.trim();

  const direct = tryParseJson(rawText);
  if (direct !== null) {
    return {
      structured: direct,
      rawText,
    };
  }

  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(rawText);
  if (fencedMatch) {
    const parsedFenced = tryParseJson(fencedMatch[1].trim());
    if (parsedFenced !== null) {
      return {
        structured: parsedFenced,
        rawText,
      };
    }
  }

  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const possibleJson = rawText.slice(firstBrace, lastBrace + 1);
    const parsedObject = tryParseJson(possibleJson);
    if (parsedObject !== null) {
      return {
        structured: parsedObject,
        rawText,
      };
    }
  }

  return {
    structured: null,
    rawText,
  };
}

export async function runSearch(options: RunSearchOptions): Promise<RunSearchResult> {
  const query = options.query?.trim();
  if (!query) {
    throw new Error('Search query is required.');
  }

  const provider = resolveProvider(options.provider);

  if (provider.execute) {
    return provider.execute({
      query,
      model: options.model,
      maxResults: options.maxResults,
      extraPrompt: options.prompt,
      providerBin: options.providerBin,
      workdir: options.workdir,
    });
  }

  const invocation = provider.buildInvocation({
    query,
    model: options.model,
    maxResults: options.maxResults,
    extraPrompt: options.prompt,
    providerBin: options.providerBin,
    workdir: options.workdir,
  });

  const commandResult = await runCommand(
    provider.name,
    invocation.command,
    invocation.args,
    invocation.cwd,
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const providerOutput = parseProviderJsonOutput(commandResult.stdout);
  const extracted = extractSearchPayload(providerOutput.response);

  return {
    query,
    provider: provider.name,
    structured: extracted.structured,
    rawText: extracted.rawText,
    meta: {
      generatedAt: new Date().toISOString(),
      model: options.model ?? null,
      providerSessionId: providerOutput.session_id ?? null,
      providerStats: providerOutput.stats ?? null,
    },
  };
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function runCommand(
  providerName: string,
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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
        reject(new Error(`Provider CLI not found: ${command}`));
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
