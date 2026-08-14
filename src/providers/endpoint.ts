// Endpoint resolution for the HTTP engines (tavily, exa, firecrawl). Its own
// module with no imports, so providers can use it at runtime without creating
// a value-level cycle through the registry in index.ts.
/**
 * The endpoint an HTTP engine posts to: its documented path on the configured
 * `baseURL` when one is set (a third-party compatible gateway or self-hosted
 * deployment), else on the official base. `config set` validates the scheme at
 * write time; this re-checks because an env var (`TAVILY_BASE_URL`) skips that
 * gate, and a bad value should fail here with its name, not as a fetch error.
 */
export function resolveEndpoint(
  baseURL: string | undefined,
  defaultBase: string,
  pathname: string,
): string {
  const base = baseURL?.trim() || defaultBase;
  if (!/^https?:\/\//i.test(base)) {
    throw new Error(
      `Invalid engine baseURL "${base}". Use a full http(s) URL, e.g. https://api.example.com`,
    );
  }
  return `${base.replace(/\/+$/, '')}${pathname}`;
}
