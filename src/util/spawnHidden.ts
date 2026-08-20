// The only place in the core that starts a child process. A GUI host has no
// console of its own, so Windows otherwise allocates and shows a black console
// window for every engine invocation. The option is ignored off Windows.
//
// Writing windowsHide after the caller's options makes the guarantee
// structural. A call site cannot forget it or override it through a spread.
import {
  type ChildProcessByStdio,
  spawn,
  type SpawnOptionsWithStdioTuple,
  type StdioNull,
  type StdioPipe,
} from 'child_process';
import type { Readable } from 'stream';

export function spawnHidden(
  command: string,
  args: readonly string[],
  options: Omit<SpawnOptionsWithStdioTuple<StdioNull, StdioPipe, StdioPipe>, 'windowsHide'>,
): ChildProcessByStdio<null, Readable, Readable> {
  return spawn(command, args, { ...options, windowsHide: true });
}
