// `modsearch doctor`: diagnose configuration and routing on this machine
// without spending quota or making a network request. It only looks at the
// Node version, the config file, environment variables, whether engine
// binaries are on PATH, and whether the Grok login file exists. Everything it
// reports is a local fact, so it is safe to run anywhere, any number of times.
import * as fs from 'fs';
import {
  allowsPrivateNetwork,
  chosenEngine,
  cooldownEnabled,
  currentConfigPath,
  engineSettings,
  loadConfigFile,
  type ModsearchConfig,
  type Role,
  ROLES,
} from './config.ts';
import {
  coolingEntry,
  currentStatePath,
  loadCooldownState,
  parseCooldownStateKey,
} from './cooldown.ts';
import { grokAuthFile } from './providers/grok.ts';
import { findEngine, ROLE_PREFERENCE, type SearchEngine } from './providers/index.ts';
import { commandOnPath } from './system.ts';
import { splitApiKeys } from './util/apiKeys.ts';

/** The Node floor this build promises. Kept in step with package.json engines. */
export const MIN_NODE = '22.13.0';

export interface EngineDiagnosis {
  engine: string;
  /** Whether automatic routing is allowed to use this engine. */
  enabled: boolean;
  ready: boolean;
  /** One line explaining the readiness verdict. */
  reason: string;
  /** A copyable command that would make it ready, when it is not. */
  fix?: string;
  /** For keyed engines: where the key came from, or null when absent. */
  keySource?: 'env' | 'file' | null;
}

export interface RoleDiagnosis {
  role: Role;
  /** Plain-language job name. */
  job: string;
  /** The candidate engines for this role, in resolution order. */
  candidates: EngineDiagnosis[];
  /** The first enabled and ready candidate, or null when none qualifies. */
  resolved: string | null;
}

/** One engine that is currently cooling, with how long is left. */
export interface CooldownDiagnosis {
  engine: string;
  /** Zero-based API key index for per-key cooldowns. Absent on legacy engine cooldowns. */
  keyIndex?: number;
  /** ISO time it may recover. */
  until: string;
  /** Human remaining time, e.g. "1h 30m" or "45m". */
  remaining: string;
  reason: string;
}

export interface DoctorReport {
  node: { version: string; minimum: string; ok: boolean; fix?: string };
  engineChoice: {
    /** The configured search engine, or null when automatic. */
    value: string | null;
    source: 'file' | 'default';
    /** Set when the configured name is not a known engine. */
    problem?: string;
  };
  configFile: {
    path: string;
    exists: boolean;
    /** Octal permission string (e.g. "600") when the file exists. */
    mode?: string;
    /**
     * False when the file is group- or world-readable on a platform that
     * enforces POSIX permissions. A missing file is fine (true): defaults
     * leak nothing. Windows reports 666/777 for every file, so the judgment
     * is skipped there rather than crying wolf.
     */
    permissionsOk: boolean;
    /** The fix, when permissions are too open. */
    note?: string;
    readable: boolean;
    /** Set when the file exists but could not be read or parsed. */
    problem?: string;
  };
  allowPrivateNetwork: { enabled: boolean; source: 'file' | 'default' };
  /** Quota cooldown: the switch state and every engine cooling right now. */
  cooldown: { enabled: boolean; statePath: string; engines: CooldownDiagnosis[] };
  roles: RoleDiagnosis[];
}

export interface DoctorOptions {
  config?: ModsearchConfig;
  env?: NodeJS.ProcessEnv;
  /** Defaults to the running Node version. Injectable for tests. */
  nodeVersion?: string;
  configPath?: string;
  /** Cooldown state file. Injectable for tests. */
  statePath?: string;
  /** Clock for remaining-time math. Injectable for tests. */
  now?: Date;
}

const ROLE_JOB: Record<Role, string> = {
  search: 'search the web',
  fetch: 'fetch a page',
  social: 'search X',
};

const INSTALL_AGY = 'curl -fsSL https://antigravity.google/cli/install.sh | bash && agy';
const INSTALL_GROK = 'curl -fsSL https://x.ai/cli/install.sh | bash && grok';

function configuredApiKeys(
  fromEnv: string | undefined,
  fromFile: string | undefined,
): { count: number; source: 'env' | 'file' | null } {
  const envKeys = splitApiKeys(fromEnv);
  if (envKeys.length > 0) {
    return { count: envKeys.length, source: 'env' };
  }
  const fileKeys = splitApiKeys(fromFile);
  return { count: fileKeys.length, source: fileKeys.length > 0 ? 'file' : null };
}

function apiKeyPresentReason(count: number, source: 'env' | 'file'): string {
  return `API key present (${count} ${count === 1 ? 'key' : 'keys'}, from ${source})`;
}

/** Compare two dotted numeric versions. Returns negative, zero, or positive. */
function compareVersions(a: string, b: string): number {
  const pa = a
    .replace(/^v/, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = b
    .replace(/^v/, '')
    .split('.')
    .map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/** Diagnose one engine: is it usable here, and if not, what fixes it. */
function diagnoseEngine(
  engine: SearchEngine,
  config: ModsearchConfig,
  env: NodeJS.ProcessEnv,
  role: Role,
): EngineDiagnosis {
  const settings = engineSettings(engine.name, config, env);
  const enabled = settings.enabled !== false;

  if (engine.name === 'antigravity-cli') {
    const bin = settings.bin || 'agy';
    const ready = commandOnPath(bin, env);
    return {
      engine: engine.name,
      enabled,
      ready,
      reason: ready
        ? `binary "${bin}" found and runnable`
        : `binary "${bin}" not found on PATH (sign-in also required, once)`,
      ...(ready ? {} : { fix: INSTALL_AGY }),
    };
  }

  if (engine.name === 'tavily') {
    const { count, source: keySource } = configuredApiKeys(
      env.TAVILY_API_KEY,
      config.engines?.tavily?.apiKey,
    );
    const ready = count > 0;
    return {
      engine: engine.name,
      enabled,
      ready,
      keySource,
      reason: keySource
        ? apiKeyPresentReason(count, keySource)
        : 'no API key (not in TAVILY_API_KEY or the config file)',
      ...(ready ? {} : { fix: 'modsearch config set tavily.apiKey <key>' }),
    };
  }

  if (engine.name === 'exa') {
    const { count, source: keySource } = configuredApiKeys(
      env.EXA_API_KEY,
      config.engines?.exa?.apiKey,
    );
    const ready = count > 0;
    return {
      engine: engine.name,
      enabled,
      ready,
      keySource,
      reason: keySource
        ? apiKeyPresentReason(count, keySource)
        : 'no API key (not in EXA_API_KEY or the config file)',
      ...(ready ? {} : { fix: 'modsearch config set exa.apiKey <key>' }),
    };
  }

  if (engine.name === 'firecrawl') {
    const { count, source: keySource } = configuredApiKeys(
      env.FIRECRAWL_API_KEY,
      config.engines?.firecrawl?.apiKey,
    );
    const configuredEngine = chosenEngine(config);
    // Keyless fetch is on by default; only an explicit `keylessFetch: false`
    // turns it off, and an explicit Firecrawl engine choice overrides even
    // that (choosing the engine is consent). Mirrors firecrawlProvider and
    // the router's unconditional add of the configured engine.
    const keylessFetch =
      settings.keylessFetch === undefined ||
      settings.keylessFetch === true ||
      (configuredEngine !== undefined && findEngine(configuredEngine)?.name === 'firecrawl');
    if (role === 'search') {
      return {
        engine: engine.name,
        enabled,
        ready: true,
        keySource,
        reason: keySource
          ? apiKeyPresentReason(count, keySource)
          : 'keyless: works with no key and no signup (Firecrawl grants 1,000 free credits/month, metered per IP per day). Set a free key for your own quota.',
      };
    }
    const ready = Boolean(keySource || keylessFetch);
    return {
      engine: engine.name,
      enabled,
      ready,
      keySource,
      reason: keySource
        ? apiKeyPresentReason(count, keySource)
        : keylessFetch
          ? 'keyless fetch (default): public pages are read by a cloud browser, no key or signup needed. Opt out with: modsearch config set firecrawl.keylessFetch false'
          : 'keyless fetch is switched off (firecrawl.keylessFetch false), so Firecrawl is excluded from automatic page fetch.',
      ...(ready ? {} : { fix: 'modsearch config set firecrawl.keylessFetch true' }),
    };
  }

  if (engine.name === 'grok-cli') {
    const bin = settings.bin || 'grok';
    const binPresent = commandOnPath(bin, env);
    const authPath = grokAuthFile();
    const authPresent = fs.existsSync(authPath);
    const ready = binPresent && authPresent;
    const parts: string[] = [];
    parts.push(binPresent ? `binary "${bin}" found` : `binary "${bin}" not found on PATH`);
    parts.push(authPresent ? `login file ${authPath} present` : `login file ${authPath} missing`);
    return {
      engine: engine.name,
      enabled,
      ready,
      reason: parts.join('; '),
      ...(ready ? {} : { fix: INSTALL_GROK }),
    };
  }

  // the local engine and anything else that needs no setup.
  const ready = engine.isAvailable(settings, env, role);
  return {
    engine: engine.name,
    enabled,
    ready,
    reason: ready ? 'built in, needs nothing installed' : engine.requirement,
  };
}

/** The candidate engines for a role, in resolution order, deduplicated. */
function candidatesForRole(role: Role, config: ModsearchConfig): SearchEngine[] {
  const names: string[] = [];
  const configured = chosenEngine(config);
  if (configured) {
    const engine = findEngine(configured);
    if (engine && engine.roles.includes(role)) {
      names.push(engine.name);
    }
  }
  for (const name of ROLE_PREFERENCE[role]) {
    names.push(name);
  }

  const seen = new Set<string>();
  const engines: SearchEngine[] = [];
  for (const name of names) {
    const engine = findEngine(name);
    if (engine && !seen.has(engine.name)) {
      seen.add(engine.name);
      engines.push(engine);
    }
  }
  return engines;
}

/** The engines cooling right now, plus whether the switch is even on. */
function diagnoseCooldown(
  config: ModsearchConfig,
  statePath: string,
  now: Date,
): DoctorReport['cooldown'] {
  if (!cooldownEnabled(config)) {
    return { enabled: false, statePath, engines: [] };
  }
  const state = loadCooldownState(statePath);
  const engines: CooldownDiagnosis[] = [];
  for (const stateKey of Object.keys(state.engineCooldowns)) {
    const target = parseCooldownStateKey(stateKey);
    const entry = coolingEntry(state, target.engine, now, target.keyIndex);
    if (entry) {
      engines.push({
        engine: target.engine,
        ...(target.keyIndex === undefined ? {} : { keyIndex: target.keyIndex }),
        until: entry.until,
        remaining: formatRemaining(Date.parse(entry.until) - now.getTime()),
        reason: entry.reason.split('\n')[0].slice(0, 120),
      });
    }
  }
  engines.sort(
    (a, b) => a.engine.localeCompare(b.engine) || (a.keyIndex ?? -1) - (b.keyIndex ?? -1),
  );
  return { enabled: true, statePath, engines };
}

function formatRemaining(ms: number): string {
  if (ms <= 0) {
    return '0m';
  }
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

export function runDoctor(options: DoctorOptions = {}): DoctorReport {
  const env = options.env ?? process.env;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const configPath = options.configPath ?? currentConfigPath();
  const statePath = options.statePath ?? currentStatePath();
  const now = options.now ?? new Date();

  // Read the config, but never let a broken file abort the diagnosis: a broken
  // file is one of the things doctor exists to point at.
  let config: ModsearchConfig = options.config ?? {};
  let configProblem: string | undefined;
  const exists = fs.existsSync(configPath);
  let readable = !exists ? false : true;
  let mode: string | undefined;
  let permissionsOk = true;
  if (options.config === undefined && exists) {
    // Permissions first, parsing second: a broken file still holds its keys,
    // so an unparseable 0644 config must still earn the chmod verdict.
    try {
      const stat = fs.statSync(configPath);
      const bits = stat.mode & 0o777;
      mode = bits.toString(8).padStart(3, '0');
      // Judge, don't just report: the file holds API keys. Windows reads back
      // 666/777 for every file, so only platforms with real POSIX permissions
      // (process.getuid exists) get the verdict.
      const enforcesPosixPerms = typeof process.getuid === 'function';
      permissionsOk = !enforcesPosixPerms || (bits & 0o077) === 0;
    } catch {
      // stat failing is reported through the read path below
    }
    try {
      config = loadConfigFile(configPath);
    } catch (error) {
      readable = false;
      configProblem = error instanceof Error ? error.message : String(error);
    }
  } else if (options.config === undefined) {
    readable = false; // no file is not "readable", it just means defaults
  }

  const ok = compareVersions(nodeVersion, MIN_NODE) >= 0;

  const configuredName = chosenEngine(config);
  let engineProblem: string | undefined;
  if (configuredName && !findEngine(configuredName)) {
    engineProblem = `"${configuredName}" is not a known engine, so search picks one automatically`;
  }

  const roles: RoleDiagnosis[] = ROLES.map((role) => {
    const candidates = candidatesForRole(role, config).map((engine) =>
      diagnoseEngine(engine, config, env, role),
    );
    const resolved = candidates.find((c) => c.enabled && c.ready)?.engine ?? null;
    return { role, job: ROLE_JOB[role], candidates, resolved };
  });

  const allowPrivate = allowsPrivateNetwork(config);

  return {
    node: {
      version: nodeVersion,
      minimum: MIN_NODE,
      ok,
      ...(ok ? {} : { fix: `Upgrade Node to ${MIN_NODE} or newer.` }),
    },
    engineChoice: {
      value: configuredName ?? null,
      source: configuredName ? 'file' : 'default',
      ...(engineProblem ? { problem: engineProblem } : {}),
    },
    configFile: {
      path: configPath,
      exists,
      ...(mode ? { mode } : {}),
      permissionsOk,
      ...(permissionsOk
        ? {}
        : { note: `group/world can read this file. Run: chmod 600 ${configPath}` }),
      readable,
      ...(configProblem ? { problem: configProblem } : {}),
    },
    allowPrivateNetwork: {
      enabled: allowPrivate,
      source: allowPrivate ? 'file' : 'default',
    },
    cooldown: diagnoseCooldown(config, statePath, now),
    roles,
  };
}

/** Human-readable report. `--json` prints the object instead. */
export function formatDoctorReport(report: DoctorReport): string {
  const lines: string[] = ['modsearch doctor', ''];

  lines.push('Node');
  lines.push(`  version: ${report.node.version}`);
  lines.push(`  minimum: ${report.node.minimum}`);
  lines.push(`  status:  ${report.node.ok ? 'OK' : 'TOO OLD'}`);
  if (report.node.fix) {
    lines.push(`  fix:     ${report.node.fix}`);
  }
  lines.push('');

  lines.push('Config');
  const choice = report.engineChoice;
  lines.push(
    `  search engine: ${choice.value ? `${choice.value} (from config file)` : '(unset: automatic)'}`,
  );
  if (choice.problem) {
    lines.push(`    ! ${choice.problem}`);
  }
  const file = report.configFile;
  if (!file.exists) {
    lines.push(`  file: ${file.path} (not present, running on defaults)`);
  } else if (file.problem) {
    lines.push(`  file: ${file.path} (unreadable)`);
    lines.push(`    ! ${file.problem}`);
  } else {
    lines.push(`  file: ${file.path} (present, mode ${file.mode})`);
    if (!file.permissionsOk && file.note) {
      lines.push(`    ! ${file.note}`);
    }
  }
  lines.push(
    `  allowPrivateNetwork: ${report.allowPrivateNetwork.enabled ? 'on' : 'off'} (${report.allowPrivateNetwork.source})`,
  );
  lines.push('');

  lines.push('Cooldown');
  if (!report.cooldown.enabled) {
    lines.push('  switch: off (state not consulted)');
  } else if (report.cooldown.engines.length === 0) {
    lines.push('  switch: on');
    lines.push('  no engines are cooling right now');
  } else {
    lines.push('  switch: on');
    for (const c of report.cooldown.engines) {
      const label = c.keyIndex === undefined ? c.engine : `${c.engine} key ${c.keyIndex + 1}`;
      lines.push(`  - ${label.padEnd(16)} cooling, ${c.remaining} left (until ${c.until})`);
      if (c.reason) {
        lines.push(`      reason: ${c.reason}`);
      }
    }
  }
  lines.push('');

  for (const role of report.roles) {
    lines.push(`${role.role} (${role.job})`);
    lines.push(`  resolved: ${role.resolved ?? '(none available)'}`);
    for (const c of role.candidates) {
      const mark = !c.enabled ? 'disabled' : c.ready ? 'READY  ' : 'not set';
      lines.push(`  - ${c.engine.padEnd(16)} ${mark}  ${c.reason}`);
      if (c.enabled && !c.ready && c.fix) {
        lines.push(`      fix: ${c.fix}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
