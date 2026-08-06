// SSRF guard: a localhost URL must be refused before any request goes out.
// This case needs no engine, no quota, and no network, so it always runs.
export default {
  id: 'ssrf-localhost',
  title: 'SSRF: a localhost URL is refused before any request goes out',
  requirement: 'none',
  args: ['-u', 'http://localhost/'],
  expectError: true,
  expectation:
    'Exit non-zero and the message names localhost as a blocked hostname. No request is made.',
  check({ code, stderr }) {
    const firstLine = (stderr.trim().split('\n')[0] ?? '').trim();
    return {
      pass: code !== 0 && /Blocked hostname: localhost/.test(stderr),
      detail: firstLine,
    };
  },
};
