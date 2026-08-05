import { spawn } from 'child_process';
import type { ProviderInvocation } from './providers/index.ts';

export interface CommandResult {
  stdout: string;
  stderr: string;
}

// After the engine exits, how long to keep draining stdout before giving up
// on the pipe closing. Reset whenever more output arrives.
const DRAIN_GRACE_MS = 500;
// How long a killed child gets before SIGKILL.
const SIGKILL_GRACE_MS = 2_000;

/**
 * Run an engine binary and collect its output.
 *
 * 'close' waits for every stdio pipe to close, but agy leaves a language
 * server running that inherited the pipe, so its write end never closes and
 * 'close' never fires (modlens issue #1). Settle on 'exit' plus a drain window
 * instead, and drop the pipes afterwards so the lingering descendant cannot
 * keep this process alive either.
 */
export function runCommand(
  engineName: string,
  invocation: ProviderInvocation,
  timeoutMs: number,
  describeFailure?: (context: { stdout: string; stderr: string; code: number | null }) => string | null,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Decoders keep state across chunks: a multi-byte character split down the
    // middle used to come out as replacement characters.
    const outDecoder = new TextDecoder('utf-8');
    const errDecoder = new TextDecoder('utf-8');
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let drainTimer: NodeJS.Timeout | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // A child that ignores SIGTERM used to keep the caller waiting for as
      // long as it liked, so report the timeout now and make sure it dies.
      settle(null);
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, SIGKILL_GRACE_MS).unref();
    }, timeoutMs);

    const settle = (code: number | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(drainTimer);
      // Flush the decoders: trailing bytes of a split character were dropped.
      stdout += outDecoder.decode();
      stderr += errDecoder.decode();
      child.stdout?.destroy();
      child.stderr?.destroy();
      child.unref();

      if (timedOut) {
        reject(new Error(`${engineName} engine timed out after ${timeoutMs} ms.`));
        return;
      }
      if (code !== 0) {
        const explained = describeFailure?.({ stdout, stderr, code }) ?? null;
        reject(
          new Error(
            explained ??
              `${engineName} engine failed with code ${code}.${stderr ? ` stderr: ${stderr.trim()}` : ''}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    };

    let exitCode: number | null = null;
    let exited = false;
    const restartDrain = () => {
      if (!exited || settled) {
        return;
      }
      clearTimeout(drainTimer);
      drainTimer = setTimeout(() => settle(exitCode), DRAIN_GRACE_MS);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += outDecoder.decode(chunk, { stream: true });
      restartDrain();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += errDecoder.decode(chunk, { stream: true });
      restartDrain();
    });

    child.on('error', (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      clearTimeout(drainTimer);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(
          new Error(`Engine CLI not found: ${invocation.command}. Install it and sign in first.`),
        );
        return;
      }
      reject(error);
    });

    child.on('exit', (code) => {
      exitCode = code;
      exited = true;
      restartDrain();
    });

    // Normal engines close their pipes right after exiting: settle at once.
    child.on('close', (code) => settle(code));
  });
}
