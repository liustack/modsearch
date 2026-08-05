import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { TRAP_HTML } from '../fixtures/index.ts';
import {
  extractLinks,
  extractVisibleTextFromHtml,
  isBlockedHostname,
  isPrivateIpAddress,
  normalizeFetchUrl,
} from './httpFetch.ts';
import { resolveEngine } from './index.ts';
import { planRole } from '../router.ts';

describe('http engine safety guards', () => {
  it.each([
    'localhost',
    'app.localhost',
    'metadata.google.internal',
    'metadata.amazonaws.com',
  ])('blocks hostname %s', (hostname) => {
    expect(isBlockedHostname(hostname)).toBe(true);
  });

  it.each(['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '::1', 'fc00::1'])(
    'treats %s as private',
    (ip) => {
      expect(isPrivateIpAddress(ip)).toBe(true);
    },
  );

  it('allows ordinary public addresses', () => {
    expect(isPrivateIpAddress('93.184.216.34')).toBe(false);
    expect(isBlockedHostname('example.com')).toBe(false);
  });

  it('rejects non-http schemes and embedded credentials', () => {
    expect(() => normalizeFetchUrl('file:///etc/passwd')).toThrow('Only http/https');
    expect(() => normalizeFetchUrl('https://user:pw@example.com')).toThrow('embedded credentials');
    expect(normalizeFetchUrl(' https://example.com/a ').toString()).toBe('https://example.com/a');
  });
});

describe('http engine extraction', () => {
  const html = `
    <html><head><title>Doc Title</title><style>.x{color:red}</style></head>
    <body>
      <script>console.log('hidden')</script>
      <h1>Heading</h1><p>First para &amp; entity.</p>
      <a href="/docs/start">Get started</a>
      <a href="https://other.example.com/x">Other</a>
      <a href="#anchor">Skip me</a>
      <a href="mailto:a@b.c">Mail</a>
    </body></html>`;

  it('keeps visible text and drops script, style, and head', () => {
    const extracted = extractVisibleTextFromHtml(html);
    expect(extracted.title).toBe('Doc Title');
    expect(extracted.text).toContain('Heading');
    expect(extracted.text).toContain('First para & entity.');
    expect(extracted.text).not.toContain('console.log');
    expect(extracted.text).not.toContain('color:red');
  });

  it('resolves links to absolute urls and skips anchors and mailto', () => {
    const links = extractLinks(html, 'https://example.com/guide/');
    expect(links).toEqual([
      { text: 'Get started', url: 'https://example.com/docs/start' },
      { text: 'Other', url: 'https://other.example.com/x' },
    ]);
  });
});

describe('http engine routing', () => {
  it('is registered as a fetch-only engine', () => {
    const engine = resolveEngine('http');
    expect(engine.name).toBe('http');
    expect(engine.roles).toEqual(['fetch']);
    expect(engine.isAvailable({}, {})).toBe(true);
    expect(resolveEngine('direct').name).toBe('http');
  });

  it('takes over page fetch when agy is not installed', () => {
    const bare = planRole('fetch', {}, undefined, { PATH: '/nonexistent' } as NodeJS.ProcessEnv);
    expect(bare.chain[0].name).toBe('http');
  });

  it('never takes over search', () => {
    expect(resolveEngine('http').roles).not.toContain('search');
  });
});

describe('private network escape hatch', () => {
  it('is off by default and settable from the config file', async () => {
    const { loadConfigFile, setConfigValue } = await import('../config.ts');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-apn-'));
    const p = path.join(dir, 'config.json');

    expect(loadConfigFile(p).engines?.http?.allowPrivateNetwork).toBeUndefined();
    setConfigValue('http.allowPrivateNetwork', 'true', p);
    expect(loadConfigFile(p).engines?.http?.allowPrivateNetwork).toBe('true');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('blocks a private target by default and names the VPN case', async () => {
    const { runFetch } = await import('./httpFetch.ts');
    await expect(runFetch({ url: 'http://127.0.0.1:1/x' })).rejects.toThrow(
      /Blocked private network target/,
    );
  });
});

describe('hardening against hostile pages', () => {
  it('treats IPv4-mapped IPv6 as private in hex form too', () => {
    // http://[::ffff:127.0.0.1] normalizes to ::ffff:7f00:1, which used to read
    // as a public IPv6 address and reached services bound to loopback.
    expect(isPrivateIpAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIpAddress('::ffff:a00:1')).toBe(true);
    expect(isPrivateIpAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('strips elements in linear time on malformed markup', () => {
    // The nested-quantifier regexes this replaced took 14 seconds here.
    const hostile = `<html><script>${'x<div '.repeat(40_000)}</html>`;
    const startedAt = Date.now();
    const extracted = extractVisibleTextFromHtml(hostile);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(extracted.text).not.toContain('<div');
  });

  it('drops an unclosed element instead of keeping its contents', () => {
    expect(extractVisibleTextFromHtml('<p>keep</p><script>secret').text).toBe('keep');
  });

  it('survives a numeric entity outside Unicode', () => {
    // One malformed entity used to throw RangeError and kill the whole fetch.
    const extracted = extractVisibleTextFromHtml('<p>before &#1114112; after &#xD800;</p>');
    expect(extracted.text).toContain('before');
    expect(extracted.text).toContain('after');
  });

  it('resolves links against the document base, not the response URL', () => {
    const html = `<base href="https://docs.example.com/v2/"><a href="guide?a=1&amp;b=2">Guide</a>`;
    expect(extractLinks(html, 'https://cdn.example.net/page')).toEqual([
      { text: 'Guide', url: 'https://docs.example.com/v2/guide?a=1&b=2' },
    ]);
  });

  it('survives every trap on one page (the shared fixture)', () => {
    const extracted = extractVisibleTextFromHtml(TRAP_HTML);
    expect(extracted.title).toBe('Trap Page');
    expect(extracted.text).toContain('visible & intact');
    expect(extracted.text).not.toContain('console.log');
    const links = extractLinks(TRAP_HTML, 'https://cdn.example.net/page');
    expect(links).toContainEqual({ text: 'Guide', url: 'https://docs.example.com/v2/guide' });
    expect(links).toContainEqual({ text: 'Other', url: 'https://other.example.com/x' });
  });
});

describe('stripElement edge cases from the verification pass', () => {
  it('does not leak hidden content when the document has Unicode uppercase', () => {
    // Unicode toLowerCase can lengthen a string (İ becomes two characters), and
    // the indices were used to slice the original, so script contents leaked.
    const html = `<p>${'İ'.repeat(20)}</p><script>SECRETSECRET</script><p>after</p>`;
    const extracted = extractVisibleTextFromHtml(html);
    expect(extracted.text).not.toContain('SECRET');
    expect(extracted.text).toContain('after');
  });

  it('ignores a tag name that appears inside an attribute value', () => {
    const html = `<div data-note="<script>">VISIBLE CONTENT</div><p>more</p>`;
    const extracted = extractVisibleTextFromHtml(html);
    expect(extracted.text).toContain('VISIBLE CONTENT');
    expect(extracted.text).toContain('more');
  });

  it('still strips a real element that follows an attribute mentioning it', () => {
    const html = `<div title="<script>">keep</div><script>drop</script><p>tail</p>`;
    const extracted = extractVisibleTextFromHtml(html);
    expect(extracted.text).toContain('keep');
    expect(extracted.text).toContain('tail');
    expect(extracted.text).not.toContain('drop');
  });
});

describe('link extraction accepts real-world href spellings', () => {
  it('reads unquoted and spaced href attributes', () => {
    const html = `<a href=https://a.example.com/one>One</a><a href = "https://b.example.com/two">Two</a>`;
    expect(extractLinks(html, 'https://base.example.com/')).toEqual([
      { text: 'One', url: 'https://a.example.com/one' },
      { text: 'Two', url: 'https://b.example.com/two' },
    ]);
  });

  it('reads an unquoted base href', () => {
    const html = `<base href=https://docs.example.com/v3/><a href="guide">G</a>`;
    expect(extractLinks(html, 'https://cdn.example.net/page')).toEqual([
      { text: 'G', url: 'https://docs.example.com/v3/guide' },
    ]);
  });
});
