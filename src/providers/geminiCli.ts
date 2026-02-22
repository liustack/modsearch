import * as path from 'path';
import { buildSearchPrompt } from '../prompt.ts';
import type {
  BuildProviderInvocationOptions,
  ProviderInvocation,
  SearchProvider,
} from './index.ts';

const DEFAULT_MAX_RESULTS = 8;

export function buildGeminiInvocation(
  options: BuildProviderInvocationOptions,
): ProviderInvocation {
  const prompt = buildSearchPrompt({
    query: options.query,
    maxResults: options.maxResults ?? DEFAULT_MAX_RESULTS,
    extraPrompt: options.extraPrompt,
  });

  const args = ['-p', prompt, '--output-format', 'json'];

  if (options.model) {
    args.push('-m', options.model);
  }

  return {
    command: options.providerBin || 'gemini',
    args,
    cwd: options.workdir ? path.resolve(options.workdir) : process.cwd(),
  };
}

export const geminiCliProvider: SearchProvider = {
  name: 'gemini-cli',
  buildInvocation: buildGeminiInvocation,
};
