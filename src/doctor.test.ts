import * as fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDoctorReport, MIN_NODE, runDoctor } from './doctor.ts';
import {
  BARE_ENV,
  cleanupTempDirs,
  envWithBinaries,
  tempConfigPath,
  withSignedInGrok,
  withTempHome,
} from './testing/helpers.ts';

/** The diagnosis for one role, by name. */
function role(report: ReturnType<typeof runDoctor>, name: string) {
  return report.roles.find((r) => r.role === name);
}

/** The diagnosis for one engine within a role. */
function engine(report: ReturnType<typeof runDoctor>, roleName: string, engineName: string) {
  return role(report, roleName)?.candidates.find((c) => c.engine === engineName);
}

describe('doctor: Node version', () => {
  afterEach(() => cleanupTempDirs());

  it('accepts the floor and anything newer', () => {
    const ok = runDoctor({ config: {}, env: BARE_ENV, nodeVersion: MIN_NODE });
    expect(ok.node.ok).toBe(true);
    expect(ok.node.fix).toBeUndefined();
  });

  it('flags an older Node with a fix', () => {
    const old = runDoctor({ config: {}, env: BARE_ENV, nodeVersion: '20.10.0' });
    expect(old.node.ok).toBe(false);
    expect(old.node.fix).toContain(MIN_NODE);
  });
});

describe('doctor: search engines', () => {
  afterEach(() => cleanupTempDirs());

  it('reports agy ready when its binary is on PATH', () => {
    const report = runDoctor({ config: {}, env: envWithBinaries('agy') });
    const agy = engine(report, 'search', 'antigravity-cli');
    expect(agy?.ready).toBe(true);
    expect(role(report, 'search')?.resolved).toBe('antigravity-cli');
  });

  it('reports tavily ready from an env key and tags the source', () => {
    const report = runDoctor({
      config: {},
      env: { PATH: '/nonexistent', TAVILY_API_KEY: 'k' } as NodeJS.ProcessEnv,
    });
    const tavily = engine(report, 'search', 'tavily');
    expect(tavily?.ready).toBe(true);
    expect(tavily?.keySource).toBe('env');
  });

  it('reports exa ready from an env key and tags the source', () => {
    const report = runDoctor({
      config: {},
      env: { PATH: '/nonexistent', EXA_API_KEY: 'k' } as NodeJS.ProcessEnv,
    });
    const exa = engine(report, 'search', 'exa');
    expect(exa?.ready).toBe(true);
    expect(exa?.keySource).toBe('env');
  });

  it('gives a copyable fix for a missing key and missing agy', () => {
    const report = runDoctor({ config: {}, env: BARE_ENV });
    expect(role(report, 'search')?.resolved).toBeNull();
    expect(engine(report, 'search', 'tavily')?.fix).toContain('modsearch config set tavily.apiKey');
    expect(engine(report, 'search', 'exa')?.fix).toContain('modsearch config set exa.apiKey');
    expect(engine(report, 'search', 'antigravity-cli')?.fix).toContain('antigravity.google');
  });
});

describe('doctor: fetch and X', () => {
  afterEach(() => cleanupTempDirs());

  it('always resolves fetch to the built-in http engine', () => {
    const report = runDoctor({ config: {}, env: BARE_ENV });
    expect(engine(report, 'fetch', 'http')?.ready).toBe(true);
    expect(role(report, 'fetch')?.resolved).toBe('http');
  });

  it('reports grok not ready when the login file is missing', () => {
    const { restore } = withTempHome();
    try {
      const report = runDoctor({ config: {}, env: envWithBinaries('grok') });
      const grok = engine(report, 'social', 'grok-cli');
      expect(grok?.ready).toBe(false);
      expect(grok?.reason).toContain('login file');
      expect(grok?.reason).toContain('missing');
    } finally {
      restore();
    }
  });

  it('reports grok ready when signed in with the binary present', () => {
    const { env, restore } = withSignedInGrok();
    try {
      const report = runDoctor({ config: {}, env });
      expect(engine(report, 'social', 'grok-cli')?.ready).toBe(true);
      expect(role(report, 'social')?.resolved).toBe('grok-cli');
    } finally {
      restore();
    }
  });
});

describe('doctor: config layer', () => {
  afterEach(() => cleanupTempDirs());

  it('reports the configured engine and its origin', () => {
    const report = runDoctor({ config: { engine: 'tavily' }, env: BARE_ENV });
    expect(report.engineChoice.value).toBe('tavily');
    expect(report.engineChoice.source).toBe('file');
  });

  it('marks an unknown configured engine as a problem', () => {
    const report = runDoctor({ config: { engine: 'bing' }, env: BARE_ENV });
    expect(report.engineChoice.problem).toContain('not a known engine');
  });

  it('reports automatic selection when nothing is configured', () => {
    const report = runDoctor({ config: {}, env: BARE_ENV });
    expect(report.engineChoice.value).toBeNull();
    expect(report.engineChoice.source).toBe('default');
  });

  it('reports allowPrivateNetwork when set in the file', () => {
    const on = runDoctor({
      config: { engines: { http: { allowPrivateNetwork: 'true' } } },
      env: BARE_ENV,
    });
    expect(on.allowPrivateNetwork.enabled).toBe(true);
    expect(on.allowPrivateNetwork.source).toBe('file');

    const off = runDoctor({ config: {}, env: BARE_ENV });
    expect(off.allowPrivateNetwork.enabled).toBe(false);
  });
});

describe('doctor: config file', () => {
  afterEach(() => cleanupTempDirs());

  it('reports a missing file as running on defaults', () => {
    const report = runDoctor({ env: BARE_ENV, configPath: tempConfigPath() });
    expect(report.configFile.exists).toBe(false);
  });

  it('reports an existing file with its permission mode', () => {
    const p = tempConfigPath();
    fs.writeFileSync(p, JSON.stringify({ engine: 'tavily' }), { mode: 0o600 });
    fs.chmodSync(p, 0o600);
    const report = runDoctor({ env: BARE_ENV, configPath: p });
    expect(report.configFile.exists).toBe(true);
    expect(report.configFile.mode).toBe('600');
    expect(report.engineChoice.value).toBe('tavily');
  });

  it('names a broken config file instead of aborting the diagnosis', () => {
    const p = tempConfigPath();
    fs.writeFileSync(p, '{broken');
    const report = runDoctor({ env: BARE_ENV, configPath: p });
    expect(report.configFile.problem).toBeTruthy();
    // The rest of the report still populates.
    expect(report.roles).toHaveLength(3);
  });
});

describe('doctor: rendering', () => {
  afterEach(() => cleanupTempDirs());

  it('renders a readable text report covering every section', () => {
    const text = formatDoctorReport(runDoctor({ config: {}, env: BARE_ENV }));
    expect(text).toContain('Node');
    expect(text).toContain('search (search the web)');
    expect(text).toContain('fetch (fetch a page)');
    expect(text).toContain('social (search X)');
    expect(text).toContain('allowPrivateNetwork');
  });
});
