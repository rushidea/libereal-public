import { ProxyAgent } from 'undici';

type FetchWithDispatcher = RequestInit & { dispatcher: ProxyAgent };

/**
 * Google OAuth token and userinfo requests need the configured proxy on hosts
 * that cannot reach Google directly. Recreate the proxy connection after a
 * transient network failure so a stale pooled connection does not abort login.
 */
export function createGoogleOAuthFetch(
  proxyUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
  retryDelayMs = 250,
): typeof fetch | undefined {
  if (!proxyUrl) return undefined;

  let agent = new ProxyAgent(proxyUrl);
  return async (input, init) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fetchImpl(input, { ...init, dispatcher: agent } as FetchWithDispatcher);
      } catch (error) {
        lastError = error;
        if (attempt === 2) break;
        await agent.close().catch(() => undefined);
        agent = new ProxyAgent(proxyUrl);
        if (retryDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, retryDelayMs * (attempt + 1)));
      }
    }
    throw lastError;
  };
}
