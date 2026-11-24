import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTempDirs, withTempHome } from './testing/helpers.ts';

const originalArgv = process.argv;
const originalElectronDescriptor = Object.getOwnPropertyDescriptor(process.versions, 'electron');
const originalElectronRunAsNode = process.env.ELECTRON_RUN_AS_NODE;
const originalNested = process.env.MODSEARCH_NESTED;
let restoreHome: (() => void) | undefined;

afterEach(() => {
  process.argv = originalArgv;
  if (originalElectronRunAsNode === undefined) {
    delete process.env.ELECTRON_RUN_AS_NODE;
  } else {
    process.env.ELECTRON_RUN_AS_NODE = originalElectronRunAsNode;
  }
  if (originalNested === undefined) {
    delete process.env.MODSEARCH_NESTED;
  } else {
    process.env.MODSEARCH_NESTED = originalNested;
  }
  if (originalElectronDescriptor) {
    Object.defineProperty(process.versions, 'electron', originalElectronDescriptor);
  } else {
    Reflect.deleteProperty(process.versions, 'electron');
  }
  restoreHome?.();
  restoreHome = undefined;
  cleanupTempDirs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('CLI entry point', () => {
  it('uses Node argv layout when Electron runs as Node', async () => {
    ({ restore: restoreHome } = withTempHome());
    process.env.ELECTRON_RUN_AS_NODE = '1';
    process.argv = [process.execPath, '/package/dist/main.js', 'doctor', '--json'];
    Object.defineProperty(process.versions, 'electron', {
      value: '43.4.0',
      configurable: true,
    });
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`unexpected process.exit(${code})`);
    });

    await import('./main.ts');

    expect(stdout).toHaveBeenCalledOnce();
    expect(JSON.parse(String(stdout.mock.calls[0][0]))).toMatchObject({
      node: { ok: true },
      roles: expect.any(Array),
    });
  });

  it('refuses to run when spawned from inside an engine', async () => {
    process.env.MODSEARCH_NESTED = '1';
    process.argv = [process.execPath, '/package/dist/main.js', 'doctor', '--json'];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    await expect(import('./main.ts')).rejects.toThrow(/process\.exit\(1\)/);
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(stderr.mock.calls.map((call) => call[0]).join(''))).toContain(
      'modsearch refused to run: it was started from inside an engine that modsearch itself spawned (recursion guard).',
    );
  });
});

/** A stream write stub that reports the chunk as flushed, as a real stream would. */
function acceptWrite(...args: unknown[]): boolean {
  const callback = args.find((arg) => typeof arg === 'function') as (() => void) | undefined;
  callback?.();
  return true;
}

describe('search flags', () => {
  async function runCli(args: string[], pendingKills: Promise<void> = Promise.resolve()) {
    const runSearch = vi.fn(async () => ({ mode: 'search', results: [], meta: {} }));
    vi.doMock('./search.ts', () => ({ runSearch }));
    const waitForPendingKills = vi.fn(() => pendingKills);
    vi.doMock('./subprocess.ts', () => ({ waitForPendingKills }));
    ({ restore: restoreHome } = withTempHome());
    process.argv = [process.execPath, '/package/dist/main.js', ...args];
    vi.spyOn(process.stdout, 'write').mockImplementation(acceptWrite);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(acceptWrite);
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    // The entry awaits the whole action at top level, pending kills included,
    // so the import is not awaited here: a test may be holding those kills.
    const loading = import('./main.ts');
    await vi.waitFor(() => {
      expect(runSearch.mock.calls.length + stderr.mock.calls.length).toBeGreaterThan(0);
    });
    return { runSearch, stderr, exit, waitForPendingKills, loading };
  }

  afterEach(() => {
    vi.doUnmock('./search.ts');
    vi.doUnmock('./subprocess.ts');
    vi.useRealTimers();
    process.exitCode = undefined;
  });

  it('passes --deadline through as the run-wide budget', async () => {
    const { runSearch } = await runCli([
      '-q',
      'anything',
      '--timeout',
      '40000',
      '--deadline',
      '55000',
    ]);
    expect(runSearch).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 40_000, deadlineMs: 55_000 }),
    );
  });

  it('starts the deadline clock when this run starts, not when the host process did', async () => {
    // A host that runs the CLI inside a long-lived process (DSH on iOS) has a
    // performance.timeOrigin hours in the past, so a clock started there had
    // every engine skipped as out of time before it began (#55). The test
    // worker stands in for that host: it started well before this import.
    const before = Date.now();
    const { runSearch } = await runCli(['-q', 'anything', '--deadline', '55000']);
    const { deadlineStartedAt } = (
      runSearch.mock.calls[0] as unknown as [{ deadlineStartedAt: number }]
    )[0];
    expect(deadlineStartedAt).toBeGreaterThanOrEqual(before);
    expect(deadlineStartedAt).toBeLessThanOrEqual(Date.now());
  });

  it('lets the event loop drain after pending engine kills land', async () => {
    // Exiting on the spot tore down fetch sockets mid-close, which aborts Node
    // on Windows (libuv async.c assertion, exit 0xC0000409) after a good
    // result was already written (#38). So the CLI sets its exit code and lets
    // the loop end the process. It waits for a pending SIGKILL first, or the
    // exit would orphan an engine that ignored SIGTERM.
    let releaseKills = () => {};
    const pendingKills = new Promise<void>((resolve) => {
      releaseKills = resolve;
    });
    const { exit, waitForPendingKills, loading } = await runCli(['-q', 'anything'], pendingKills);
    await vi.waitFor(() => expect(waitForPendingKills).toHaveBeenCalled());
    vi.useFakeTimers();
    releaseKills();
    await loading;
    expect(process.exitCode).toBe(0);
    expect(exit).not.toHaveBeenCalled();
    // Abandoned work (a DNS lookup nobody answers) may still hold the loop,
    // so a backstop ends the process anyway.
    vi.runOnlyPendingTimers();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('leaves the run uncapped without --deadline', async () => {
    const { runSearch } = await runCli(['-q', 'anything']);
    expect(runSearch).toHaveBeenCalledWith(expect.objectContaining({ deadlineMs: undefined }));
  });

  it('passes --start and --max-length through for a page fetch (#57)', async () => {
    const { runSearch } = await runCli([
      '-u',
      'https://example.com',
      '--start',
      '50000',
      '--max-length',
      '20000',
    ]);
    expect(runSearch).toHaveBeenCalledWith(
      expect.objectContaining({ startIndex: 50_000, maxLength: 20_000 }),
    );
  });

  for (const [flags, message] of [
    [['--start', '-1'], 'Invalid --start'],
    [['--start', '12abc'], 'Invalid --start'],
    [['--max-length', '0'], 'Invalid --max-length'],
  ] as const) {
    it(`rejects ${flags.join(' ')}`, async () => {
      const { runSearch, stderr, loading } = await runCli(['-u', 'https://example.com', ...flags]);
      await loading;
      expect(process.exitCode).toBe(1);
      expect(runSearch).not.toHaveBeenCalled();
      expect(String(stderr.mock.calls.map((call) => call[0]).join(''))).toContain(message);
    });
  }

  it('refuses a page window on a search, which has no page to window', async () => {
    const { runSearch, stderr, loading } = await runCli(['-q', 'anything', '--start', '10']);
    await loading;
    expect(process.exitCode).toBe(1);
    expect(runSearch).not.toHaveBeenCalled();
    expect(String(stderr.mock.calls.map((call) => call[0]).join(''))).toContain('-u');
  });

  it('rejects a --deadline that is not a positive integer', async () => {
    const { runSearch, stderr, loading } = await runCli(['-q', 'anything', '--deadline', '0']);
    await loading;
    expect(process.exitCode).toBe(1);
    expect(runSearch).not.toHaveBeenCalled();
    expect(String(stderr.mock.calls.map((call) => call[0]).join(''))).toContain(
      'Invalid --deadline',
    );
  });
});
