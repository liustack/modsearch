import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCooldownController,
  classifyQuota,
  clearAllCooldowns,
  clearEngineCooldown,
  coolingEntry,
  DEFAULT_COOLDOWN_MS,
  emptyCooldownState,
  isEngineCooling,
  loadCooldownState,
  MONTHLY_COOLDOWN_MS,
  parseResetDuration,
  recordQuotaCooldown,
} from './cooldown.ts';
import { agyQuotaEnvelope } from './fixtures/index.ts';
import { parseAntigravityOutput } from './providers/antigravity.ts';
import { cleanupTempDirs, expectPosixMode, tempDir } from './testing/helpers.ts';

afterEach(() => cleanupTempDirs());

const statePath = () => path.join(tempDir('modsearch-state-'), 'state.json');
const at = (iso: string) => new Date(iso);

describe('cooldown state file', () => {
  it('reads a missing file as empty state, never throwing', () => {
    expect(loadCooldownState(statePath())).toEqual(emptyCooldownState());
  });

  it('treats a corrupt state file as empty, silently', () => {
    const p = statePath();
    fs.writeFileSync(p, '{not json at all');
    expect(loadCooldownState(p)).toEqual({ engineCooldowns: {} });
  });

  it('drops malformed entries but keeps well-formed ones', () => {
    const p = statePath();
    fs.writeFileSync(
      p,
      JSON.stringify({
        engineCooldowns: {
          tavily: { until: '2999-01-01T00:00:00.000Z', reason: 'spent', observedAt: '2026-01-01T00:00:00.000Z' },
          broken: { reason: 'no until' },
          alsoBroken: 42,
        },
      }),
    );
    const state = loadCooldownState(p);
    expect(Object.keys(state.engineCooldowns)).toEqual(['tavily']);
  });

  it('folds a legacy engine key (http) onto its canonical name (local) on read', () => {
    const p = statePath();
    fs.writeFileSync(
      p,
      JSON.stringify({
        engineCooldowns: {
          http: { until: '2999-01-01T00:00:00.000Z', reason: 'x', observedAt: '2026-01-01T00:00:00.000Z' },
          tavily: { until: '2999-01-01T00:00:00.000Z', reason: 'y', observedAt: '2026-01-01T00:00:00.000Z' },
        },
      }),
    );
    const state = loadCooldownState(p);
    expect(Object.keys(state.engineCooldowns).sort()).toEqual(['local', 'tavily']);
  });

  it('writes 0600 and round-trips through a record', () => {
    const p = statePath();
    const state = emptyCooldownState();
    recordQuotaCooldown(state, 'exa', new Error('out of credits'), at('2026-08-06T00:00:00.000Z'), p);
    expectPosixMode(p, 0o600);
    const reloaded = loadCooldownState(p);
    expect(reloaded.engineCooldowns.exa.reason).toContain('out of credits');
  });
});

describe('parseResetDuration', () => {
  it('parses the agy full h/m/s form', () => {
    expect(parseResetDuration('Resets in 94h19m9s')).toBe((94 * 3600 + 19 * 60 + 9) * 1000);
  });

  it('parses partial forms', () => {
    expect(parseResetDuration('Resets in 45m')).toBe(45 * 60 * 1000);
    expect(parseResetDuration('resets in 2h')).toBe(2 * 3600 * 1000);
  });

  it('returns null when there is no reset clause', () => {
    expect(parseResetDuration('out of credits')).toBeNull();
  });
});

describe('classifyQuota', () => {
  const now = at('2026-08-06T00:00:00.000Z');

  it('parses a precise reset from the real agy quota envelope', () => {
    let thrown: unknown;
    try {
      parseAntigravityOutput(agyQuotaEnvelope());
    } catch (error) {
      thrown = error;
    }
    const until = classifyQuota(thrown, now);
    expect(until).not.toBeNull();
    expect((until as Date).getTime() - now.getTime()).toBe((94 * 3600 + 19 * 60 + 9) * 1000);
  });

  it('falls back to a 45-minute TTL for a quota error with no reset time', () => {
    const until = classifyQuota(new Error('exa is out of credits: insufficient balance'), now);
    expect((until as Date).getTime() - now.getTime()).toBe(DEFAULT_COOLDOWN_MS);
  });

  it.each([432, 433])('holds a Tavily monthly-cap %i for 24 hours, not 45 minutes', (status) => {
    const until = classifyQuota(new Error(`tavily is out of monthly quota (HTTP ${status}).`), now);
    expect((until as Date).getTime() - now.getTime()).toBe(MONTHLY_COOLDOWN_MS);
  });

  it('does not persist a per-second rate limit', () => {
    expect(classifyQuota(new Error('tavily returned 429 Too Many Requests: rate limit'), now)).toBeNull();
  });

  it('ignores errors that are not about quota', () => {
    expect(classifyQuota(new Error('firecrawl rejected the API key (401)'), now)).toBeNull();
    expect(classifyQuota(new Error('request timed out after 1000 ms'), now)).toBeNull();
  });
});

describe('cooling window', () => {
  it('is cooling while until is in the future and not once it passes', () => {
    const p = statePath();
    const state = emptyCooldownState();
    const now = at('2026-08-06T00:00:00.000Z');
    recordQuotaCooldown(state, 'tavily', new Error('out of credits'), now, p);

    // 45 minutes out: still cooling just before, recovered just after.
    expect(isEngineCooling(state, 'tavily', at('2026-08-06T00:30:00.000Z'))).toBe(true);
    expect(isEngineCooling(state, 'tavily', at('2026-08-06T01:00:00.001Z'))).toBe(false);
    expect(isEngineCooling(state, 'exa', now)).toBe(false);
    expect(coolingEntry(state, 'tavily', now)?.reason).toContain('out of credits');
  });
});

describe('recording and clearing', () => {
  const now = at('2026-08-06T00:00:00.000Z');

  it('records only quota errors, returning the entry, and skips others', () => {
    const p = statePath();
    const state = emptyCooldownState();
    expect(recordQuotaCooldown(state, 'exa', new Error('timed out'), now, p)).toBeNull();
    expect(fs.existsSync(p)).toBe(false);

    const entry = recordQuotaCooldown(state, 'exa', new Error('out of credits'), now, p);
    expect(entry).not.toBeNull();
    expect(entry?.observedAt).toBe(now.toISOString());
    expect(fs.existsSync(p)).toBe(true);
  });

  it('clears one engine and reports whether anything changed', () => {
    const p = statePath();
    const state = emptyCooldownState();
    recordQuotaCooldown(state, 'exa', new Error('out of credits'), now, p);
    expect(clearEngineCooldown(state, 'exa', p)).toBe(true);
    expect(state.engineCooldowns.exa).toBeUndefined();
    expect(loadCooldownState(p).engineCooldowns.exa).toBeUndefined();
    expect(clearEngineCooldown(state, 'exa', p)).toBe(false);
  });

  it('wipes the whole state file', () => {
    const p = statePath();
    const state = emptyCooldownState();
    recordQuotaCooldown(state, 'exa', new Error('out of credits'), now, p);
    clearAllCooldowns(p);
    expect(fs.existsSync(p)).toBe(false);
    expect(loadCooldownState(p)).toEqual(emptyCooldownState());
  });
});

describe('concurrent writes merge instead of clobbering', () => {
  const now = at('2026-08-06T00:00:00.000Z');

  it('keeps both engines when two processes record different ones', () => {
    const p = statePath();
    // Two independent in-memory snapshots, as two processes would each hold.
    const procA = emptyCooldownState();
    const procB = emptyCooldownState();
    recordQuotaCooldown(procA, 'exa', new Error('out of credits'), now, p);
    // procB's snapshot is still empty when it writes. The old whole-file write
    // put just {tavily} on disk, dropping exa. The merge keeps both.
    recordQuotaCooldown(procB, 'tavily', new Error('out of credits'), now, p);
    const disk = loadCooldownState(p);
    expect(Object.keys(disk.engineCooldowns).sort()).toEqual(['exa', 'tavily']);
  });

  it('keeps the later until when the same engine is recorded twice', () => {
    const p = statePath();
    recordQuotaCooldown(emptyCooldownState(), 'exa', new Error('out of credits'), now, p);
    const short = loadCooldownState(p).engineCooldowns.exa.until;
    // A fresh snapshot records a far-future reset for the same engine.
    recordQuotaCooldown(emptyCooldownState(), 'exa', new Error('quota. Resets in 94h19m9s'), now, p);
    const long = loadCooldownState(p).engineCooldowns.exa.until;
    expect(Date.parse(long)).toBeGreaterThan(Date.parse(short));
    // A later shorter record must not shorten the live cooldown.
    recordQuotaCooldown(emptyCooldownState(), 'exa', new Error('out of credits'), now, p);
    expect(loadCooldownState(p).engineCooldowns.exa.until).toBe(long);
  });

  it("clearing one engine leaves another process's record intact", () => {
    const p = statePath();
    const procA = emptyCooldownState();
    const procB = emptyCooldownState();
    recordQuotaCooldown(procA, 'exa', new Error('out of credits'), now, p);
    recordQuotaCooldown(procB, 'tavily', new Error('out of credits'), now, p);
    // procA only knows about exa, so clearing it must not wipe tavily off disk.
    expect(clearEngineCooldown(procA, 'exa', p)).toBe(true);
    expect(Object.keys(loadCooldownState(p).engineCooldowns)).toEqual(['tavily']);
  });
});

describe('buildCooldownController switch', () => {
  const now = at('2026-08-06T00:00:00.000Z');

  it('returns nothing and touches no file when the switch is off', () => {
    const p = statePath();
    const controller = buildCooldownController({ cooldown: 'off' }, { now, statePath: p });
    expect(controller).toBeUndefined();
    expect(fs.existsSync(p)).toBe(false);
  });

  it('builds a working controller when the switch is on (the default)', () => {
    const p = statePath();
    const controller = buildCooldownController({}, { now, statePath: p });
    expect(controller).toBeDefined();
    const entry = controller?.record('exa', new Error('out of credits'));
    expect(entry).not.toBeNull();
    expect(loadCooldownState(p).engineCooldowns.exa).toBeDefined();
    controller?.clear('exa');
    expect(loadCooldownState(p).engineCooldowns.exa).toBeUndefined();
  });
});

describe('the cache never breaks the run, and clear always reaches the disk', () => {
  it('clears an on-disk cooldown this snapshot never saw (stale-snapshot clear)', () => {
    const p = statePath();
    // Run A starts while the disk is empty.
    const stale = loadCooldownState(p);
    // Run B records exa meanwhile.
    recordQuotaCooldown(
      emptyCooldownState(),
      'exa',
      new Error('out of credits'),
      at('2026-08-07T00:00:00Z'),
      p,
    );
    expect(loadCooldownState(p).engineCooldowns.exa).toBeDefined();
    // A's exa call succeeded, so A clears it, despite never having seen it:
    // the engine that just answered has earned the clear.
    clearEngineCooldown(stale, 'exa', p);
    expect(loadCooldownState(p).engineCooldowns.exa).toBeUndefined();
  });

  it('keeps the cooldown in memory and reports, instead of throwing, when the state cannot be written', () => {
    const dir = tempDir('modsearch-badstate-');
    const blocker = path.join(dir, 'blocker');
    fs.writeFileSync(blocker, 'a plain file');
    // The parent of the state path is a file, so every mkdir/write fails.
    const p = path.join(blocker, 'nested', 'state.json');
    const state = emptyCooldownState();
    const persistErrors: unknown[] = [];
    const entry = recordQuotaCooldown(
      state,
      'exa',
      new Error('out of credits'),
      at('2026-08-07T00:00:00Z'),
      p,
      (persistError) => persistErrors.push(persistError),
    );
    expect(entry).not.toBeNull();
    expect(state.engineCooldowns.exa).toBeDefined();
    expect(persistErrors).toHaveLength(1);
  });

  it.skipIf(process.getuid?.() === 0)(
    'clear survives an unwritable state dir: memory cleared, miss reported, no throw',
    () => {
      const dir = tempDir('modsearch-rostate-');
      const p = path.join(dir, 'state.json');
      recordQuotaCooldown(
        emptyCooldownState(),
        'exa',
        new Error('out of credits'),
        at('2026-08-07T00:00:00Z'),
        p,
      );
      const state = loadCooldownState(p);
      fs.chmodSync(dir, 0o500);
      try {
        const persistErrors: unknown[] = [];
        expect(() =>
          clearEngineCooldown(state, 'exa', p, (persistError) => persistErrors.push(persistError)),
        ).not.toThrow();
        expect(state.engineCooldowns.exa).toBeUndefined();
        expect(persistErrors).toHaveLength(1);
      } finally {
        fs.chmodSync(dir, 0o700);
      }
    },
  );

  it('state clear surfaces a delete that failed instead of pretending success', () => {
    const dir = tempDir('modsearch-cleardir-');
    const p = path.join(dir, 'state-dir');
    fs.mkdirSync(path.join(p, 'child'), { recursive: true });
    // The path is a non-empty directory: rmSync without recursive must throw,
    // and clearAllCooldowns must let it out so the CLI can exit non-zero.
    expect(() => clearAllCooldowns(p)).toThrow();
  });

  it('skips the write when nothing changed, so a quiet clear touches no file', () => {
    const p = statePath();
    clearEngineCooldown(emptyCooldownState(), 'exa', p);
    expect(fs.existsSync(p)).toBe(false);
  });
});
