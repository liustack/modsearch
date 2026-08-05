import { afterAll, describe, expect, it } from 'vitest';
import {
  BARE_ENV as BARE,
  cleanupTempDirs,
  withTempHome,
  envWithBinaries,
  withSignedInGrok,
} from './testing/helpers.ts';
import type { ModsearchConfig } from './config.ts';
import { defaultSources, isXQuery, parseSources, planRole, planRun, X_DEGRADE_NOTE } from './router.ts';

const WITH_AGY = envWithBinaries('agy');

/** agy plus a signed-in grok, since grok availability also checks ~/.grok. */
function envWithGrok(): { env: NodeJS.ProcessEnv; restoreHome: () => void } {
  const { env, restore } = withSignedInGrok();
  return { env, restoreHome: restore };
}

afterAll(cleanupTempDirs);

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

  it('honors the engine chosen in the config file', () => {
    const pinned = config({ engine: 'tavily', engines: { tavily: { apiKey: 'k' } } });
    expect(names(planRole('search', pinned, undefined, WITH_AGY).chain)[0]).toBe('tavily');
    // --engine still wins over the file
    expect(names(planRole('search', pinned, 'antigravity-cli', WITH_AGY).chain)[0]).toBe(
      'antigravity-cli',
    );
  });
});

describe('run plans', () => {
  it('keeps web and x separate when both are asked for and X is reachable', () => {
    const { env, restoreHome } = envWithGrok();
    try {
      const plans = planRun({
        mode: 'search',
        query: 'anything',
        config: config(),
        requestedSources: ['web', 'x'],
        env,
      });
      expect(plans.map((plan) => plan.source)).toEqual(['web', 'x']);
      expect(plans[0].engine.name).toBe('antigravity-cli');
      expect(plans[1].engine.name).toBe('grok-cli');
    } finally {
      restoreHome();
    }
  });

  it('does not search the web twice when x degrades into it', () => {
    // Both sources asked for, no grok: the web entry already covers the ground,
    // so a second identical query would just bill the same quota again.
    const plans = planRun({
      mode: 'search',
      query: 'anything',
      config: config(),
      requestedSources: ['web', 'x'],
      env: WITH_AGY,
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].source).toBe('web');
    expect(plans[0].notes).toContain(X_DEGRADE_NOTE);
  });

  it('carries the degrade note on the plan so a mid-run grok failure is flagged', () => {
    const { env, restoreHome } = envWithGrok();
    try {
      const [plan] = planRun({ mode: 'search', query: '推特上怎么说', config: config(), env });
      expect(plan.engine.name).toBe('grok-cli');
      expect(plan.degradeNote).toBe(X_DEGRADE_NOTE);
      expect(plan.fallbacks.length).toBeGreaterThan(0);
    } finally {
      restoreHome();
    }
  });

  it('degrades an X request to the web with an honest note when grok is missing', () => {
    // An empty HOME, so a real ~/.grok on the dev machine cannot make this pass.
    const { restore } = withTempHome();
    const [plan] = planRun({
      mode: 'search',
      query: '推特上怎么说',
      config: config(),
      env: WITH_AGY,
    });
    restore();
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

describe('fetch follows the chosen engine without being configured', () => {
  it('uses the search engine for fetching when that engine can fetch', () => {
    const chain = planRole('fetch', config({ engine: 'antigravity-cli' }), undefined, WITH_AGY);
    expect(names(chain.chain)).toEqual(['antigravity-cli', 'http']);
    expect(chain.notes).toEqual([]);
  });

  it('falls to the local fetcher when the search engine cannot fetch', () => {
    // Choosing Tavily is a normal setup, not a mistake, so it earns no warning.
    const chain = planRole('fetch', config({ engine: 'tavily' }), undefined, WITH_AGY);
    expect(names(chain.chain)).toEqual(['antigravity-cli', 'http']);
    expect(chain.notes).toEqual([]);
  });

  it('still fetches with nothing installed at all', () => {
    expect(names(planRole('fetch', config({ engine: 'tavily' }), undefined, BARE).chain)).toEqual([
      'http',
    ]);
  });

  it('complains only when --engine explicitly names something that cannot fetch', () => {
    const chain = planRole('fetch', config(), 'tavily', BARE);
    expect(names(chain.chain)).toEqual(['http']);
    expect(chain.notes[0]).toContain('cannot do fetch');
  });
});
