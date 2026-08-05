import { describe, expect, it } from 'vitest';
import { TRAP_HTML } from '../../fixtures/index.ts';
import { extractLinks, extractVisibleTextFromHtml } from './htmlExtract.ts';

describe('html extraction', () => {
  const html = `
    <html><head><title>Doc Title</title><style>.x{color:red}</style></head>
    <body>
      <script>console.log('hidden')</script>
      <h1>Heading</h1><p>First para &amp; entity.</p>
      <a href="/docs/start">Get started</a>
      <a href="https://other.example.com/x">Other</a>
      <a href="#anchor">Skip me</a>
      <a href="mailto:a@b.c">Mail</a>
    </body></html>`;

  it('keeps visible text and drops script, style, and head', () => {
    const extracted = extractVisibleTextFromHtml(html);
    expect(extracted.title).toBe('Doc Title');
    expect(extracted.text).toContain('Heading');
    expect(extracted.text).toContain('First para & entity.');
    expect(extracted.text).not.toContain('console.log');
    expect(extracted.text).not.toContain('color:red');
  });

  it('resolves links to absolute urls and skips anchors and mailto', () => {
    const links = extractLinks(html, 'https://example.com/guide/');
    expect(links).toEqual([
      { text: 'Get started', url: 'https://example.com/docs/start' },
      { text: 'Other', url: 'https://other.example.com/x' },
    ]);
  });
});

describe('extraction hardening against hostile pages', () => {
  it('strips elements in linear time on malformed markup', () => {
    // The nested-quantifier regexes this replaced took 14 seconds here.
    const hostile = `<html><script>${'x<div '.repeat(40_000)}</html>`;
    const startedAt = Date.now();
    const extracted = extractVisibleTextFromHtml(hostile);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(extracted.text).not.toContain('<div');
  });

  it('drops an unclosed element instead of keeping its contents', () => {
    expect(extractVisibleTextFromHtml('<p>keep</p><script>secret').text).toBe('keep');
  });

  it('survives a numeric entity outside Unicode', () => {
    // One malformed entity used to throw RangeError and kill the whole fetch.
    const extracted = extractVisibleTextFromHtml('<p>before &#1114112; after &#xD800;</p>');
    expect(extracted.text).toContain('before');
    expect(extracted.text).toContain('after');
  });

  it('resolves links against the document base, not the response URL', () => {
    const html = `<base href="https://docs.example.com/v2/"><a href="guide?a=1&amp;b=2">Guide</a>`;
    expect(extractLinks(html, 'https://cdn.example.net/page')).toEqual([
      { text: 'Guide', url: 'https://docs.example.com/v2/guide?a=1&b=2' },
    ]);
  });

  it('survives every trap on one page (the shared fixture)', () => {
    const extracted = extractVisibleTextFromHtml(TRAP_HTML);
    expect(extracted.title).toBe('Trap Page');
    expect(extracted.text).toContain('visible & intact');
    expect(extracted.text).not.toContain('console.log');
    const links = extractLinks(TRAP_HTML, 'https://cdn.example.net/page');
    expect(links).toContainEqual({ text: 'Guide', url: 'https://docs.example.com/v2/guide' });
    expect(links).toContainEqual({ text: 'Other', url: 'https://other.example.com/x' });
  });
});

describe('stripElement edge cases from the verification pass', () => {
  it('does not leak hidden content when the document has Unicode uppercase', () => {
    // Unicode toLowerCase can lengthen a string (İ becomes two characters), and
    // the indices were used to slice the original, so script contents leaked.
    const html = `<p>${'İ'.repeat(20)}</p><script>SECRETSECRET</script><p>after</p>`;
    const extracted = extractVisibleTextFromHtml(html);
    expect(extracted.text).not.toContain('SECRET');
    expect(extracted.text).toContain('after');
  });

  it('ignores a tag name that appears inside an attribute value', () => {
    const html = `<div data-note="<script>">VISIBLE CONTENT</div><p>more</p>`;
    const extracted = extractVisibleTextFromHtml(html);
    expect(extracted.text).toContain('VISIBLE CONTENT');
    expect(extracted.text).toContain('more');
  });

  it('still strips a real element that follows an attribute mentioning it', () => {
    const html = `<div title="<script>">keep</div><script>drop</script><p>tail</p>`;
    const extracted = extractVisibleTextFromHtml(html);
    expect(extracted.text).toContain('keep');
    expect(extracted.text).toContain('tail');
    expect(extracted.text).not.toContain('drop');
  });
});

describe('link extraction accepts real-world href spellings', () => {
  it('reads unquoted and spaced href attributes', () => {
    const html = `<a href=https://a.example.com/one>One</a><a href = "https://b.example.com/two">Two</a>`;
    expect(extractLinks(html, 'https://base.example.com/')).toEqual([
      { text: 'One', url: 'https://a.example.com/one' },
      { text: 'Two', url: 'https://b.example.com/two' },
    ]);
  });

  it('reads an unquoted base href', () => {
    const html = `<base href=https://docs.example.com/v3/><a href="guide">G</a>`;
    expect(extractLinks(html, 'https://cdn.example.net/page')).toEqual([
      { text: 'G', url: 'https://docs.example.com/v3/guide' },
    ]);
  });
});
