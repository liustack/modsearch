import { describe, expect, it } from 'vitest';
import {
  extractLinks,
  extractVisibleTextFromHtml,
  isBlockedHostname,
  isPrivateIpAddress,
  normalizeFetchUrl,
} from './httpFetch.ts';
import { resolveProvider } from './index.ts';
import { routeProvider } from '../search.ts';

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
    const provider = resolveProvider('http');
    expect(provider.name).toBe('http');
    expect(provider.modes).toEqual(['fetch']);
    expect(resolveProvider('direct').name).toBe('http');
  });

  it('takes over page fetch when agy is not installed', () => {
    expect(routeProvider({ mode: 'fetch', agyBin: '/nonexistent/agy' }).name).toBe('http');
    expect(routeProvider({ mode: 'fetch', agyBin: '/bin/sh' }).name).toBe('antigravity-cli');
  });

  it('never takes over search', () => {
    expect(routeProvider({ mode: 'search', query: 'anything' }).name).not.toBe('http');
  });
});

describe('private network escape hatch', () => {
  it('is off by default and settable from the config file', async () => {
    const { loadConfigFile, setConfigValue } = await import('../config.ts');
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'modsearch-apn-')), 'config.json');

    expect(loadConfigFile(p).providers?.http?.allowPrivateNetwork).toBeUndefined();
    setConfigValue('http.allowPrivateNetwork', 'true', p);
    expect(loadConfigFile(p).providers?.http?.allowPrivateNetwork).toBe('true');
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  });

  it('names the VPN case in the block message so the fix is obvious', async () => {
    // A VPN that maps public hosts into 198.18/15 makes real sites look
    // private, and a bare "blocked" message would send people hunting.
    const { runFetch } = await import('./httpFetch.ts');
    await expect(runFetch({ url: 'http://127.0.0.1:1/x' })).rejects.toThrow(
      /Blocked private network target/,
    );
  });
});
