// JS-rendered page: the local http engine runs no JavaScript, so a client-
// rendered page comes back thin and the result should flag that. Needs network.
// The target is a known single-page app whose initial HTML is a near-empty
// shell; if it ever ships server-side content, this case will fail loudly.
export default {
  id: 'js-render',
  title: 'JS-rendered page: the local fetcher flags a client-rendered page as thin',
  requirement: 'fetch',
  args: ['-u', 'https://play.tailwindcss.com/'],
  expectation:
    'uncertainty (or warnings) notes the page is likely JavaScript-rendered / read thin.',
  check(result) {
    const entry = result.results?.[0] ?? {};
    const uncertainty = Array.isArray(entry.uncertainty) ? entry.uncertainty.join(' ') : '';
    const warnings = Array.isArray(entry.warnings) ? entry.warnings.join(' ') : '';
    const note = `${uncertainty} ${warnings}`;
    return {
      pass: /JavaScript|thin|little text/i.test(note),
      detail: `content ${String(entry.content ?? '').length} chars`,
    };
  },
};
