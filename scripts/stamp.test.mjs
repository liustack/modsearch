import { describe, expect, it } from 'vitest';
import {
  dshInstallTargets,
  readPackageVersion,
  readStampedVersions,
  stampTargets,
} from './stamp.mjs';

describe('launcher version stamping', () => {
  it('keeps launchers and dsh install commands pinned to the package version', () => {
    const version = readPackageVersion();
    const stampedVersions = readStampedVersions();
    expect(stampedVersions.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'README.md dsh install',
        'README.zh-CN.md dsh install',
        'harness-setup.md dsh install',
        'harness-setup.md dsh update',
        'harness-setup.zh-CN.md dsh install',
        'harness-setup.zh-CN.md dsh update',
        'dsh.md install',
        'dsh.md doctor',
        'dsh.md update',
        'dsh.zh-CN.md install',
        'dsh.zh-CN.md doctor',
        'dsh.zh-CN.md update',
      ]),
    );
    for (const stamped of stampedVersions) {
      expect(stamped.version, `${stamped.file} is not stamped to ${version}`).toBe(version);
    }
  });

  it('rewrites only the version value and leaves the line shape intact', () => {
    const targets = [
      ...stampTargets('/base', '@scope/pkg'),
      ...dshInstallTargets('/repo', '@scope/pkg'),
    ];
    for (const target of targets) {
      const original = target.format('0.0.0');
      const restamped = original.replace(target.pattern, target.format('9.9.9'));
      expect(restamped).toBe(target.format('9.9.9'));
      expect(restamped).not.toBe(original);
    }
  });
});
