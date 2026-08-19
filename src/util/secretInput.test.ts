import { PassThrough } from 'stream';
import { describe, expect, it } from 'vitest';
import { readSecret } from './secretInput.ts';

// A PassThrough has no isTTY, so it takes the piped branch; setting isTTY
// makes readline treat it as a terminal, keypress handling included.
const piped = () => new PassThrough() as unknown as NodeJS.ReadStream;
const tty = () => {
  const stream = new PassThrough() as unknown as NodeJS.ReadStream & PassThrough;
  (stream as { isTTY: boolean }).isTTY = true;
  return stream;
};
const sink = () => {
  const stream = new PassThrough();
  stream.resume();
  return stream as unknown as NodeJS.WriteStream;
};

describe('readSecret, piped', () => {
  it('survives a multibyte character split across chunks', async () => {
    // Raw-chunk concatenation decodes each chunk alone and turns the
    // split character into replacement garbage, silently corrupting the
    // stored key.
    const stdin = piped();
    const pending = readSecret(': ', stdin, sink());
    const bytes = Buffer.from('密钥sk-秘密\n');
    (stdin as unknown as PassThrough).write(bytes.subarray(0, 4)); // mid-character
    await new Promise((resolve) => setTimeout(resolve, 5));
    (stdin as unknown as PassThrough).write(bytes.subarray(4));
    await expect(pending).resolves.toBe('密钥sk-秘密');
  });

  it('rejects an empty pipe', async () => {
    const stdin = piped();
    const pending = readSecret(': ', stdin, sink());
    (stdin as unknown as PassThrough).end();
    await expect(pending).rejects.toThrow(/no key arrived/);
  });
});

describe('readSecret, terminal', () => {
  it('resolves on enter and never echoes the key', async () => {
    const stdin = tty();
    const echoed: string[] = [];
    const stderr = new PassThrough();
    stderr.on('data', (chunk) => echoed.push(String(chunk)));
    const pending = readSecret('prompt: ', stdin, stderr as unknown as NodeJS.WriteStream);
    stdin.write('sk-visible\r');
    await expect(pending).resolves.toBe('sk-visible');
    expect(echoed.join('')).not.toContain('sk-visible');
    expect(echoed.join('')).toContain('prompt: ');
  });

  it('settles cleanly on Ctrl+C instead of leaving the promise hanging', async () => {
    // An unsettled promise here died as an unresolved top-level await:
    // exit 13 and an internal warning where a cancellation belonged.
    const stdin = tty();
    const pending = readSecret(': ', stdin, sink());
    stdin.write('\x03');
    await expect(pending).rejects.toThrow(/cancelled/);
  });

  it('settles cleanly on EOF', async () => {
    const stdin = tty();
    const pending = readSecret(': ', stdin, sink());
    (stdin as unknown as PassThrough).end();
    await expect(pending).rejects.toThrow(/input ended|no key/);
  });
});
