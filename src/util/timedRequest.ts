import { EnvHttpProxyAgent, type Dispatcher } from 'undici';
import { formatErrorWithCause } from './errorCause.ts';
import { resolveProxyForUrl } from './proxy.ts';
import { redactSecrets } from './redact.ts';

/**
 * One HTTP request to an engine API with its whole body read under a single
 * deadline. The signal stays armed until the body is in memory: aborting only
 * up to the response headers let a server that streams the body slowly hold
 * the run past its timeout.
 *
 * A timeout reads `<label> timed out after <ms> ms.`, which the cooldown layer
 * treats as transient. Any other transport failure reads `<label> request
 * failed: ...` with the cause attached and the secrets scrubbed. An error
 * response whose body cannot be read comes back with empty text, so the caller
 * still reports the status.
 *
 * The call honors http_proxy / https_proxy / no_proxy the same way the local
 * page fetch does. Node's fetch ignores them unless NODE_USE_ENV_PROXY is set,
 * and a harness that spawns this CLI rarely sets it, so on a machine whose
 * only way out is a proxy every engine failed while page fetches worked.
 */
export async function requestText(
  label: string,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs: number,
  secrets: ReadonlyArray<string | undefined | null>,
): Promise<{ response: Response; text: string }> {
  const fail = (error: unknown): Error =>
    signal.aborted
      ? new Error(`${label} timed out after ${timeoutMs} ms.`)
      : new Error(
          `${label} request failed: ${redactSecrets(
            formatErrorWithCause(error),
            secrets,
          )}`,
        );

  const proxyUrl = resolveProxyForUrl(new URL(url), process.env);
  // NO_PROXY was already applied above, so the agent gets an empty one and
  // always takes the proxy it is handed.
  const dispatcher = proxyUrl
    ? new EnvHttpProxyAgent({ httpProxy: proxyUrl, httpsProxy: proxyUrl, noProxy: '' })
    : undefined;
  try {
    let response: Response;
    try {
      // `dispatcher` is a Node/undici extension to fetch's options, not in the
      // DOM RequestInit type, so it is attached through a cast.
      response = await fetch(url, {
        ...init,
        signal,
        ...(dispatcher ? { dispatcher } : {}),
      } as RequestInit & { dispatcher?: Dispatcher });
    } catch (error) {
      throw fail(error);
    }
    try {
      return { response, text: await response.text() };
    } catch (error) {
      if (!response.ok && !signal.aborted) {
        return { response, text: '' };
      }
      throw fail(error);
    }
  } finally {
    await dispatcher?.close();
  }
}
