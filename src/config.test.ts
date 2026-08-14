import * as fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  allowsPrivateNetwork,
  chosenEngine,
  cooldownEnabled,
  engineSettings,
  initConfigFile,
  loadConfigFile,
  migrateLegacyConfig,
  renderEffectiveConfig,
  setConfigValue,
} from './config.ts';
import { cleanupTempDirs, expectPosixMode, tempConfigPath } from './testing/helpers.ts';

describe('config file', () => {
  afterEach(() => cleanupTempDirs());

  it('is optional: a missing file reads as empty', () => {
    expect(loadConfigFile(tempConfigPath())).toEqual({});
  });

  it('throws a fix-or-delete error on unparseable JSON', () => {
    const p = tempConfigPath();
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
    expectPosixMode(p, 0o600);
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

  it('sets and reads the cooldown switch, on by default, rejecting other values', () => {
    const p = tempConfigPath();
    // Missing file and unset key both read as on.
    expect(cooldownEnabled(loadConfigFile(p))).toBe(true);
    setConfigValue('cooldown', 'off', p);
    expect(loadConfigFile(p).cooldown).toBe('off');
    expect(cooldownEnabled(loadConfigFile(p))).toBe(false);
    setConfigValue('cooldown', 'ON', p);
    expect(cooldownEnabled(loadConfigFile(p))).toBe(true);
    expect(() => setConfigValue('cooldown', 'maybe', p)).toThrow('Use on or off');
  });

  it('sets and reads the top-level allowPrivateNetwork flag, rejecting other values', () => {
    const p = tempConfigPath();
    // Missing file and unset key both read as off.
    expect(allowsPrivateNetwork(loadConfigFile(p))).toBe(false);
    setConfigValue('allowPrivateNetwork', 'true', p);
    expect(loadConfigFile(p).allowPrivateNetwork).toBe(true);
    expect(allowsPrivateNetwork(loadConfigFile(p))).toBe(true);
    setConfigValue('allowPrivateNetwork', 'false', p);
    expect(loadConfigFile(p).allowPrivateNetwork).toBe(false);
    expect(() => setConfigValue('allowPrivateNetwork', 'maybe', p)).toThrow('Use true or false');
  });

  it('migrates the retired per-engine allowPrivateNetwork string to the top-level boolean', () => {
    // Old files stored it as engines.http.allowPrivateNetwork ("true"/"false").
    // Reading promotes it to a top-level boolean and drops the hollow entry.
    const p = tempConfigPath();
    fs.writeFileSync(p, JSON.stringify({ engines: { http: { allowPrivateNetwork: 'true' } } }));
    const migrated = loadConfigFile(p);
    expect(migrated.allowPrivateNetwork).toBe(true);
    expect(migrated.engines).toEqual({});

    // The alias key `local` and a real per-engine "false" both migrate too.
    fs.writeFileSync(p, JSON.stringify({ engines: { local: { allowPrivateNetwork: 'false' } } }));
    expect(loadConfigFile(p).allowPrivateNetwork).toBe(false);
  });

  it('coerces a legacy top-level allowPrivateNetwork string form to a boolean', () => {
    const p = tempConfigPath();
    fs.writeFileSync(p, JSON.stringify({ allowPrivateNetwork: 'true', engines: {} }));
    expect(loadConfigFile(p).allowPrivateNetwork).toBe(true);
  });

  it('renders the top-level allowPrivateNetwork with its source', () => {
    expect(
      JSON.parse(renderEffectiveConfig({ allowPrivateNetwork: true }, {})).allowPrivateNetwork,
    ).toBe('true (file)');
    expect(JSON.parse(renderEffectiveConfig({}, {})).allowPrivateNetwork).toBe('false (default)');
  });

  it('lets env vars override the file', () => {
    const config = { engines: { tavily: { apiKey: 'from-file' } } };
    expect(
      engineSettings('tavily', config, { TAVILY_API_KEY: 'from-env' } as NodeJS.ProcessEnv).apiKey,
    ).toBe('from-env');
    expect(engineSettings('tavily', config, {} as NodeJS.ProcessEnv).apiKey).toBe('from-file');
  });

  it('stores, env-overrides, validates, and unsets an engine baseURL', () => {
    const p = tempConfigPath();
    setConfigValue('tavily.baseURL', 'https://gw.example.com/tavily/', p);
    expect(loadConfigFile(p).engines?.tavily?.baseURL).toBe('https://gw.example.com/tavily/');

    const config = loadConfigFile(p);
    expect(
      engineSettings('tavily', config, {
        TAVILY_BASE_URL: 'https://env.example.com',
      } as NodeJS.ProcessEnv).baseURL,
    ).toBe('https://env.example.com');

    // Not a URL: refused at write time, not as a fetch failure at search time.
    expect(() => setConfigValue('exa.baseURL', 'api.example.com', p)).toThrow(/full http\(s\) URL/);

    // Empty unsets the override, back to the official endpoint.
    setConfigValue('tavily.baseURL', '', p);
    expect(loadConfigFile(p).engines?.tavily?.baseURL).toBeUndefined();
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

  it('masks api keys when rendering the effective config', () => {
    const rendered = renderEffectiveConfig(
      { engines: { tavily: { apiKey: 'tvly-abcdefghijklmnop' } } },
      {} as NodeJS.ProcessEnv,
    );
    expect(rendered).not.toContain('abcdefghijklmnop');
    expect(rendered).toContain('tvly-a...op');
    expect(rendered).toContain('(file)');
  });

  it('merges env vars into the effective config and tags their source', () => {
    // No key in the file, one in the environment: the env value shows up, is
    // masked, and is tagged env so a reader knows where it came from.
    const rendered = renderEffectiveConfig({}, {
      TAVILY_API_KEY: 'tvly-envkey1234567',
    } as NodeJS.ProcessEnv);
    const parsed = JSON.parse(rendered);
    expect(parsed.engines.tavily.apiKey).toMatch(/\(env\)$/);
    expect(parsed.engines.tavily.apiKey).not.toContain('envkey1234567');
    expect(parsed.engine).toBe('(unset: automatic)');
  });

  it('lets an env key override the file key, keeping the env tag', () => {
    const rendered = renderEffectiveConfig(
      { engines: { tavily: { apiKey: 'tvly-fromfile12345' } } },
      {
        TAVILY_API_KEY: 'tvly-fromenv123456',
      } as NodeJS.ProcessEnv,
    );
    const parsed = JSON.parse(rendered);
    expect(parsed.engines.tavily.apiKey).toMatch(/\(env\)$/);
    expect(parsed.engines.tavily.apiKey).not.toContain('fromfile');
    expect(parsed.engines.tavily.apiKey).not.toContain('fromenv123456');
  });

  it('normalizes alias engine keys to their canonical name', () => {
    const rendered = renderEffectiveConfig(
      {
        engine: 'agy',
        engines: { agy: { bin: '/opt/agy' }, grok: { bin: '/opt/grok' }, direct: { model: 'm' } },
      },
      {} as NodeJS.ProcessEnv,
    );
    const parsed = JSON.parse(rendered);
    expect(Object.keys(parsed.engines).sort()).toEqual(['antigravity-cli', 'grok-cli', 'local']);
    expect(parsed.engines['antigravity-cli'].bin).toBe('/opt/agy (file)');
    expect(parsed.engines['grok-cli'].bin).toBe('/opt/grok (file)');
    expect(parsed.engines.local.model).toBe('m (file)');
    expect(parsed.engine).toBe('agy (file)');
  });
});
