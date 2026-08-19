// Firecrawl fetch: force the firecrawl engine on a real page and assert content
// comes back through the cloud crawler, with firecrawl itself answering. It runs
// keyless when no API key is configured, so every networked eval exercises it.
export default {
  id: 'fetch-firecrawl',
  title: 'Firecrawl fetch: a forced -e firecrawl run reads a page as markdown',
  requirement: 'fetch',
  args: ['-e', 'firecrawl', '-u', 'https://example.com/'],
  expectation:
    'With or without an API key, results[0].engine is "firecrawl" and content is non-empty. A spent anonymous or keyed quota is reported as blocked.',
  check(result, run) {
    if (run.code !== 0) {
      const stderr = run.stderr || '';
      if (/out of credits/i.test(stderr)) {
        return { outcome: 'blocked', detail: 'firecrawl quota is spent' };
      }
      // A rejected key or any other error is a real failure.
      return { outcome: 'fail', detail: (stderr.split('\n')[0] || 'run failed').trim() };
    }
    const entry = result.results?.[0] ?? {};
    const content = String(entry.content ?? '');
    return {
      pass: entry.engine === 'firecrawl' && content.length > 0,
      detail: `engine ${entry.engine}, content ${content.length} chars`,
    };
  },
};
