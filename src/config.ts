import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Runtime-safe: providers/index.ts imports nothing from this module at runtime
// (its config import is type-only), so this does not create an import cycle.
import { enginesForRole, findEngine, listEngines } from './providers/index.ts';
import { splitApiKeys } from './util/apiKeys.ts';
import { maskUrlCredentials, redactSecrets } from './util/redact.ts';

// Layered configuration: CLI flags > environment variables > ~/.modsearch/config.json > built-ins.
//
// `engine` is the soft search preference and `fetchEngine` the soft page-fetch
// one (unset, fetch follows `engine`). `engines.<name>.enabled` decides which
// engines automatic routing may use, with missing meaning enabled. Everything
// else follows from engine capability. Credentials and binaries also live
// under `engines`.

export type Role = 'search' | 'fetch' | 'social';

export const ROLES: Role[] = ['search', 'fetch', 'social'];

/** The role whose preferred engine is stored at the top level. */
export const CONFIGURED_ROLE: Role = 'search';

export interface EngineSettings {
  apiKey?: string;
  model?: string;
  bin?: string;
  /** Participate in automatic routing. Undefined means enabled. */
  enabled?: boolean;
  /**
   * Allow Firecrawl to fetch public URLs without an API key. On by default
   * (undefined means on); set false to keep page fetch off Firecrawl's cloud.
   */
  keylessFetch?: boolean;
  /**
   * Endpoint base for the HTTP engines (tavily, exa, firecrawl, keenable), replacing the
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
  /**
   * Engine for page fetch. Empty means: follow `engine` when it can fetch,
   * otherwise the built-in fetch order.
   */
  fetchEngine?: string;
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

/** Shapes older configs used before role preferences collapsed to one field. */
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
  keenable: { apiKey: 'KEENABLE_API_KEY', baseURL: 'KEENABLE_BASE_URL' },
};

const SETTABLE_ENGINE_FIELDS: Array<keyof EngineSettings> = [
  'apiKey',
  'model',
  'bin',
  'enabled',
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

/**
 * The canonical name for an engine, folding aliases (agy, http, direct, ...).
 * Own properties only: the aliases table is a plain object, and a bare index
 * walks the prototype chain, so "constructor" resolved to Object's constructor
 * function, read as truthy, and a `config set constructor.apiKey` wrote the
 * key onto that global, printed success, and saved nothing.
 */
export function canonicalEngineName(name: string): string {
  const trimmed = name.trim().toLowerCase();
  return Object.hasOwn(CANONICAL_ENGINE, trimmed) ? CANONICAL_ENGINE[trimmed] : trimmed;
}

/** JSON-parsed objects only: null, arrays, and prototype residents are not settings. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
 *   collapse to the top-level `engine` preference.
 * - `allowPrivateNetwork` moved from a per-engine string to a top-level boolean.
 *   The old `engines.<name>.allowPrivateNetwork` position and the old `"true"`/
 *   `"false"` string form are both read and promoted to the new top-level key.
 */
/**
 * Every string apiKey the raw file carried, including ones the alias fold
 * displaced (two alias spellings of one engine can each bring a key; the merge
 * keeps one). A displaced key is gone from the config object but may survive
 * in another field's text, so config show must still know to scrub it. Keyed
 * by the migrated config object: this never touches the JSON shape.
 */
const SEEN_API_KEYS = new WeakMap<ModsearchConfig, string[]>();

export function migrateLegacyConfig(raw: ModsearchConfig & LegacyConfig): ModsearchConfig {
  const hasLegacy = Boolean(raw.providers || raw.provider || raw.search || raw.fetch || raw.social);
  const seenApiKeys = new Set<string>();

  // A top-level string form ("true"/"false") is coerced here too.
  let allowPrivateNetwork = coerceBoolean(
    (raw as { allowPrivateNetwork?: unknown }).allowPrivateNetwork,
  );

  // Merge per engine, not per map: a new `engines.tavily.model` next to an old
  // `providers.tavily.apiKey` used to drop the key entirely. The retired
  // per-engine allowPrivateNetwork flag is lifted out to the top level.
  //
  // Null prototype on purpose: the entry names come from a hand-editable file,
  // and on a normal object literal `engines["__proto__"] = {...}` does not
  // define a property, it SETS THE PROTOTYPE. The entry then hides from
  // Object.entries and JSON.stringify (doctor would report an inherited key as
  // present, and the next write would silently drop it) while dot-access still
  // sees it. On a null-prototype object the same name is an ordinary own
  // property: visible, serialized, and judged like any unknown engine.
  const engines: Record<string, EngineSettings> = Object.create(null);
  const fold = (source: Record<string, Record<string, unknown>> | undefined) => {
    if (!isPlainObject(source)) {
      return;
    }
    for (const [name, rawSettings] of Object.entries(source)) {
      // A hand-edited entry that is not an object (a string, an array) has no
      // fields to merge; skip it rather than spreading its characters.
      if (!isPlainObject(rawSettings)) {
        continue;
      }
      if (typeof rawSettings.apiKey === 'string') {
        for (const apiKey of splitApiKeys(rawSettings.apiKey)) {
          seenApiKeys.add(apiKey);
        }
      }
      const canonical = canonicalEngineName(name);
      const {
        allowPrivateNetwork: legacyFlag,
        keylessFetch: rawKeylessFetch,
        enabled: rawEnabled,
        ...rest
      } = rawSettings;
      if (legacyFlag !== undefined) {
        allowPrivateNetwork ??= coerceBoolean(legacyFlag);
      }
      const keylessFetch = coerceBoolean(rawKeylessFetch);
      const enabled = coerceBoolean(rawEnabled);
      engines[canonical] = {
        ...engines[canonical],
        ...(rest as EngineSettings),
        ...(keylessFetch === undefined ? {} : { keylessFetch }),
        ...(enabled === undefined ? {} : { enabled }),
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

  // Any older shape collapses to the preference: a per-role search engine, or a
  // v2 global provider that happened to be a search engine. A current config
  // keeps its `engine` verbatim, empty string included.
  const legacySearch = raw.search?.engine?.trim();
  const pinned = raw.provider?.trim();
  const fromPin =
    pinned && Object.hasOwn(LEGACY_ENGINE_ROLES, pinned) && LEGACY_ENGINE_ROLES[pinned] === 'search'
      ? canonicalEngineName(pinned)
      : undefined;
  const engine = hasLegacy ? raw.engine?.trim() || legacySearch || fromPin : raw.engine;

  const config: ModsearchConfig = { engines };
  if (engine !== undefined) {
    config.engine = engine;
  }
  if (typeof raw.fetchEngine === 'string') {
    config.fetchEngine = raw.fetchEngine;
  }
  if (raw.cooldown !== undefined) {
    config.cooldown = raw.cooldown;
  }
  if (allowPrivateNetwork !== undefined) {
    config.allowPrivateNetwork = allowPrivateNetwork;
  }
  if (seenApiKeys.size > 0) {
    SEEN_API_KEYS.set(config, [...seenApiKeys]);
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

/**
 * A project's own `.modsearch/config.json`, found by walking up from the
 * working directory the way editors find workspace settings. A project
 * directory may be someone else's clone, so the file can only narrow what the
 * user's global config allows, never widen it:
 *
 * - `engine` and `fetchEngine` set the preferred search and page-fetch
 *   engines. A project's choice is not consent to keyless cloud fetch (see
 *   engineChoiceIsConsent).
 * - `engines.<name>.enabled: false` keeps an engine out of automatic routing.
 *   `true` cannot switch back on what the global config switched off.
 * - `engines.<name>.model` picks the model.
 *
 * Everything else (keys, binaries, endpoints, keylessFetch, cooldown,
 * allowPrivateNetwork) is read from the global file only. A `bin` from a clone
 * would run any program, and a `baseURL` would send the user's key anywhere.
 * Ignored entries are reported by path, never silently applied.
 */
export interface ProjectConfig {
  path: string;
  engine?: string;
  fetchEngine?: string;
  engines: Record<string, { enabled?: false; model?: string }>;
  /** Dotted paths the file set that a project config may not set. */
  ignored: string[];
}

/** `MODSEARCH_PROJECT_CONFIG=off` skips the lookup (a host that serves many projects from one cwd). */
export function projectConfigDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MODSEARCH_PROJECT_CONFIG?.trim().toLowerCase() === 'off';
}

/**
 * The nearest `.modsearch/config.json` at or above `cwd`, or undefined. The
 * walk stops at the home directory without checking it, because
 * `~/.modsearch/config.json` is the global file, not a project's. Both the
 * HOME-derived directory and the account's real one stop it, so a run under a
 * redirected HOME still never mistakes the account's global file for a project.
 */
export function findProjectConfigPath(
  cwd: string = process.cwd(),
  home: string = os.homedir(),
): string | undefined {
  const stops = new Set([path.resolve(home)]);
  try {
    stops.add(path.resolve(os.userInfo().homedir));
  } catch {
    // No passwd entry for this uid (some containers): HOME is all there is.
  }
  let dir = path.resolve(cwd);
  for (;;) {
    if (stops.has(dir)) {
      return undefined;
    }
    const candidate = path.join(dir, '.modsearch', 'config.json');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** Read a project file, keeping only what a project may set. */
export function loadProjectConfig(filePath: string): ProjectConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (error) {
    throw new Error(
      `Failed to read the project config ${filePath}: ${(error as Error).message}. Fix or delete the file.`,
    );
  }
  const project: ProjectConfig = { path: filePath, engines: Object.create(null), ignored: [] };
  if (!isPlainObject(parsed)) {
    throw new Error(`The project config ${filePath} is not a JSON object. Fix or delete the file.`);
  }
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'engine' && typeof value === 'string') {
      project.engine = value;
    } else if (key === 'fetchEngine' && typeof value === 'string') {
      project.fetchEngine = value;
    } else if (key === 'engines' && isPlainObject(value)) {
      for (const [rawName, settings] of Object.entries(value)) {
        const name = canonicalEngineName(rawName);
        if (!findEngine(name) || !isPlainObject(settings)) {
          project.ignored.push(`engines.${rawName}`);
          continue;
        }
        for (const [field, fieldValue] of Object.entries(settings)) {
          if (field === 'enabled' && coerceBoolean(fieldValue) === false) {
            project.engines[name] = { ...project.engines[name], enabled: false };
          } else if (field === 'model' && typeof fieldValue === 'string') {
            project.engines[name] = { ...project.engines[name], model: fieldValue };
          } else {
            project.ignored.push(`engines.${rawName}.${field}`);
          }
        }
      }
    } else {
      project.ignored.push(key);
    }
  }
  return project;
}

/** The config fields that hold an engine preference. */
export type PreferenceField = 'engine' | 'fetchEngine';

/** Engine choices that came from a project file, keyed by the merged config. */
const PROJECT_ENGINE_CHOICE = new WeakMap<ModsearchConfig, Set<PreferenceField>>();

/** Lay a project file over the global config. The global object is not mutated. */
export function applyProjectConfig(
  global: ModsearchConfig,
  project: ProjectConfig,
): ModsearchConfig {
  const globalEngines = isPlainObject(global.engines) ? global.engines : {};
  const engines: Record<string, EngineSettings> = Object.create(null);
  for (const [name, settings] of Object.entries(globalEngines)) {
    engines[name] = { ...settings };
  }
  for (const [name, settings] of Object.entries(project.engines)) {
    engines[name] = { ...engines[name], ...settings };
  }
  const merged: ModsearchConfig = { ...global, engines };
  const fromProject = new Set<PreferenceField>();
  if (project.engine !== undefined) {
    merged.engine = project.engine;
    fromProject.add('engine');
  }
  if (project.fetchEngine !== undefined) {
    merged.fetchEngine = project.fetchEngine;
    fromProject.add('fetchEngine');
  }
  if (fromProject.size > 0) {
    PROJECT_ENGINE_CHOICE.set(merged, fromProject);
  }
  const seen = SEEN_API_KEYS.get(global);
  if (seen) {
    SEEN_API_KEYS.set(merged, seen);
  }
  return merged;
}

/**
 * Does the engine named in this preference field count as the user's consent
 * to its keyless cloud fetch, overriding `keylessFetch: false`? Only when the
 * user chose it in their own global config. A project file cannot opt anyone
 * into the cloud.
 */
export function engineChoiceIsConsent(
  config: ModsearchConfig,
  field: PreferenceField = 'engine',
): boolean {
  return !PROJECT_ENGINE_CHOICE.get(config)?.has(field);
}

export interface EffectiveConfig {
  config: ModsearchConfig;
  /** The project file that was applied, if one was found. */
  project?: ProjectConfig;
}

/** The global config with the nearest project file laid over it. */
export function loadEffectiveConfig(
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    configPath?: string;
    home?: string;
  } = {},
): EffectiveConfig {
  const global = loadConfigFile(options.configPath ?? currentConfigPath());
  if (projectConfigDisabled(options.env ?? process.env)) {
    return { config: global };
  }
  const projectPath = findProjectConfigPath(options.cwd, options.home);
  if (!projectPath) {
    return { config: global };
  }
  const project = loadProjectConfig(projectPath);
  return { config: applyProjectConfig(global, project), project };
}

/** One line for stderr when a project file set things it may not. */
export function describeIgnoredProjectFields(project: ProjectConfig): string | undefined {
  if (project.ignored.length === 0) {
    return undefined;
  }
  return `modsearch: ignored ${project.ignored.join(', ')} in ${project.path}. A project config may set only engine, fetchEngine, engines.<name>.enabled false, and engines.<name>.model. Keys, binaries, endpoints, and network settings come from ~/.modsearch/config.json.`;
}

/** The engine the user asked for, if any. */
export function chosenEngine(config: ModsearchConfig): string | undefined {
  return config.engine?.trim() || undefined;
}

/** The engine the user asked for page fetch, if any. */
export function chosenFetchEngine(config: ModsearchConfig): string | undefined {
  return config.fetchEngine?.trim() || undefined;
}

/**
 * The engine the user prefers for one role, and the field it came from. Page
 * fetch reads `fetchEngine` first and falls back to `engine`, so a user who
 * set only one engine still has it tried for both jobs when it can do both.
 */
export function preferredEngine(
  config: ModsearchConfig,
  role: Role,
): { name: string; field: PreferenceField } | undefined {
  if (role === 'fetch') {
    const fetchName = chosenFetchEngine(config);
    if (fetchName) {
      return { name: fetchName, field: 'fetchEngine' };
    }
  }
  const name = chosenEngine(config);
  return name ? { name, field: 'engine' } : undefined;
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
  const engines = isPlainObject(config.engines) ? config.engines : {};
  const fromFile =
    Object.hasOwn(engines, engineName) && isPlainObject(engines[engineName])
      ? (engines[engineName] as EngineSettings)
      : {};
  const bindings = Object.hasOwn(ENV_BINDINGS, engineName) ? ENV_BINDINGS[engineName] : {};

  const settings: EngineSettings = { ...fromFile };
  for (const [field, envName] of Object.entries(bindings) as Array<[StringEngineSetting, string]>) {
    const value = env[envName]?.trim();
    const present = field === 'apiKey' ? splitApiKeys(value).length > 0 : Boolean(value);
    if (value && present) {
      settings[field] = value;
    }
  }
  return settings;
}

/**
 * Set a dotted key and persist with 0600 perms. Two shapes:
 *   search.engine tavily             role to engine
 *   fetchEngine keenable             page-fetch engine
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
  // muscle memory from the previous shape does not hit an error. A non-empty
  // value must name a real engine: the router tolerates a typo in a
  // hand-edited file with a warning, but the CLI has no reason to create one,
  // and doctor would echo the bad value back (which, pasted secrets included,
  // is text better refused than displayed). Empty returns to automatic.
  const isEngineKey =
    (parts.length === 1 && parts[0] === 'engine') ||
    (parts.length === 2 && parts[0] === 'search' && parts[1] === 'engine');
  if (isEngineKey) {
    const trimmed = value.trim();
    if (trimmed !== '' && !findEngine(trimmed)) {
      throw new Error(`Unknown engine: ${value}. Known engines: ${listEngines().join(', ')}.`);
    }
    config.engine = trimmed === '' ? '' : canonicalEngineName(trimmed);
  } else if (
    (parts.length === 1 && parts[0] === 'fetchEngine') ||
    (parts.length === 2 && parts[0] === 'fetch' && parts[1] === 'engine')
  ) {
    // Same rules as `engine`, plus the engine must be able to fetch: a
    // search-only engine here would never be tried, which reads as a silent
    // no-op. Empty returns page fetch to following `engine`.
    const trimmed = value.trim();
    if (trimmed === '') {
      config.fetchEngine = '';
    } else {
      const engine = findEngine(trimmed);
      if (!engine) {
        throw new Error(`Unknown engine: ${value}. Known engines: ${listEngines().join(', ')}.`);
      }
      if (!engine.roles.includes('fetch')) {
        throw new Error(
          `${engine.name} cannot fetch pages. Engines that can: ${enginesForRole('fetch')
            .map((candidate) => candidate.name)
            .join(', ')}.`,
        );
      }
      config.fetchEngine = engine.name;
    }
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
    const [rawEngineName, field] =
      parts[0] === 'engines' ? [parts[1], parts[2]] : [parts[0], parts[1]];
    if (!rawEngineName || !field) {
      throw new Error(
        `Invalid config key: ${dottedKey}. Use "engine", "fetchEngine", or "engines.<engine>.<${SETTABLE_ENGINE_FIELDS.join('|')}>".`,
      );
    }
    // The file is read back by exact lowercase canonical key, so an unknown or
    // miscased name would be stored, reported saved, and never read again.
    // Refusing here turns silent data loss into an immediate, fixable error.
    const engineName = canonicalEngineName(rawEngineName);
    if (!findEngine(engineName)) {
      throw new Error(
        `Unknown engine: ${rawEngineName}. Known engines: ${listEngines().join(', ')}.`,
      );
    }
    if (!SETTABLE_ENGINE_FIELDS.includes(field as keyof EngineSettings)) {
      throw new Error(
        `Unknown engine setting: ${field}. Use ${SETTABLE_ENGINE_FIELDS.join(', ')}.`,
      );
    }
    // A hand-edited file can put anything at these positions. Refuse to spread
    // a non-object rather than corrupting the write.
    if (config.engines !== undefined && !isPlainObject(config.engines)) {
      throw new Error(
        `The "engines" section of the config file is not an object. Fix or remove it.`,
      );
    }
    if (config.engines?.[engineName] !== undefined && !isPlainObject(config.engines[engineName])) {
      throw new Error(
        `The "engines.${engineName}" entry of the config file is not an object. Fix or remove it.`,
      );
    }
    if (field === 'keylessFetch' || field === 'enabled') {
      const parsed = coerceBoolean(value);
      if (parsed === undefined) {
        throw new Error(`Invalid ${field} value: ${value}. Use true or false.`);
      }
      if (field === 'enabled' && parsed) {
        const settings = config.engines?.[engineName];
        if (settings) {
          delete settings.enabled;
          if (Object.keys(settings).length === 0) {
            delete config.engines?.[engineName];
          }
        }
        writeConfigFile(config, configPath);
        return;
      }
      config.engines ??= {};
      config.engines[engineName] ??= {};
      config.engines[engineName][field] = parsed;
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

/**
 * The config directory holds key material, so it is created 0700. An existing
 * directory keeps whatever mode it has: re-tightening on every write would
 * override permissions a user set deliberately, and the files inside carry
 * their own 0600. chmod is best-effort for platforms without POSIX modes.
 */
function ensurePrivateDir(dir: string): void {
  if (fs.existsSync(dir)) {
    return;
  }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // best effort on platforms without chmod
  }
}

/**
 * Write key material as a fresh 0600 file and rename it into place.
 * writeFileSync's mode only applies when it CREATES the file: rewriting an
 * existing 0644 config would land the new key world-readable until the chmod,
 * and a pre-placed file owned by someone else would take the content into
 * their inode with the chmod failing silently. A same-directory temp file is
 * born 0600 and rename replaces the inode, so neither window exists.
 */
function writePrivateFile(filePath: string, content: string): void {
  ensurePrivateDir(path.dirname(filePath));
  const unique = `${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const tmp = path.join(path.dirname(filePath), `.config.${unique}.tmp`);
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  try {
    fs.renameSync(tmp, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // the rename failure is the error worth reporting
    }
    throw error;
  }
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best effort on platforms without chmod
  }
}

function writeConfigFile(config: ModsearchConfig, configPath: string): void {
  writePrivateFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

/**
 * The starter file holds nothing but the shape. Pre-filling every engine and
 * every default looked helpful and was not: it buried the real decisions in
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
  writePrivateFile(configPath, `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`);
}

/** Every API key the file or environment holds, displaced fold casualties included. */
function knownApiKeys(config: ModsearchConfig, env: NodeJS.ProcessEnv): string[] {
  const keys = new Set<string>(SEEN_API_KEYS.get(config) ?? []);
  const enginesRoot = isPlainObject(config.engines) ? config.engines : {};
  for (const entry of Object.values(enginesRoot)) {
    if (isPlainObject(entry) && typeof entry.apiKey === 'string') {
      for (const apiKey of splitApiKeys(entry.apiKey)) {
        keys.add(apiKey);
      }
    }
  }
  for (const bindings of Object.values(ENV_BINDINGS)) {
    const variable = bindings.apiKey;
    for (const apiKey of splitApiKeys(variable ? env[variable] : undefined)) {
      keys.add(apiKey);
    }
  }
  return [...keys];
}

/**
 * Redact every known key from a value tree's strings, longest key first so an
 * overlapping shorter key cannot split a longer one into survivable halves.
 * No length assumption at all: the config layer imposes no minimum on an
 * apiKey and gateways issue what they issue, so even a one-character key is
 * scrubbed from every string it appears in. A short key shreds the view's
 * readability, and that is the right failure: this output exists to be pasted
 * into issues, and a shredded view is safe where a readable one leaking a
 * credential is not.
 *
 * Values ONLY, by structural contract: every property name in the rendered
 * view is a compile-time constant or a registry engine name, and user data
 * (hand-written engine spellings included) lives inside values.
 */
function redactValues<T>(value: T, keys: string[]): T {
  const ordered = [...keys].sort((a, b) => b.length - a.length);
  const scrub = (text: string): string => {
    let out = text;
    for (const key of ordered) {
      if (key.length > 0) {
        out = out.split(key).join('[redacted]');
      }
    }
    return out;
  };
  const walk = (node: unknown): unknown => {
    // The known-key split runs with no length floor, then the shape net
    // (redactSecrets) catches token-shaped strings nobody declared as a key:
    // an sk- credential pasted into a model note, an api_key= parameter in a
    // gateway URL. A secret with no known shape living only in a non-secret
    // field stays unknowable; the security doc says so.
    if (typeof node === 'string') return redactSecrets(scrub(node));
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = Object.create(null);
      for (const [key, entry] of Object.entries(node)) {
        out[key] = walk(entry);
      }
      return out;
    }
    return node;
  };
  return walk(value) as T;
}

/**
 * Render the effective config: what modsearch will actually use, not just what
 * the file says. Environment variables are merged in the way `engineSettings`
 * merges them, every value is tagged with where it came from (`file` or `env`),
 * alias engine keys (agy, antigravity, grok, direct) are shown under their
 * canonical name, and API keys stay masked.
 *
 * Redaction is a boundary here, not a per-field habit: this output's product
 * contract is being safe to paste into an issue. A key is masked in its own
 * field, scrubbed from every other field on the same row (a key pasted into a
 * gateway URL or a model note used to print in full one field over from its
 * own mask), URL credentials are masked, unknown engine names become note
 * values rather than property names, and a final pass scrubs every known key
 * from every string in the tree.
 */
export function renderEffectiveConfig(
  config: ModsearchConfig,
  env: NodeJS.ProcessEnv = process.env,
  project?: ProjectConfig,
): string {
  const tag = (value: string | boolean, source: 'file' | 'project' | 'env') =>
    `${value} (${source})`;

  const out: Record<string, unknown> = {};
  out.engine = config.engine ? tag(config.engine, 'file') : '(unset: automatic)';
  if (project?.engine !== undefined) {
    out.engine = project.engine ? tag(project.engine, 'project') : '(unset: automatic) (project)';
  }
  out.fetchEngine = config.fetchEngine?.trim()
    ? tag(config.fetchEngine, 'file')
    : '(unset: follows engine)';
  if (project?.fetchEngine !== undefined) {
    out.fetchEngine = project.fetchEngine.trim()
      ? tag(project.fetchEngine, 'project')
      : '(unset: follows engine) (project)';
  }
  out.cooldown = config.cooldown ? tag(config.cooldown, 'file') : 'on (default)';
  out.allowPrivateNetwork =
    config.allowPrivateNetwork === undefined
      ? 'false (default)'
      : tag(String(config.allowPrivateNetwork), 'file');

  const engines: Record<string, Record<string, string>> = {};
  const notes: string[] = [];
  const ensure = (name: string) => {
    engines[name] ??= {};
    return engines[name];
  };

  const shown = (field: string, value: unknown, entryKeys: string[]): string => {
    if (field === 'apiKey') {
      return maskKeys(String(value));
    }
    let text = String(value);
    if (field === 'baseURL') {
      text = maskUrlCredentials(text);
    }
    // Same-row wash: the row's own key must not survive in its other fields.
    for (const entryKey of entryKeys) {
      text = text.split(entryKey).join('[redacted]');
    }
    return text;
  };

  // File settings first, alias keys folded onto their canonical engine. An
  // engine name the registry does not know never becomes a property name: a
  // hand-written spelling is user data, and user data lives in values only.
  for (const [rawName, settings] of Object.entries(config.engines ?? {})) {
    if (!isPlainObject(settings)) {
      notes.push(`engines entry is not an object and was ignored`);
      continue;
    }
    const canonical = canonicalEngineName(rawName);
    if (!findEngine(canonical)) {
      notes.push(`unknown engine entry (not one of: ${listEngines().join(', ')})`);
      continue;
    }
    const target = ensure(canonical);
    const entryKeys = splitApiKeys(
      typeof settings.apiKey === 'string' ? settings.apiKey : undefined,
    );
    for (const field of SETTABLE_ENGINE_FIELDS) {
      const value = settings[field];
      if (value === undefined) {
        continue;
      }
      target[field] = tag(shown(field, value, entryKeys), 'file');
    }
  }

  // The project file lays its few allowed fields over the global file.
  if (project) {
    for (const [name, settings] of Object.entries(project.engines)) {
      const target = ensure(name);
      if (settings.enabled === false) {
        target.enabled = tag(false, 'project');
      }
      if (settings.model !== undefined) {
        target.model = tag(shown('model', settings.model, []), 'project');
      }
    }
  }

  // Environment overrides, exactly the bindings engineSettings applies. An env
  // value wins over the file, so it overwrites the tag too.
  for (const [engineName, bindings] of Object.entries(ENV_BINDINGS)) {
    const canonical = canonicalEngineName(engineName);
    const entryKeys = splitApiKeys(bindings.apiKey ? env[bindings.apiKey] : undefined);
    for (const [field, envName] of Object.entries(bindings) as Array<
      [StringEngineSetting, string]
    >) {
      const value = env[envName]?.trim();
      if (!value || (field === 'apiKey' && splitApiKeys(value).length === 0)) {
        continue;
      }
      ensure(canonical)[field] = tag(shown(field, value, entryKeys), 'env');
    }
  }

  out.engines = engines;
  if (project) {
    out.projectConfig = project.path;
    if (project.ignored.length > 0) {
      notes.push(
        `project config entries ignored (a project may set only engine, fetchEngine, engines.<name>.enabled false, engines.<name>.model): ${project.ignored.join(', ')}`,
      );
    }
  }
  if (notes.length > 0) {
    out.notes = notes;
  }
  // The last line of defense: no known key survives in any string of the view,
  // whatever field or note it was pasted into.
  return JSON.stringify(redactValues(out, knownApiKeys(config, env)), null, 2);
}

function maskKey(key: string): string {
  if (key.length <= 8) {
    return '****';
  }
  return `${key.slice(0, 6)}...${key.slice(-2)}`;
}

function maskKeys(value: string): string {
  const keys = splitApiKeys(value);
  return keys.length > 0 ? keys.map(maskKey).join(', ') : '****';
}
