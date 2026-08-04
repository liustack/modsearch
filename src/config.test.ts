import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  initConfigFile,
  loadConfigFile,
  renderConfig,
  resolveProviderSettings,
  setConfigValue,
} from './config.ts';

function tempConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-config-'));
  return path.join(dir, 'config.json');
}

describe('config file', () => {
  it('returns an empty config when the file is missing', () => {
    expect(loadConfigFile(tempConfigPath())).toEqual({});
  });

  it('throws a fix-or-delete error on unparseable JSON', () => {
    const p = tempConfigPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '{broken');
    expect(() => loadConfigFile(p)).toThrow('Fix or delete the file');
  });

  it('sets dotted keys with 0600 perms and round-trips', () => {
    const p = tempConfigPath();
    setConfigValue('provider', 'playwright', p);
    setConfigValue('tavily.apiKey', 'tvly-secret-123456', p);
    setConfigValue('grok-cli.bin', '/opt/grok', p);
    setConfigValue('playwright.headless', 'false', p);

    const config = loadConfigFile(p);
    expect(config.provider).toBe('playwright');
    expect(config.providers?.tavily?.apiKey).toBe('tvly-secret-123456');
    expect(config.providers?.['grok-cli']?.bin).toBe('/opt/grok');
    expect(config.providers?.playwright?.headless).toBe('false');
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
  });

  it('rejects unknown fields and malformed keys', () => {
    const p = tempConfigPath();
    expect(() => setConfigValue('tavily.password', 'x', p)).toThrow('Unknown config field');
    expect(() => setConfigValue('noDotHere', 'x', p)).toThrow('Invalid config key');
  });

  it('init writes a template and refuses to overwrite without force', () => {
    const p = tempConfigPath();
    initConfigFile(p);
    expect(loadConfigFile(p).providers?.['antigravity-cli']?.bin).toBe('agy');
    expect(() => initConfigFile(p)).toThrow('already exists');
    initConfigFile(p, true);
  });

  it('lets env vars override the file for bound fields', () => {
    const config = { providers: { tavily: { apiKey: 'from-file' } } };
    const settings = resolveProviderSettings('tavily', config, {
      TAVILY_API_KEY: 'from-env',
    } as NodeJS.ProcessEnv);
    expect(settings.apiKey).toBe('from-env');
    const noEnv = resolveProviderSettings('tavily', config, {} as NodeJS.ProcessEnv);
    expect(noEnv.apiKey).toBe('from-file');
  });

  it('masks api keys when rendering', () => {
    const rendered = renderConfig({
      providers: { tavily: { apiKey: 'tvly-abcdefghijklmnop' } },
    });
    expect(rendered).not.toContain('abcdefghijklmnop');
    expect(rendered).toContain('tvly-a...op');
  });
});
