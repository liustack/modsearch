import { describe, expect, it } from 'vitest';
import { buildBingUrl, buildSerpUrl, summarizeSerp, unwrapBingUrl } from './playwright.ts';

describe('playwright provider pure parts', () => {
  it('builds a google SERP url with a capped result count', () => {
    const url = buildSerpUrl('node lts version', 8);
    expect(url).toContain('https://www.google.com/search?q=node%20lts%20version');
    expect(url).toContain('num=10');
    expect(buildSerpUrl('q', 100)).toContain('num=10');
    expect(buildSerpUrl('q', 1)).toContain('num=3');
  });

  it('summarizes mechanically from the top titles', () => {
    const summary = summarizeSerp('node lts', [
      { title: 'A', url: 'https://a.com', snippet: '' },
      { title: 'B', url: 'https://b.com', snippet: '' },
    ]);
    expect(summary).toContain('2 results scraped');
    expect(summary).toContain('A | B');
  });

  it('builds bing urls and unwraps /ck/ redirect links', () => {
    expect(buildBingUrl('node lts')).toBe('https://www.bing.com/search?q=node%20lts&setlang=en');
    const target = 'https://nodejs.org/en';
    const b64 = Buffer.from(target, 'utf-8').toString('base64').replace(/=+$/, '');
    expect(unwrapBingUrl(`https://www.bing.com/ck/a?!&&p=abc&u=a1${b64}&ntb=1`)).toBe(target);
    expect(unwrapBingUrl('https://direct.example.com/page')).toBe('https://direct.example.com/page');
  });
});
