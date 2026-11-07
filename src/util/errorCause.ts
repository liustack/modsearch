/**
 * An error message with its first `cause` appended. Node's fetch throws a bare
 * `fetch failed` and hides the reason (ENOTFOUND, ECONNREFUSED, a TLS failure)
 * in `cause`, which is the part a reader needs to tell a dead engine from a
 * network that never reached it.
 */
export function formatErrorWithCause(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error) {
      return `${error.message}; cause: ${cause.message}`;
    }

    if (cause !== undefined) {
      return `${error.message}; cause: ${String(cause)}`;
    }

    return error.message;
  }

  return String(error);
}
