import { describe, expect, it } from 'vitest';
import testCase from './fetch-firecrawl.mjs';

describe('fetch-firecrawl eval', () => {
  it('treats a rejected keyless request as a failure, not an unexercised case', () => {
    const verdict = testCase.check(
      {},
      { code: 1, stderr: 'Error: firecrawl needs an API key', stdout: '' },
    );
    // Normalize the way evals/run.mjs does: a check may spell the outcome in
    // either case, and the runner upper-cases before judging.
    expect(String(verdict.outcome ?? (verdict.pass ? 'PASS' : 'FAIL')).toUpperCase()).toBe('FAIL');
  });
});
