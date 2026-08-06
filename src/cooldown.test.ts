import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyQuota,
  clearAllCooldowns,
  clearEngineCooldown,
  coolingEntry,
  DEFAULT_COOLDOWN_MS,
  emptyCooldownState,
  isEngineCooling,
  loadCooldownState,
  parseResetDuration,
  recordQuotaCooldown,
} from './cooldown.ts';
import { agyQuotaEnvelope } from './fixtures/index.ts';
import { parseAntigravityOutput } from './providers/antigravity.ts';
import { cleanupTempDirs, tempDir } from './testing/helpers.ts';

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

  it('writes 0600 and round-trips through a record', () => {
    const p = statePath();
    const state = emptyCooldownState();
    recordQuotaCooldown(state, 'exa', new Error('out of credits'), at('2026-08-06T00:00:00.000Z'), p);
    expect(fs.statSync(p).mode & 0o777).toBe(0o600);
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
