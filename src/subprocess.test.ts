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
    // Ignore SIGTERM and sit there. Only SIGKILL can end this.
    fs.writeFileSync(bin, `#!/bin/sh\necho $$ > "${pidFile}"\ntrap '' TERM\nsleep 30\n`, {
      mode: 0o755,
    });

    const promise = runCommand('stubborn', { command: bin, args: [], cwd: dir }, 300);
    await expect(promise).rejects.toThrow(/timed out/);

    // The child wrote its PID at startup; give it a beat to flush to disk.
    await waitFor(() => {
      try {
        return fs.readFileSync(pidFile, 'utf-8').trim().length > 0;
      } catch {
        return false;
      }
    }, 2_000);
    const pid = Number.parseInt(fs.readFileSync(pidFile, 'utf-8').trim(), 10);
    expect(Number.isFinite(pid)).toBe(true);
    expect(processGone(pid)).toBe(false);

    // SIGKILL follows SIGTERM after the 2s grace window: the PID must vanish.
    expect(await waitFor(() => processGone(pid), 5_000)).toBe(true);
  }, 10_000);
});
