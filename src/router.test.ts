import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ModsearchConfig } from './config.ts';
import { defaultSources, isXQuery, parseSources, planRole, planRun, X_DEGRADE_NOTE } from './router.ts';

/** Nothing installed, no keys: the bare machine every new user starts on. */
const BARE: NodeJS.ProcessEnv = { PATH: '/nonexistent' };

/** A PATH holding fake binaries, so tests never depend on this machine. */
function envWith(...binaries: string[]): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-bin-'));
  for (const name of binaries) {
    fs.writeFileSync(path.join(dir, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  tempDirs.push(dir);
  return { PATH: dir };
}

// Cleaned once at the end: WITH_AGY is built at module load and shared, so a
// per-test cleanup would delete it out from under the later tests.
const tempDirs: string[] = [];
afterAll(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

const WITH_AGY = envWith('agy');
const names = (engines: Array<{ name: string }>) => engines.map((engine) => engine.name);

function config(overrides: ModsearchConfig = {}): ModsearchConfig {
  return overrides;
}

describe('isXQuery', () => {
  it.each([
    'DeepSeek V4 Flash 在推特上的评价',
    'what are people saying about deepseek on twitter',
    'latest tweets about grok build',
    'reactions on X to the launch',
    '在 X 上搜一下 DeepSeek',
  ])('matches %s', (query) => expect(isXQuery(query)).toBe(true));

  it.each(['current Node.js LTS version', '在 OS X 上安装 node', 'xcode build failing', ''])(
    'leaves %s alone',
    (query) => expect(isXQuery(query)).toBe(false),
  );
});

describe('source selection', () => {
  it('sends X-flavored questions to X alone, sparing web quota', () => {
    expect(defaultSources('推特上怎么说')).toEqual(['x']);
    expect(defaultSources('node lts version')).toEqual(['web']);
  });

  it('parses explicit source lists and rejects nonsense', () => {
    expect(parseSources('web,x')).toEqual(['web', 'x']);
    expect(parseSources(' X ')).toEqual(['x']);
    expect(parseSources('web,web')).toEqual(['web']);
    expect(() => parseSources('bing')).toThrow('Unknown source');
    expect(() => parseSources(' ')).toThrow('No sources given');
  });
});

describe('engine chains per role', () => {
  it('prefers agy for search and adds tavily when a key exists', () => {
    const withKey = config({ engines: { tavily: { apiKey: 'k' } } });
    expect(names(planRole('search', withKey, undefined, WITH_AGY).chain)).toEqual([
      'antigravity-cli',
      'tavily',
    ]);
  });

  it('leaves the search chain empty on a bare machine', () => {
    expect(planRole('search', config(), undefined, BARE).chain).toEqual([]);
  });

  it('always ends page fetch at the local http engine', () => {
    // Bare machine, wrong engine name, engine that cannot fetch: still fetches.
    expect(names(planRole('fetch', config(), undefined, BARE).chain)).toEqual(['http']);
    expect(names(planRole('fetch', config(), 'nonsense', BARE).chain)).toEqual(['http']);
    expect(names(planRole('fetch', config(), 'tavily', BARE).chain)).toEqual(['http']);
    expect(names(planRole('fetch', config(), undefined, WITH_AGY).chain)).toEqual([
      'antigravity-cli',
      'http',
    ]);
  });

  it('explains a misconfigured engine instead of failing silently', () => {
    expect(planRole('fetch', config(), 'nonsense', BARE).notes[0]).toContain('Unknown engine');
    expect(planRole('fetch', config(), 'tavily', BARE).notes[0]).toContain('cannot do fetch');
    expect(planRole('fetch', config(), undefined, BARE).notes).toEqual([]);
  });

  it('honors a role engine pinned in the config file', () => {
    const pinned = config({
      search: { engine: 'tavily' },
      engines: { tavily: { apiKey: 'k' } },
    });
    expect(names(planRole('search', pinned, undefined, WITH_AGY).chain)[0]).toBe('tavily');
    // --engine still wins over the file
    expect(names(planRole('search', pinned, 'antigravity-cli', WITH_AGY).chain)[0]).toBe(
      'antigravity-cli',
    );
  });
});

describe('run plans', () => {
  it('keeps web and x separate when both are asked for', () => {
    const plans = planRun({
      mode: 'search',
      query: 'anything',
      config: config({ engines: { tavily: { apiKey: 'k' } } }),
      requestedSources: ['web', 'x'],
      env: WITH_AGY,
    });
    expect(plans.map((plan) => plan.source)).toEqual(['web', 'x']);
    expect(plans[0].engine.name).toBe('antigravity-cli');
  });

  it('degrades an X request to the web with an honest note when grok is missing', () => {
    // Fake HOME so a real ~/.grok on the dev machine cannot make this pass.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-home-'));
    const realHome = process.env.HOME;
    process.env.HOME = home;
    tempDirs.push(home);
    const [plan] = planRun({
      mode: 'search',
      query: '推特上怎么说',
      config: config(),
      env: WITH_AGY,
    });
    process.env.HOME = realHome;
    expect(plan.source).toBe('x');
    expect(plan.engine.name).toBe('antigravity-cli');
    expect(plan.notes).toContain(X_DEGRADE_NOTE);
  });

  it('fetch mode ignores sources and always plans a fetch chain', () => {
    const [plan] = planRun({ mode: 'fetch', config: config(), env: BARE });
    expect(plan.engine.name).toBe('http');
    expect(plan.source).toBe('web');
  });
});
