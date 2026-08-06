// Drift guard: the example envelopes in the output-schema reference must have
// the exact structure a real RunSearchResult produces. When the shape changes,
// this fails until the doc is updated to match, so the reference cannot rot.
import * as fs from 'fs';
import { afterEach, describe, expect, it } from 'vitest';
import { runSearch } from './search.ts';
import { cleanupTempDirs, fakeEngine, SPAWNS_FAKE_CLI } from './testing/helpers.ts';

// The two envelope tests spawn a fake agy CLI, which does not run on Windows;
// see SPAWNS_FAKE_CLI. The doc-shape test below reads only the reference file
// and runs everywhere.
const itSpawn = it.runIf(SPAWNS_FAKE_CLI);

const DOC_URL = new URL('../skills/modsearch/references/output-schema.md', import.meta.url);

/** Every ```json fenced block in the document, parsed. */
function jsonBlocks(markdown: string): unknown[] {
  const blocks: unknown[] = [];
  const fence = /```json\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(markdown)) !== null) {
    blocks.push(JSON.parse(match[1]));
  }
  return blocks;
}

/** The full-envelope examples, keyed by mode. */
function envelopes(markdown: string): Record<string, unknown> {
  const byMode: Record<string, unknown> = {};
  for (const block of jsonBlocks(markdown)) {
    if (block && typeof block === 'object' && 'mode' in block) {
      byMode[(block as { mode: string }).mode] = block;
    }
  }
  return byMode;
}

/**
 * Structural fingerprint: an object becomes its sorted [key, shape] pairs, an
 * array the shape of its first element, everything else its type. Two values
 * with the same fingerprint have the same shape regardless of their contents.
 */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return ['[]', value.length > 0 ? shapeOf(value[0]) : 'empty'];
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, shapeOf((value as Record<string, unknown>)[key])]);
  }
  return value === null ? 'null' : typeof value;
}

describe('output-schema reference stays in step with RunSearchResult', () => {
  afterEach(() => cleanupTempDirs());

  const doc = envelopes(fs.readFileSync(DOC_URL, 'utf-8'));
  const BARE: NodeJS.ProcessEnv = { PATH: '/nonexistent' };

  it('documents both a search and a fetch envelope', () => {
    expect(Object.keys(doc).sort()).toEqual(['fetch', 'search']);
  });

  itSpawn('search envelope matches a real run', async () => {
    const bin = fakeEngine({
      name: 'agy',
      stdout: JSON.stringify({
        status: 'SUCCESS',
        structured_output: {
          summary: 's',
          items: [
            { title: 't', url: 'https://e/x', snippet: 'sn', source: 'e', published_at: '2026' },
          ],
          uncertainty: [],
        },
      }),
    });
    const real = await runSearch({
      query: 'anything',
      config: { engine: 'antigravity-cli', engines: { 'antigravity-cli': { bin } } },
      env: BARE,
      timeoutMs: 20_000,
    });
    expect(shapeOf(real)).toEqual(shapeOf(doc.search));
  }, 30_000);

  itSpawn('fetch envelope matches a real run', async () => {
    const bin = fakeEngine({
      name: 'agy',
      stdout: JSON.stringify({
        status: 'SUCCESS',
        structured_output: {
          summary: 's',
          content: 'c',
          links: [{ text: 'l', url: 'https://e/y' }],
          uncertainty: [],
        },
      }),
    });
    const real = await runSearch({
      url: 'https://example.com/x',
      config: { engine: 'antigravity-cli', engines: { 'antigravity-cli': { bin } } },
      env: BARE,
      timeoutMs: 20_000,
    });
    expect(shapeOf(real)).toEqual(shapeOf(doc.fetch));
  }, 30_000);
});
