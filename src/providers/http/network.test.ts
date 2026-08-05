import { describe, expect, it } from 'vitest';
import { isBlockedHostname, isPrivateIpAddress, normalizeFetchUrl } from './network.ts';

describe('http network guards', () => {
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

  it('treats IPv4-mapped IPv6 as private in hex form too', () => {
    // http://[::ffff:127.0.0.1] normalizes to ::ffff:7f00:1, which used to read
    // as a public IPv6 address and reached services bound to loopback.
    expect(isPrivateIpAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIpAddress('::ffff:a00:1')).toBe(true);
    expect(isPrivateIpAddress('2606:4700:4700::1111')).toBe(false);
  });
});
