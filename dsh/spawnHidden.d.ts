import type { ChildProcess, SpawnOptions } from 'child_process';

export declare function spawnHidden(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess;
