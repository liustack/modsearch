import { describe, expect, it } from 'vitest';
import { readPackageVersion, readStampedVersions, stampTargets } from './stamp.mjs';

describe('launcher version stamping', () => {
  it('keeps run.sh, run.ps1, runtime.md, and SKILL.md pinned to the package version', () => {
    const version = readPackageVersion();
    for (const stamped of readStampedVersions()) {
      expect(stamped.version, `${stamped.file} is not stamped to ${version}`).toBe(version);
    }
  });

  it('rewrites only the version value and leaves the line shape intact', () => {
    for (const target of stampTargets('/base', '@scope/pkg')) {
      const original = target.format('0.0.0');
      const restamped = original.replace(target.pattern, target.format('9.9.9'));
      expect(restamped).toBe(target.format('9.9.9'));
      expect(restamped).not.toBe(original);
    }
  });
});
