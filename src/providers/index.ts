import { antigravityCliProvider } from './antigravity.ts';

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
  buildInvocation: (options: BuildProviderInvocationOptions) => ProviderInvocation;
  parseOutput: (stdout: string) => ProviderParsedOutput;
}

const PROVIDERS: Record<string, SearchProvider> = {
  'antigravity-cli': antigravityCliProvider,
  antigravity: antigravityCliProvider,
  agy: antigravityCliProvider,
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
