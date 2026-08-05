// Real-shaped samples from the engines we drive, kept in one place so a test
// asserting on an envelope is asserting on something an engine actually emits.

/** agy print-mode envelope, success. */
export function agySearchEnvelope(summary = 'web-sum'): string {
  return JSON.stringify({
    conversation_id: 'c-1',
    status: 'SUCCESS',
    structured_output: { summary, items: [], uncertainty: [] },
    duration_seconds: 5.5,
    usage: { total_tokens: 812 },
  });
}

/** agy print-mode envelope, quota exhausted. This is the exact wording it uses. */
export function agyQuotaEnvelope(): string {
  return JSON.stringify({
    conversation_id: 'c-2',
    status: 'ERROR',
    response: '',
    error:
      'Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 94h19m9s.',
    duration_seconds: 5.1,
    usage: { total_tokens: 0 },
  });
}

/** Grok headless envelope where schema validation ran too late, so the goods are in `text`. */
export function grokSalvageEnvelope(summary = 'real'): string {
  return JSON.stringify({
    structuredOutput: null,
    structuredOutputError: 'model output was not valid JSON: trailing characters',
    text: `{ "summary": "progress", "items": [], "uncertainty": [] }{ "summary": "${summary}", "items": [{"title": "@a on x", "url": "https://x.com/a/status/1", "snippet": "s", "source": "x.com"}], "uncertainty": [] }`,
    sessionId: 'sid-1',
    modelUsage: { 'grok-4.5-build': { inputTokens: 10 } },
  });
}

/** A page with the traps that broke extraction before: hidden elements, an
 * attribute that mentions a tag, entities, a base href, and a relative link. */
export const TRAP_HTML = `<!doctype html>
<html><head><title>Trap Page</title><style>.x{color:red}</style>
<base href="https://docs.example.com/v2/"></head>
<body>
  <script>console.log('hidden')</script>
  <div data-note="<script>">visible &amp; intact</div>
  <p>entity &#1114112; out of range</p>
  <a href=guide>Guide</a>
  <a href = "https://other.example.com/x">Other</a>
</body></html>`;
