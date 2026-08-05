import * as fs from 'fs';
import * as path from 'path';

/** Is this binary runnable from here? Accepts a bare name or a full path. */
export function commandOnPath(bin: string, env: NodeJS.ProcessEnv = process.env): boolean {
  if (bin.includes(path.sep)) {
    return fs.existsSync(bin);
  }
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    try {
      fs.accessSync(path.join(dir, bin), fs.constants.X_OK);
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}
