import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Layered configuration: CLI flags > environment variables > ~/.modsearch/config.json > built-ins.

export interface ProviderSettings {
  apiKey?: string;
  model?: string;
  bin?: string;
  /** 'true' | 'false' as a string so `config set` stays uniform. */
  allowPrivateNetwork?: string;
}

export interface ModsearchConfig {
  /** Pin one provider and skip routing. Empty string means auto-route. */
  provider?: string;
  providers?: Record<string, ProviderSettings>;
}

export const CONFIG_DIR = path.join(os.homedir(), '.modsearch');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

/** Resolved at call time so a faked HOME (tests) redirects the config too. */
export function currentConfigPath(): string {
  return path.join(os.homedir(), '.modsearch', 'config.json');
}

const ENV_BINDINGS: Record<string, Partial<Record<keyof ProviderSettings, string>>> = {
  tavily: { apiKey: 'TAVILY_API_KEY' },
};

const SETTABLE_FIELDS: Array<keyof ProviderSettings> = ['apiKey', 'model', 'bin', 'allowPrivateNetwork'];

export function loadConfigFile(configPath = currentConfigPath()): ModsearchConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
  } catch {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return {};
    }
    return parsed as ModsearchConfig;
  } catch (error) {
    throw new Error(
      `Failed to parse ${configPath}: ${(error as Error).message}. Fix or delete the file.`,
    );
  }
}

/** Resolve settings for one provider with env vars overriding the config file. */
export function resolveProviderSettings(
  providerName: string,
  config: ModsearchConfig,
  env: NodeJS.ProcessEnv = process.env,
): ProviderSettings {
  const fromFile = config.providers?.[providerName] ?? {};
  const bindings = ENV_BINDINGS[providerName] ?? {};

  const settings: ProviderSettings = { ...fromFile };
  for (const [field, envName] of Object.entries(bindings) as Array<
    [keyof ProviderSettings, string]
  >) {
    const value = env[envName]?.trim();
    if (value) {
      settings[field] = value;
    }
  }
  return settings;
}

/** Set a dotted key like "tavily.apiKey" or "provider" and persist with 0600 perms. */
export function setConfigValue(dottedKey: string, value: string, configPath = currentConfigPath()): void {
  const config = loadConfigFile(configPath);

  if (dottedKey === 'provider') {
    config.provider = value;
  } else {
    const dot = dottedKey.indexOf('.');
    if (dot <= 0 || dot === dottedKey.length - 1) {
      throw new Error(
        `Invalid config key: ${dottedKey}. Use "provider" or "<provider>.<${SETTABLE_FIELDS.join('|')}>".`,
      );
    }
    const providerName = dottedKey.slice(0, dot);
    const field = dottedKey.slice(dot + 1) as keyof ProviderSettings;
    if (!SETTABLE_FIELDS.includes(field)) {
      throw new Error(`Unknown config field: ${field}. Use ${SETTABLE_FIELDS.join(', ')}.`);
    }
    config.providers ??= {};
    config.providers[providerName] ??= {};
    config.providers[providerName][field] = value;
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
  // Empty means route automatically: X queries to grok-cli, everything else
  // to antigravity-cli. Set a name here to pin one engine.
  provider: '',
  providers: {
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
    providers: Object.fromEntries(
      Object.entries(config.providers ?? {}).map(([name, settings]) => [
        name,
        {
          ...settings,
          ...(settings.apiKey ? { apiKey: maskKey(settings.apiKey) } : {}),
        },
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
