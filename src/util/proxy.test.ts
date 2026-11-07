import { describe, expect, it } from 'vitest';
import { resolveProxyForUrl } from './proxy.ts';

describe('resolveProxyForUrl', () => {
  const httpUrl = new URL('http://example.com/');
  const httpsUrl = new URL('https://example.com/');
  const proxy = 'http://127.0.0.1:8888';
  const otherProxy = 'http://127.0.0.1:9999';

  it('returns null when no proxy env is set', () => {
    expect(resolveProxyForUrl(httpUrl, {})).toBeNull();
    expect(resolveProxyForUrl(httpsUrl, {})).toBeNull();
  });

  it('returns null when proxy values are empty or whitespace', () => {
    expect(resolveProxyForUrl(httpUrl, { http_proxy: '' })).toBeNull();
    expect(resolveProxyForUrl(httpUrl, { http_proxy: '  ', HTTP_PROXY: '\t' })).toBeNull();
    expect(resolveProxyForUrl(httpsUrl, { https_proxy: ' ', HTTPS_PROXY: '' })).toBeNull();
  });

  it('uses http_proxy for an http URL', () => {
    expect(resolveProxyForUrl(httpUrl, { http_proxy: proxy })).toBe(proxy);
  });

  it('uses HTTP_PROXY when only the uppercase http proxy is set', () => {
    expect(resolveProxyForUrl(httpUrl, { HTTP_PROXY: proxy })).toBe(proxy);
  });

  it('lets lowercase http_proxy win over HTTP_PROXY', () => {
    expect(resolveProxyForUrl(httpUrl, { http_proxy: proxy, HTTP_PROXY: otherProxy })).toBe(proxy);
  });

  it('falls through a whitespace http_proxy to HTTP_PROXY', () => {
    expect(resolveProxyForUrl(httpUrl, { http_proxy: '  ', HTTP_PROXY: proxy })).toBe(proxy);
  });

  it('uses https_proxy for an https URL', () => {
    expect(resolveProxyForUrl(httpsUrl, { https_proxy: proxy })).toBe(proxy);
  });

  it('uses HTTPS_PROXY when only the uppercase https proxy is set', () => {
    expect(resolveProxyForUrl(httpsUrl, { HTTPS_PROXY: proxy })).toBe(proxy);
  });

  it('falls back to http_proxy for https when no https proxy is set', () => {
    expect(resolveProxyForUrl(httpsUrl, { http_proxy: proxy })).toBe(proxy);
  });

  it('does not use https_proxy alone for an http URL', () => {
    expect(resolveProxyForUrl(httpUrl, { https_proxy: proxy })).toBeNull();
    expect(resolveProxyForUrl(httpUrl, { HTTPS_PROXY: proxy })).toBeNull();
  });

  it('returns null when no_proxy is * even if a proxy is set', () => {
    expect(resolveProxyForUrl(httpUrl, { http_proxy: proxy, no_proxy: '* ' })).toBeNull();
    expect(resolveProxyForUrl(httpsUrl, { https_proxy: proxy, NO_PROXY: '*' })).toBeNull();
  });

  it('returns null when * is one comma-separated no_proxy entry', () => {
    expect(
      resolveProxyForUrl(httpUrl, { http_proxy: proxy, no_proxy: 'other.com, *, foo.net' }),
    ).toBeNull();
  });

  it('treats no_proxy=example.com as the host and its subdomains', () => {
    const env = { http_proxy: proxy, no_proxy: 'example.com' };
    expect(resolveProxyForUrl(new URL('http://example.com/'), env)).toBeNull();
    expect(resolveProxyForUrl(new URL('http://www.example.com/'), env)).toBeNull();
    expect(resolveProxyForUrl(new URL('http://a.b.example.com/'), env)).toBeNull();
    expect(resolveProxyForUrl(new URL('http://WWW.EXAMPLE.COM/'), env)).toBeNull();
  });

  it('treats no_proxy=.example.com as the host and its subdomains', () => {
    const env = { http_proxy: proxy, no_proxy: '.example.com' };
    expect(resolveProxyForUrl(new URL('http://example.com/'), env)).toBeNull();
    expect(resolveProxyForUrl(new URL('http://www.example.com/'), env)).toBeNull();
    expect(resolveProxyForUrl(new URL('http://a.b.example.com/'), env)).toBeNull();
  });

  it('does not treat no_proxy=other.com as a match for example.com', () => {
    expect(
      resolveProxyForUrl(httpUrl, { http_proxy: proxy, no_proxy: 'other.com' }),
    ).toBe(proxy);
  });

  it('matches no_proxy host:port only when the URL port matches', () => {
    const env = { http_proxy: proxy, no_proxy: 'example.com:8080' };
    expect(resolveProxyForUrl(new URL('http://example.com:8080/'), env)).toBeNull();
    expect(resolveProxyForUrl(new URL('http://example.com/'), env)).toBe(proxy);
    expect(resolveProxyForUrl(new URL('https://example.com/'), env)).toBe(proxy);
  });

  it('treats no_proxy=example.com:443 as a match for https on the implicit port', () => {
    expect(
      resolveProxyForUrl(httpsUrl, { https_proxy: proxy, no_proxy: 'example.com:443' }),
    ).toBeNull();
  });

  it('splits a comma-separated no_proxy list and trims surrounding whitespace', () => {
    const env = { http_proxy: proxy, no_proxy: ' other.com , example.com , foo.net ' };
    expect(resolveProxyForUrl(httpUrl, env)).toBeNull();
    expect(resolveProxyForUrl(new URL('http://unmatched.example/'), env)).toBe(proxy);
  });

  it('lets lowercase no_proxy win over NO_PROXY', () => {
    const env = {
      http_proxy: proxy,
      no_proxy: 'example.com',
      NO_PROXY: '*',
    };
    expect(resolveProxyForUrl(httpUrl, env)).toBeNull();
    expect(resolveProxyForUrl(new URL('http://other.com/'), env)).toBe(proxy);
  });
});
