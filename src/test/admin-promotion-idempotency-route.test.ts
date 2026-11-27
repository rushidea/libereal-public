import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(async () => ({ id: 'admin' })) }));
vi.mock('@/lib/promotion-repository', () => ({ withPromotionRepository: (action: (repo: { save: typeof mocks.save }) => unknown) => action({ save: mocks.save }), promotionError: () => ({ error: 'invalid', status: 400 }) }));
import { POST } from '@/app/api/admin/promotions/route';
const originalFlag = process.env.PROMOTION_CREATE_IDEMPOTENCY_ENABLED;
afterEach(() => { if (originalFlag === undefined) delete process.env.PROMOTION_CREATE_IDEMPOTENCY_ENABLED; else process.env.PROMOTION_CREATE_IDEMPOTENCY_ENABLED = originalFlag; mocks.save.mockReset(); });
const request = (key?: string, actor = 'admin') => new NextRequest('http://localhost/api/admin/promotions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key, 'X-Promotion-Expected-Actor': actor } : {}) }, body: JSON.stringify({ name: 'Synthetic' }) });
it('keeps the old unkeyed path available while refusing keyed requests when disabled', async () => {
  delete process.env.PROMOTION_CREATE_IDEMPOTENCY_ENABLED;
  expect((await POST(request('key-1'))).status).toBe(503);
  expect(mocks.save).not.toHaveBeenCalled();
  mocks.save.mockReturnValue({ id: 'created' });
  expect((await POST(request())).status).toBe(201);
  expect(mocks.save).toHaveBeenCalledWith({ name: 'Synthetic' }, 'admin', undefined, undefined);
});
it('passes the key and authenticated actor to the repository when enabled', async () => {
  process.env.PROMOTION_CREATE_IDEMPOTENCY_ENABLED = 'true';
  mocks.save.mockReturnValue({ id: 'created' });
  expect((await POST(request('key-1'))).status).toBe(201);
  expect(mocks.save).toHaveBeenCalledWith({ name: 'Synthetic' }, 'admin', undefined, 'key-1');
});
it('requires a key for creation when the feature is enabled', async () => {
  process.env.PROMOTION_CREATE_IDEMPOTENCY_ENABLED = 'true';
  expect((await POST(request())).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled();
});
it('rejects a key bound to a different authenticated actor', async () => {
  process.env.PROMOTION_CREATE_IDEMPOTENCY_ENABLED = 'true';
  expect((await POST(request('key-1', 'other-actor'))).status).toBe(409);
  expect(mocks.save).not.toHaveBeenCalled();
});
