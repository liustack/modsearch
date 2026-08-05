#!/usr/bin/env node
// One command per release, because doing it by hand is how a version once
// shipped to npm with no changelog entry and no tag behind it.
//
//   pnpm release 3.2.4        explicit version
//   pnpm release patch        bump from the current one
//
// This script only prepares and pushes the release: validate, bump, commit,
// tag, push. It does NOT publish. Pushing the tag triggers CI
// (.github/workflows/release.yml), which publishes to npm with provenance and
// creates the GitHub release. Two publishers racing (a local `pnpm publish`
// plus the tag-triggered workflow) is exactly the double-publish this avoids.
//
// The order matters: everything that can refuse to release runs before the
// tag and push, the only irreversible steps here.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { changelogSection } from './changelog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: 'utf-8', stdio: 'pipe', ...options }).trim();
const runLoud = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });

function fail(message) {
  console.error(`\nRelease stopped: ${message}\n`);
  process.exit(1);
}

const pkgPath = join(root, 'package.json');
const pkgRaw = readFileSync(pkgPath, 'utf-8');
const pkg = JSON.parse(pkgRaw);

const requested = process.argv[2];
if (!requested) {
  fail('give a version (3.2.4) or a bump (patch, minor, major).');
}

const next = (() => {
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  if (requested === 'major') return `${major + 1}.0.0`;
  if (requested === 'minor') return `${major}.${minor + 1}.0`;
  if (requested === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (!/^\d+\.\d+\.\d+$/.test(requested)) fail(`"${requested}" is not a version or a bump.`);
  return requested;
})();

// --- refuse early, while nothing has happened yet ---

if (run('git', ['status', '--porcelain'])) {
  fail('the working tree has uncommitted changes. Commit them first.');
}
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== 'main') {
  fail(`on branch ${branch}, not main.`);
}
if (run('git', ['tag', '--list', `v${next}`])) {
  fail(`tag v${next} already exists.`);
}

// The check that would have caught a real mistake: a version published with
// nothing written about it.
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8');
const notes = changelogSection(changelog, next);
if (notes === null) {
  fail(`CHANGELOG.md has no "## ${next}" section. Write what changed before releasing it.`);
}
if (notes.length < 20) {
  fail(`the CHANGELOG entry for ${next} is empty. Say what changed.`);
}

console.log(`Releasing ${pkg.name} ${pkg.version} -> ${next}\n`);
runLoud('pnpm', ['typecheck']);
runLoud('pnpm', ['test']);
runLoud('pnpm', ['build']);

// --- from here on it is real ---

writeFileSync(pkgPath, pkgRaw.replace(`"version": "${pkg.version}"`, `"version": "${next}"`));
run('git', ['commit', '-am', `chore(release): v${next}`]);
run('git', ['tag', '-a', `v${next}`, '-m', `v${next}`]);
run('git', ['push', '--follow-tags']);

console.log(`\nPushed v${next}. CI takes it from here.`);
console.log('The release workflow (.github/workflows/release.yml) publishes to npm');
console.log('with provenance and creates the GitHub release.');
console.log('Watch it: gh run watch, or the repository Actions tab.');
