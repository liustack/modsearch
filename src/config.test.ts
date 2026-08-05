import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  engineSettings,
  initConfigFile,
  loadConfigFile,
  migrateLegacyConfig,
  renderConfig,
  roleEngine,
  setConfigValue,
} from './config.ts';

function tempConfigPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-config-')), 'config.json');
}

describe('config file', () => {
  it('is optional: a missing file reads as empty', () => {
    expect(loadConfigFile(tempConfigPath())).toEqual({});
  });

  it('throws a fix-or-delete error on unparseable JSON', () => {
    const p = tempConfigPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{broken');
    expect(() => loadConfigFile(p)).toThrow('Fix or delete the file');
  });

  it('sets role engines and engine settings, 0600, either key shape', () => {
    const p = tempConfigPath();
    setConfigValue('search.engine', 'tavily', p);
    setConfigValue('tavily.apiKey', 'tvly-secret-123456', p);
    setConfigValue('engines.grok-cli.bin', '/opt/grok', p);

    const config = loadConfigFile(p);
    expect(roleEngine(config, 'search')).toBe('tavily');
    expect(roleEngine(config, 'fetch')).toBeUndefined();
    expect(config.engines?.tavily?.apiKey).toBe('tvly-secret-123456');
    expect(config.engines?.['grok-cli']?.bin).toBe('/opt/grok');
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });

  it('rejects unknown fields and malformed keys', () => {
    const p = tempConfigPath();
    expect(() => setConfigValue('tavily.password', 'x', p)).toThrow('Unknown engine setting');
    expect(() => setConfigValue('noDotHere', 'x', p)).toThrow('Invalid config key');
  });

  it('reads configs written before roles existed', () => {
    // The old shape pinned one global provider next to a providers map.
    const migrated = migrateLegacyConfig({
      provider: 'tavily',
      providers: { tavily: { apiKey: 'k' }, 'antigravity-cli': { bin: 'agy' } },
    });
    expect(roleEngine(migrated, 'search')).toBe('tavily');
    expect(migrated.engines?.tavily?.apiKey).toBe('k');
    expect(migrated.engines?.['antigravity-cli']?.bin).toBe('agy');
    expect((migrated as Record<string, unknown>).providers).toBeUndefined();
  });

  it('maps a legacy grok pin onto the social role, not search', () => {
    const migrated = migrateLegacyConfig({ provider: 'grok-cli', providers: {} });
    expect(roleEngine(migrated, 'social')).toBe('grok-cli');
    expect(roleEngine(migrated, 'search')).toBeUndefined();
  });

  it('lets env vars override the file', () => {
    const config = { engines: { tavily: { apiKey: 'from-file' } } };
    expect(
      engineSettings('tavily', config, { TAVILY_API_KEY: 'from-env' } as NodeJS.ProcessEnv).apiKey,
    ).toBe('from-env');
    expect(engineSettings('tavily', config, {} as NodeJS.ProcessEnv).apiKey).toBe('from-file');
  });

  it('init writes a template and refuses to overwrite without force', () => {
    const p = tempConfigPath();
    initConfigFile(p);
    expect(loadConfigFile(p).engines?.['antigravity-cli']?.bin).toBe('agy');
    expect(() => initConfigFile(p)).toThrow('already exists');
    initConfigFile(p, true);
  });

  it('masks api keys when rendering', () => {
    const rendered = renderConfig({ engines: { tavily: { apiKey: 'tvly-abcdefghijklmnop' } } });
    expect(rendered).not.toContain('abcdefghijklmnop');
    expect(rendered).toContain('tvly-a...op');
  });
});
