#!/usr/bin/env node

declare const __APP_VERSION__: string;

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  CONFIG_PATH,
  initConfigFile,
  loadConfigFile,
  renderConfig,
  setConfigValue,
} from './config.ts';
import { listEngines } from './providers/index.ts';
import { runSearch } from './search.ts';

const program = new Command();

program
  .name('modsearch')
  .description(
    'Plug-in web search and page fetch for text-only LLMs: query or URL in, structured JSON evidence out',
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
    'Engine for this run, overriding config (antigravity-cli, tavily, grok-cli, http)',
  )
  .option('-m, --model <name>', 'Engine model, where the engine has one')
  .option('--prompt <text>', 'Extra constraints for this run')
  .option('--max-results <n>', 'Maximum number of search results', '8')
  .option('--timeout <ms>', 'Engine timeout in milliseconds', '180000')
  .option('--workdir <path>', 'Working directory for engines that run a command')
  .option(
    '--allow-private-network',
    'Let the http engine reach reserved address ranges, for VPNs that map public hosts into them',
  )
  .action(async (options) => {
    try {
      const timeoutMs = Number.parseInt(options.timeout, 10);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error('Invalid --timeout. Use a positive integer in milliseconds.');
      }

      const maxResults = Number.parseInt(options.maxResults, 10);
      if (!Number.isFinite(maxResults) || maxResults <= 0) {
        throw new Error('Invalid --max-results. Use a positive integer.');
      }

      const result = await runSearch({
        query: options.query,
        url: options.url,
        engine: options.engine,
        sources: options.source,
        model: options.model,
        prompt: options.prompt,
        timeoutMs,
        maxResults,
        workdir: options.workdir,
        allowPrivateNetwork: options.allowPrivateNetwork,
      });

      const output = JSON.stringify(result, null, 2);

      if (options.output) {
        const outputPath = path.resolve(options.output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, output, 'utf-8');
      }

      process.stdout.write(`${output}\n`);
    } catch (error) {
      process.stderr.write(
        [
          `Error: ${error instanceof Error ? error.message : String(error)}`,
          `Known engines: ${listEngines().join(', ')}`,
        ].join('\n') + '\n',
      );
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
        `Created ${CONFIG_PATH}\nEvery field is optional: leave one empty and modsearch picks what works here.\n`,
      );
    } catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  });

config
  .command('set <key> <value>')
  .description('Set a value, e.g. tavily.apiKey <key>, or search.engine tavily')
  .action((key: string, value: string) => {
    try {
      setConfigValue(key, value);
      process.stdout.write(`Saved ${key} to ${CONFIG_PATH}\n`);
    } catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  });

config
  .command('show')
  .description('Print the effective config with API keys masked')
  .action(() => {
    try {
      process.stdout.write(`${renderConfig(loadConfigFile())}\n`);
    } catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  });

program.parse();
