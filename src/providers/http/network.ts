// Network guards for the local page fetcher. This is the load-bearing SSRF
// surface: an agent will happily fetch a URL that appeared inside a web page,
// so blocked hostnames, private and reserved address ranges, and every redirect
// hop are validated here before a request goes out.
// DNS-derived IPv4 addresses in 198.18.0.0/15 are proxy fake-IP placeholders
// and pass without a private-network waiver. Literal URLs in that range stay
// blocked unless the guard is waived.
//
// DNS rebinding is closed on the direct path: assertSafeRemoteTarget resolves
// the hostname, checks every address, and returns the exact IP it validated.
// The caller pins the socket to that IP, so a DNS answer that changes between
// the check and the connect cannot point the socket at an address the check
// never saw. The Host header and TLS SNI still carry the original hostname.
// Every redirect hop repeats the check. When a system HTTP proxy is used, the
// proxy does DNS and the socket is not pinned. The preflight check still runs.
import * as dns from 'dns/promises';
import { isIP } from 'net';

/** The validated connection target: on the direct path, connect to this exact IP. */
export interface PinnedTarget {
  /** The original hostname, kept for the Host header and TLS SNI. */
  hostname: string;
  /** The IP the safety check validated. The socket connects here. */
  address: string;
  /** 4 or 6. */
  family: number;
}

/** Advisory DNS evidence used only before disclosing a URL to a cloud crawler. */
export interface CloudDisclosureInspection {
  reserved: boolean;
  addresses: string[];
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
  signal?: AbortSignal,
): Promise<PinnedTarget> {
  if (isBlockedHostname(url.hostname)) {
    throw new Error(`Blocked hostname: ${url.hostname}`);
  }

  const hostname = stripIpv6Brackets(url.hostname);

  // A literal IP is its own validated target: pin straight to it.
  const ipFamily = isIP(hostname);
  if (ipFamily > 0) {
    if (!allowPrivateNetwork && isPrivateIpAddress(hostname)) {
      if (isLoopbackIpAddress(hostname)) {
        throw new Error(privateNetworkBlockMessage(hostname));
      }
      throw new Error(`Blocked private network target: ${hostname}`);
    }
    return { hostname, address: hostname, family: ipFamily };
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await lookupAll(hostname, signal);
  } catch (error) {
    if (signal?.aborted) {
      throw signal.reason;
    }
    throw new Error(
      `DNS lookup failed for host ${hostname}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (resolved.length === 0) {
    throw new Error(`Host ${hostname} did not resolve to any IP address.`);
  }

  if (!allowPrivateNetwork) {
    const blocked = resolved.find(
      (record) => !isFakeIpPoolAddress(record.address) && isPrivateIpAddress(record.address),
    );
    if (blocked) {
      throw new Error(privateNetworkBlockMessage(hostname, blocked.address));
    }
  }

  // Return the first validated address. The direct path pins the socket here
  // so a later DNS change cannot swap in one the check never saw.
  const [chosen] = resolved;
  return { hostname, address: chosen.address, family: chosen.family };
}

/**
 * Is this target a *literal* private or reserved destination: a hostname that is
 * inherently local (localhost and `*.localhost`, `*.local`, `*.internal`, the
 * cloud metadata blacklist) or an IP written straight into the URL that lands in
 * a reserved range? These never make sense to hand to a cloud crawler, so a
 * cloud-fetch engine (firecrawl) skips them regardless of the allowPrivateNetwork
 * switch: forwarding one would leak an internal address to the cloud. It reads
 * nothing from DNS. A public-looking hostname is handled by the advisory cloud
 * disclosure inspection below.
 */
export function isLiteralReservedTarget(url: URL): boolean {
  if (isBlockedHostname(url.hostname)) {
    return true;
  }
  const hostname = stripIpv6Brackets(url.hostname).trim().toLowerCase();
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return true;
  }
  if (isIP(hostname) > 0) {
    return isPrivateIpAddress(hostname);
  }
  return false;
}

/**
 * Check for cloud-fetch engines such as Firecrawl: do all usable DNS answers
 * prove this target private or reserved and therefore unsafe to disclose?
 *
 * This is not a security boundary. The local engine's assertSafeRemoteTarget
 * stays the SSRF guard. The caller pins the socket on the direct path. Both
 * paths exempt DNS-derived IPv4 198.18/15 fake-IP placeholders, while literal
 * addresses stay reserved.
 * The local guard blocks any other private or reserved answer. This cloud check
 * allows disclosure if any answer is public or a fake-IP placeholder.
 * It never connects or pins. A DNS failure returns false
 * because this process cannot prove the target is reserved. The local-only
 * private-network switch does not change this result.
 */
export async function isReservedTarget(url: URL): Promise<boolean> {
  return (await inspectCloudDisclosureTarget(url)).reserved;
}

/**
 * Inspect a target for cloud disclosure and retain its DNS evidence for errors.
 * DNS answers share the local guard's IPv4 fake-IP exemption. Literal private
 * or reserved targets, including 198.18/15 addresses, remain reserved.
 */
export async function inspectCloudDisclosureTarget(
  url: URL,
  signal?: AbortSignal,
): Promise<CloudDisclosureInspection> {
  if (isBlockedHostname(url.hostname)) {
    return { reserved: true, addresses: [] };
  }

  const hostname = stripIpv6Brackets(url.hostname);
  const ipFamily = isIP(hostname);
  if (ipFamily > 0) {
    return { reserved: isPrivateIpAddress(hostname), addresses: [hostname] };
  }

  try {
    const resolved = await lookupAll(hostname, signal);
    const addresses = resolved.map((record) => record.address);
    return {
      reserved:
        addresses.length > 0 && addresses.every((address) => isPrivateForCloudDisclosure(address)),
      addresses,
    };
  } catch {
    // Out of time is the caller's deadline, not an unknown target.
    if (signal?.aborted) {
      throw signal.reason;
    }
    // Cannot confirm it is private from here, so do not block the cloud engine.
    return { reserved: false, addresses: [] };
  }
}

/**
 * Resolve every address for a hostname, giving up when `signal` fires. The
 * system resolver cannot be cancelled, so a slow lookup is abandoned rather
 * than stopped: the caller's deadline holds either way.
 */
async function lookupAll(
  hostname: string,
  signal?: AbortSignal,
): Promise<Array<{ address: string; family: number }>> {
  if (!signal) {
    return dns.lookup(hostname, { all: true, verbatim: true });
  }
  signal.throwIfAborted();
  const lookup = dns.lookup(hostname, { all: true, verbatim: true });
  // An abandoned lookup that fails later must not surface as unhandled.
  lookup.catch(() => {});
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([lookup, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Shared DNS-only exemption for local fetch and cloud disclosure. */
function isFakeIpPoolAddress(ipAddress: string): boolean {
  return isIP(ipAddress) === 4 && inRange(ipv4ToNumber(ipAddress), '198.18.0.0', '198.19.255.255');
}

/** DNS fake-IP placeholders do not mark a hostname private for cloud disclosure. */
function isPrivateForCloudDisclosure(ipAddress: string): boolean {
  return !isFakeIpPoolAddress(ipAddress) && isPrivateIpAddress(ipAddress);
}

const ALLOW_PRIVATE_NETWORK_HINT =
  'allow it with --allow-private-network, or: modsearch config set allowPrivateNetwork true';

function privateNetworkBlockMessage(hostname: string, resolvedAddress?: string): string {
  const target = resolvedAddress ? `${hostname} -> ${resolvedAddress}` : hostname;
  const blockedAddress = resolvedAddress ?? hostname;
  if (isLoopbackIpAddress(blockedAddress)) {
    return `Blocked private network target: ${target}. If a VPN or proxy on this machine maps public hosts into reserved ranges outside the 198.18.0.0/15 fake-IP pool, or a hosts-file accelerator (such as Watt Toolkit / Steam++) points public domains at 127.0.0.1, ${ALLOW_PRIVATE_NETWORK_HINT}`;
  }
  return `Blocked private network target: ${target}. If a VPN or proxy on this machine maps public hosts into reserved ranges outside the 198.18.0.0/15 fake-IP pool, ${ALLOW_PRIVATE_NETWORK_HINT}`;
}

function isLoopbackIpAddress(ipAddress: string): boolean {
  const normalized = ipAddress.trim().toLowerCase();
  const family = isIP(normalized);
  if (family === 4) {
    return isLoopbackIPv4(normalized);
  }
  if (family === 6) {
    return isLoopbackIPv6(normalized);
  }
  return false;
}

function isLoopbackIPv4(ipAddress: string): boolean {
  return inRange(ipv4ToNumber(ipAddress), '127.0.0.0', '127.255.255.255');
}

function isLoopbackIPv6(ipAddress: string): boolean {
  const groups = expandIpv6(ipAddress);
  if (groups?.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const mapped = [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join('.');
    return isLoopbackIPv4(mapped);
  }

  const normalized = ipAddress.split('%')[0];
  const mapped = extractMappedIpv4(normalized);
  if (mapped) {
    return isLoopbackIPv4(mapped);
  }

  const value = ipv6ToBigInt(normalized);
  if (value === null) {
    return false;
  }
  return inIpv6Range(value, '::1', 128);
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

/**
 * The gate every cloud fetch engine (firecrawl, keenable) passes before a URL
 * leaves the machine. A literal private target is refused outright. A hostname
 * is refused only when every usable DNS answer is private or reserved, with
 * the 198.18/15 fake-IP placeholders counted as public. --allow-private-network
 * authorizes the local fetcher only and never reaches this check. One deadline
 * covers the DNS lookup, so a slow resolver reads as this engine timing out.
 */
export async function assertCloudDisclosable(
  engineName: string,
  target: URL,
  deadline: AbortSignal,
  timeoutMs: number,
): Promise<void> {
  if (isLiteralReservedTarget(target)) {
    throw new Error(
      `${engineName} does not fetch the private or reserved target ${target.hostname}. Use the local engine instead.`,
    );
  }
  let disclosure: CloudDisclosureInspection;
  try {
    disclosure = await inspectCloudDisclosureTarget(target, deadline);
  } catch (error) {
    if (deadline.aborted) {
      throw new Error(`${engineName} timed out after ${timeoutMs} ms.`);
    }
    throw error;
  }
  if (disclosure.reserved) {
    const resolved =
      disclosure.addresses.length > 0 ? ` -> ${disclosure.addresses.join(', ')}` : '';
    throw new Error(
      `${engineName} does not fetch the private or reserved target ${target.hostname}${resolved}. If a VPN or proxy on this machine uses fake-IP DNS, a public hostname may look reserved here. Use the local engine instead.`,
    );
  }
}
