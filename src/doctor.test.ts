import * as fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import { formatDoctorReport, MIN_NODE, runDoctor } from './doctor.ts';
import {
  BARE_ENV,
  cleanupTempDirs,
  envWithBinaries,
  IS_WINDOWS,
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

  it('reports firecrawl ready from an env key for both search and fetch', () => {
    const report = runDoctor({
      config: {},
      env: { PATH: '/nonexistent', FIRECRAWL_API_KEY: 'k' } as NodeJS.ProcessEnv,
    });
    expect(engine(report, 'search', 'firecrawl')?.ready).toBe(true);
    expect(engine(report, 'fetch', 'firecrawl')?.ready).toBe(true);
  });

  it('gives a copyable fix for a missing key and missing agy', () => {
    const report = runDoctor({ config: {}, env: BARE_ENV });
    // Keyless firecrawl means search always resolves, even on a bare machine.
    expect(role(report, 'search')?.resolved).toBe('firecrawl');
    const fc = engine(report, 'search', 'firecrawl');
    expect(fc?.ready).toBe(true);
    expect(fc?.reason).toMatch(/keyless/i);
    expect(engine(report, 'search', 'tavily')?.fix).toContain('modsearch config set tavily.apiKey');
    expect(engine(report, 'search', 'exa')?.fix).toContain('modsearch config set exa.apiKey');
    expect(engine(report, 'search', 'antigravity-cli')?.fix).toContain('antigravity.google');
  });
});

describe('doctor: fetch and X', () => {
  afterEach(() => cleanupTempDirs());

  it('always resolves fetch to the built-in local engine', () => {
    const report = runDoctor({ config: {}, env: BARE_ENV });
    expect(engine(report, 'fetch', 'local')?.ready).toBe(true);
    expect(role(report, 'fetch')?.resolved).toBe('local');
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

  it('reports the top-level allowPrivateNetwork when set in the file', () => {
    const on = runDoctor({ config: { allowPrivateNetwork: true }, env: BARE_ENV });
    expect(on.allowPrivateNetwork.enabled).toBe(true);
    expect(on.allowPrivateNetwork.source).toBe('file');

    const off = runDoctor({ config: {}, env: BARE_ENV });
    expect(off.allowPrivateNetwork.enabled).toBe(false);
    expect(off.allowPrivateNetwork.source).toBe('default');
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
    if (!IS_WINDOWS) {
      fs.chmodSync(p, 0o600);
    }
    const report = runDoctor({ env: BARE_ENV, configPath: p });
    expect(report.configFile.exists).toBe(true);
    // POSIX permission bits only: Windows reports an ACL-derived mode, not 600.
    if (!IS_WINDOWS) {
      expect(report.configFile.mode).toBe('600');
    }
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
    const text = formatDoctorReport(
      runDoctor({ config: {}, env: BARE_ENV, statePath: tempConfigPath() }),
    );
    expect(text).toContain('Node');
    expect(text).toContain('search (search the web)');
    expect(text).toContain('fetch (fetch a page)');
    expect(text).toContain('social (search X)');
    expect(text).toContain('allowPrivateNetwork');
    expect(text).toContain('Cooldown');
  });
});

describe('doctor: cooldown', () => {
  afterEach(() => cleanupTempDirs());

  const now = new Date('2026-08-06T00:00:00.000Z');

  it('reports the switch off and consults no state when cooldown is disabled', () => {
    const report = runDoctor({
      config: { cooldown: 'off' },
      env: BARE_ENV,
      statePath: tempConfigPath(),
      now,
    });
    expect(report.cooldown.enabled).toBe(false);
    expect(report.cooldown.engines).toEqual([]);
    expect(formatDoctorReport(report)).toContain('switch: off');
  });

  it('lists a cooling engine with its remaining time', () => {
    const p = tempConfigPath();
    const until = new Date(now.getTime() + 90 * 60_000).toISOString();
    fs.writeFileSync(
      p,
      JSON.stringify({
        engineCooldowns: { exa: { until, reason: 'out of credits', observedAt: now.toISOString() } },
      }),
    );
    const report = runDoctor({ config: {}, env: BARE_ENV, statePath: p, now });
    expect(report.cooldown.enabled).toBe(true);
    expect(report.cooldown.engines).toHaveLength(1);
    expect(report.cooldown.engines[0]).toMatchObject({ engine: 'exa', remaining: '1h 30m' });
    expect(formatDoctorReport(report)).toContain('cooling, 1h 30m left');
  });

  it('omits an already-expired cooldown from the active list', () => {
    const p = tempConfigPath();
    const until = new Date(now.getTime() - 60_000).toISOString();
    fs.writeFileSync(
      p,
      JSON.stringify({
        engineCooldowns: { exa: { until, reason: 'x', observedAt: now.toISOString() } },
      }),
    );
    const report = runDoctor({ config: {}, env: BARE_ENV, statePath: p, now });
    expect(report.cooldown.engines).toEqual([]);
  });
});
