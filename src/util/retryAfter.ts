// How long a provider asked us to stay away, and the clause that carries it to
// the cooldown layer. classifyQuota reads "Resets in 23h48m52s" and holds the
// engine until then, so a spent keyless allowance is skipped instead of being
// asked again (and refused again) on every run.

/** Waits shorter than this are a burst limit, not a spent allowance. */
export const SPENT_ALLOWANCE_MIN_SECONDS = 60;

/**
 * Seconds from a Retry-After header: delta-seconds or an HTTP date. Null when
 * the header is absent or unreadable.
 */
export function retryAfterSeconds(response: Response, now = Date.now()): number | null {
  const raw = response.headers.get('retry-after')?.trim();
  if (!raw) {
    return null;
  }
  if (/^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - now) / 1000));
}

/** "Resets in 23h48m52s", the shape parseResetDuration in cooldown.ts reads. */
export function resetClause(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `Resets in ${hours > 0 ? `${hours}h` : ''}${minutes}m${rest}s`;
}
