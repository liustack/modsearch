// Errors are the one place credentials love to travel: subprocess stderr,
// gateway error bodies, and probe failures all get quoted into messages that
// end up in terminals, meta.attempts, model contexts, and the discovery
// cache. Everything quoted into an error goes through here first.

/**
 * Token shapes worth catching even when the concrete secret is unknown.
 * Erring toward redacting too much: an over-redacted error stays actionable,
 * a leaked key does not.
 */
const TOKEN_SHAPES: RegExp[] = [
  // Vendor-prefixed keys (OpenAI/Anthropic sk-, Stripe rk/pk, Slack xox*).
  /\b(?:sk|rk|pk|xox[a-z])-[A-Za-z0-9_-]{12,}\b/g,
  // Google API keys.
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  // GitHub tokens.
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  // JWTs (three base64url segments, the first spelling {"alg" or {"typ").
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/g,
  // Auth headers: "Bearer xyz" / "Authorization: xyz" (space form is real).
  /\b(?:bearer|authorization)\b[=:\s]+"?[A-Za-z0-9._~+/-]{12,}"?/gi,
  // Labeled keys need an explicit = or : separator. Prose like
  // "token limit_exceeded" is diagnostics, not a credential.
  /\b(?:token|api[-_]?key)\b\s*[=:]\s*"?[A-Za-z0-9._~+/-]{12,}"?/gi,
];

/**
 * A substring that might be a URL carrying userinfo: a scheme, then anything
 * up to a space that contains an `@`. Deliberately loose about what sits
 * between the colon and the `@`, because the WHATWG parser is too: special
 * schemes take an authority with zero, one, or many slashes or backslashes
 * (`http:u:p@h`, `http:/u:p@h`, `http:\\u:p@h` all connect), and the parser
 * strips raw tabs and line breaks from its input, so the token runs to a
 * SPACE only and may span lines. Loose extraction is safe because a token is
 * only ever rewritten when the parser confirms real credentials inside it.
 */
const URL_CANDIDATE = /\b[a-z][a-z0-9+.-]*:[^ ]*@[^ ]*/gi;

/**
 * The last-resort regex mask for a candidate the URL parser refuses. Two
 * separators minimum on purpose: the slash-less special-scheme forms all
 * parse fine and never reach this fallback, while `word:text@thing` prose
 * must not be torn when its parse (with no credentials) declines to rewrite.
 */
const RAW_USERINFO = /^([a-z][a-z0-9+.-]*:[\\/]{2,4})[^\s/?#]*@/i;

/**
 * Rebuild a URL with its userinfo replaced, through the SAME parser the
 * runtime connects with (WHATWG). A regex kept losing to shapes the parser
 * accepts: backslash authorities (`http:\\u:p@h`), slash runs
 * (`http:////u:p@h`), tabs and newlines stripped inside the authority, and
 * backslash paths that relocate the visible host. Parsing first means
 * whatever undici's ProxyAgent would read as credentials is exactly what
 * gets masked, in normalized form. Returns null when the candidate is not a
 * parseable URL or carries no credentials.
 */
function parseUrl(candidate: string): URL | null {
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

/**
 * Rebuild a parsed URL with its userinfo replaced. Rebuilt by hand: the URL
 * serializer percent-encodes characters like brackets in the username, which
 * would garble "[redacted]".
 */
function rebuildMasked(url: URL, replacement: string): string {
  return `${url.protocol}//${replacement}@${url.host}${url.pathname}${url.search}${url.hash}`;
}

/**
 * Mask userinfo in a URL while keeping it recognizable:
 * http://alice:s3cr3t@proxy:8080 -> http://***@proxy:8080/ (re-serialized in
 * normalized form). For display surfaces (config show) whose whole point is
 * being safe to paste into an issue. redactSecrets is the blunter net for
 * error text. A credential-free URL passes through untouched.
 */
export function maskUrlCredentials(url: string): string {
  const parsed = parseUrl(url);
  if (parsed) {
    return parsed.username !== '' || parsed.password !== ''
      ? rebuildMasked(parsed, '***')
      : url;
  }
  return url.replace(RAW_USERINFO, '$1***@');
}

/**
 * Strip likely credentials from text about to travel into an error message,
 * a cache file, or a model context. Known secrets are replaced exactly first,
 * then the shape patterns run as the second net, then every URL-shaped token
 * is checked for userinfo through the real parser.
 */
export function redactSecrets(
  text: string,
  knownSecrets: ReadonlyArray<string | undefined | null> = [],
): string {
  let out = text;
  for (const secret of knownSecrets) {
    // Very short strings would tear unrelated text: real keys are longer.
    if (secret && secret.length >= 6) {
      out = out.split(secret).join('[redacted]');
    }
  }
  for (const shape of TOKEN_SHAPES) {
    out = out.replace(shape, '[redacted]');
  }
  // Each URL-shaped token is masked only when the parser confirms it
  // carries credentials, so scheme-less `//text@` prose and ordinary URLs
  // (query @s included) stay verbatim, while every shape the runtime would
  // read credentials out of gets them removed. A control character or a
  // comma can separate two URLs just as legally as it can be swallowed by
  // one, and a merged candidate would let the parser see only the first
  // authority; so a token with interior scheme starts (any separator count
  // the parser accepts, one slash included) is split and each piece judged
  // alone. Pieces mask only on a full user:password pair, an unsplit token
  // on any userinfo, so `note:http://user@host` prose survives while every
  // credentialed neighbor is caught. A boundary that is itself a legal
  // scheme and host character (dot, hyphen, plus) is genuinely ambiguous
  // and stays with the parser's own one-URL reading.
  out = out.replace(URL_CANDIDATE, (token) => {
    const pieces = token.split(/(?<=[^a-z0-9+.-])(?=[a-z][a-z0-9+.-]*:[\\/]{1,4})/i);
    if (pieces.length === 1) {
      const parsed = parseUrl(token);
      if (parsed) {
        return parsed.username !== '' || parsed.password !== ''
          ? rebuildMasked(parsed, '[redacted]')
          : token;
      }
      return token.replace(RAW_USERINFO, '$1[redacted]@');
    }
    return pieces
      .map((piece) => {
        const parsed = parseUrl(piece);
        // A parsed piece is judged by its parse alone: mask on a full
        // user:password pair, keep prose addresses. The regex
        // fallback serves only pieces the parser refuses.
        if (parsed) {
          return parsed.password !== '' ? rebuildMasked(parsed, '[redacted]') : piece;
        }
        return piece.replace(RAW_USERINFO, '$1[redacted]@');
      })
      .join('');
  });
  return out;
}
