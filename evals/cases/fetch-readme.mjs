// Single-page fetch against this project's own README on GitHub. Forces the
// dependency-free local engine (-e local), so it spends no quota no matter
// which keyed engines are configured. Needs network.
export default {
  id: 'fetch-readme',
  title: 'Single-page fetch: the project README reads back with content',
  requirement: 'fetch',
  args: ['-e', 'local', '-u', 'https://raw.githubusercontent.com/liustack/modsearch/main/README.md'],
  expectation: 'content is non-empty and mentions "ModSearch".',
  check(result) {
    const entry = result.results?.[0] ?? {};
    const content = String(entry.content ?? '');
    return {
      pass: content.length > 0 && /ModSearch/i.test(content),
      detail: `content ${content.length} chars via ${entry.engine}`,
    };
  },
};
