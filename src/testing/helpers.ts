// Shared test scaffolding. Every suite needs the same three things: a throwaway
// HOME, a PATH holding fake engine binaries, and a temp config path. These were
// copied into each test file, so a fix to one copy left the others behind.
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { expect } from 'vitest';

export const IS_WINDOWS = process.platform === 'win32';

/**
 * Whether this platform can run the suites that spawn a fake engine CLI.
 *
 * modsearch runs engine binaries with `spawn(bin, args)` and no shell, a
 * deliberate security choice. On Windows only a real `.exe` is a runnable image
 * by path: Node refuses to spawn a `.cmd`/`.bat` without `shell: true`
 * (CVE-2024-27980), and a POSIX shell script is not executable there. `fakeEngine`
 * therefore emits a shell script that runs only on Unix, so the suites that spawn
 * it are gated on this flag and skipped on Windows. The in-process HTTP engines
 * (local, tavily, exa, firecrawl) and every pure-logic test still run on all
 * platforms. See docs/testing.md.
 */
export const SPAWNS_FAKE_CLI = !IS_WINDOWS;

/**
 * Assert a file's POSIX permission bits. A no-op on Windows, which controls file
 * access through ACLs rather than rwx bits, so `stat.mode` never reflects a
 * chmod there and `fs.chmod` only toggles the read-only flag.
 */
export function expectPosixMode(filePath: string, mode: number): void {
  if (IS_WINDOWS) {
    return;
  }
  expect(fs.statSync(filePath).mode & 0o777).toBe(mode);
}

const created: string[] = [];

export function tempDir(prefix = 'modsearch-test-'): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  while (created.length > 0) {
    fs.rmSync(created.pop() as string, { recursive: true, force: true });
  }
}

export function tempConfigPath(): string {
  return path.join(tempDir('modsearch-config-'), 'config.json');
}

/** A PATH holding the named fake binaries, so tests never see the real ones. */
export function envWithBinaries(...binaries: string[]): NodeJS.ProcessEnv {
  const dir = tempDir('modsearch-bin-');
  for (const name of binaries) {
    fs.writeFileSync(path.join(dir, name), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  return { PATH: dir };
}

/** Nothing installed, no keys: the machine a new user starts on. */
export const BARE_ENV: NodeJS.ProcessEnv = { PATH: '/nonexistent' };

/**
 * A fake engine binary that prints `stdout` and exits with `code`. It is a POSIX
 * shell script, so it only runs on Unix. Suites that spawn it must be gated on
 * SPAWNS_FAKE_CLI, which explains why a cross-platform fake is not possible under
 * modsearch's no-shell spawn.
 */
export function fakeEngine(options: {
  name?: string;
  stdout?: string;
  stderr?: string;
  code?: number;
  lingerSeconds?: number;
  /** Sleep this long before printing, to model a slow engine (timing tests). */
  delaySeconds?: number;
}): string {
  const dir = tempDir('modsearch-engine-');
  const bin = path.join(dir, options.name ?? 'fake-engine');
  const lines = ['#!/bin/sh'];
  if (options.delaySeconds) {
    lines.push(`sleep ${options.delaySeconds}`);
  }
  if (options.stdout !== undefined) {
    lines.push(`cat <<'ENGINE_EOF'\n${options.stdout}\nENGINE_EOF`);
  }
  if (options.stderr !== undefined) {
    lines.push(`cat >&2 <<'ENGINE_ERR_EOF'\n${options.stderr}\nENGINE_ERR_EOF`);
  }
  if (options.lingerSeconds) {
    // Inherits stdout, which is how agy's language server keeps the pipe open.
    lines.push(`sleep ${options.lingerSeconds} &`);
  }
  lines.push(`exit ${options.code ?? 0}`);
  fs.writeFileSync(bin, `${lines.join('\n')}\n`, { mode: 0o755 });
  return bin;
}

/** Restore an env var to its prior value, deleting it when it was unset. */
function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

/**
 * Point the home directory at a throwaway dir for the duration of a test.
 * `os.homedir()` reads HOME on POSIX and USERPROFILE on Windows, so redirect
 * both for a test home that holds on every platform.
 */
export function withTempHome(): { home: string; restore: () => void } {
  const home = tempDir('modsearch-home-');
  const realHome = process.env.HOME;
  const realUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return {
    home,
    restore: () => {
      restoreEnv('HOME', realHome);
      restoreEnv('USERPROFILE', realUserProfile);
    },
  };
}

/**
 * A throwaway HTTP server on loopback that serves one page, so a fetch test can
 * exercise the real local engine without going online. Bind is 127.0.0.1, so the
 * caller must allow the private network on the fetch (allowPrivateNetwork).
 */
export function startLocalPage(
  html: string,
  contentType = 'text/html; charset=utf-8',
): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': contentType });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

/** A signed-in Grok Build: the binary on PATH plus its auth file under HOME. */
export function withSignedInGrok(): { env: NodeJS.ProcessEnv; restore: () => void } {
  const { home, restore } = withTempHome();
  fs.mkdirSync(path.join(home, '.grok'), { recursive: true });
  fs.writeFileSync(path.join(home, '.grok', 'auth.json'), '{}');
  return { env: envWithBinaries('agy', 'grok'), restore };
}
