import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertSafeRemoteTarget,
  isBlockedHostname,
  isLiteralReservedTarget,
  isPrivateIpAddress,
  isReservedTarget,
  normalizeFetchUrl,
} from './network.ts';

// Hostname-resolution cases stay offline. Literal-IP targets never reach this.
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock('dns/promises', () => ({ lookup: lookupMock }));

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('http network guards', () => {
  it.each(['localhost', 'app.localhost', 'metadata.google.internal', 'metadata.amazonaws.com'])(
    'blocks hostname %s',
    (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(true);
    },
  );

  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '192.168.1.1',
    '169.254.169.254',
    '198.18.92.141',
    '::1',
    'fc00::1',
  ])('treats %s as private', (ip) => {
    expect(isPrivateIpAddress(ip)).toBe(true);
  });

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
    await expect(assertSafeRemoteTarget(u('http://[::ffff:127.0.0.1]/'), false)).rejects.toThrow(
      /private/i,
    );
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
    expect(isLiteralReservedTarget(u('http://198.18.92.141/'))).toBe(true);
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
    expect(await isReservedTarget(u('http://192.168.0.1/'))).toBe(true);
    expect(await isReservedTarget(u('http://127.0.0.1/'))).toBe(true);
    expect(await isReservedTarget(u('http://[::1]/'))).toBe(true);
    expect(await isReservedTarget(u('http://localhost/'))).toBe(true);
  });

  it('does not flag ordinary public literals', async () => {
    expect(await isReservedTarget(u('http://93.184.216.34/'))).toBe(false);
    expect(await isReservedTarget(u('http://[2606:4700:4700::1111]/'))).toBe(false);
  });
});

describe('hostname-resolution block messages', () => {
  const allowHint =
    'allow it with --allow-private-network, or: modsearch config set allowPrivateNetwork true';

  async function blockedMessage(address: string, family: number): Promise<string> {
    lookupMock.mockResolvedValue([{ address, family }]);
    try {
      await assertSafeRemoteTarget(new URL('http://github.com/'), false);
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      return (error as Error).message;
    }
    throw new Error('expected assertSafeRemoteTarget to reject');
  }

  it.each([
    { address: '127.0.0.1', family: 4 },
    { address: '::1', family: 6 },
    { address: '::ffff:127.0.0.1', family: 6 },
    { address: '::ffff:7f00:1', family: 6 },
  ])('names a hosts-file accelerator when DNS returns $address', async ({ address, family }) => {
    const message = await blockedMessage(address, family);
    expect(message).toContain('Watt Toolkit / Steam++');
    expect(message).toContain('hosts');
    expect(message).toContain(allowHint);
  });

  it.each([
    { address: '198.18.91.58', family: 4 },
    { address: '10.0.0.5', family: 4 },
  ])('keeps VPN wording for reserved non-loopback $address', async ({ address, family }) => {
    const message = await blockedMessage(address, family);
    expect(message).toMatch(/VPN or proxy/);
    expect(message).toContain(allowHint);
    expect(message).not.toContain('Watt Toolkit');
    expect(message).not.toContain('Steam++');
    expect(message).not.toContain('hosts-file accelerator');
  });
});

describe('literal loopback block messages', () => {
  const allowHint =
    'allow it with --allow-private-network, or: modsearch config set allowPrivateNetwork true';

  it.each([
    'http://127.23.45.67/',
    'http://[::1]/',
    'http://[::ffff:127.1.2.3]/',
  ])('names a hosts-file accelerator for %s', async (url) => {
    await expect(assertSafeRemoteTarget(new URL(url), false)).rejects.toThrow(
      new RegExp(`Watt Toolkit / Steam\\+\\+.*${allowHint}`),
    );
  });

  it('keeps the literal non-loopback private message unchanged', async () => {
    await expect(assertSafeRemoteTarget(new URL('http://10.0.0.5/'), false)).rejects.toThrow(
      /^Blocked private network target: 10\.0\.0\.5$/,
    );
  });
});
