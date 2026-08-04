import { describe, expect, it } from 'vitest';
import { buildChain, resolveMode, validateUrl } from './search.ts';

describe('resolveMode', () => {
  it('is search when only a query is given', () => {
    expect(resolveMode('latest node lts', undefined)).toBe('search');
  });

  it('is fetch when a url is given, with or without a query', () => {
    expect(resolveMode(undefined, 'https://example.com')).toBe('fetch');
    expect(resolveMode('pricing details', 'https://example.com')).toBe('fetch');
  });

  it('rejects runs with neither query nor url', () => {
    expect(() => resolveMode(undefined, undefined)).toThrow(
      'Provide a search query (-q) or a URL to fetch (-u).',
    );
  });
});

describe('validateUrl', () => {
  it('accepts http and https urls', () => {
    expect(validateUrl(' https://example.com/page ')).toBe('https://example.com/page');
  });

  it('rejects other schemes', () => {
    expect(() => validateUrl('ftp://example.com')).toThrow('must start with http');
  });
});

describe('buildChain', () => {
  const names = (chain: ReturnType<typeof buildChain>) => chain.map((p) => p.name);

  it('walks agy, playwright, tavily for web searches when everything is available', () => {
    expect(
      names(
        buildChain({
          mode: 'search',
          wantSocial: false,
          availability: { agy: true, grok: true, tavily: true },
        }),
      ),
    ).toEqual(['antigravity-cli', 'playwright', 'tavily']);
  });

  it('always keeps playwright as the quota-less fallback', () => {
    expect(
      names(
        buildChain({
          mode: 'search',
          wantSocial: false,
          availability: { agy: false, grok: false, tavily: false },
        }),
      ),
    ).toEqual(['playwright']);
  });

  it('excludes tavily from fetch mode', () => {
    expect(
      names(
        buildChain({
          mode: 'fetch',
          wantSocial: false,
          availability: { agy: true, grok: true, tavily: true },
        }),
      ),
    ).toEqual(['antigravity-cli', 'playwright']);
  });

  it('prepends grok for social requests and keeps the web chain as degrade path', () => {
    expect(
      names(
        buildChain({
          mode: 'search',
          wantSocial: true,
          availability: { agy: true, grok: true, tavily: false },
        }),
      ),
    ).toEqual(['grok-cli', 'antigravity-cli', 'playwright']);
  });

  it('serves social requests from the web chain alone when grok is unavailable', () => {
    expect(
      names(
        buildChain({
          mode: 'search',
          wantSocial: true,
          availability: { agy: true, grok: false, tavily: false },
        }),
      ),
    ).toEqual(['antigravity-cli', 'playwright']);
  });
});
