import { describe, expect, it } from 'vitest';
import {
  assertSafeRemoteTarget,
  isBlockedHostname,
  isLiteralReservedTarget,
  isPrivateIpAddress,
  isReservedTarget,
  normalizeFetchUrl,
} from './network.ts';

describe('http network guards', () => {
  it.each(['localhost', 'app.localhost', 'metadata.google.internal', 'metadata.amazonaws.com'])(
    'blocks hostname %s',
    (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(true);
    },
  );

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

  it('treats IPv4-mapped IPv6 as private in hex form too, and blocks it as a target', () => {
    // http://[::ffff:127.0.0.1] normalizes to ::ffff:7f00:1, which used to read
    // as a public IPv6 address and reached services bound to loopback.
    expect(isPrivateIpAddress('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateIpAddress('::ffff:a00:1')).toBe(true);
    expect(isPrivateIpAddress('2606:4700:4700::1111')).toBe(false);
  });
});

describe('assertSafeRemoteTarget returns the pinned IP', () => {
  const u = (spec: string) => new URL(spec);
  const bare = (url: URL) => url.hostname.replace(/^\[|\]$/g, '');

  it('pins a public IPv4 literal to itself', async () => {
    expect(await assertSafeRemoteTarget(u('http://93.184.216.34/'), false)).toEqual({
      hostname: '93.184.216.34',
      address: '93.184.216.34',
      family: 4,
    });
  });

  it('pins a public IPv6 literal to itself, family 6', async () => {
    const url = u('http://[2606:4700:4700::1111]/');
    const pinned = await assertSafeRemoteTarget(url, false);
    expect(pinned.family).toBe(6);
    expect(pinned.address).toBe(bare(url));
    expect(pinned.hostname).toBe(bare(url));
  });

  it('pins a public ::ffff: mapped literal as family 6', async () => {
    const pinned = await assertSafeRemoteTarget(u('http://[::ffff:93.184.216.34]/'), false);
    expect(pinned.family).toBe(6);
  });

  it('blocks private IPv4, IPv6, and mapped-private literals before pinning', async () => {
    await expect(assertSafeRemoteTarget(u('http://127.0.0.1/'), false)).rejects.toThrow(/private/i);
    await expect(assertSafeRemoteTarget(u('http://[::1]/'), false)).rejects.toThrow(/private/i);
    await expect(
      assertSafeRemoteTarget(u('http://[::ffff:127.0.0.1]/'), false),
    ).rejects.toThrow(/private/i);
  });

  it('pins a private literal when the guard is waived', async () => {
    expect(await assertSafeRemoteTarget(u('http://127.0.0.1/'), true)).toEqual({
      hostname: '127.0.0.1',
      address: '127.0.0.1',
      family: 4,
    });
  });

  it('rejects a blocked hostname outright', async () => {
    await expect(assertSafeRemoteTarget(u('http://localhost/'), true)).rejects.toThrow(
      /Blocked hostname/,
    );
  });
});

describe('isLiteralReservedTarget: names and IPs that never go to the cloud', () => {
  const u = (spec: string) => new URL(spec);

  it('flags literal reserved IPs, loopback, and inherently local names', () => {
    expect(isLiteralReservedTarget(u('http://10.0.0.5/'))).toBe(true);
    expect(isLiteralReservedTarget(u('http://192.168.1.1/admin'))).toBe(true);
    expect(isLiteralReservedTarget(u('http://127.0.0.1/'))).toBe(true);
    expect(isLiteralReservedTarget(u('http://[::1]/'))).toBe(true);
    expect(isLiteralReservedTarget(u('http://localhost/'))).toBe(true);
    expect(isLiteralReservedTarget(u('http://app.localhost/'))).toBe(true);
    expect(isLiteralReservedTarget(u('http://printer.local/'))).toBe(true);
    expect(isLiteralReservedTarget(u('http://db.internal/'))).toBe(true);
    expect(isLiteralReservedTarget(u('http://metadata.google.internal/'))).toBe(true);
  });

  it('does not flag ordinary public literals or hostnames (DNS is never read)', () => {
    expect(isLiteralReservedTarget(u('http://93.184.216.34/'))).toBe(false);
    expect(isLiteralReservedTarget(u('http://[2606:4700:4700::1111]/'))).toBe(false);
    expect(isLiteralReservedTarget(u('http://example.com/'))).toBe(false);
  });
});

describe('isReservedTarget: advisory skip for cloud-fetch engines', () => {
  const u = (spec: string) => new URL(spec);

  it('flags private and blocked literals as reserved', async () => {
    expect(await isReservedTarget(u('http://192.168.0.1/'), false)).toBe(true);
    expect(await isReservedTarget(u('http://127.0.0.1/'), false)).toBe(true);
    expect(await isReservedTarget(u('http://[::1]/'), false)).toBe(true);
    expect(await isReservedTarget(u('http://localhost/'), false)).toBe(true);
  });

  it('does not flag ordinary public literals', async () => {
    expect(await isReservedTarget(u('http://93.184.216.34/'), false)).toBe(false);
    expect(await isReservedTarget(u('http://[2606:4700:4700::1111]/'), false)).toBe(false);
  });

  it('returns false for any target when the private network is allowed', async () => {
    // --allow-private-network means the user vouches for the reserved range, so
    // firecrawl should still try rather than skip.
    expect(await isReservedTarget(u('http://192.168.0.1/'), true)).toBe(false);
    expect(await isReservedTarget(u('http://localhost/'), true)).toBe(false);
  });
});
