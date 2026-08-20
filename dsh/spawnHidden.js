// The only place the standalone dsh plugin starts a child process. dsh can run
// inside a GUI host with no console, where Windows otherwise shows a black
// console window for every ModSearch call.
import { spawn } from 'node:child_process';

export function spawnHidden(command, args, options) {
  return spawn(command, args, { ...options, windowsHide: true });
}
