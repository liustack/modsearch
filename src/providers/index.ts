import { geminiCliProvider } from './geminiCli.ts';

export interface ProviderInvocation {
  command: string;
  args: string[];
  cwd: string;
}

export interface BuildProviderInvocationOptions {
  query: string;
  model?: string;
  maxResults?: number;
  extraPrompt?: string;
  providerBin?: string;
  workdir?: string;
}

export interface SearchProvider {
  name: string;
  buildInvocation: (options: BuildProviderInvocationOptions) => ProviderInvocation;
}

const PROVIDERS: Record<string, SearchProvider> = {
  'gemini-cli': geminiCliProvider,
  gemini: geminiCliProvider,
};

export function resolveProvider(providerName = 'gemini-cli'): SearchProvider {
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
