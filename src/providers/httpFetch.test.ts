import { afterEach, describe, expect, it } from 'vitest';
import { planRole } from '../router.ts';
import { cleanupTempDirs, tempConfigPath } from '../testing/helpers.ts';
import { resolveEngine } from './index.ts';

describe('http engine routing', () => {
  it('is registered as a fetch-only engine', () => {
    const engine = resolveEngine('http');
    expect(engine.name).toBe('http');
    expect(engine.roles).toEqual(['fetch']);
    expect(engine.isAvailable({}, {})).toBe(true);
    expect(resolveEngine('direct').name).toBe('http');
  });

  it('takes over page fetch when agy is not installed', () => {
    const bare = planRole('fetch', {}, undefined, { PATH: '/nonexistent' } as NodeJS.ProcessEnv);
    expect(bare.chain[0].name).toBe('http');
  });

  it('never takes over search', () => {
    expect(resolveEngine('http').roles).not.toContain('search');
  });
});

describe('private network escape hatch', () => {
  afterEach(() => cleanupTempDirs());

  it('is off by default and settable from the config file', async () => {
    const { loadConfigFile, setConfigValue } = await import('../config.ts');
    const p = tempConfigPath();

    expect(loadConfigFile(p).engines?.http?.allowPrivateNetwork).toBeUndefined();
    setConfigValue('http.allowPrivateNetwork', 'true', p);
    expect(loadConfigFile(p).engines?.http?.allowPrivateNetwork).toBe('true');
  });

  it('blocks a private target by default and names the VPN case', async () => {
    const { runFetch } = await import('./httpFetch.ts');
    await expect(runFetch({ url: 'http://127.0.0.1:1/x' })).rejects.toThrow(
      /Blocked private network target/,
    );
  });
});
