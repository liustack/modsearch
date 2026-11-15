import { describe, expect, it } from 'vitest';
import { parseResetDuration } from '../cooldown.ts';
import { resetClause, retryAfterSeconds } from './retryAfter.ts';

const withHeader = (value?: string) =>
  ({ headers: new Headers(value === undefined ? {} : { 'retry-after': value }) }) as Response;

describe('retryAfterSeconds', () => {
  it('reads delta-seconds and an HTTP date', () => {
    expect(retryAfterSeconds(withHeader('85731'))).toBe(85731);
    const now = Date.parse('2026-11-15T14:00:00Z');
    expect(retryAfterSeconds(withHeader('Sun, 15 Nov 2026 15:00:00 GMT'), now)).toBe(3600);
  });

  it('is null when the header is absent or unreadable', () => {
    expect(retryAfterSeconds(withHeader())).toBeNull();
    expect(retryAfterSeconds(withHeader('soon'))).toBeNull();
  });
});

describe('resetClause', () => {
  it('writes what the cooldown parser reads back exactly', () => {
    for (const seconds of [59, 60, 1800, 3600, 85732]) {
      expect(parseResetDuration(resetClause(seconds))).toBe(seconds * 1000);
    }
    expect(resetClause(85732)).toBe('Resets in 23h48m52s');
  });
});
