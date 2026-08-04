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
import { listProviders } from './providers/index.ts';
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
  .description('Search the web or fetch a page (default command)')
  .option('-q, --query <text>', 'Search query (or answer focus when combined with -u)')
  .option('-u, --url <url>', 'Fetch this web page instead of searching')
  .option('-o, --output <path>', 'Write result JSON to a file')
  .option(
    '-p, --provider <name>',
    'Provider name (default: routed; web queries walk antigravity-cli, playwright, tavily; X/Twitter queries go to grok-cli)',
  )
  .option('-m, --model <name>', 'Provider model name (default: gemini-3.6-flash-low on agy)')
  .option('--prompt <text>', 'Extra constraints for this run')
  .option('--max-results <n>', 'Maximum number of search results', '8')
  .option('--timeout <ms>', 'Provider timeout in milliseconds', '180000')
  .option('--provider-bin <path>', 'Antigravity CLI binary path (default: agy)')
  .option('--workdir <path>', 'Working directory for the provider command')
  .option('--x', 'Force the grok-cli X route even without X keywords in the query')
  .option('--no-x', 'Never route to grok-cli; stay on the web chain')
  .option('--grok-bin <path>', 'Grok Build binary path for the X route (default: grok)')
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
        provider: options.provider,
        model: options.model,
        prompt: options.prompt,
        timeoutMs,
        providerBin: options.providerBin,
        maxResults,
        workdir: options.workdir,
        x: options.x,
        grokBin: options.grokBin,
      });

      const output = JSON.stringify(result, null, 2);

      if (options.output) {
        const outputPath = path.resolve(options.output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, output, 'utf-8');
      }

      process.stdout.write(`${output}\n`);
    } catch (error) {
      const availableProviders = listProviders().join(', ');
      process.stderr.write(
        [
          `Error: ${error instanceof Error ? error.message : String(error)}`,
          `Available providers: ${availableProviders}`,
        ].join('\n') + '\n',
      );
      process.exit(1);
    }
  });

const config = program
  .command('config')
  .description(`Manage ${CONFIG_PATH} (default provider, keys, binaries)`);

config
  .command('init')
  .description(`Create a starter config at ${CONFIG_PATH}`)
  .option('--force', 'Overwrite an existing config file')
  .action((options: { force?: boolean }) => {
    try {
      initConfigFile(CONFIG_PATH, Boolean(options.force));
      process.stdout.write(
        `Created ${CONFIG_PATH}\nLeave provider empty for routing, or pin one with: modsearch config set provider <name>\n`,
      );
    } catch (error) {
      process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    }
  });

config
  .command('set <key> <value>')
  .description('Set a value, e.g. modsearch config set tavily.apiKey <key>')
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
