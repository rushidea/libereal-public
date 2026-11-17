import { afterEach, describe, it, expect, vi } from 'vitest';
import { sendBusinessMailNow } from '@/lib/mail';

const message = { from: 'LIBEREAL <order@example.test>', replyTo: 'order@example.test', to: ['recipient@example.test'], subject: '商务函', text: '正文', html: '<p>正文</p>' };
const key = `business-letter-${'a'.repeat(64)}`;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('business transport', () => {
  it('does not use notification credentials, console, or disabled mode as delivery', async () => {
    vi.stubEnv('BUSINESS_MAIL_ENABLED', 'false'); vi.stubEnv('RESEND_API_KEY', 'notification-key');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await sendBusinessMailNow(message, key)).deliveryState).toBe('not_sent');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('sends HTML and text with fixed message identity and preserves provider receipt', async () => {
    vi.stubEnv('BUSINESS_MAIL_ENABLED', 'true'); vi.stubEnv('BUSINESS_MAIL_RESEND_API_KEY', 'business-key');
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'example-receipt' }), { status: 200 })); vi.stubGlobal('fetch', fetch);
    const result = await sendBusinessMailNow(message, key);
    expect(result).toMatchObject({ deliveryState: 'accepted', providerMessageId: 'example-receipt' });
    expect(fetch).toHaveBeenCalledOnce();
    const options = fetch.mock.calls[0][1];
    expect(options.headers).toMatchObject({ Authorization: 'Bearer business-key', 'Idempotency-Key': key });
    expect(JSON.parse(options.body)).toEqual({ from: message.from, reply_to: message.replyTo, to: message.to, subject: message.subject, text: message.text, html: message.html });
    expect(options.redirect).toBe('error');
  });
  it('records timeout and missing receipts as unknown without retry', async () => {
    vi.stubEnv('BUSINESS_MAIL_ENABLED', 'true'); vi.stubEnv('BUSINESS_MAIL_RESEND_API_KEY', 'business-key');
    const fetch = vi.fn().mockRejectedValue(new Error('timeout')); vi.stubGlobal('fetch', fetch);
    expect((await sendBusinessMailNow(message, key)).deliveryState).toBe('unknown');
    expect(fetch).toHaveBeenCalledOnce();
    fetch.mockResolvedValue(new Response('{}', { status: 200 }));
    expect((await sendBusinessMailNow(message, key)).deliveryState).toBe('unknown');
  });
});
