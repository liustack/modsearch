import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Layered configuration: CLI flags > environment variables > ~/.modsearch/config.json > built-ins.
//
// There is one decision to make, so the file has one knob: `engine`, the
// engine you want searching with. Everything else follows from what an engine
// can do. Reading a page uses that same engine when it can fetch, and the
// built-in local fetcher when it cannot. Searching X uses Grok Build, because
// nothing else can see inside X. Credentials and binaries live under `engines`.

export type Role = 'search' | 'fetch' | 'social';

export const ROLES: Role[] = ['search', 'fetch', 'social'];

/** The one role a user picks an engine for. The rest follow from capability. */
export const CONFIGURED_ROLE: Role = 'search';

export interface EngineSettings {
  apiKey?: string;
  model?: string;
  bin?: string;
  /** 'true' | 'false' as a string so `config set` stays uniform. */
  allowPrivateNetwork?: string;
}

export interface ModsearchConfig {
  /** Engine for searching. Empty means: use the best one available here. */
  engine?: string;
  engines?: Record<string, EngineSettings>;
}

/** Shapes older configs used before this collapsed to one knob. */
interface LegacyRoleConfig {
  engine?: string;
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
  /** v2: one global provider name. */
  provider?: string;
  providers?: Record<string, EngineSettings>;
  /** v3.0-3.1: one engine per role. */
  search?: LegacyRoleConfig;
  fetch?: LegacyRoleConfig;
  social?: LegacyRoleConfig;
}

/**
 * Configs written before roles existed had one global `provider` plus a
 * `providers` map. Read those rather than making the user start over.
 */
export function migrateLegacyConfig(raw: ModsearchConfig & LegacyConfig): ModsearchConfig {
  const hasLegacy = Boolean(raw.providers || raw.provider || raw.search || raw.fetch || raw.social);
  if (!hasLegacy) {
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

  // Any older shape collapses to the one knob: a per-role search engine, or a
  // v2 global provider that happened to be a search engine.
  const legacySearch = raw.search?.engine?.trim();
  const pinned = raw.provider?.trim();
  const fromPin =
    pinned && LEGACY_ENGINE_ROLES[pinned] === 'search'
      ? (CANONICAL_ENGINE[pinned] ?? pinned)
      : undefined;
  const engine = raw.engine?.trim() || legacySearch || fromPin;

  return { ...(engine ? { engine } : {}), engines };
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

/** The engine the user asked for, if any. */
export function chosenEngine(config: ModsearchConfig): string | undefined {
  return config.engine?.trim() || undefined;
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

  // `engine <name>` is the whole role surface. `search.engine` still works so
  // muscle memory from the previous shape does not hit an error.
  if (parts.length === 1 && parts[0] === 'engine') {
    config.engine = value;
  } else if (parts.length === 2 && parts[0] === 'search' && parts[1] === 'engine') {
    config.engine = value;
  } else {
    const [engineName, field] = parts[0] === 'engines' ? [parts[1], parts[2]] : [parts[0], parts[1]];
    if (!engineName || !field) {
      throw new Error(
        `Invalid config key: ${dottedKey}. Use "engine" or "engines.<engine>.<${SETTABLE_ENGINE_FIELDS.join('|')}>".`,
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
  // Empty means: use the best engine available on this machine. Page fetch
  // follows this choice when the engine can fetch, and falls to the built-in
  // local fetcher when it cannot. X always uses Grok Build.
  engine: '',
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
