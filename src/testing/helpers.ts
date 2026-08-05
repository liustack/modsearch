// Shared test scaffolding. Every suite needs the same three things: a throwaway
// HOME, a PATH holding fake engine binaries, and a temp config path. These were
// copied into each test file, so a fix to one copy left the others behind.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

/** A fake engine binary that prints `stdout` and exits with `code`. */
export function fakeEngine(options: {
  name?: string;
  stdout?: string;
  code?: number;
  lingerSeconds?: number;
}): string {
  const dir = tempDir('modsearch-engine-');
  const bin = path.join(dir, options.name ?? 'fake-engine');
  const lines = ['#!/bin/sh'];
  if (options.stdout !== undefined) {
    lines.push(`cat <<'ENGINE_EOF'\n${options.stdout}\nENGINE_EOF`);
  }
  if (options.lingerSeconds) {
    // Inherits stdout, which is how agy's language server keeps the pipe open.
    lines.push(`sleep ${options.lingerSeconds} &`);
  }
  lines.push(`exit ${options.code ?? 0}`);
  fs.writeFileSync(bin, `${lines.join('\n')}\n`, { mode: 0o755 });
  return bin;
}

/** Point HOME at a throwaway directory for the duration of a test. */
export function withTempHome(): { home: string; restore: () => void } {
  const home = tempDir('modsearch-home-');
  const realHome = process.env.HOME;
  process.env.HOME = home;
  return {
    home,
    restore: () => {
      process.env.HOME = realHome;
    },
  };
}

/** A signed-in Grok Build: the binary on PATH plus its auth file under HOME. */
export function withSignedInGrok(): { env: NodeJS.ProcessEnv; restore: () => void } {
  const { home, restore } = withTempHome();
  fs.mkdirSync(path.join(home, '.grok'), { recursive: true });
  fs.writeFileSync(path.join(home, '.grok', 'auth.json'), '{}');
  return { env: envWithBinaries('agy', 'grok'), restore };
}
