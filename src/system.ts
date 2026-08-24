import * as fs from 'fs';
import * as path from 'path';

/** Is this binary runnable from here? Accepts a bare name or a full path. */
export function commandOnPath(
  bin: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (bin.includes(path.sep)) {
    return fs.existsSync(bin);
  }
  // Windows command lookup resolves a bare `agy` to the native `agy.exe`.
  // Check only the executable format our shell-free spawn boundary can run:
  // accepting PATHEXT's .cmd or .bat entries here would advertise a command
  // that the spawn wrapper intentionally refuses without a shell.
  const candidates =
    platform === 'win32' && path.extname(bin) === '' ? [`${bin}.exe`] : [bin];
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    for (const candidate of candidates) {
      try {
        fs.accessSync(path.join(dir, candidate), fs.constants.X_OK);
        return true;
      } catch {
        // keep looking
      }
    }
  }
  return false;
}
