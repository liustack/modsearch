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
  chosenEngine,
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
    setConfigValue('engine', 'tavily', p);
    setConfigValue('tavily.apiKey', 'tvly-secret-123456', p);
    setConfigValue('engines.grok-cli.bin', '/opt/grok', p);

    const config = loadConfigFile(p);
    expect(chosenEngine(config)).toBe('tavily');
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
    expect(chosenEngine(migrated)).toBe('tavily');
    expect(migrated.engines?.tavily?.apiKey).toBe('k');
    expect(migrated.engines?.['antigravity-cli']?.bin).toBe('agy');
    expect((migrated as Record<string, unknown>).providers).toBeUndefined();
  });

  it('ignores a legacy pin that was not a search engine', () => {
    // grok was pinnable per role before; now X has no choice to make.
    const migrated = migrateLegacyConfig({ provider: 'grok-cli', providers: {} });
    expect(chosenEngine(migrated)).toBeUndefined();
  });

  it('reads the short-lived per-role shape', () => {
    const migrated = migrateLegacyConfig({
      search: { engine: 'tavily' },
      fetch: { engine: 'http' },
      engines: { tavily: { apiKey: 'k' } },
    });
    expect(chosenEngine(migrated)).toBe('tavily');
    expect((migrated as Record<string, unknown>).fetch).toBeUndefined();
  });

  it('accepts search.engine as a spelling of engine', () => {
    const p = tempConfigPath();
    setConfigValue('search.engine', 'tavily', p);
    expect(chosenEngine(loadConfigFile(p))).toBe('tavily');
  });

  it('lets env vars override the file', () => {
    const config = { engines: { tavily: { apiKey: 'from-file' } } };
    expect(
      engineSettings('tavily', config, { TAVILY_API_KEY: 'from-env' } as NodeJS.ProcessEnv).apiKey,
    ).toBe('from-env');
    expect(engineSettings('tavily', config, {} as NodeJS.ProcessEnv).apiKey).toBe('from-file');
  });

  it('init writes only the shape, never baked-in defaults', () => {
    // Pre-filling every engine buried the one real decision, and a default
    // written into the file would silently outrank a future change to it.
    const p = tempConfigPath();
    initConfigFile(p);
    const config = loadConfigFile(p);
    expect(config.engine).toBe('');
    expect(config.engines).toEqual({});
    expect(JSON.parse(fs.readFileSync(p, 'utf-8'))).toEqual({ engine: '', engines: {} });

    expect(() => initConfigFile(p)).toThrow('already exists');
    initConfigFile(p, true);
  });

  it('masks api keys when rendering', () => {
    const rendered = renderConfig({ engines: { tavily: { apiKey: 'tvly-abcdefghijklmnop' } } });
    expect(rendered).not.toContain('abcdefghijklmnop');
    expect(rendered).toContain('tvly-a...op');
  });
});
