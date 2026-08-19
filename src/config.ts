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
  /**
   * Allow Firecrawl to fetch public URLs without an API key. On by default
   * (undefined means on); set false to keep page fetch off Firecrawl's cloud.
   */
  keylessFetch?: boolean;
  /**
   * Endpoint base for the HTTP engines (tavily, exa, firecrawl), replacing the
   * official host: a third-party compatible gateway, a proxy, a self-hosted
   * deployment. The engine appends its documented path (`/search`, `/v2/scrape`)
   * and sends its API key to whatever host this names, which is exactly the
   * point and exactly the risk: only name a host you trust with that key.
   */
  baseURL?: string;
}

export interface ModsearchConfig {
  /** Engine for searching. Empty means: use the best one available here. */
  engine?: string;
  engines?: Record<string, EngineSettings>;
  /**
   * Quota cooldown switch: 'on' (default) or 'off'. On, a quota-spent engine is
   * remembered and moved to the back of the fallback chain until it recovers.
   * Off, nothing is read from or written to state.json and routing is unchanged.
   */
  cooldown?: string;
  /**
   * Global network policy, not an engine setting: allow reserved and private
   * address ranges in the local fetcher. It never authorizes sending a target
   * that is, or resolves to, a reserved address to Firecrawl. Off by default.
   */
  allowPrivateNetwork?: boolean;
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

type StringEngineSetting = 'apiKey' | 'model' | 'bin' | 'baseURL';

const ENV_BINDINGS: Record<string, Partial<Record<StringEngineSetting, string>>> = {
  tavily: { apiKey: 'TAVILY_API_KEY', baseURL: 'TAVILY_BASE_URL' },
  exa: { apiKey: 'EXA_API_KEY', baseURL: 'EXA_BASE_URL' },
  firecrawl: { apiKey: 'FIRECRAWL_API_KEY', baseURL: 'FIRECRAWL_BASE_URL' },
};

const SETTABLE_ENGINE_FIELDS: Array<keyof EngineSettings> = [
  'apiKey',
  'model',
  'bin',
  'baseURL',
  'keylessFetch',
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
  http: 'local',
  direct: 'local',
};

/** The canonical name for an engine, folding aliases (agy, http, direct, ...). */
export function canonicalEngineName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return CANONICAL_ENGINE[trimmed] ?? trimmed;
}

interface LegacyConfig {
  /** v2: one global provider name. */
  provider?: string;
  providers?: Record<string, EngineSettings>;
  /** v3.0-3.1: one engine per role. */
  search?: LegacyRoleConfig;
  fetch?: LegacyRoleConfig;
  social?: LegacyRoleConfig;
}

/** 'true'/'false' (any case) or a real boolean to a boolean, else undefined. */
export function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return undefined;
}

/**
 * Read a config file into the current shape. Two migrations run here, always,
 * so an older file keeps working without the user touching it:
 *
 * - Alias engine keys (agy, antigravity, grok, http, direct) fold onto their
 *   canonical name, and configs written before roles existed (a global
 *   `provider` plus a `providers` map, or a per-role search/fetch/social block)
 *   collapse to the one `engine` knob.
 * - `allowPrivateNetwork` moved from a per-engine string to a top-level boolean.
 *   The old `engines.<name>.allowPrivateNetwork` position and the old `"true"`/
 *   `"false"` string form are both read and promoted to the new top-level key.
 */
export function migrateLegacyConfig(raw: ModsearchConfig & LegacyConfig): ModsearchConfig {
  const hasLegacy = Boolean(raw.providers || raw.provider || raw.search || raw.fetch || raw.social);

  // A top-level string form ("true"/"false") is coerced here too.
  let allowPrivateNetwork = coerceBoolean(
    (raw as { allowPrivateNetwork?: unknown }).allowPrivateNetwork,
  );

  // Merge per engine, not per map: a new `engines.tavily.model` next to an old
  // `providers.tavily.apiKey` used to drop the key entirely. The retired
  // per-engine allowPrivateNetwork flag is lifted out to the top level.
  const engines: Record<string, EngineSettings> = {};
  const fold = (source: Record<string, Record<string, unknown>> | undefined) => {
    for (const [name, rawSettings] of Object.entries(source ?? {})) {
      const canonical = CANONICAL_ENGINE[name] ?? name;
      const {
        allowPrivateNetwork: legacyFlag,
        keylessFetch: rawKeylessFetch,
        ...rest
      } = rawSettings;
      if (legacyFlag !== undefined) {
        allowPrivateNetwork ??= coerceBoolean(legacyFlag);
      }
      const keylessFetch = coerceBoolean(rawKeylessFetch);
      engines[canonical] = {
        ...engines[canonical],
        ...(rest as EngineSettings),
        ...(keylessFetch === undefined ? {} : { keylessFetch }),
      };
    }
  };
  fold(raw.providers as Record<string, Record<string, unknown>> | undefined);
  fold(raw.engines as Record<string, Record<string, unknown>> | undefined);

  // An engine entry that held nothing but the migrated flag is now empty: drop
  // it so the effective config does not show a hollow `local: {}`.
  for (const [name, settings] of Object.entries(engines)) {
    if (Object.keys(settings).length === 0) {
      delete engines[name];
    }
  }

  // Any older shape collapses to the one knob: a per-role search engine, or a
  // v2 global provider that happened to be a search engine. A current config
  // keeps its `engine` verbatim, empty string included.
  const legacySearch = raw.search?.engine?.trim();
  const pinned = raw.provider?.trim();
  const fromPin =
    pinned && LEGACY_ENGINE_ROLES[pinned] === 'search'
      ? (CANONICAL_ENGINE[pinned] ?? pinned)
      : undefined;
  const engine = hasLegacy ? raw.engine?.trim() || legacySearch || fromPin : raw.engine;

  const config: ModsearchConfig = { engines };
  if (engine !== undefined) {
    config.engine = engine;
  }
  if (raw.cooldown !== undefined) {
    config.cooldown = raw.cooldown;
  }
  if (allowPrivateNetwork !== undefined) {
    config.allowPrivateNetwork = allowPrivateNetwork;
  }
  return config;
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

/** Whether the quota cooldown is active. On by default, off only when set to 'off'. */
export function cooldownEnabled(config: ModsearchConfig): boolean {
  return config.cooldown?.trim().toLowerCase() !== 'off';
}

/** Whether reserved and private address ranges are allowed. Off by default. */
export function allowsPrivateNetwork(config: ModsearchConfig): boolean {
  return config.allowPrivateNetwork === true;
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
  for (const [field, envName] of Object.entries(bindings) as Array<
    [StringEngineSetting, string]
  >) {
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
  } else if (parts.length === 1 && parts[0] === 'cooldown') {
    const normalized = value.trim().toLowerCase();
    if (normalized !== 'on' && normalized !== 'off') {
      throw new Error(`Invalid cooldown value: ${value}. Use on or off.`);
    }
    config.cooldown = normalized;
  } else if (parts.length === 1 && parts[0] === 'allowPrivateNetwork') {
    const parsed = coerceBoolean(value);
    if (parsed === undefined) {
      throw new Error(`Invalid allowPrivateNetwork value: ${value}. Use true or false.`);
    }
    config.allowPrivateNetwork = parsed;
  } else {
    const [engineName, field] =
      parts[0] === 'engines' ? [parts[1], parts[2]] : [parts[0], parts[1]];
    if (!engineName || !field) {
      throw new Error(
        `Invalid config key: ${dottedKey}. Use "engine" or "engines.<engine>.<${SETTABLE_ENGINE_FIELDS.join('|')}>".`,
      );
    }
    if (!SETTABLE_ENGINE_FIELDS.includes(field as keyof EngineSettings)) {
      throw new Error(
        `Unknown engine setting: ${field}. Use ${SETTABLE_ENGINE_FIELDS.join(', ')}.`,
      );
    }
    if (field === 'keylessFetch') {
      const parsed = coerceBoolean(value);
      if (parsed === undefined) {
        throw new Error(`Invalid keylessFetch value: ${value}. Use true or false.`);
      }
      config.engines ??= {};
      config.engines[engineName] ??= {};
      config.engines[engineName].keylessFetch = parsed;
      writeConfigFile(config, configPath);
      return;
    }
    if (field === 'baseURL') {
      const trimmed = value.trim();
      // Empty unsets the override, back to the official endpoint. Anything else
      // must be a full origin, refused here rather than as a confusing fetch
      // failure at search time.
      if (trimmed === '') {
        delete config.engines?.[engineName]?.baseURL;
        writeConfigFile(config, configPath);
        return;
      }
      if (!/^https?:\/\//i.test(trimmed)) {
        throw new Error(
          `Invalid baseURL: ${value}. Use a full http(s) URL, e.g. https://api.example.com`,
        );
      }
      value = trimmed;
    }
    config.engines ??= {};
    config.engines[engineName] ??= {};
    config.engines[engineName][field as StringEngineSetting] = value;
  }

  writeConfigFile(config, configPath);
}

function writeConfigFile(config: ModsearchConfig, configPath: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // best effort on platforms without chmod
  }
}

/**
 * The starter file holds nothing but the shape. Pre-filling every engine and
 * every default looked helpful and was not: it buried the one real decision in
 * placeholders, and writing today's defaults into the file freezes them, so a
 * later change to a default model would be silently overridden by this copy.
 */
export const CONFIG_TEMPLATE: ModsearchConfig = {
  // Empty means: use the best engine available on this machine.
  engine: '',
  engines: {},
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

/**
 * Render the effective config: what modsearch will actually use, not just what
 * the file says. Environment variables are merged in the way `engineSettings`
 * merges them, every value is tagged with where it came from (`file` or `env`),
 * alias engine keys (agy, antigravity, grok, direct) are shown under their
 * canonical name, and API keys stay masked.
 */
export function renderEffectiveConfig(
  config: ModsearchConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const tag = (value: string | boolean, source: 'file' | 'env') => `${value} (${source})`;

  const out: Record<string, unknown> = {};
  out.engine = config.engine ? tag(config.engine, 'file') : '(unset: automatic)';
  out.cooldown = config.cooldown ? tag(config.cooldown, 'file') : 'on (default)';
  out.allowPrivateNetwork =
    config.allowPrivateNetwork === undefined
      ? 'false (default)'
      : tag(String(config.allowPrivateNetwork), 'file');

  const engines: Record<string, Record<string, string>> = {};
  const ensure = (name: string) => {
    engines[name] ??= {};
    return engines[name];
  };

  // File settings first, alias keys folded onto their canonical engine.
  for (const [rawName, settings] of Object.entries(config.engines ?? {})) {
    const canonical = CANONICAL_ENGINE[rawName] ?? rawName;
    const target = ensure(canonical);
    for (const field of SETTABLE_ENGINE_FIELDS) {
      const value = settings[field];
      if (value === undefined) {
        continue;
      }
      target[field] = tag(field === 'apiKey' ? maskKey(String(value)) : value, 'file');
    }
  }

  // Environment overrides, exactly the bindings engineSettings applies. An env
  // value wins over the file, so it overwrites the tag too.
  for (const [engineName, bindings] of Object.entries(ENV_BINDINGS)) {
    const canonical = CANONICAL_ENGINE[engineName] ?? engineName;
    for (const [field, envName] of Object.entries(bindings) as Array<
      [StringEngineSetting, string]
    >) {
      const value = env[envName]?.trim();
      if (!value) {
        continue;
      }
      ensure(canonical)[field] = tag(field === 'apiKey' ? maskKey(value) : value, 'env');
    }
  }

  out.engines = engines;
  return JSON.stringify(out, null, 2);
}

function maskKey(key: string): string {
  if (key.length <= 8) {
    return '****';
  }
  return `${key.slice(0, 6)}...${key.slice(-2)}`;
}
