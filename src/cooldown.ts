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
import { canonicalEngineName, cooldownEnabled, type ModsearchConfig } from './config.ts';
import { redactSecrets } from './util/redact.ts';

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
        // Fold a legacy engine key (e.g. `http`, written before the rename to
        // `local`) onto its canonical name so an old cooldown is not orphaned.
        // On a collision, keep whichever cooldown lasts longer.
        const key = canonicalEngineName(engine);
        const normalized: CooldownEntry = {
          until: e.until,
          reason: typeof e.reason === 'string' ? e.reason : '',
          observedAt: typeof e.observedAt === 'string' ? e.observedAt : '',
        };
        clean[key] = clean[key] ? laterEntry(clean[key], normalized) : normalized;
      }
    }
    return { engineCooldowns: clean };
  } catch {
    // Corrupt JSON is a lost cache, not an error to raise at the user.
    return emptyCooldownState();
  }
}

/** The entry with the later `until`, so a concurrent writer's fresher cooldown wins. */
function laterEntry(existing: CooldownEntry | undefined, incoming: CooldownEntry): CooldownEntry {
  if (!existing) {
    return incoming;
  }
  const existingUntil = Date.parse(existing.until);
  const incomingUntil = Date.parse(incoming.until);
  // Prefer the incoming record on a tie or an unparseable existing `until`.
  return Number.isFinite(existingUntil) && existingUntil > incomingUntil ? existing : incoming;
}

/**
 * Read-modify-write the state file under an atomic rename. Two processes writing
 * at once used to clobber each other, because each wrote its whole in-memory
 * snapshot over the file, so the second write dropped whatever the first had
 * recorded. We re-read the latest on-disk state, apply the caller's change to
 * that (set or replace one engine, or delete one), and write the union, so a
 * cooldown another process recorded meanwhile survives. Still a temp file plus
 * rename, so a crash mid-write cannot leave a partial file behind.
 */
function updateStateOnDisk(
  statePath: string,
  mutate: (state: CooldownState) => void,
): CooldownState {
  const merged = loadCooldownState(statePath);
  const before = JSON.stringify(merged);
  mutate(merged);
  if (JSON.stringify(merged) === before) {
    // Nothing changed (e.g. clearing an engine that was not cooling), so skip
    // the write entirely: the success path stays free of disk writes.
    return merged;
  }
  const dir = path.dirname(statePath);
  fs.mkdirSync(dir, { recursive: true });
  const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const tmp = path.join(dir, `.state.${unique}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, statePath);
  try {
    fs.chmodSync(statePath, 0o600);
  } catch {
    // best effort on platforms without chmod
  }
  return merged;
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
  onPersistError?: (persistError: unknown) => void,
): CooldownEntry | null {
  const until = classifyQuota(error, now);
  if (!until) {
    return null;
  }
  // Redact before truncating: a cut placed inside a secret would hide it from
  // the exact-match scrub, and doctor renders this reason back to humans.
  const reason = redactSecrets(error instanceof Error ? error.message : String(error)).slice(
    0,
    300,
  );
  const entry: CooldownEntry = {
    until: until.toISOString(),
    reason,
    observedAt: now.toISOString(),
  };
  // Merge against the latest on-disk state so a concurrent writer's record for
  // another engine is not lost. The same engine keeps whichever cooldown lasts
  // longer, so a shorter later write cannot shorten a live cooldown.
  try {
    const merged = updateStateOnDisk(statePath, (disk) => {
      disk.engineCooldowns[engine] = laterEntry(disk.engineCooldowns[engine], entry);
    });
    const persisted = merged.engineCooldowns[engine];
    state.engineCooldowns[engine] = persisted;
    return persisted;
  } catch (persistError) {
    // The store is a pure cache: a read-only dir, a full disk, or a Windows
    // rename lock must never break failover. Keep the cooldown for this run
    // in memory and report the miss instead of throwing.
    state.engineCooldowns[engine] = entry;
    onPersistError?.(persistError);
    return entry;
  }
}

/**
 * Clear one engine's cooldown, in memory and on disk. The disk delete always
 * runs against the latest on-disk state: this run's snapshot may predate a
 * cooldown another process recorded meanwhile, and an engine that just
 * answered has earned the clear regardless of who recorded it.
 */
export function clearEngineCooldown(
  state: CooldownState,
  engine: string,
  statePath: string,
  onPersistError?: (persistError: unknown) => void,
): boolean {
  const hadInMemory = engine in state.engineCooldowns;
  delete state.engineCooldowns[engine];
  try {
    // Remove only this engine on disk, preserving any other process's records.
    // updateStateOnDisk skips the write when the engine was not on disk either.
    updateStateOnDisk(statePath, (disk) => {
      delete disk.engineCooldowns[engine];
    });
    return hadInMemory;
  } catch (persistError) {
    onPersistError?.(persistError);
    return hadInMemory;
  }
}

/**
 * Wipe all cooldown state by deleting the file. Used by `modsearch state clear`.
 * Unlike the in-run cache writes, this is an explicit user command, so a delete
 * that fails must surface as an error, not print success over a file still there.
 */
export function clearAllCooldowns(statePath = currentStatePath()): void {
  fs.rmSync(statePath, { force: true });
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
  /** Notices about cooldown persistence failing; the run merges them into warnings. */
  readonly warnings: string[];
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
  const warnings: string[] = [];
  const persistNote = (persistError: unknown) => {
    const message = persistError instanceof Error ? persistError.message : String(persistError);
    warnings.push(
      `Cooldown state could not be saved (${message}); failover still works, but the next run will rediscover this quota wall.`,
    );
  };
  return {
    state,
    now,
    warnings,
    record: (engine, error) => recordQuotaCooldown(state, engine, error, now, statePath, persistNote),
    clear: (engine) => {
      clearEngineCooldown(state, engine, statePath, persistNote);
    },
  };
}
