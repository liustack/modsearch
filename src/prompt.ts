export interface BuildSearchPromptOptions {
  query: string;
  maxResults: number;
  extraPrompt?: string;
}

export function buildSearchPrompt(options: BuildSearchPromptOptions): string {
  const normalizedQuery = options.query.trim();
  const maxResults = Math.max(1, Math.floor(options.maxResults));

  const basePrompt = `请搜索：${normalizedQuery}

你是一个通用搜索结果聚合引擎。你的任务是返回可供文本 LLM 消费的结构化搜索结果。

输出要求：
1. 只输出 JSON，不要输出 Markdown。
2. 结果应尽量覆盖权威来源，并保留可追溯链接。
3. 如果时间敏感，请优先最新信息，并在 uncertainty 里标注不确定点。
4. 最多返回 ${maxResults} 条结果。

输出 JSON 结构：
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

  return `${basePrompt}\n\n附加约束：\n${options.extraPrompt.trim()}`;
}
