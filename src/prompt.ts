export interface BuildSearchPromptOptions {
  query: string;
  maxResults: number;
  extraPrompt?: string;
}

export function buildSearchPrompt(options: BuildSearchPromptOptions): string {
  const normalizedQuery = options.query.trim();
  const maxResults = Math.max(1, Math.floor(options.maxResults));

  const basePrompt = `Search the web for: ${normalizedQuery}. Return structured search results.

Output requirements:
1. Output JSON only, no Markdown.
2. Prefer authoritative sources and preserve traceable links.
3. If time-sensitive, prioritize the latest information and note uncertain points in the uncertainty field.
4. Return at most ${maxResults} results.

Output JSON schema:
{
  "summary": "",
  "items": [
    {
      "title": "",
      "url": "",
      "snippet": "",
      "source": "",
      "published_at": "",
      "relevance": 0
    }
  ],
  "uncertainty": [""]
}`;

  if (!options.extraPrompt || !options.extraPrompt.trim()) {
    return basePrompt;
  }

  return `${basePrompt}\n\nAdditional constraints:\n${options.extraPrompt.trim()}`;
}
