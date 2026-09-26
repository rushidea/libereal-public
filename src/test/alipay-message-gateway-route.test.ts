import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkNotifySign: vi.fn(),
  receiptCreate: vi.fn(),
  receiptFindUnique: vi.fn(),
}));

vi.mock('@/lib/alipay', () => ({
  getAlipaySdk: () => ({
    config: { appId: '9021000000000000' },
    sdk: { checkNotifySign: mocks.checkNotifySign },
  }),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    alipayMessageReceipt: {
      create: mocks.receiptCreate,
      findUnique: mocks.receiptFindUnique,
    },
  },
}));

import { POST } from '@/app/api/payments/alipay/message-gateway/route';

function messageRequest(overrides: Record<string, string> = {}) {
  const body = new URLSearchParams({
    app_id: '9021000000000000',
    notify_id: 'notify-001',
    msg_method: 'alipay.test.message',
    biz_content: JSON.stringify({ trade_no: '202607170001' }),
    sign_type: 'RSA2',
    sign: 'signed-value',
    ...overrides,
  });
  return new Request('https://libereal.cn/api/payments/alipay/message-gateway', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('Alipay application message gateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkNotifySign.mockReturnValue(true);
    mocks.receiptFindUnique.mockResolvedValue(null);
    mocks.receiptCreate.mockResolvedValue({ id: 'receipt-1' });
  });

  it('verifies and stores a platform message before acknowledging it', async () => {
    const response = await POST(messageRequest());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('success');
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(mocks.checkNotifySign).toHaveBeenCalledWith(expect.objectContaining({
      notify_id: 'notify-001',
      msg_method: 'alipay.test.message',
    }));
    expect(mocks.receiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        notifyId: 'notify-001',
        msgMethod: 'alipay.test.message',
        appId: '9021000000000000',
        notifyType: null,
      }),
    });
    const payload = JSON.parse(mocks.receiptCreate.mock.calls[0][0].data.payload);
    expect(payload).not.toHaveProperty('sign');
    expect(payload).not.toHaveProperty('sign_type');
  });

  it('acknowledges a previously stored notify_id without storing it again', async () => {
    mocks.receiptFindUnique.mockResolvedValue({ id: 'receipt-1' });

    const response = await POST(messageRequest());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('success');
    expect(mocks.receiptCreate).not.toHaveBeenCalled();
  });

  it('accepts notify_type as the method for a historical message', async () => {
    const response = await POST(messageRequest({ msg_method: '', notify_type: 'trade_status_sync' }));

    expect(response.status).toBe(200);
    expect(mocks.receiptCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        msgMethod: 'trade_status_sync',
        notifyType: 'trade_status_sync',
      }),
    });
  });

  it('rejects an invalid signature', async () => {
    mocks.checkNotifySign.mockReturnValue(false);

    const response = await POST(messageRequest());

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('fail');
    expect(mocks.receiptFindUnique).not.toHaveBeenCalled();
  });

  it('rejects a message sent to a different application', async () => {
    const response = await POST(messageRequest({ app_id: 'other-app' }));

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('fail');
    expect(mocks.receiptCreate).not.toHaveBeenCalled();
  });

  it('acknowledges concurrent duplicate inserts', async () => {
    mocks.receiptCreate.mockRejectedValue({ code: 'P2002' });

    const response = await POST(messageRequest());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('success');
  });
});
