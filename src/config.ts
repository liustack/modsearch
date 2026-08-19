import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
// Runtime-safe: providers/index.ts imports nothing from this module at runtime
// (its config import is type-only), so this does not create an import cycle.
import { findEngine, listEngines } from './providers/index.ts';
import { maskUrlCredentials } from './util/redact.ts';

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
      const canonical = canonicalEngineName(name);
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
    pinned && Object.hasOwn(LEGACY_ENGINE_ROLES, pinned) && LEGACY_ENGINE_ROLES[pinned] === 'search'
      ? canonicalEngineName(pinned)
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
  const engines = isPlainObject(config.engines) ? config.engines : {};
  const fromFile = Object.hasOwn(engines, engineName) && isPlainObject(engines[engineName])
    ? (engines[engineName] as EngineSettings)
    : {};
  const bindings = Object.hasOwn(ENV_BINDINGS, engineName) ? ENV_BINDINGS[engineName] : {};

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
    const [rawEngineName, field] =
      parts[0] === 'engines' ? [parts[1], parts[2]] : [parts[0], parts[1]];
    if (!rawEngineName || !field) {
      throw new Error(
        `Invalid config key: ${dottedKey}. Use "engine" or "engines.<engine>.<${SETTABLE_ENGINE_FIELDS.join('|')}>".`,
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
      throw new Error(`The "engines" section of the config file is not an object. Fix or remove it.`);
    }
    if (config.engines?.[engineName] !== undefined && !isPlainObject(config.engines[engineName])) {
      throw new Error(
        `The "engines.${engineName}" entry of the config file is not an object. Fix or remove it.`,
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

function writeConfigFile(config: ModsearchConfig, configPath: string): void {
  ensurePrivateDir(path.dirname(configPath));
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
  ensurePrivateDir(path.dirname(configPath));
  fs.writeFileSync(configPath, `${JSON.stringify(CONFIG_TEMPLATE, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // best effort on platforms without chmod
  }
}

/** Every API key the file or environment holds. */
function knownApiKeys(config: ModsearchConfig, env: NodeJS.ProcessEnv): string[] {
  const keys = new Set<string>();
  const enginesRoot = isPlainObject(config.engines) ? config.engines : {};
  for (const entry of Object.values(enginesRoot)) {
    if (isPlainObject(entry) && typeof entry.apiKey === 'string') {
      keys.add(entry.apiKey);
    }
  }
  for (const bindings of Object.values(ENV_BINDINGS)) {
    const variable = bindings.apiKey;
    const value = variable ? env[variable]?.trim() : undefined;
    if (value) {
      keys.add(value);
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
    if (typeof node === 'string') return scrub(node);
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
  const notes: string[] = [];
  const ensure = (name: string) => {
    engines[name] ??= {};
    return engines[name];
  };

  const shown = (field: string, value: unknown, entryKey: string | undefined): string => {
    if (field === 'apiKey') {
      return maskKey(String(value));
    }
    let text = String(value);
    if (field === 'baseURL') {
      text = maskUrlCredentials(text);
    }
    // Same-row wash: the row's own key must not survive in its other fields.
    return entryKey && entryKey.length > 0 ? text.split(entryKey).join('[redacted]') : text;
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
    const entryKey = typeof settings.apiKey === 'string' ? settings.apiKey : undefined;
    for (const field of SETTABLE_ENGINE_FIELDS) {
      const value = settings[field];
      if (value === undefined) {
        continue;
      }
      target[field] = tag(shown(field, value, entryKey), 'file');
    }
  }

  // Environment overrides, exactly the bindings engineSettings applies. An env
  // value wins over the file, so it overwrites the tag too.
  for (const [engineName, bindings] of Object.entries(ENV_BINDINGS)) {
    const canonical = canonicalEngineName(engineName);
    const entryKey = bindings.apiKey ? env[bindings.apiKey]?.trim() : undefined;
    for (const [field, envName] of Object.entries(bindings) as Array<
      [StringEngineSetting, string]
    >) {
      const value = env[envName]?.trim();
      if (!value) {
        continue;
      }
      ensure(canonical)[field] = tag(shown(field, value, entryKey), 'env');
    }
  }

  out.engines = engines;
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
