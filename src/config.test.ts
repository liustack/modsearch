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

  it('rejects an unknown engine name instead of storing an unreachable setting', () => {
    // The file is read back by canonical lowercase key: a typo'd name would be
    // saved, reported saved, and never read again.
    const p = tempConfigPath();
    expect(() => setConfigValue('tavly.apiKey', 'k', p)).toThrow(/Unknown engine: tavly.*tavily/s);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('folds alias engine names to canonical on write', () => {
    const p = tempConfigPath();
    setConfigValue('agy.bin', '/opt/agy', p);
    expect(loadConfigFile(p).engines?.['antigravity-cli']?.bin).toBe('/opt/agy');
  });

  it('refuses prototype-chain engine names and pollutes nothing', () => {
    // "constructor" used to resolve through the alias table's prototype chain
    // to Object's constructor: the write printed success and saved nothing,
    // and "__proto__" polluted Object.prototype for the whole process.
    const p = tempConfigPath();
    expect(() => setConfigValue('constructor.apiKey', 'sk-secret-12345678', p)).toThrow(
      'Unknown engine',
    );
    expect(() => setConfigValue('__proto__.apiKey', 'sk-secret-12345678', p)).toThrow(
      'Unknown engine',
    );
    expect(({} as Record<string, unknown>).apiKey).toBeUndefined();
    expect(fs.existsSync(p)).toBe(false);
  });

  it('config show is safe to paste: no known key survives anywhere in the view', () => {
    const p = tempConfigPath();
    const key = 'tvly-SECRETKEY1234567890';
    setConfigValue('tavily.apiKey', key, p);
    setConfigValue('tavily.model', `note ${key} in a model field`, p);
    setConfigValue('tavily.baseURL', `https://user:hunter2@gw.example.com/${key}`, p);
    const view = renderEffectiveConfig(loadConfigFile(p), {} as NodeJS.ProcessEnv);
    expect(view).not.toContain(key);
    expect(view).not.toContain('hunter2');
    // Masked, not deleted: the view still says which key and which host.
    expect(view).toContain('tvly-S...90');
    expect(view).toContain('gw.example.com');
    expect(() => JSON.parse(view)).not.toThrow();
  });

  it('scrubs an environment key that was pasted into a file field', () => {
    const p = tempConfigPath();
    setConfigValue('exa.model', 'copied exa-env-key-123456 here', p);
    const view = renderEffectiveConfig(loadConfigFile(p), {
      EXA_API_KEY: 'exa-env-key-123456',
    } as NodeJS.ProcessEnv);
    expect(view).not.toContain('exa-env-key-123456');
  });

  it('scrubs even a two-character key from every string of the view', () => {
    // No length assumption: a short key shreds readability, and that is the
    // right failure for an output whose contract is being safe to paste.
    const p = tempConfigPath();
    setConfigValue('exa.apiKey', 'k2', p);
    setConfigValue('exa.model', 'prefix k2 suffix', p);
    const view = renderEffectiveConfig(loadConfigFile(p), {} as NodeJS.ProcessEnv);
    expect(JSON.stringify(JSON.parse(view))).not.toContain('k2');
  });

  it('never uses an unknown engine name as a property name in the view', () => {
    // A hand-written engine name is user data, and a name can BE a key.
    const p = tempConfigPath();
    const secretName = 'tvly-NAMEISAKEY123456';
    fs.writeFileSync(p, JSON.stringify({ engines: { [secretName]: { model: 'x' } } }));
    const view = renderEffectiveConfig(loadConfigFile(p), {} as NodeJS.ProcessEnv);
    const parsed = JSON.parse(view) as { engines: Record<string, unknown>; notes?: string[] };
    expect(Object.keys(parsed.engines)).not.toContain(secretName);
    expect(view).not.toContain(secretName);
    expect(parsed.notes?.join(' ')).toContain('unknown engine entry');
  });

  it('keeps the view valid JSON when a key collides with JSON syntax', () => {
    const p = tempConfigPath();
    setConfigValue('exa.apiKey', '"engines"', p);
    const view = renderEffectiveConfig(loadConfigFile(p), {} as NodeJS.ProcessEnv);
    expect(() => JSON.parse(view)).not.toThrow();
  });

  it('keeps a hand-written __proto__ entry as data, never as the prototype', () => {
    // On a normal object literal, engines["__proto__"] = {...} sets the
    // prototype: the entry hides from Object.entries and JSON.stringify while
    // dot-access still sees it, so doctor reported an inherited key as present
    // and the next write silently dropped it.
    const raw = JSON.parse('{"engines": {"__proto__": {"apiKey": "sk-hidden-key-123456"}}}');
    const migrated = migrateLegacyConfig(raw);
    // Nothing is inherited: an arbitrary engine lookup finds no smuggled key.
    expect((migrated.engines as Record<string, { apiKey?: string }>).firecrawl?.apiKey)
      .toBeUndefined();
    expect(Object.getPrototypeOf(migrated.engines)).toBeNull();
    // The entry is ordinary visible data, judged like any unknown engine.
    expect(Object.keys(migrated.engines ?? {})).toContain('__proto__');
    expect(JSON.stringify(migrated)).toContain('sk-hidden-key-123456');
  });

  it('survives a hand-written file with non-object engine entries', () => {
    const p = tempConfigPath();
    fs.writeFileSync(
      p,
      JSON.stringify({ engines: { tavily: 'not-an-object', exa: { apiKey: 'k' } } }),
    );
    const config = loadConfigFile(p);
    expect(config.engines?.tavily).toBeUndefined();
    expect(config.engines?.exa?.apiKey).toBe('k');
    expect(engineSettings('tavily', config, {} as NodeJS.ProcessEnv)).toEqual({});
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

  it('sets keyless Firecrawl fetch as an explicit boolean opt-in', () => {
    const p = tempConfigPath();
    setConfigValue('firecrawl.keylessFetch', 'true', p);
    expect(loadConfigFile(p).engines?.firecrawl?.keylessFetch).toBe(true);
    setConfigValue('firecrawl.keylessFetch', 'false', p);
    const config = loadConfigFile(p);
    expect(config.engines?.firecrawl?.keylessFetch).toBe(false);
    expect(JSON.parse(renderEffectiveConfig(config, {})).engines.firecrawl.keylessFetch).toBe(
      'false (file)',
    );
    expect(() => setConfigValue('firecrawl.keylessFetch', 'maybe', p)).toThrow(
      'Use true or false',
    );
  });

  it('coerces hand-written keylessFetch strings before routing reads them', () => {
    const p = tempConfigPath();
    fs.writeFileSync(
      p,
      JSON.stringify({ engines: { firecrawl: { keylessFetch: 'false' } } }),
    );
    expect(loadConfigFile(p).engines?.firecrawl?.keylessFetch).toBe(false);

    fs.writeFileSync(p, JSON.stringify({ engines: { firecrawl: { keylessFetch: 'true' } } }));
    expect(loadConfigFile(p).engines?.firecrawl?.keylessFetch).toBe(true);
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
