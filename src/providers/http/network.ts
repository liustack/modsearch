// Network guards for the local page fetcher. This is the load-bearing SSRF
// surface: an agent will happily fetch a URL that appeared inside a web page,
// so blocked hostnames, private and reserved address ranges, and every redirect
// hop are validated here before a request goes out.
//
// DNS rebinding is closed: assertSafeRemoteTarget resolves the hostname, checks
// every address, and returns the exact IP it validated. The caller pins the
// connection to that IP (via an undici Agent with a custom lookup, see
// httpFetch.ts), so a DNS answer that changes between the check and the connect
// can no longer point the socket at an address the check never saw. The Host
// header and TLS SNI still carry the original hostname. Every redirect hop
// repeats the check and re-pins.
import * as dns from 'dns/promises';
import { isIP } from 'net';

/** The validated connection target: connect to this exact IP, not a re-lookup. */
export interface PinnedTarget {
  /** The original hostname, kept for the Host header and TLS SNI. */
  hostname: string;
  /** The IP the safety check validated. The socket connects here. */
  address: string;
  /** 4 or 6. */
  family: number;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.amazonaws.com',
  'metadata.azure.internal',
]);

export function normalizeFetchUrl(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Fetch URL is required.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`Invalid URL: ${trimmed}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs are supported.');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URL with embedded credentials is not allowed.');
  }

  return parsed;
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  if (BLOCKED_HOSTNAMES.has(normalized)) {
    return true;
  }

  if (normalized.endsWith('.localhost')) {
    return true;
  }

  return false;
}

export function isPrivateIpAddress(ipAddress: string): boolean {
  const normalized = ipAddress.trim().toLowerCase();
  const family = isIP(normalized);

  if (family === 4) {
    return isPrivateIPv4(normalized);
  }

  if (family === 6) {
    return isPrivateIPv6(normalized);
  }

  return true;
}

export async function assertSafeRemoteTarget(
  url: URL,
  allowPrivateNetwork: boolean,
): Promise<PinnedTarget> {
  if (isBlockedHostname(url.hostname)) {
    throw new Error(`Blocked hostname: ${url.hostname}`);
  }

  const hostname = stripIpv6Brackets(url.hostname);

  // A literal IP is its own validated target: pin straight to it.
  const ipFamily = isIP(hostname);
  if (ipFamily > 0) {
    if (!allowPrivateNetwork && isPrivateIpAddress(hostname)) {
      throw new Error(`Blocked private network target: ${hostname}`);
    }
    return { hostname, address: hostname, family: ipFamily };
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(
      `DNS lookup failed for host ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (resolved.length === 0) {
    throw new Error(`Host ${hostname} did not resolve to any IP address.`);
  }

  if (!allowPrivateNetwork) {
    const blocked = resolved.find((record) => isPrivateIpAddress(record.address));
    if (blocked) {
      // VPN and proxy clients routinely map public hosts into reserved ranges
      // (198.18/15 especially), so a real site can look private from here.
      throw new Error(
        `Blocked private network target: ${hostname} -> ${blocked.address}. If a VPN or proxy on this machine maps public hosts into reserved ranges, allow it with --allow-private-network, or: modsearch config set http.allowPrivateNetwork true`,
      );
    }
  }

  // Pin to the first validated address. The connection uses exactly this IP,
  // so a later DNS change cannot swap in one the check never saw.
  const [chosen] = resolved;
  return { hostname, address: chosen.address, family: chosen.family };
}

function stripIpv6Brackets(hostname: string): string {
  if (hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

function isPrivateIPv4(ipAddress: string): boolean {
  const octets = ipAddress.split('.').map((part) => Number.parseInt(part, 10));
  if (
    octets.length !== 4 ||
    octets.some((value) => !Number.isFinite(value) || value < 0 || value > 255)
  ) {
    return true;
  }

  const value = octets[0] * 256 ** 3 + octets[1] * 256 ** 2 + octets[2] * 256 + octets[3];

  return (
    inRange(value, '0.0.0.0', '0.255.255.255') ||
    inRange(value, '10.0.0.0', '10.255.255.255') ||
    inRange(value, '100.64.0.0', '100.127.255.255') ||
    inRange(value, '127.0.0.0', '127.255.255.255') ||
    inRange(value, '169.254.0.0', '169.254.255.255') ||
    inRange(value, '172.16.0.0', '172.31.255.255') ||
    inRange(value, '192.0.0.0', '192.0.0.255') ||
    inRange(value, '192.168.0.0', '192.168.255.255') ||
    inRange(value, '198.18.0.0', '198.19.255.255') ||
    inRange(value, '224.0.0.0', '255.255.255.255')
  );
}

function inRange(value: number, start: string, end: string): boolean {
  return value >= ipv4ToNumber(start) && value <= ipv4ToNumber(end);
}

function ipv4ToNumber(ipAddress: string): number {
  const octets = ipAddress.split('.').map((part) => Number.parseInt(part, 10));
  return octets[0] * 256 ** 3 + octets[1] * 256 ** 2 + octets[2] * 256 + octets[3];
}

function isPrivateIPv6(ipAddress: string): boolean {
  // ::ffff:127.0.0.1 normalizes to ::ffff:7f00:1, whose last two groups are
  // the IPv4 address in hex. Judging it as IPv6 would wave through loopback.
  const groups = expandIpv6(ipAddress);
  if (groups && groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const mapped = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
    return isPrivateIPv4(mapped);
  }

  const normalized = ipAddress.split('%')[0];
  const mapped = extractMappedIpv4(normalized);
  if (mapped && isPrivateIPv4(mapped)) {
    return true;
  }

  const value = ipv6ToBigInt(normalized);
  if (value === null) {
    return true;
  }

  return (
    inIpv6Range(value, '::', 128) ||
    inIpv6Range(value, '::1', 128) ||
    inIpv6Range(value, 'fc00::', 7) ||
    inIpv6Range(value, 'fe80::', 10) ||
    inIpv6Range(value, 'ff00::', 8) ||
    inIpv6Range(value, '2001:db8::', 32)
  );
}

function extractMappedIpv4(ipAddress: string): string | null {
  const lower = ipAddress.toLowerCase();
  const marker = '::ffff:';
  if (!lower.startsWith(marker)) {
    return null;
  }

  const candidate = lower.slice(marker.length);
  return isIP(candidate) === 4 ? candidate : null;
}

function inIpv6Range(value: bigint, start: string, prefixLength: number): boolean {
  const startValue = ipv6ToBigInt(start);
  if (startValue === null) {
    return false;
  }

  const mask =
    prefixLength === 0 ? 0n : ((1n << BigInt(prefixLength)) - 1n) << BigInt(128 - prefixLength);
  return (value & mask) === (startValue & mask);
}

function ipv6ToBigInt(ipAddress: string): bigint | null {
  const expanded = expandIpv6(ipAddress);
  if (!expanded) {
    return null;
  }

  return expanded.reduce((acc, group) => (acc << 16n) + BigInt(group), 0n);
}

function expandIpv6(ipAddress: string): number[] | null {
  const value = ipAddress.toLowerCase();
  if (value.includes('::')) {
    const [left, right] = value.split('::');
    const leftGroups = left ? left.split(':').filter(Boolean) : [];
    const rightGroups = right ? right.split(':').filter(Boolean) : [];

    if (leftGroups.length + rightGroups.length > 8) {
      return null;
    }

    const middle = new Array(8 - leftGroups.length - rightGroups.length).fill('0');
    const allGroups = [...leftGroups, ...middle, ...rightGroups];
    return parseIpv6Groups(allGroups);
  }

  return parseIpv6Groups(value.split(':'));
}

function parseIpv6Groups(groups: string[]): number[] | null {
  if (groups.length !== 8) {
    return null;
  }

  const parsed = groups.map((group) => Number.parseInt(group || '0', 16));
  if (parsed.some((value) => !Number.isFinite(value) || value < 0 || value > 0xffff)) {
    return null;
  }

  return parsed;
}
