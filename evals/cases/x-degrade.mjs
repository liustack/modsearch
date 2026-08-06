// X degrade: on a machine with no Grok Build, an X query is answered by the web
// and the result must say so. Needs a search engine present AND Grok absent, so
// it is skipped where Grok is signed in (there is nothing to degrade).
export default {
  id: 'x-degrade',
  title: 'X degrade: with no Grok, an X query is answered by the web and says so',
  requirement: 'search-no-social',
  args: ['-q', 'DeepSeek 在推特上的评价', '--source', 'x'],
  expectation:
    'The X entry is status degraded or unavailable, requestedSource "x", and warnings explain the fall back to the public web.',
  check(result) {
    const entry =
      result.results?.find((r) => r.requestedSource === 'x') ?? result.results?.[0] ?? {};
    const warnings = Array.isArray(entry.warnings) ? entry.warnings.join(' ') : '';
    return {
      pass:
        (entry.status === 'degraded' || entry.status === 'unavailable') &&
        /X itself was not reachable/.test(warnings),
      detail: `status ${entry.status}, requestedSource ${entry.requestedSource}`,
    };
  },
};
