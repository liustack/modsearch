import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ pid: 1 })),
}));

const { spawn } = await import('child_process');
const { spawnHidden } = await import('./util/spawnHidden.ts');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The core and dsh plugin ship separately, so each owns one child-process
 * wrapper. No caller may reach Node's child_process module directly.
 */
const WRAPPERS = new Set(['src/util/spawnHidden.ts', 'dsh/spawnHidden.js']);

/** Pure data, prose and declarations cannot start a child process. */
const INERT = /\.(json|md|ya?ml|d\.ts)$/;

/** Every shipped source that could execute, with tests excluded. */
function shippedSources(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (INERT.test(entry.name) || /\.test\./.test(entry.name)) {
        continue;
      }
      found.push(full);
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'dsh'));
  return found;
}

describe('Windows child processes stay hidden', () => {
  it('writes windowsHide after caller options so it cannot be overridden', () => {
    vi.mocked(spawn).mockClear();
    spawnHidden('cmd', ['a'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    } as never);

    expect(vi.mocked(spawn).mock.calls[0][2]).toMatchObject({ windowsHide: true });
  });

  it('keeps caller options while forcing the hidden window', () => {
    vi.mocked(spawn).mockClear();
    spawnHidden('cmd', ['a', 'b'], {
      cwd: '/tmp',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(vi.mocked(spawn).mock.calls[0][0]).toBe('cmd');
    expect(vi.mocked(spawn).mock.calls[0][1]).toEqual(['a', 'b']);
    expect(vi.mocked(spawn).mock.calls[0][2]).toMatchObject({ cwd: '/tmp', windowsHide: true });
  });

  it('lets nothing but the wrappers reach child_process', () => {
    const reaching = shippedSources()
      .map((file) => path.relative(root, file).split(path.sep).join('/'))
      .filter((relative) => !WRAPPERS.has(relative))
      .filter((relative) =>
        /child_process/.test(fs.readFileSync(path.join(root, relative), 'utf-8')),
      );

    expect(reaching).toEqual([]);
  });

  it('forces windowsHide in the separately shipped dsh wrapper', async () => {
    vi.mocked(spawn).mockClear();
    const dsh = await import('../dsh/spawnHidden.js');
    dsh.spawnHidden('cmd', ['a'], { stdio: 'ignore', windowsHide: false });

    expect(vi.mocked(spawn).mock.calls[0][2]).toMatchObject({ windowsHide: true });
  });
});
