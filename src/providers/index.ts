import { antigravityCliProvider } from './antigravity.ts';
import { grokCliProvider } from './grok.ts';
import { tavilyProvider } from './tavily.ts';

export type RunMode = 'search' | 'fetch';

export interface ProviderInvocation {
  command: string;
  args: string[];
  cwd: string;
}

export interface BuildProviderInvocationOptions {
  mode: RunMode;
  query?: string;
  url?: string;
  model?: string;
  maxResults?: number;
  extraPrompt?: string;
  providerBin?: string;
  grokBin?: string;
  workdir?: string;
  timeoutMs: number;
}

export interface ProviderParsedOutput {
  result: unknown;
  meta: {
    conversationId: string | null;
    durationSeconds: number | null;
    usage: unknown | null;
  };
}

export interface SearchProvider {
  name: string;
  defaultModel: string;
  // Subprocess providers implement buildInvocation + parseOutput.
  // In-process API providers (e.g. tavily) implement execute instead.
  buildInvocation?: (options: BuildProviderInvocationOptions) => ProviderInvocation;
  parseOutput?: (stdout: string) => ProviderParsedOutput;
  execute?: (options: BuildProviderInvocationOptions) => Promise<ProviderParsedOutput>;
}

const PROVIDERS: Record<string, SearchProvider> = {
  'antigravity-cli': antigravityCliProvider,
  antigravity: antigravityCliProvider,
  agy: antigravityCliProvider,
  tavily: tavilyProvider,
  'grok-cli': grokCliProvider,
  grok: grokCliProvider,
};

export function resolveProvider(providerName = 'antigravity-cli'): SearchProvider {
  const normalized = providerName.trim().toLowerCase();
  const provider = PROVIDERS[normalized];

  if (!provider) {
    throw new Error(`Unsupported provider: ${providerName}`);
  }

  return provider;
}

export function listProviders(): string[] {
  return [...new Set(Object.values(PROVIDERS).map((provider) => provider.name))];
}
