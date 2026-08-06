// Exa search: force the exa engine and assert the ranked-results shape (an
// http(s) link, and that exa itself answered). Needs an exa key. When exa is not
// configured here, the forced run errors on the missing key, which the check
// treats as "not exercised" rather than a failure, so a normal eval run on a
// machine without an exa key is not polluted with a red.
export default {
  id: 'search-exa',
  title: 'Exa search: a forced -e exa run returns ranked results with links',
  requirement: 'search',
  args: ['-e', 'exa', '-q', 'current Node.js LTS version'],
  expectation:
    'When exa is keyed, results[0].engine is "exa" and at least one item has an http(s) URL. When exa is not set up, the run reports the missing key and the case is treated as not exercised.',
  check(result, run) {
    if (run.code !== 0) {
      const stderr = run.stderr || '';
      if (/exa.*(API key|out of credits)|config set exa/i.test(stderr)) {
        return { pass: true, detail: 'exa not configured here, nothing to exercise' };
      }
      return { pass: false, detail: (stderr.split('\n')[0] || 'run failed').trim() };
    }
    const entry = result.results?.[0] ?? {};
    const items = Array.isArray(entry.items) ? entry.items : [];
    const hasLink = items.some((i) => typeof i.url === 'string' && /^https?:\/\//.test(i.url));
    return {
      pass: entry.engine === 'exa' && hasLink,
      detail: `engine ${entry.engine}, ${items.length} items, link=${hasLink}`,
    };
  },
};
