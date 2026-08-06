// Version stamping for the skill launchers. `scripts/release.mjs` calls
// stampLaunchers() at release time so the pinned version inside run.sh,
// run.ps1, references/runtime.md, and the SKILL.md no-script fallback can
// never drift from package.json by hand. The drift test
// (scripts/stamp.test.mjs) reads the same files back and asserts they match.
// Keeping the read and the write in one module is what keeps the two in step.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readPackage(root) {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
}

/** The version this repo currently ships, from package.json. */
export function readPackageVersion(root = repoRoot) {
  return readPackage(root).version;
}

/** The skill directory name, derived from the scoped package name. */
export function skillName(root = repoRoot) {
  return readPackage(root).name.split('/').pop();
}

/**
 * The files that carry the pinned version, each with a pattern that matches
 * one version occurrence and captures just the value in group 1, plus a
 * formatter that rebuilds that text for a given version. One pattern serves
 * both stamping (replace the text) and reading (capture the value).
 */
export function stampTargets(base, pkgName) {
  const skillFile = join(base, 'SKILL.md');
  const escaped = pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    {
      name: 'run.sh',
      file: join(base, 'scripts', 'run.sh'),
      pattern: /^PINNED="([^"]*)"$/m,
      format: (version) => `PINNED="${version}"`,
    },
    {
      name: 'run.ps1',
      file: join(base, 'scripts', 'run.ps1'),
      pattern: /^\$Pinned = '([^']*)'$/m,
      format: (version) => `$Pinned = '${version}'`,
    },
    {
      name: 'runtime.md',
      file: join(base, 'references', 'runtime.md'),
      pattern: /^- Pinned CLI version: (.+)$/m,
      format: (version) => `- Pinned CLI version: ${version}`,
    },
    {
      name: 'SKILL.md pinned prose',
      file: skillFile,
      pattern: /the pinned version is (\d+\.\d+\.\d+)/,
      format: (version) => `the pinned version is ${version}`,
    },
    {
      name: 'SKILL.md PATH rule',
      file: skillFile,
      pattern: /major version is \d+ and is at least (\d+\.\d+\.\d+)/,
      format: (version) => `major version is ${version.split('.')[0]} and is at least ${version}`,
    },
    {
      name: 'SKILL.md npx pin',
      file: skillFile,
      pattern: new RegExp(`npx --yes --package ${escaped}@(\\d+\\.\\d+\\.\\d+)`),
      format: (version) => `npx --yes --package ${pkgName}@${version}`,
    },
    {
      name: 'SKILL.md bunx pin',
      file: skillFile,
      pattern: new RegExp(`bunx --bun ${escaped}@(\\d+\\.\\d+\\.\\d+)`),
      format: (version) => `bunx --bun ${pkgName}@${version}`,
    },
  ];
}

/** Rewrite every launcher/reference version line to the package version. */
export function stampLaunchers(root = repoRoot) {
  const pkg = readPackage(root);
  const version = pkg.version;
  const base = join(root, 'skills', skillName(root));
  const stamped = [];
  for (const target of stampTargets(base, pkg.name)) {
    const before = readFileSync(target.file, 'utf-8');
    if (!target.pattern.test(before)) {
      throw new Error(`No version line to stamp in ${target.file}`);
    }
    const after = before.replace(target.pattern, target.format(version));
    if (after !== before) {
      writeFileSync(target.file, after);
    }
    stamped.push(target.name);
  }
  return { version, stamped };
}

/** The version currently written in each launcher/reference file. */
export function readStampedVersions(root = repoRoot) {
  const base = join(root, 'skills', skillName(root));
  return stampTargets(base, readPackage(root).name).map((target) => {
    const match = readFileSync(target.file, 'utf-8').match(target.pattern);
    return { name: target.name, file: target.file, version: match ? match[1] : null };
  });
}
