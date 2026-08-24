import * as fs from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandOnPath } from './system.ts';
import { cleanupTempDirs, tempDir } from './testing/helpers.ts';

function executable(dir: string, name: string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, '', { mode: 0o755 });
  return file;
}

describe('commandOnPath', () => {
  afterEach(cleanupTempDirs);

  it('finds a Windows .exe when given its bare command name', () => {
    const dir = tempDir('modsearch-windows-bin-');
    executable(dir, 'agy.exe');

    expect(commandOnPath('agy', { PATH: dir }, 'win32')).toBe(true);
  });

  it('does not treat an extensionless Windows file as a runnable bare command', () => {
    const dir = tempDir('modsearch-windows-bin-');
    executable(dir, 'agy');

    expect(commandOnPath('agy', { PATH: dir }, 'win32')).toBe(false);
  });

  it('does not apply the Windows suffix on Unix', () => {
    const dir = tempDir('modsearch-unix-bin-');
    executable(dir, 'agy.exe');

    expect(commandOnPath('agy', { PATH: dir }, 'linux')).toBe(false);
  });

  it('does not append .exe to a command that already has an extension', () => {
    const dir = tempDir('modsearch-windows-bin-');
    executable(dir, 'agy.cmd.exe');

    expect(commandOnPath('agy.cmd', { PATH: dir }, 'win32')).toBe(false);
  });

  it('does not discover shell scripts through PATHEXT', () => {
    const dir = tempDir('modsearch-windows-bin-');
    executable(dir, 'agy.cmd');

    expect(commandOnPath('agy', { PATH: dir, PATHEXT: '.CMD;.EXE' }, 'win32')).toBe(false);
  });

  it('keeps explicit path lookup exact', () => {
    const dir = tempDir('modsearch-explicit-bin-');
    const bin = executable(dir, 'agy-custom');

    expect(commandOnPath(bin, { PATH: '/nonexistent' }, 'win32')).toBe(true);
  });
});
