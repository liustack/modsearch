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
  .description(
    'Plug-in web search and page fetch for text-only LLMs: query or URL in, structured JSON evidence out',
  )
  .version(__APP_VERSION__)
  .option('-q, --query <text>', 'Search query (or answer focus when combined with -u)')
  .option('-u, --url <url>', 'Fetch this web page instead of searching')
  .option('-o, --output <path>', 'Write result JSON to a file')
  .option('-p, --provider <name>', 'Provider name', 'antigravity-cli')
  .option('-m, --model <name>', 'Provider model name (default: gemini-3.6-flash-low)')
  .option('--prompt <text>', 'Extra constraints for this run')
  .option('--max-results <n>', 'Maximum number of search results', '8')
  .option('--timeout <ms>', 'Provider timeout in milliseconds', '180000')
  .option('--provider-bin <path>', 'Provider binary path (default: agy)')
  .option('--workdir <path>', 'Working directory for the provider command')
  .option('--x', 'Force the X (Twitter) companion source even without X keywords in the query')
  .option('--no-x', 'Disable the X companion source')
  .option('--grok-bin <path>', 'Grok Build binary path for the X source (default: grok)')
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

program.parse();
