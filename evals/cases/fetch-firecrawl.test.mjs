import { describe, expect, it } from 'vitest';
import testCase from './fetch-firecrawl.mjs';

describe('fetch-firecrawl eval', () => {
  it('treats a rejected keyless request as a failure, not an unexercised case', () => {
    const verdict = testCase.check(
      {},
      { code: 1, stderr: 'Error: firecrawl needs an API key', stdout: '' },
    );
    expect(verdict.outcome).toBe('fail');
  });
});
