// Playwright provider: a real headless Chromium doing what a human would do,
// opening google.com for searches and the target page for fetches. No LLM in
// the loop: summaries are mechanical, snippets come straight off the page, and
// uncertainty says so. Free and quota-less, which makes it the natural
// fallback when agy's thin weekly quota runs dry.
//
// Honest limits: Google may serve consent walls or captchas to headless
// traffic, and SERP selectors rot. Failures throw, and the router moves on
// down the chain.
import type {
  BuildProviderInvocationOptions,
  ProviderParsedOutput,
  SearchProvider,
} from './index.ts';

export const DEFAULT_SERP_RESULTS = 8;
const MAX_CONTENT_CHARS = 60_000;

interface SerpEntry {
  title: string;
  url: string;
  snippet: string;
}

export function buildSerpUrl(query: string, maxResults: number): string {
  const capped = Math.max(1, Math.min(Math.floor(maxResults) + 2, 10));
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}&num=${capped}&hl=en`;
}

export function buildBingUrl(query: string): string {
  return `https://www.bing.com/search?q=${encodeURIComponent(query.trim())}&setlang=en`;
}

/** Bing wraps result urls in /ck/ redirects with the target base64-coded in `u`. */
export function unwrapBingUrl(href: string): string {
  try {
    const url = new URL(href, 'https://www.bing.com');
    if (!url.pathname.startsWith('/ck/')) {
      return href;
    }
    const u = url.searchParams.get('u') ?? '';
    if (u.startsWith('a1')) {
      const b64 = u.slice(2).replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const decoded = Buffer.from(padded, 'base64').toString('utf-8');
      if (/^https?:\/\//.test(decoded)) {
        return decoded;
      }
    }
    return href;
  } catch {
    return href;
  }
}

export function summarizeSerp(query: string, entries: SerpEntry[], engine = 'Google'): string {
  const top = entries
    .slice(0, 3)
    .map((entry) => entry.title)
    .join(' | ');
  return `${entries.length} results scraped from the ${engine} results page for "${query.trim()}". Top hits: ${top}`;
}

export async function executePlaywright(
  options: BuildProviderInvocationOptions,
): Promise<ProviderParsedOutput> {
  const startedAt = Date.now();
  const { chromium } = await import('playwright');

  // A real installed Chrome is much less captcha-prone than the bundled
  // headless shell, so prefer the chrome channel and fall back to bundled.
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  const headless = options.headless !== false;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless });
  } catch {
    try {
      browser = await chromium.launch({ headless });
    } catch (error) {
      throw new Error(
        `playwright could not launch Chromium: ${(error as Error).message}\nIf the browser is missing, run: npx playwright install chromium`,
      );
    }
  }

  try {
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(Math.min(options.timeoutMs, 30_000));

    const result =
      options.mode === 'fetch'
        ? await fetchPage(page, options)
        : await searchSerp(page, options);

    return {
      result,
      meta: {
        conversationId: null,
        durationSeconds: (Date.now() - startedAt) / 1000,
        usage: null,
      },
    };
  } finally {
    await browser.close();
  }
}

type Page = Awaited<
  ReturnType<Awaited<ReturnType<(typeof import('playwright'))['chromium']['launch']>>['newPage']>
>;

async function searchSerp(page: Page, options: BuildProviderInvocationOptions): Promise<unknown> {
  if (!options.query) {
    throw new Error('Search mode requires a query.');
  }
  const maxResults = options.maxResults ?? DEFAULT_SERP_RESULTS;
  const uncertainty: string[] = [
    'Scraped from a search results page without LLM synthesis: snippets are short and may be truncated.',
  ];

  let entries: SerpEntry[] = [];
  let engine = 'Google';
  try {
    entries = await googleSerp(page, options.query, maxResults, uncertainty);
  } catch (googleError) {
    // Google walls off headless traffic quickly; Bing tolerates it. Honest
    // downgrade, noted in uncertainty.
    entries = await bingSerp(page, options.query);
    engine = 'Bing';
    uncertainty.push(
      `Google blocked the browser (${(googleError as Error).message.slice(0, 80)}); results scraped from Bing instead.`,
    );
  }

  const items = entries.slice(0, Math.max(1, maxResults)).map((entry) => ({
    title: entry.title,
    url: entry.url,
    snippet: entry.snippet,
    source: safeHostname(entry.url),
  }));

  if (items.length === 0) {
    throw new Error('No results parsed from Google or Bing (layout change or blocking).');
  }

  return {
    summary: summarizeSerp(options.query, items, engine),
    items,
    uncertainty,
  };
}

async function googleSerp(
  page: Page,
  query: string,
  maxResults: number,
  uncertainty: string[],
): Promise<SerpEntry[]> {
  await page.goto(buildSerpUrl(query, maxResults), { waitUntil: 'domcontentloaded' });

  // EU consent wall: dismiss best-effort, then continue.
  const consent = page
    .locator(
      'button:has-text("Accept all"), button:has-text("I agree"), button:has-text("Alle akzeptieren")',
    )
    .first();
  if (await consent.isVisible().catch(() => false)) {
    await consent.click().catch(() => {});
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    uncertainty.push('A Google consent page was dismissed automatically.');
  }

  if (page.url().includes('/sorry/')) {
    throw new Error('captcha page');
  }

  const entries = (await page.evaluate(() => {
    const seen = new Set<string>();
    const out: Array<{ title: string; url: string; snippet: string }> = [];
    for (const anchor of Array.from(
      document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]'),
    )) {
      const heading = anchor.querySelector('h3');
      if (!heading) {
        continue;
      }
      const url = anchor.href;
      const title = heading.textContent?.trim() ?? '';
      if (!title || seen.has(url)) {
        continue;
      }
      try {
        if (new URL(url).hostname.includes('google.')) {
          continue;
        }
      } catch {
        continue;
      }
      seen.add(url);
      let snippet = '';
      const block = anchor.closest('[data-hveid]') ?? anchor.closest('div.g');
      if (block) {
        const snippetNode = block.querySelector('[data-sncf], .VwiC3b, [style*="line-clamp"]');
        snippet = snippetNode?.textContent?.trim() ?? '';
      }
      out.push({ title, url, snippet });
    }
    return out;
  })) as SerpEntry[];

  if (entries.length === 0) {
    throw new Error('no results parsed');
  }
  return entries;
}

async function bingSerp(page: Page, query: string): Promise<SerpEntry[]> {
  await page.goto(buildBingUrl(query), { waitUntil: 'domcontentloaded' });
  const raw = (await page.evaluate(() => {
    const out: Array<{ title: string; url: string; snippet: string }> = [];
    for (const result of Array.from(document.querySelectorAll('li.b_algo'))) {
      const anchor = result.querySelector<HTMLAnchorElement>('h2 a');
      if (!anchor) {
        continue;
      }
      const title = anchor.textContent?.trim() ?? '';
      if (!title) {
        continue;
      }
      out.push({
        title,
        url: anchor.getAttribute('href') ?? '',
        snippet: result.querySelector('.b_caption p, p')?.textContent?.trim() ?? '',
      });
    }
    return out;
  })) as SerpEntry[];

  return raw
    .map((entry) => ({ ...entry, url: unwrapBingUrl(entry.url) }))
    .filter((entry) => entry.url.startsWith('http'));
}

async function fetchPage(page: Page, options: BuildProviderInvocationOptions): Promise<unknown> {
  if (!options.url) {
    throw new Error('Fetch mode requires a URL.');
  }
  const uncertainty: string[] = [
    'Extracted by a headless browser without LLM synthesis: plain text, not restructured markdown.',
  ];

  try {
    await page.goto(options.url, { waitUntil: 'load' });
  } catch (error) {
    // A slow page is still worth scraping if the DOM arrived.
    if (!String(error).includes('Timeout')) {
      throw error;
    }
    uncertainty.push('Page load timed out; content below is what had arrived by then.');
  }

  const title = await page.title();
  const extracted = (await page.evaluate(() => {
    const root =
      document.querySelector('article') ??
      document.querySelector('main') ??
      document.querySelector('[role="main"]') ??
      document.body;
    const text = (root as HTMLElement).innerText ?? '';
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]'))
      .map((anchor: HTMLAnchorElement) => ({
        text: (anchor.textContent ?? '').trim().slice(0, 100),
        url: anchor.href,
      }))
      .filter((link) => link.text.length > 0)
      .slice(0, 20);
    return { text, links };
  })) as { text: string; links: Array<{ text: string; url: string }> };

  let content = extracted.text.trim();
  if (content.length > MAX_CONTENT_CHARS) {
    content = content.slice(0, MAX_CONTENT_CHARS);
    uncertainty.push(`Content truncated at ${MAX_CONTENT_CHARS} characters.`);
  }
  if (content.length === 0) {
    throw new Error('The page rendered no extractable text (client-side wall or empty document).');
  }

  return {
    summary: `${title || options.url} (browser extraction${options.query ? `, focus requested: ${options.query}` : ''})`,
    content,
    links: extracted.links,
    uncertainty,
  };
}

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export const playwrightProvider: SearchProvider = {
  name: 'playwright',
  providerClass: 'web',
  defaultModel: '',
  execute: executePlaywright,
};
