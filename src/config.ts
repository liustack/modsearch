import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Layered configuration: CLI flags > environment variables > ~/.modsearch/config.json > built-ins.
//
// The file is organised by role, not by engine. A role is a job modsearch can
// do (search the public web, fetch one page, search X), and each role names the
// engine that should do it. Engine credentials and binaries live once, under
// `engines`, so changing one role never disturbs another.

export type Role = 'search' | 'fetch' | 'social';

export const ROLES: Role[] = ['search', 'fetch', 'social'];

export interface EngineSettings {
  apiKey?: string;
  model?: string;
  bin?: string;
  /** 'true' | 'false' as a string so `config set` stays uniform. */
  allowPrivateNetwork?: string;
}

export interface RoleConfig {
  /** Engine for this role. Empty means: use the best one available here. */
  engine?: string;
}

export interface ModsearchConfig {
  search?: RoleConfig;
  fetch?: RoleConfig;
  social?: RoleConfig;
  engines?: Record<string, EngineSettings>;
}

export const CONFIG_DIR = path.join(os.homedir(), '.modsearch');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

/** Resolved at call time so a faked HOME (tests) redirects the config too. */
export function currentConfigPath(): string {
  return path.join(os.homedir(), '.modsearch', 'config.json');
}

const ENV_BINDINGS: Record<string, Partial<Record<keyof EngineSettings, string>>> = {
  tavily: { apiKey: 'TAVILY_API_KEY' },
};

const SETTABLE_ENGINE_FIELDS: Array<keyof EngineSettings> = [
  'apiKey',
  'model',
  'bin',
  'allowPrivateNetwork',
];

/** Engines that used to be pinned globally, mapped to the role they serve. */
const LEGACY_ENGINE_ROLES: Record<string, Role> = {
  'antigravity-cli': 'search',
  antigravity: 'search',
  agy: 'search',
  tavily: 'search',
  'grok-cli': 'social',
  grok: 'social',
  http: 'fetch',
  direct: 'fetch',
};

/** Aliases the registry accepts, mapped to the name settings are stored under. */
const CANONICAL_ENGINE: Record<string, string> = {
  antigravity: 'antigravity-cli',
  agy: 'antigravity-cli',
  grok: 'grok-cli',
  direct: 'http',
};

interface LegacyConfig {
  provider?: string;
  providers?: Record<string, EngineSettings>;
}

/**
 * Configs written before roles existed had one global `provider` plus a
 * `providers` map. Read those rather than making the user start over.
 */
export function migrateLegacyConfig(raw: ModsearchConfig & LegacyConfig): ModsearchConfig {
  if (!raw.providers && !raw.provider) {
    return raw;
  }
  // Merge per engine, not per map: a new `engines.tavily.model` next to an old
  // `providers.tavily.apiKey` used to drop the key entirely.
  const engines: Record<string, EngineSettings> = {};
  for (const [name, settings] of Object.entries(raw.providers ?? {})) {
    const canonical = CANONICAL_ENGINE[name] ?? name;
    engines[canonical] = { ...engines[canonical], ...settings };
  }
  for (const [name, settings] of Object.entries(raw.engines ?? {})) {
    const canonical = CANONICAL_ENGINE[name] ?? name;
    engines[canonical] = { ...engines[canonical], ...settings };
  }

  const migrated: ModsearchConfig = {
    ...(raw.search ? { search: raw.search } : {}),
    ...(raw.fetch ? { fetch: raw.fetch } : {}),
    ...(raw.social ? { social: raw.social } : {}),
    engines,
  };
  const pinned = raw.provider?.trim();
  if (pinned) {
    const role = LEGACY_ENGINE_ROLES[pinned];
    if (role && !migrated[role]?.engine) {
      migrated[role] = { engine: CANONICAL_ENGINE[pinned] ?? pinned };
    }
  }
  return migrated;
}

export function loadConfigFile(configPath = currentConfigPath()): ModsearchConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch (error) {
    // Only a missing file means "no config". Anything else (permissions, a
    // directory in its place) is a real problem worth naming, not a silent
    // downgrade to defaults.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw new Error(
      `Cannot read ${configPath}: ${(error as Error).message}. Fix the file or its permissions.`,
    );
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return migrateLegacyConfig(parsed as ModsearchConfig & LegacyConfig);
  } catch (error) {
    throw new Error(
      `Failed to parse ${configPath}: ${(error as Error).message}. Fix or delete the file.`,
    );
  }
}

/** Engine chosen for this role, if the user set one. */
export function roleEngine(config: ModsearchConfig, role: Role): string | undefined {
  return config[role]?.engine?.trim() || undefined;
}

/** Settings for one engine, with env vars overriding the file. */
export function engineSettings(
  engineName: string,
  config: ModsearchConfig,
  env: NodeJS.ProcessEnv = process.env,
): EngineSettings {
  const fromFile = config.engines?.[engineName] ?? {};
  const bindings = ENV_BINDINGS[engineName] ?? {};

  const settings: EngineSettings = { ...fromFile };
  for (const [field, envName] of Object.entries(bindings) as Array<[keyof EngineSettings, string]>) {
    const value = env[envName]?.trim();
    if (value) {
      settings[field] = value;
    }
  }
  return settings;
}

/**
 * Set a dotted key and persist with 0600 perms. Two shapes:
 *   search.engine tavily             role to engine
 *   engines.tavily.apiKey <key>      engine setting
 * The `engines.` prefix may be dropped: `tavily.apiKey` works too.
 */
export function setConfigValue(
  dottedKey: string,
  value: string,
  configPath = currentConfigPath(),
): void {
  const config = loadConfigFile(configPath);
  const parts = dottedKey.split('.').filter(Boolean);

  if (parts.length === 2 && ROLES.includes(parts[0] as Role) && parts[1] === 'engine') {
    config[parts[0] as Role] = { engine: value };
  } else {
    const [engineName, field] = parts[0] === 'engines' ? [parts[1], parts[2]] : [parts[0], parts[1]];
    if (!engineName || !field) {
      throw new Error(
        `Invalid config key: ${dottedKey}. Use "<${ROLES.join('|')}>.engine" or "engines.<engine>.<${SETTABLE_ENGINE_FIELDS.join('|')}>".`,
      );
    }
    if (!SETTABLE_ENGINE_FIELDS.includes(field as keyof EngineSettings)) {
      throw new Error(`Unknown engine setting: ${field}. Use ${SETTABLE_ENGINE_FIELDS.join(', ')}.`);
    }
    config.engines ??= {};
    config.engines[engineName] ??= {};
    config.engines[engineName][field as keyof EngineSettings] = value;
  }

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // best effort on platforms without chmod
  }
}

export const CONFIG_TEMPLATE: ModsearchConfig = {
  // An empty engine means: use the best one available on this machine.
  search: { engine: '' },
  fetch: { engine: '' },
  social: { engine: '' },
  engines: {
    'antigravity-cli': { bin: 'agy', model: 'gemini-3.6-flash-low' },
    tavily: { apiKey: '' },
    'grok-cli': { bin: 'grok' },
    http: { allowPrivateNetwork: 'false' },
  },
};

/** Write a starter config. Refuses to overwrite unless force is set. */
export function initConfigFile(configPath = currentConfigPath(), force = false): void {
  if (!force && fs.existsSync(configPath)) {
    throw new Error(`${configPath} already exists. Use --force to overwrite.`);
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // best effort on platforms without chmod
  }
}

/** Render the effective config with API keys masked. */
export function renderConfig(config: ModsearchConfig): string {
  const masked: ModsearchConfig = {
    ...config,
    engines: Object.fromEntries(
      Object.entries(config.engines ?? {}).map(([name, settings]) => [
        name,
        { ...settings, ...(settings.apiKey ? { apiKey: maskKey(settings.apiKey) } : {}) },
      ]),
    ),
  };
  return JSON.stringify(masked, null, 2);
}

function maskKey(key: string): string {
  if (key.length <= 8) {
    return '****';
  }
  return `${key.slice(0, 6)}...${key.slice(-2)}`;
}
