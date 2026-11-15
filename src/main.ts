#!/usr/bin/env node

declare const __APP_VERSION__: string;

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  CONFIG_PATH,
  initConfigFile,
  describeIgnoredProjectFields,
  loadConfigFile,
  loadEffectiveConfig,
  renderEffectiveConfig,
  setConfigValue,
} from './config.ts';
import { buildCooldownController, clearAllCooldowns, currentStatePath } from './cooldown.ts';
import { formatDoctorReport, runDoctor } from './doctor.ts';
import { findEngine, listEngines } from './providers/index.ts';
import { runSearch } from './search.ts';
import { waitForPendingKills } from './subprocess.ts';
import { readSecret } from './util/secretInput.ts';

if (process.env.MODSEARCH_NESTED) {
  process.stderr.write(
    'modsearch refused to run: it was started from inside an engine that modsearch itself spawned (recursion guard). An engine such as Grok Build tried to call modsearch instead of using its own search tools.\n',
  );
  process.exit(1);
}

/** How long a finished run may wait for abandoned work before it is ended. */
const EXIT_BACKSTOP_MS = 2_000;

/** Write and wait until the stream has taken it, so exiting cannot cut it short. */
function writeFully(stream: NodeJS.WriteStream, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (error) => (error ? reject(error) : resolve()));
  });
}

const program = new Command();

program
  .name('modsearch')
  .description(
    'Plug-in web search and page fetch for models without native web access: query or URL in, structured JSON evidence out',
  )
  .version(__APP_VERSION__);

program
  .command('search', { isDefault: true })
  .description('Search the web or X, or fetch a page (default command)')
  .option('-q, --query <text>', 'Search query (or answer focus when combined with -u)')
  .option('-u, --url <url>', 'Fetch this web page instead of searching')
  .option('-o, --output <path>', 'Write result JSON to a file')
  .option(
    '-s, --source <list>',
    'Where to search: web, x, or web,x (default: web, or x when the query is about X)',
  )
  .option(
    '-e, --engine <name>',
    'Engine for this run, overriding config (antigravity-cli, tavily, exa, firecrawl, keenable, youcom, grok-cli, local)',
  )
  .option('-m, --model <name>', 'Engine model, where the engine has one')
  .option('--prompt <text>', 'Extra constraints for this run')
  .option('--max-results <n>', 'Maximum number of search results', '8')
  .option('--timeout <ms>', 'Engine timeout in milliseconds', '180000')
  .option(
    '--deadline <ms>',
    'Wall-clock budget for the whole run in milliseconds, across every engine tried (default: none)',
  )
  .option('--workdir <path>', 'Working directory for engines that run a command')
  .option(
    '--allow-private-network',
    'Allow reserved address ranges for this run, for VPNs that map public hosts into them',
  )
  .action(async (options) => {
    let exitCode = 0;
    try {
      const timeoutMs = Number.parseInt(options.timeout, 10);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error('Invalid --timeout. Use a positive integer in milliseconds.');
      }

      let deadlineMs: number | undefined;
      if (options.deadline !== undefined) {
        deadlineMs = Number.parseInt(options.deadline, 10);
        if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) {
          throw new Error('Invalid --deadline. Use a positive integer in milliseconds.');
        }
      }

      const maxResults = Number.parseInt(options.maxResults, 10);
      if (!Number.isFinite(maxResults) || maxResults <= 0) {
        throw new Error('Invalid --max-results. Use a positive integer.');
      }

      // Load the config once so the cooldown controller reads the same switch
      // the run does. Off returns no controller, and the run touches no state.
      const { config, project } = loadEffectiveConfig();
      const ignored = project && describeIgnoredProjectFields(project);
      if (ignored) {
        process.stderr.write(`${ignored}\n`);
      }
      const result = await runSearch({
        query: options.query,
        url: options.url,
        engine: options.engine,
        sources: options.source,
        model: options.model,
        prompt: options.prompt,
        timeoutMs,
        deadlineMs,
        // Count the deadline from process start, so Node startup and config
        // loading come out of the budget the caller is holding.
        deadlineStartedAt: performance.timeOrigin,
        maxResults,
        workdir: options.workdir,
        allowPrivateNetwork: options.allowPrivateNetwork,
        config,
        cooldown: buildCooldownController(config),
      });

      const output = JSON.stringify(result, null, 2);

      if (options.output) {
        const outputPath = path.resolve(options.output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, output, 'utf-8');
      }

      await writeFully(process.stdout, `${output}\n`);
    } catch (error) {
      await writeFully(
        process.stderr,
        [
          `Error: ${error instanceof Error ? error.message : String(error)}`,
          `Known engines: ${listEngines().join(', ')}`,
        ].join('\n') + '\n',
      );
      exitCode = 1;
    }
    // Wait for any pending SIGKILL so an engine that ignored SIGTERM is not
    // orphaned, then let the event loop end the process. Exiting on the spot
    // tore down fetch sockets mid-close, which aborts Node on Windows with a
    // libuv assertion after the result was already written (#38). Work the
    // run abandoned at its deadline (a DNS lookup the resolver has not
    // answered) can still hold the loop, so an unref'd backstop ends it.
    await waitForPendingKills();
    process.exitCode = exitCode;
    setTimeout(() => process.exit(exitCode), EXIT_BACKSTOP_MS).unref();
  });

program
  .command('doctor')
  .description('Diagnose config and routing on this machine (no quota, no network)')
  .option('--json', 'Print the report as JSON')
  .action((options: { json?: boolean }) => {
    try {
      const report = runDoctor();
      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatDoctorReport(report)}\n`);
      }
    } catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  });

const config = program
  .command('config')
  .description(`Manage ${CONFIG_PATH}. Optional: modsearch runs without it.`);

config
  .command('init')
  .description(`Create a starter config at ${CONFIG_PATH}`)
  .option('--force', 'Overwrite an existing config file')
  .action((options: { force?: boolean }) => {
    try {
      initConfigFile(CONFIG_PATH, Boolean(options.force));
      process.stdout.write(
        [
          `Created ${CONFIG_PATH}`,
          'Everything is optional. Things you can set:',
          '  modsearch config set engine <antigravity-cli|tavily|exa|firecrawl|keenable|youcom>   which engine searches',
          '  modsearch config set <engine>.<apiKey|bin|model|baseURL|keylessFetch> <value>   engine settings',
          '  modsearch config set cooldown <on|off>   quota cooldown failover (default on)',
          '  modsearch config set allowPrivateNetwork <true|false>   reach reserved/private ranges (default false)',
          'Search, page fetch, and X need no settings at all: keyless Firecrawl works out of the box.',
          '',
        ].join('\n'),
      );
    } catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  });

config
  .command('set <key> [value]')
  .description(
    'Set a value, e.g. tavily.apiKey <key>, or search.engine tavily. Omit the value for an .apiKey to be prompted with the echo muted, so the key stays out of argv and shell history (a pipe works too: pbpaste | modsearch config set tavily.apiKey)',
  )
  .action(async (key: string, value: string | undefined) => {
    try {
      if (value === undefined) {
        // Only keys may be prompted for: every other field is ordinary
        // configuration, and omitting its value is a mistake worth naming.
        if (!key.endsWith('.apiKey')) {
          throw new Error(`${key} needs a value: modsearch config set ${key} <value>`);
        }
        // Validate the engine name BEFORE prompting: a typo must fail here,
        // not after the user has typed their key in (or, on a pipe, after a
        // line of someone's stdin has been consumed).
        const parts = key.split('.').filter(Boolean);
        const engineName = parts[0] === 'engines' ? parts[1] : parts[0];
        if (!engineName || !findEngine(engineName)) {
          throw new Error(
            `Unknown engine: ${engineName ?? key}. Known engines: ${listEngines().join(', ')}.`,
          );
        }
        value = await readSecret(`Enter the value for ${key} (input hidden): `);
      }
      setConfigValue(key, value);
      process.stdout.write(`Saved ${key} to ${CONFIG_PATH}\n`);
    } catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  });

config
  .command('show')
  .description('Print the effective config (file + env, source-tagged) with API keys masked')
  .action(() => {
    try {
      const global = loadConfigFile();
      const { project } = loadEffectiveConfig();
      process.stdout.write(`${renderEffectiveConfig(global, process.env, project)}\n`);
    } catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  });

const state = program
  .command('state')
  .description('Manage the quota cooldown state at ~/.modsearch/state.json');

state
  .command('clear')
  .description('Forget every engine cooldown, so all engines are tried at full priority again')
  .action(() => {
    try {
      const statePath = currentStatePath();
      clearAllCooldowns(statePath);
      process.stdout.write(`Cleared cooldown state (${statePath}).\n`);
    } catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  });

// parseAsync: the hidden-prompt path in `config set` awaits user input.
await program.parseAsync(process.argv, { from: 'node' });
