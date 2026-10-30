import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(async () => ({ id: 'admin' })) }));
vi.mock('@/lib/promotion-repository', () => ({ withPromotionRepository: (action: (repo: { save: typeof mocks.save }) => unknown) => action({ save: mocks.save }), promotionError: () => ({ error: 'invalid', status: 400 }) }));
import { DELETE, PATCH } from '@/app/api/admin/promotions/[id]/route';
const originalFlag = process.env.PROMOTION_VERSION_CHECK_ENABLED;
const params = { params: Promise.resolve({ id: 'promotion' }) };
afterEach(() => { if (originalFlag === undefined) delete process.env.PROMOTION_VERSION_CHECK_ENABLED; else process.env.PROMOTION_VERSION_CHECK_ENABLED = originalFlag; mocks.save.mockReset(); });
it('requires a version for patch and delete when enabled', async () => {
  process.env.PROMOTION_VERSION_CHECK_ENABLED = 'true';
  expect((await PATCH(new NextRequest('http://localhost', { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) }), params)).status).toBe(428);
  expect((await DELETE(new NextRequest('http://localhost', { method: 'DELETE' }), params)).status).toBe(428);
  expect(mocks.save).not.toHaveBeenCalled();
  mocks.save.mockReturnValue({ id: 'promotion' });
  expect((await DELETE(new NextRequest('http://localhost', { method: 'DELETE', headers: { 'If-Match': '3' } }), params)).status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith({ status: 'ended', expectedVersion: 3 }, 'admin', 'promotion');
});
it('keeps legacy unversioned writes available while disabled', async () => {
  delete process.env.PROMOTION_VERSION_CHECK_ENABLED;
  mocks.save.mockReturnValue({ id: 'promotion' });
  expect((await PATCH(new NextRequest('http://localhost', { method: 'PATCH', body: JSON.stringify({ status: 'paused' }) }), params)).status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith({ status: 'paused' }, 'admin', 'promotion');
});
