// Which system HTTP proxy a request should use, read from the conventional
// http_proxy / https_proxy / no_proxy variables (either case). Shared by the
// local page fetch and every engine API call, so both honor one NO_PROXY.
function firstNonEmpty(values: Array<string | undefined>): string | null {
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed !== '') {
      return trimmed;
    }
  }
  return null;
}

function proxyUriForProtocol(protocol: string, env: NodeJS.ProcessEnv): string | null {
  if (protocol === 'http:') {
    return firstNonEmpty([env.http_proxy, env.HTTP_PROXY]);
  }
  if (protocol === 'https:') {
    return firstNonEmpty([env.https_proxy, env.HTTPS_PROXY, env.http_proxy, env.HTTP_PROXY]);
  }
  return null;
}

function urlPort(url: URL): number {
  if (url.port) {
    return Number.parseInt(url.port, 10);
  }
  return url.protocol === 'https:' ? 443 : 80;
}

function isExcludedByNoProxy(url: URL, env: NodeJS.ProcessEnv): boolean {
  const raw = env.no_proxy ?? env.NO_PROXY;
  if (raw === undefined) {
    return false;
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return false;
  }
  if (trimmed === '*') {
    return true;
  }

  const hostname = url.hostname.toLowerCase();
  const port = urlPort(url);

  for (const part of trimmed.split(/[,\s]/)) {
    if (!part) {
      continue;
    }
    if (part === '*') {
      return true;
    }
    const parsed = part.match(/^(.+):(\d+)$/);
    const hostRaw = parsed ? parsed[1] : part;
    const entryHost = hostRaw.replace(/^\*?\./, '').toLowerCase();
    const entryPort = parsed ? Number.parseInt(parsed[2], 10) : undefined;
    if (entryPort !== undefined && entryPort !== port) {
      continue;
    }
    if (hostname === entryHost || hostname.endsWith(`.${entryHost}`)) {
      return true;
    }
  }
  return false;
}

/** Which system HTTP proxy to use for this URL, or null to go direct. */
export function resolveProxyForUrl(url: URL, env: NodeJS.ProcessEnv): string | null {
  const proxyUrl = proxyUriForProtocol(url.protocol, env);
  if (!proxyUrl) {
    return null;
  }
  if (isExcludedByNoProxy(url, env)) {
    return null;
  }
  return proxyUrl;
}
