/**
 * The body of the `## <version>` section in a CHANGELOG, trimmed, or null when
 * that version has no section.
 *
 * Two bugs used to live in the caller's inline regex:
 *   - `version.replace(/\\./g, '\\\\.')` matched "backslash + any char", so the
 *     dots in the version were never escaped and `3.2.4` could match `3x2y4`.
 *   - the lookahead ended at `\Z`, which JavaScript has no notion of, so it was
 *     read as a literal `Z`. Releasing the OLDEST changelog version (nothing
 *     after it, so no following `## `) then failed to match at all.
 */
export function changelogSection(changelog, version) {
  const escaped = version.replace(/\./g, '\\.');
  // Stop at the next `## ` heading or at the true end of the string. `(?![\s\S])`
  // is the end-of-input anchor JavaScript lacks a `\Z` for.
  const match = changelog.match(
    new RegExp(`^## ${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |(?![\\s\\S]))`, 'm'),
  );
  return match ? match[1].trim() : null;
}
