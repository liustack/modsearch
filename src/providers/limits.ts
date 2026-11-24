// Shared limits for fetch engines, kept in one leaf module so the caps cannot
// drift between the engines (and so importing it never pulls in the provider
// registry, which would form an import cycle).

/**
 * How much of a page an engine keeps: the whole document a run can page
 * through. Every fetch engine truncates to this, the local engine as its
 * default max chars, firecrawl and keenable on their cloud markdown.
 */
export const MAX_DOCUMENT_CHARS = 500_000;

/**
 * How much of that document one run returns by default. No single answer
 * should flood a model's context, so a longer page is read a window at a time
 * with --start and --max-length.
 */
export const MAX_CONTENT_CHARS = 50_000;
