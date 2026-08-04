import { describe, expect, it } from 'vitest';
import { resolveMode, validateUrl } from './search.ts';

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
