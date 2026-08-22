/** Parse the API-key setting shared by file and environment configuration. */
export function splitApiKeys(value: string | undefined | null): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

/** An authentication, rate-limit, or quota failure tied to the selected key. */
export class ApiKeyFailureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiKeyFailureError';
  }
}

export function isApiKeyFailure(error: unknown): error is ApiKeyFailureError {
  return error instanceof ApiKeyFailureError;
}

const QUOTA_FAILURE_PATTERNS = [
  /\bquota\b/i,
  /\bpayment required\b/i,
  /\b(?:out of|insufficient|not enough)\s+(?:account\s+)?(?:balance|credits?)\b/i,
  /\b(?:balance|credits?)\s+(?:is\s+)?(?:insufficient|exhausted|depleted|empty|too low|used up)\b/i,
  /\b(?:credit|usage)\s+(?:limit|cap)\s+(?:reached|exceeded)\b/i,
];

/** Whether foreign response text specifically describes an exhausted quota. */
export function isQuotaFailureMessage(message: string): boolean {
  return QUOTA_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}
