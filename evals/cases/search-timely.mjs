// Time-sensitive fact: a search answer must be checkable, meaning at least one
// source link and a date. Needs a working search engine (agy or a Tavily key).
export default {
  id: 'search-timely',
  title: 'Time-sensitive fact: the answer carries a date and a source link',
  requirement: 'search',
  args: ['-q', 'current Node.js LTS version'],
  expectation:
    'At least one item has an http(s) URL, and a date appears (an item.published_at, or a year in the summary).',
  check(result) {
    const entry = result.results?.[0] ?? {};
    const items = Array.isArray(entry.items) ? entry.items : [];
    const hasLink = items.some((i) => typeof i.url === 'string' && /^https?:\/\//.test(i.url));
    const hasDate =
      items.some((i) => typeof i.published_at === 'string' && i.published_at.trim()) ||
      /\b20\d\d\b/.test(String(entry.summary ?? ''));
    return {
      pass: hasLink && hasDate,
      detail: `${items.length} items, link=${hasLink} date=${hasDate}, engine ${entry.engine}`,
    };
  },
};
