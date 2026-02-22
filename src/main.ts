#!/usr/bin/env node

declare const __APP_VERSION__: string;

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { listProviders } from './providers/index.ts';
import { runSearch } from './search.ts';

const program = new Command();

program
  .name('modsearch')
  .description('Provider-extensible search bridge for LLM agent workflows')
  .version(__APP_VERSION__)
  .requiredOption('-q, --query <text>', 'Search query text')
  .option('-o, --output <path>', 'Write result JSON to a file')
  .option('-p, --provider <name>', 'Search provider name', 'gemini-cli')
  .option('-m, --model <name>', 'Model name (provider-specific)')
  .option('--prompt <text>', 'Extra prompt constraints for this search')
  .option('--max-results <n>', 'Maximum number of search results', '8')
  .option('--timeout <ms>', 'Command timeout in milliseconds', '180000')
  .option('--provider-bin <path>', 'Provider CLI binary path')
  .option('--workdir <path>', 'Working directory to run provider command')
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
        provider: options.provider,
        model: options.model,
        prompt: options.prompt,
        timeoutMs,
        providerBin: options.providerBin,
        maxResults,
        workdir: options.workdir,
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

program.parse();
