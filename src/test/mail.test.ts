import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendMail } from '@/lib/mail';

describe('mail provider', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses console provider outside production by default', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = await sendMail({
      to: 'user@test.com',
      subject: 'Hello',
      text: 'Test body',
    });

    expect(result).toEqual({ ok: true, provider: 'console' });
    expect(info).toHaveBeenCalledWith('[mail:console]', expect.objectContaining({
      to: ['user@test.com'],
      subject: 'Hello',
    }));
  });

  it('sends through Resend without a vendor SDK and migrates the legacy sender domain', async () => {
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('EMAIL_FROM', 'LIBEREAL <no-reply@mail.libereal.cn>');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendMail({
      to: ['user@test.com'],
      subject: 'Hello',
      text: 'Test body',
    });

    expect(result).toEqual({ ok: true, provider: 'resend' });
    expect(fetchMock).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
    }));
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request.body))).toEqual(expect.objectContaining({
      from: 'LIBEREAL <no-reply@libereal.cn>',
      to: ['user@test.com'],
    }));
  });

  it('uses the verified main domain as the default Resend sender', async () => {
    vi.stubEnv('EMAIL_PROVIDER', 'resend');
    vi.stubEnv('RESEND_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendMail({
      to: 'user@test.com',
      subject: 'Hello',
      text: 'Test body',
    });

    expect(result).toEqual({ ok: true, provider: 'resend' });
    const [, request] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(request.body))).toEqual(expect.objectContaining({
      from: 'LIBEREAL <no-reply@libereal.cn>',
      to: ['user@test.com'],
    }));
  });
});
