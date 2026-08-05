import { describe, expect, it } from 'vitest';
import { listProviders, resolveProvider } from './index.ts';

describe('resolveProvider', () => {
  it('defaults to antigravity-cli and accepts aliases', () => {
    expect(resolveProvider().name).toBe('antigravity-cli');
    expect(resolveProvider('agy').name).toBe('antigravity-cli');
    expect(resolveProvider('Antigravity').name).toBe('antigravity-cli');
  });

  it('rejects unknown providers', () => {
    expect(() => resolveProvider('gemini-cli')).toThrow('Unsupported provider: gemini-cli');
  });

  it('lists unique provider names', () => {
    expect(listProviders()).toEqual(['antigravity-cli', 'tavily', 'grok-cli', 'http']);
  });
});
