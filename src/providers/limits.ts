// Shared limits for fetch engines, kept in one leaf module so the cap cannot
// drift between the local engine and firecrawl (and so importing it never pulls
// in the provider registry, which would form an import cycle).

/**
 * Character cap on fetched page content. No single page should flood a model's
 * context, so every fetch engine truncates to this: the local engine as its
 * default max chars, firecrawl on its cloud markdown.
 */
export const MAX_CONTENT_CHARS = 50_000;
