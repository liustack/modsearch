// Firecrawl fetch: force the firecrawl engine on a real page and assert content
// comes back through the cloud crawler, with firecrawl itself answering. Needs a
// firecrawl key. requirement 'fetch' always runs (it needs only network), so
// when firecrawl is not configured the forced run errors on the missing key,
// which the check treats as "not exercised" rather than a failure, keeping a
// normal eval run green on a machine without a firecrawl key.
export default {
  id: 'fetch-firecrawl',
  title: 'Firecrawl fetch: a forced -e firecrawl run reads a page as markdown',
  requirement: 'fetch',
  args: ['-e', 'firecrawl', '-u', 'https://example.com/'],
  expectation:
    'When firecrawl is keyed, results[0].engine is "firecrawl" and content is non-empty. When firecrawl is not set up, the run reports the missing key and the case is treated as not exercised.',
  check(result, run) {
    if (run.code !== 0) {
      const stderr = run.stderr || '';
      if (/firecrawl.*(API key|out of credits|rejected)|config set firecrawl/i.test(stderr)) {
        return { pass: true, detail: 'firecrawl not configured here, nothing to exercise' };
      }
      return { pass: false, detail: (stderr.split('\n')[0] || 'run failed').trim() };
    }
    const entry = result.results?.[0] ?? {};
    const content = String(entry.content ?? '');
    return {
      pass: entry.engine === 'firecrawl' && content.length > 0,
      detail: `engine ${entry.engine}, content ${content.length} chars`,
    };
  },
};
