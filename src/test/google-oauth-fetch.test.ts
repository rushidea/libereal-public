import { describe, expect, it, vi } from 'vitest';
import { createGoogleOAuthFetch } from '@/lib/google-oauth-fetch';

describe('google OAuth fetch', () => {
  it('uses the configured proxy dispatcher', async () => {
    const response = new Response('ok', { status: 200 });
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init).toHaveProperty('dispatcher');
      return response;
    });
    const googleFetch = createGoogleOAuthFetch('http://proxy.example:3128', fetchImpl as typeof fetch, 0);

    await expect(googleFetch?.('https://oauth2.googleapis.com/token')).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('recreates the proxy connection after transient failures', async () => {
    const response = new Response('ok', { status: 200 });
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('temporary timeout'))
      .mockResolvedValueOnce(response);
    const googleFetch = createGoogleOAuthFetch('http://proxy.example:3128', fetchImpl as typeof fetch, 0);

    await expect(googleFetch?.('https://openidconnect.googleapis.com/v1/userinfo')).resolves.toBe(response);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('returns no custom fetch when no proxy is configured', () => {
    expect(createGoogleOAuthFetch(undefined)).toBeUndefined();
  });
});
