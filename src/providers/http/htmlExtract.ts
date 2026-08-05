// HTML to text/links extraction for the local page fetcher. No LLM, no browser:
// strip the markup by scanning (not by regex, whose nested quantifiers hung the
// CLI on malformed 2 MB pages), decode entities safely, and pull absolute links.

export interface HtmlExtractionResult {
  title: string | null;
  text: string;
}

const MAX_LINKS = 20;

/**
 * ASCII-only lowercasing. Unicode toLowerCase can change a string's length
 * (a single İ becomes two characters), and these indices are used to slice the
 * original, so drift there leaked hidden script content into the visible text.
 */
function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

/** Index of the next `<tag` that is really a tag, not text inside an attribute. */
function findTagStart(haystack: string, tag: string, from: number): number {
  const open = `<${tag}`;
  let index = from;
  let inTag = false;
  let quote = '';

  while (index < haystack.length) {
    const char = haystack[index];
    if (quote) {
      if (char === quote) {
        quote = '';
      }
      index++;
      continue;
    }
    if (inTag) {
      if (char === '"' || char === "'") {
        quote = char;
      } else if (char === '>') {
        inTag = false;
      }
      index++;
      continue;
    }
    if (char === '<') {
      if (haystack.startsWith(open, index)) {
        const boundary = haystack[index + open.length];
        if (boundary === undefined || /[\s/>]/.test(boundary)) {
          return index;
        }
      }
      inTag = true;
      index++;
      continue;
    }
    index++;
  }
  return -1;
}

/**
 * Drop `<tag>...</tag>` spans by scanning, not by regex. The nested-quantifier
 * patterns this replaces took 14 seconds on a 200 KB page of malformed markup,
 * and bodies here can reach 2 MB, so a remote page could hang the CLI.
 */
export function stripElement(html: string, tag: string): string {
  const close = `</${tag}>`;
  const haystack = asciiLower(html);
  let out = '';
  let cursor = 0;

  for (;;) {
    const start = findTagStart(haystack, tag, cursor);
    if (start === -1) {
      return out + html.slice(cursor);
    }
    out += `${html.slice(cursor, start)} `;
    const end = haystack.indexOf(close, start);
    if (end === -1) {
      // Unclosed: the rest of the document belongs to this element.
      return out;
    }
    cursor = end + close.length;
  }
}

function stripComments(html: string): string {
  let out = '';
  let cursor = 0;
  for (;;) {
    const start = html.indexOf('<!--', cursor);
    if (start === -1) {
      return out + html.slice(cursor);
    }
    out += `${html.slice(cursor, start)} `;
    const end = html.indexOf('-->', start + 4);
    if (end === -1) {
      return out;
    }
    cursor = end + 3;
  }
}

export function extractVisibleTextFromHtml(html: string): HtmlExtractionResult {
  const title = extractTitle(html);
  let withoutHidden = html;
  for (const tag of ['head', 'script', 'style', 'noscript', 'template']) {
    withoutHidden = stripElement(withoutHidden, tag);
  }
  withoutHidden = stripComments(withoutHidden);

  const withBreaks = withoutHidden
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/(address|article|aside|blockquote|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tr|td|th|ul)>/gi,
      '\n',
    );

  const withoutTags = withBreaks.replace(/<[^>]+>/g, ' ');
  const decoded = decodeHtmlEntities(withoutTags);
  const text = normalizeWhitespace(decoded);

  return {
    title,
    text,
  };
}

function extractTitle(html: string): string | null {
  const matched = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!matched) {
    return null;
  }

  const decoded = decodeHtmlEntities(matched[1]);
  const normalized = normalizeWhitespace(decoded);
  return normalized || null;
}

/** Code points a remote page can name but JavaScript cannot build. */
function safeFromCodePoint(codePoint: number): string | null {
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return null;
  }
  if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
    return null;
  }
  return String.fromCodePoint(codePoint);
}

function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity: string) => {
    const lower = entity.toLowerCase();

    if (lower.startsWith('#x')) {
      const code = Number.parseInt(lower.slice(2), 16);
      return safeFromCodePoint(code) ?? full;
    }

    if (lower.startsWith('#')) {
      const code = Number.parseInt(lower.slice(1), 10);
      return safeFromCodePoint(code) ?? full;
    }

    return namedEntities[lower] ?? full;
  });
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Absolute outbound links, deduped, in document order. */
export function extractLinks(html: string, baseUrl: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  // A document's own <base href> decides what relative links mean, not the URL
  // we happened to land on.
  const baseTag = /<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(html);
  let resolvedBase = baseUrl;
  if (baseTag) {
    try {
      const href = baseTag[1] ?? baseTag[2] ?? baseTag[3] ?? '';
      resolvedBase = new URL(decodeHtmlEntities(href), baseUrl).toString();
    } catch {
      // keep the response URL
    }
  }
  const seen = new Set<string>();
  const anchor =
    /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null && links.length < MAX_LINKS) {
    const href = decodeHtmlEntities(match[1] ?? match[2] ?? match[3] ?? '');
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) {
      continue;
    }
    let absolute: string;
    try {
      absolute = new URL(href, resolvedBase).toString();
    } catch {
      continue;
    }
    if (!/^https?:/i.test(absolute) || seen.has(absolute)) {
      continue;
    }
    const text = normalizeWhitespace(decodeHtmlEntities((match[4] ?? '').replace(/<[^>]+>/g, ' ')))
      .trim()
      .slice(0, 100);
    if (!text) {
      continue;
    }
    seen.add(absolute);
    links.push({ text, url: absolute });
  }
  return links;
}
