import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProjectConfig,
  chosenEngine,
  describeIgnoredProjectFields,
  engineChoiceIsConsent,
  engineSettings,
  findProjectConfigPath,
  loadEffectiveConfig,
  loadProjectConfig,
  type ModsearchConfig,
  renderEffectiveConfig,
} from './config.ts';
import { formatDoctorReport, runDoctor } from './doctor.ts';
import { planRole } from './router.ts';
import { BARE_ENV, cleanupTempDirs, tempDir } from './testing/helpers.ts';

/** A home with a global config, and a project two levels deep inside it. */
function layout(projectFile?: unknown, globalFile?: ModsearchConfig) {
  const home = tempDir();
  const globalPath = path.join(home, '.modsearch', 'config.json');
  fs.mkdirSync(path.dirname(globalPath), { recursive: true });
  fs.writeFileSync(globalPath, JSON.stringify(globalFile ?? {}));
  const project = path.join(home, 'work', 'app');
  const nested = path.join(project, 'src', 'deep');
  fs.mkdirSync(nested, { recursive: true });
  const projectPath = path.join(project, '.modsearch', 'config.json');
  if (projectFile !== undefined) {
    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.writeFileSync(
      projectPath,
      typeof projectFile === 'string' ? projectFile : JSON.stringify(projectFile),
    );
  }
  return { home, globalPath, project, nested, projectPath };
}

const names = (chain: Array<{ name: string }>) => chain.map((engine) => engine.name);

describe('project config lookup', () => {
  afterEach(() => cleanupTempDirs());

  it('finds the nearest .modsearch/config.json walking up from cwd', () => {
    const { home, nested, projectPath } = layout({ engine: 'exa' });
    expect(findProjectConfigPath(nested, home)).toBe(projectPath);
  });

  it('never treats the global file in home as a project file', () => {
    const { home, nested } = layout();
    expect(findProjectConfigPath(nested, home)).toBeUndefined();
    expect(findProjectConfigPath(home, home)).toBeUndefined();
  });

  it('is skipped entirely with MODSEARCH_PROJECT_CONFIG=off', () => {
    const { home, nested, globalPath } = layout({ engine: 'exa' });
    const on = loadEffectiveConfig({ cwd: nested, home, configPath: globalPath, env: {} });
    expect(chosenEngine(on.config)).toBe('exa');
    const off = loadEffectiveConfig({
      cwd: nested,
      home,
      configPath: globalPath,
      env: { MODSEARCH_PROJECT_CONFIG: 'off' },
    });
    expect(off.project).toBeUndefined();
    expect(chosenEngine(off.config)).toBeUndefined();
  });

  it('fails loudly on a broken project file', () => {
    const { projectPath } = layout('{broken');
    expect(() => loadProjectConfig(projectPath)).toThrow(/project config.*Fix or delete/);
  });
});

describe('project config contents', () => {
  afterEach(() => cleanupTempDirs());

  it('keeps engine, enabled false, and model, and reports everything else', () => {
    const { projectPath } = layout({
      engine: 'exa',
      allowPrivateNetwork: true,
      cooldown: 'off',
      engines: {
        tavily: { enabled: false, apiKey: 'tvly-planted', baseURL: 'https://evil.example' },
        agy: { model: 'gemini-x', bin: '/tmp/evil' },
        keenable: { enabled: true, keylessFetch: true },
        nonsense: { enabled: false },
      },
    });
    const project = loadProjectConfig(projectPath);
    expect(project.engine).toBe('exa');
    expect({ ...project.engines }).toEqual({
      tavily: { enabled: false },
      'antigravity-cli': { model: 'gemini-x' },
    });
    expect(project.ignored).toEqual([
      'allowPrivateNetwork',
      'cooldown',
      'engines.tavily.apiKey',
      'engines.tavily.baseURL',
      'engines.agy.bin',
      'engines.keenable.enabled',
      'engines.keenable.keylessFetch',
      'engines.nonsense',
    ]);
    // The warning names paths only, never a value from the file.
    const warning = describeIgnoredProjectFields(project) ?? '';
    expect(warning).toContain('engines.tavily.apiKey');
    expect(warning).not.toContain('tvly-planted');
    expect(warning).not.toContain('evil');
  });

  it('narrows the global config and never widens it', () => {
    const global: ModsearchConfig = {
      engine: 'tavily',
      allowPrivateNetwork: false,
      engines: {
        tavily: { apiKey: 'tvly-mine' },
        firecrawl: { enabled: false },
      },
    };
    const { projectPath } = layout({
      engine: 'exa',
      engines: { firecrawl: { enabled: true }, keenable: { enabled: false } },
    });
    const merged = applyProjectConfig(global, loadProjectConfig(projectPath));
    expect(chosenEngine(merged)).toBe('exa');
    // The user's switch-off stands, and the project can add its own.
    expect(engineSettings('firecrawl', merged, {}).enabled).toBe(false);
    expect(engineSettings('keenable', merged, {}).enabled).toBe(false);
    // Keys come from the global file untouched.
    expect(engineSettings('tavily', merged, {}).apiKey).toBe('tvly-mine');
    // The global object is not mutated.
    expect(global.engine).toBe('tavily');
    expect(global.engines?.keenable).toBeUndefined();
  });
});

describe('project engine choice and cloud fetch consent', () => {
  afterEach(() => cleanupTempDirs());

  it('does not let a project opt the user into keyless cloud fetch', () => {
    const global: ModsearchConfig = {
      engines: { firecrawl: { keylessFetch: false }, keenable: { keylessFetch: false } },
    };
    // The user's own choice is consent.
    const own = planRole('fetch', { ...global, engine: 'keenable' }, undefined, BARE_ENV);
    expect(names(own.chain)).toEqual(['keenable', 'local']);

    const { projectPath } = layout({ engine: 'keenable' });
    const merged = applyProjectConfig(global, loadProjectConfig(projectPath));
    expect(engineChoiceIsConsent(merged)).toBe(false);
    const fromProject = planRole('fetch', merged, undefined, BARE_ENV);
    expect(names(fromProject.chain)).toEqual(['local']);
    expect(fromProject.notes[0]).toMatch(/project config prefers keenable/);
    // Search is unaffected: keyless search needs no consent.
    expect(names(planRole('search', merged, undefined, BARE_ENV).chain)[0]).toBe('keenable');
  });

  it('leads search with the project choice when that engine is ready', () => {
    const { projectPath } = layout({ engine: 'youcom' });
    const merged = applyProjectConfig({}, loadProjectConfig(projectPath));
    expect(names(planRole('search', merged, undefined, BARE_ENV).chain)[0]).toBe('youcom');
  });

  it('skips a project choice that is not set up here, with a note', () => {
    const { projectPath } = layout({ engine: 'tavily' });
    const merged = applyProjectConfig({}, loadProjectConfig(projectPath));
    const plan = planRole('search', merged, undefined, BARE_ENV);
    expect(names(plan.chain)).not.toContain('tavily');
    expect(plan.notes[0]).toMatch(/project config prefers tavily/);
  });
});

describe('project config in doctor and config show', () => {
  afterEach(() => cleanupTempDirs());

  it('doctor names the project file, its choice, and what it ignored', () => {
    const { nested, globalPath, projectPath } = layout(
      { engine: 'exa', engines: { tavily: { apiKey: 'x' } } },
      { engine: 'tavily' },
    );
    const report = runDoctor({ configPath: globalPath, cwd: nested, env: BARE_ENV });
    expect(report.projectConfig).toEqual({ path: projectPath, ignored: ['engines.tavily.apiKey'] });
    expect(report.engineChoice).toEqual({ value: 'exa', source: 'project' });
    const text = formatDoctorReport(report);
    expect(text).toContain(`project: ${projectPath}`);
    expect(text).toContain('exa (from project config)');
    expect(text).toContain('ignored engines.tavily.apiKey');
  });

  it('doctor reports a broken project file instead of throwing', () => {
    const { nested, globalPath } = layout('{broken');
    const report = runDoctor({ configPath: globalPath, cwd: nested, env: BARE_ENV });
    expect(report.projectConfig?.problem).toMatch(/Fix or delete/);
  });

  it('config show tags project values and lists ignored entries', () => {
    const { projectPath } = layout({
      engine: 'exa',
      engines: { keenable: { enabled: false }, agy: { model: 'm1' }, exa: { apiKey: 'exa-x' } },
    });
    const shown = JSON.parse(
      renderEffectiveConfig({ engine: 'tavily' }, {}, loadProjectConfig(projectPath)),
    );
    expect(shown.engine).toBe('exa (project)');
    expect(shown.engines.keenable.enabled).toBe('false (project)');
    expect(shown.engines['antigravity-cli'].model).toBe('m1 (project)');
    expect(shown.projectConfig).toBe(projectPath);
    expect(shown.notes.join(' ')).toContain('engines.exa.apiKey');
  });
});
