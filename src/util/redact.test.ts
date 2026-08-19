import { describe, expect, it } from 'vitest';
import { maskUrlCredentials, redactSecrets } from './redact.ts';

describe('redactSecrets', () => {
  it('replaces known secrets exactly, wherever they appear', () => {
    const out = redactSecrets('401 for key my-Secret-Key-9 (my-Secret-Key-9)', [
      'my-Secret-Key-9',
    ]);
    expect(out).not.toContain('my-Secret-Key-9');
    expect(out).toContain('[redacted]');
  });

  it('catches vendor token shapes without knowing the secret', () => {
    const samples = [
      'error: sk-proj-abc123DEF456ghi789jkl was rejected',
      'AIzaSyD-1234567890abcdefghijklmnop denied',
      'push failed for ghp_ABCDEFGHIJKLMNOPQRST123456',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpM',
      'Authorization: Bearer abc.def-ghi_jkl123456789',
      'api_key=verylongsecretvalue123 in query',
    ];
    for (const sample of samples) {
      const out = redactSecrets(sample);
      expect(out).toContain('[redacted]');
    }
    expect(redactSecrets(samples[0])).not.toContain('sk-proj-');
  });

  it('leaves ordinary error text alone', () => {
    const text = 'Gemini API error 429: quota exceeded, retry in 30s (model gemini-3.6-flash)';
    expect(redactSecrets(text)).toBe(text);
  });

  it('ignores empty and too-short known secrets', () => {
    expect(redactSecrets('code ab12 failed', ['ab12', undefined, null, ''])).toBe(
      'code ab12 failed',
    );
  });

  it('strips URL userinfo, the shape proxy URLs leak credentials in', () => {
    const out = redactSecrets(
      'connect ECONNREFUSED via http://alice:s3cr3t@proxy.example:8080',
    );
    expect(out).not.toContain('alice');
    expect(out).not.toContain('s3cr3t');
    expect(out).toContain('http://[redacted]@proxy.example:8080/');
  });

  it('masks the whole userinfo when the password itself contains @', () => {
    // WHATWG URLs fold unescaped extra @s into the password; stopping at
    // the first @ used to leak the password's tail ("ss@host").
    const out = redactSecrets('via http://alice:p@ss@proxy.example:8080');
    expect(out).toBe('via http://[redacted]@proxy.example:8080/');
  });

  it('never tears scheme-less prose that merely contains //text@', () => {
    const generated = 'TypeError: unexpected token //foo@bar in generated source';
    expect(redactSecrets(generated)).toBe(generated);
    const mention = 'diagnostic: see //owner@example.com for escalation';
    expect(redactSecrets(mention)).toBe(mention);
  });

  it('masks slash-less and separator-variant schemes the parser accepts', () => {
    // Special schemes need no slashes at all for WHATWG to read an
    // authority, and the parser strips raw line breaks, so all of these
    // are proxy URLs the runtime would connect through.
    for (const raw of [
      'http:alice:secret@proxy.example',
      'http:/alice:secret@proxy.example',
      'http:\\alice:secret@proxy.example',
      'http://alice:sec\nret@proxy.example',
      'http://alice:sec\rret@proxy.example',
    ]) {
      const out = redactSecrets(`via ${raw} done`);
      expect(out).toBe('via http://[redacted]@proxy.example/ done');
      expect(maskUrlCredentials(raw)).toBe('http://***@proxy.example/');
    }
  });

  it('adjacent second URLs with sparse separators are still caught', () => {
    // The second URL needs no double slash for the runtime to accept it,
    // and the separator can be any character an authority refuses (a
    // control character, a comma, a pipe): each such piece is judged by
    // its own parse.
    for (const [separator, second] of [
      ['\n', 'http:/bob:password@two.example'],
      ['\t', 'http:\\bob:password@two.example'],
      [',', 'http:/bob:password@two.example'],
      ['|', 'http:/bob:password@two.example'],
      ['\v', 'http:/bob:password@two.example'],
      [' ', 'http:/bob:password@two.example'],
    ]) {
      const out = redactSecrets(`http://one.example${separator}${second}`);
      expect(out, JSON.stringify(separator)).not.toContain('password');
      expect(out).toContain('http://[redacted]@two.example');
    }
  });

  it('a user-only @ torn out of opaque prose is an address, not a credential', () => {
    // note:http://owner@example.net parses whole as an opaque note:
    // token with no credentials; the interior http URL carries only a
    // username. Neither reading is a proxy credential pair.
    const prose = 'opaque note:http://owner@example.net stays prose';
    expect(redactSecrets(prose)).toBe(prose);
  });

  it('adjacent URLs separated only by tab or newline are each masked', () => {
    // Tab and newline can separate two URLs just as legally as they can
    // sit inside one; a merged candidate used to hand the parser only the
    // first authority and leak the second URL's credentials.
    const both = redactSecrets(
      'http://alice:secret@one.example\nhttp://bob:password@two.example',
    );
    expect(both).not.toContain('secret');
    expect(both).not.toContain('password');
    expect(both).toContain('two.example');
    const secondOnly = redactSecrets('http://one.example\thttp://bob:password@two.example');
    expect(secondOnly).toBe('http://one.example\thttp://[redacted]@two.example/');
    const mixedSchemes = redactSecrets(
      'http://alice:secret@[2001:db8::1]\nsocks5://bob:password@proxy.example:1080',
    );
    expect(mixedSchemes).not.toContain('password');
    expect(mixedSchemes).toContain('socks5://[redacted]@proxy.example:1080');
  });

  it('leaves scheme-and-@ prose alone when the parse finds no credentials', () => {
    const ratio = 'render at ratio:3@2x for retina';
    expect(redactSecrets(ratio)).toBe(ratio);
    const mail = 'contact mailto:owner@example.net for access';
    expect(redactSecrets(mail)).toBe(mail);
  });

  it('masks every credential shape the WHATWG parser accepts', () => {
    // The runtime connects through the WHATWG parser, so the mask parses
    // first instead of approximating with a regex: backslash authorities,
    // slash runs, and tabs inside the authority all carry credentials the
    // parser reads and the proxy uses.
    expect(redactSecrets('via http:\\\\alice:secret@proxy.example done')).toBe(
      'via http://[redacted]@proxy.example/ done',
    );
    expect(redactSecrets('via http:////alice:secret@proxy.example done')).toBe(
      'via http://[redacted]@proxy.example/ done',
    );
    expect(redactSecrets('via http://alice:sec\tret@proxy.example done')).toBe(
      'via http://[redacted]@proxy.example/ done',
    );
    // A backslash path relocated the visible host in the regex days; the
    // parser keeps the real host.
    const out = redactSecrets('via http://alice:secret@proxy.example\\path@tail.example');
    expect(out).toContain('http://[redacted]@proxy.example/');
    expect(out).not.toContain('secret');
  });

  it('stops at the authority: an @ inside a query or fragment is content', () => {
    // Greedy-to-last-@ must not cross ? or #, or the real host and query
    // get swallowed and query text impersonates the host.
    expect(redactSecrets('http://alice:secret@proxy.example?contact=owner@example.net')).toBe(
      'http://[redacted]@proxy.example/?contact=owner@example.net',
    );
    const noCreds = 'fetch http://example.com?email=owner@example.net failed';
    expect(redactSecrets(noCreds)).toBe(noCreds);
    const fragment = 'see http://example.com#mail=owner@example.net';
    expect(redactSecrets(fragment)).toBe(fragment);
  });
});

describe('maskUrlCredentials', () => {
  it('masks userinfo while keeping the URL recognizable', () => {
    expect(maskUrlCredentials('http://alice:s3cr3t@proxy.example:8080')).toBe(
      'http://***@proxy.example:8080/',
    );
    expect(maskUrlCredentials('socks5://bob@10.0.0.1:1080')).toBe('socks5://***@10.0.0.1:1080');
  });

  it('masks up to the last @, so a password containing @ leaves no tail', () => {
    expect(maskUrlCredentials('http://alice:p@ss@proxy.example:8080')).toBe(
      'http://***@proxy.example:8080/',
    );
    expect(maskUrlCredentials('http:\\\\alice:secret@proxy.example')).toBe(
      'http://***@proxy.example/',
    );
    expect(maskUrlCredentials('http:////alice:secret@proxy.example')).toBe(
      'http://***@proxy.example/',
    );
    expect(maskUrlCredentials('http://alice:sec\tret@proxy.example')).toBe(
      'http://***@proxy.example/',
    );
  });

  it('leaves credential-free URLs untouched', () => {
    expect(maskUrlCredentials('http://proxy.example:8080')).toBe('http://proxy.example:8080');
    expect(maskUrlCredentials('http://proxy.example:8080/path@segment')).toBe(
      'http://proxy.example:8080/path@segment',
    );
    expect(maskUrlCredentials('http://proxy.example?contact=owner@example.net')).toBe(
      'http://proxy.example?contact=owner@example.net',
    );
  });
});
