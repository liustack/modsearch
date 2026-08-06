// The quota cooldown store. When an engine reports a quota-class failure, we
// remember it and when it may recover, so the next run fails over to another
// engine first instead of spending a call to rediscover the wall. This is a
// softened circuit breaker, not load sharing: healthy engines keep the whole
// job, a spent one is only moved to the back of the line and tried last.
//
// State lives in ~/.modsearch/state.json, apart from config.json, and is a pure
// cache: a read that fails or a file that is corrupt is treated as no state,
// silently, because nagging the user about a lost cache helps nobody. Writes go
// through a temp file and an atomic rename so a crash mid-write cannot leave a
// half-written file behind.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cooldownEnabled, type ModsearchConfig } from './config.ts';

export interface CooldownEntry {
  /** ISO time the engine may be worth trying again. */
  until: string;
  /** Short human reason, usually the quota message the engine returned. */
  reason: string;
  /** ISO time this cooldown was recorded. */
  observedAt: string;
}

export interface CooldownState {
  engineCooldowns: Record<string, CooldownEntry>;
}

/** Resolved at call time so a faked HOME (tests) redirects the state too. */
export function currentStatePath(): string {
  return path.join(os.homedir(), '.modsearch', 'state.json');
}

/** A quota error with no reset time cools for this long before a retry. */
export const DEFAULT_COOLDOWN_MS = 45 * 60 * 1000;

/**
 * A monthly-budget quota (a spent plan or PAYGO cap) with no reset time cools
 * for a day, not 45 minutes: retrying inside the hour just re-hits the same wall.
 */
export const MONTHLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function emptyCooldownState(): CooldownState {
  return { engineCooldowns: {} };
}

export function loadCooldownState(statePath = currentStatePath()): CooldownState {
  let raw: string;
  try {
    raw = fs.readFileSync(statePath, 'utf-8');
  } catch {
    // Missing or unreadable: no state is a valid state, so stay silent.
    return emptyCooldownState();
  }

  try {
    const parsed = JSON.parse(raw) as { engineCooldowns?: unknown } | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.engineCooldowns !== 'object') {
      return emptyCooldownState();
    }
    const cooldowns = parsed.engineCooldowns as Record<string, unknown>;
    const clean: Record<string, CooldownEntry> = {};
    for (const [engine, entry] of Object.entries(cooldowns)) {
      if (entry && typeof entry === 'object' && typeof (entry as CooldownEntry).until === 'string') {
        const e = entry as CooldownEntry;
        clean[engine] = {
          until: e.until,
          reason: typeof e.reason === 'string' ? e.reason : '',
          observedAt: typeof e.observedAt === 'string' ? e.observedAt : '',
        };
      }
    }
    return { engineCooldowns: clean };
  } catch {
    // Corrupt JSON is a lost cache, not an error to raise at the user.
    return emptyCooldownState();
  }
}

function writeCooldownState(state: CooldownState, statePath: string): void {
  const dir = path.dirname(statePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.state.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, statePath);
  try {
    fs.chmodSync(statePath, 0o600);
  } catch {
    // best effort on platforms without chmod
  }
}

/** The active cooldown entry for an engine, or undefined if it is not cooling now. */
export function coolingEntry(
  state: CooldownState,
  engine: string,
  now: Date,
): CooldownEntry | undefined {
  const entry = state.engineCooldowns[engine];
  if (!entry) {
    return undefined;
  }
  const until = Date.parse(entry.until);
  if (!Number.isFinite(until) || until <= now.getTime()) {
    return undefined;
  }
  return entry;
}

export function isEngineCooling(state: CooldownState, engine: string, now: Date): boolean {
  return coolingEntry(state, engine, now) !== undefined;
}

/** Parse an agy-style "Resets in 94h19m9s" clause to milliseconds, or null. */
export function parseResetDuration(message: string): number | null {
  const match = /Resets? in\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i.exec(message);
  if (!match || (!match[1] && !match[2] && !match[3])) {
    return null;
  }
  const hours = Number.parseInt(match[1] ?? '0', 10);
  const minutes = Number.parseInt(match[2] ?? '0', 10);
  const seconds = Number.parseInt(match[3] ?? '0', 10);
  return (hours * 3600 + minutes * 60 + seconds) * 1000;
}

/**
 * Decide whether an engine failure is the quota class worth remembering, and
 * when the engine should recover. A per-second rate limit is transient, not a
 * spent budget, so it returns null and never touches the store. A quota error
 * with a reset clause recovers precisely, one without recovers after the
 * default TTL.
 */
export function classifyQuota(error: unknown, now: Date): Date | null {
  const message = error instanceof Error ? error.message : String(error);
  const looksRateLimited = /rate.?limit|too many requests|\b429\b/i.test(message);
  // Tavily's monthly plan cap (432) and PAYGO cap (433) are a spent monthly
  // budget carried in the status code, not a per-second blip.
  const monthlyQuota = /\bhttp 43[23]\b/i.test(message);
  const looksQuota =
    monthlyQuota ||
    /quota|out of credit|insufficient (?:balance|credit)|credits? (?:exhausted|used up)|balance|Resets? in/i.test(
      message,
    );
  if (looksRateLimited && !looksQuota) {
    return null;
  }
  if (!looksQuota) {
    return null;
  }
  const resetMs = parseResetDuration(message);
  const fallbackMs = monthlyQuota ? MONTHLY_COOLDOWN_MS : DEFAULT_COOLDOWN_MS;
  return new Date(now.getTime() + (resetMs ?? fallbackMs));
}

/**
 * Record a cooldown when the error is quota class. Mutates the in-memory state
 * and persists it. Returns the new entry, or null when the error is not quota
 * class (and nothing is written).
 */
export function recordQuotaCooldown(
  state: CooldownState,
  engine: string,
  error: unknown,
  now: Date,
  statePath: string,
): CooldownEntry | null {
  const until = classifyQuota(error, now);
  if (!until) {
    return null;
  }
  const reason = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  const entry: CooldownEntry = {
    until: until.toISOString(),
    reason,
    observedAt: now.toISOString(),
  };
  state.engineCooldowns[engine] = entry;
  writeCooldownState(state, statePath);
  return entry;
}

/** Clear one engine's cooldown. Persists only when something actually changed. */
export function clearEngineCooldown(
  state: CooldownState,
  engine: string,
  statePath: string,
): boolean {
  if (!(engine in state.engineCooldowns)) {
    return false;
  }
  delete state.engineCooldowns[engine];
  writeCooldownState(state, statePath);
  return true;
}

/** Wipe all cooldown state by deleting the file. Used by `modsearch state clear`. */
export function clearAllCooldowns(statePath = currentStatePath()): void {
  try {
    fs.rmSync(statePath, { force: true });
  } catch {
    // best effort: a missing file is already the desired state
  }
}

/**
 * One run's view of the cooldown store: a state snapshot and clock for routing
 * to order by, plus record/clear side effects for the run to report outcomes.
 * The router reads `state`/`now`, search.ts calls `record` on a failure and
 * `clear` on a success.
 */
export interface CooldownController {
  readonly state: CooldownState;
  readonly now: Date;
  record(engine: string, error: unknown): CooldownEntry | null;
  clear(engine: string): void;
}

/**
 * Build a controller for a run, or undefined when the switch is off. Off means
 * off: no state file is read here and none is written, so routing is byte-for-
 * byte what it was before cooldowns existed. On, the state is read once and the
 * side effects persist against the same path and clock.
 */
export function buildCooldownController(
  config: ModsearchConfig,
  opts: { now?: Date; statePath?: string } = {},
): CooldownController | undefined {
  if (!cooldownEnabled(config)) {
    return undefined;
  }
  const statePath = opts.statePath ?? currentStatePath();
  const now = opts.now ?? new Date();
  const state = loadCooldownState(statePath);
  return {
    state,
    now,
    record: (engine, error) => recordQuotaCooldown(state, engine, error, now, statePath),
    clear: (engine) => {
      clearEngineCooldown(state, engine, statePath);
    },
  };
}
