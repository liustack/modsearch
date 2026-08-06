// `modsearch doctor`: diagnose configuration and routing on this machine
// without spending quota or making a network request. It only looks at the
// Node version, the config file, environment variables, whether engine
// binaries are on PATH, and whether the Grok login file exists. Everything it
// reports is a local fact, so it is safe to run anywhere, any number of times.
import * as fs from 'fs';
import {
  chosenEngine,
  currentConfigPath,
  engineSettings,
  loadConfigFile,
  type ModsearchConfig,
  type Role,
  ROLES,
} from './config.ts';
import { grokAuthFile } from './providers/grok.ts';
import {
  findEngine,
  ROLE_PREFERENCE,
  type SearchEngine,
} from './providers/index.ts';
import { commandOnPath } from './system.ts';

/** The Node floor this build promises. Kept in step with package.json engines. */
export const MIN_NODE = '22.13.0';

export interface EngineDiagnosis {
  engine: string;
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
  /** The first ready candidate, or null when none is ready. */
  resolved: string | null;
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
    readable: boolean;
    /** Set when the file exists but could not be read or parsed. */
    problem?: string;
  };
  allowPrivateNetwork: { enabled: boolean; source: 'file' | 'default' };
  roles: RoleDiagnosis[];
}

export interface DoctorOptions {
  config?: ModsearchConfig;
  env?: NodeJS.ProcessEnv;
  /** Defaults to the running Node version; injectable for tests. */
  nodeVersion?: string;
  configPath?: string;
}

const ROLE_JOB: Record<Role, string> = {
  search: 'search the web',
  fetch: 'fetch a page',
  social: 'search X',
};

const INSTALL_AGY = 'curl -fsSL https://antigravity.google/cli/install.sh | bash && agy';
const INSTALL_GROK = 'curl -fsSL https://x.ai/cli/install.sh | bash && grok';

/** Compare two dotted numeric versions. Returns negative, zero, or positive. */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
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
): EngineDiagnosis {
  const settings = engineSettings(engine.name, config, env);

  if (engine.name === 'antigravity-cli') {
    const bin = settings.bin || 'agy';
    const ready = commandOnPath(bin, env);
    return {
      engine: engine.name,
      ready,
      reason: ready
        ? `binary "${bin}" found and runnable`
        : `binary "${bin}" not found on PATH (sign-in also required, once)`,
      ...(ready ? {} : { fix: INSTALL_AGY }),
    };
  }

  if (engine.name === 'tavily') {
    const fromEnv = env.TAVILY_API_KEY?.trim();
    const fromFile = config.engines?.tavily?.apiKey?.trim();
    const keySource: 'env' | 'file' | null = fromEnv ? 'env' : fromFile ? 'file' : null;
    const ready = Boolean(keySource);
    return {
      engine: engine.name,
      ready,
      keySource,
      reason: ready
        ? `API key present (from ${keySource})`
        : 'no API key (not in TAVILY_API_KEY or the config file)',
      ...(ready ? {} : { fix: 'modsearch config set tavily.apiKey <key>' }),
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
      ready,
      reason: parts.join('; '),
      ...(ready ? {} : { fix: INSTALL_GROK }),
    };
  }

  // http and anything else that needs no setup.
  const ready = engine.isAvailable(settings, env);
  return {
    engine: engine.name,
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

export function runDoctor(options: DoctorOptions = {}): DoctorReport {
  const env = options.env ?? process.env;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const configPath = options.configPath ?? currentConfigPath();

  // Read the config, but never let a broken file abort the diagnosis: a broken
  // file is one of the things doctor exists to point at.
  let config: ModsearchConfig = options.config ?? {};
  let configProblem: string | undefined;
  const exists = fs.existsSync(configPath);
  let readable = !exists ? false : true;
  let mode: string | undefined;
  if (options.config === undefined && exists) {
    try {
      config = loadConfigFile(configPath);
      const stat = fs.statSync(configPath);
      mode = (stat.mode & 0o777).toString(8).padStart(3, '0');
    } catch (error) {
      readable = false;
      configProblem = error instanceof Error ? error.message : String(error);
    }
  } else if (options.config === undefined) {
    readable = false; // no file is not "readable"; it just means defaults
  }

  const ok = compareVersions(nodeVersion, MIN_NODE) >= 0;

  const configuredName = chosenEngine(config);
  let engineProblem: string | undefined;
  if (configuredName && !findEngine(configuredName)) {
    engineProblem = `"${configuredName}" is not a known engine, so search picks one automatically`;
  }

  const roles: RoleDiagnosis[] = ROLES.map((role) => {
    const candidates = candidatesForRole(role, config).map((engine) =>
      diagnoseEngine(engine, config, env),
    );
    const resolved = candidates.find((c) => c.ready)?.engine ?? null;
    return { role, job: ROLE_JOB[role], candidates, resolved };
  });

  const allowPrivate = config.engines?.http?.allowPrivateNetwork === 'true';

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
      readable,
      ...(configProblem ? { problem: configProblem } : {}),
    },
    allowPrivateNetwork: {
      enabled: allowPrivate,
      source: allowPrivate ? 'file' : 'default',
    },
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
    lines.push(`  file: ${file.path} (not present; running on defaults)`);
  } else if (file.problem) {
    lines.push(`  file: ${file.path} (unreadable)`);
    lines.push(`    ! ${file.problem}`);
  } else {
    lines.push(`  file: ${file.path} (present, mode ${file.mode})`);
  }
  lines.push(
    `  allowPrivateNetwork: ${report.allowPrivateNetwork.enabled ? 'on' : 'off'} (${report.allowPrivateNetwork.source})`,
  );
  lines.push('');

  for (const role of report.roles) {
    lines.push(`${role.role} (${role.job})`);
    lines.push(`  resolved: ${role.resolved ?? '(none available)'}`);
    for (const c of role.candidates) {
      const mark = c.ready ? 'READY  ' : 'not set';
      lines.push(`  - ${c.engine.padEnd(16)} ${mark}  ${c.reason}`);
      if (!c.ready && c.fix) {
        lines.push(`      fix: ${c.fix}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
