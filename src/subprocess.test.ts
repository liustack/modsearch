import * as fs from 'fs';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { runCommand } from './subprocess.ts';
import { cleanupTempDirs, tempDir } from './testing/helpers.ts';

afterAll(cleanupTempDirs);

/** Poll `check` until it returns true or the deadline passes. */
async function waitFor(check: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return check();
}

function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

describe('runCommand timeout handling', () => {
  it('SIGKILLs a child that ignores SIGTERM, so its PID goes away', async () => {
    const dir = tempDir('modsearch-sigkill-');
    const pidFile = path.join(dir, 'pid');
    const bin = path.join(dir, 'stubborn');
    // Install the SIGTERM-ignoring trap BEFORE anything else, so a SIGTERM that
    // races the startup cannot kill the child on the default handler. Then it
    // records its PID and sits there: only SIGKILL can end it.
    fs.writeFileSync(bin, `#!/bin/sh\ntrap '' TERM\necho $$ > "${pidFile}"\nsleep 30\n`, {
      mode: 0o755,
    });

    const promise = runCommand('stubborn', { command: bin, args: [], cwd: dir }, 800);
    await expect(promise).rejects.toThrow(/timed out/);

    // The child wrote its PID at startup; give it a generous beat to flush to
    // disk, since a busy machine running the full suite starves timers.
    await waitFor(() => {
      try {
        return fs.readFileSync(pidFile, 'utf-8').trim().length > 0;
      } catch {
        return false;
      }
    }, 5_000);
    const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    expect(Number.isFinite(pid)).toBe(true);

    // SIGKILL follows SIGTERM after the 2s grace window: the PID must vanish.
    // The window is wide so scheduling jitter under load cannot flake it.
    expect(await waitFor(() => processGone(pid), 12_000)).toBe(true);
  }, 25_000);
});
