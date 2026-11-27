import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  calculate: vi.fn(),
  getCampaign: vi.fn(),
  createSnapshot: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireAdmin: vi.fn(async () => ({ id: 'admin' })) }));
vi.mock('@/data/promotion-calculation', () => ({ calculateBoundPromotions: mocks.calculate }));
vi.mock('@/lib/unified-pricing-snapshot', () => ({ createUnifiedPricingSnapshot: mocks.createSnapshot }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@/lib/promotion-repository', () => ({
  withPromotionRepository: (action: (repository: unknown, db: unknown) => unknown) => action(
    { get: mocks.getCampaign },
    { prepare: vi.fn(() => ({ get: vi.fn(() => ({ price: 20, variantPrice: 7 })) })) },
  ),
  promotionError: (error: Error) => ({ error: error.message, status: error.message.startsWith('INVALID_') ? 400 : 503 }),
}));

import { POST } from '@/app/api/admin/promotions/[id]/preview/route';
import { unifiedPromotionRuntimeEnabled } from '@/lib/unified-promotion-config';

const catalogDefinition = JSON.stringify({ schemaVersion: 1, template: 'direct-price', repeat: true,
  maxApplications: null, partialBenefit: true,
  groups: [{ key: 'benefit', role: 'benefit', unit: 'each', quantity: 1 }],
  benefit: { kind: 'percentage', basisPoints: 5000 }, priceBasis: 'catalog' });
const campaign = (catalog = true) => ({ id: 'draft-1', name: 'Preview', ruleVersion: 4, priority: 3, exclusive: true,
  ruleDefinition: catalog ? JSON.parse(catalogDefinition) : { ...JSON.parse(catalogDefinition), priceBasis: 'sale' },
  products: [{ productId: 'p1', variantId: 'v1', groupKey: 'benefit' }] });
function request(body: unknown) {
  return new NextRequest('http://localhost/api/admin/promotions/draft-1/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
function transactionClient() {
  const tx = {
    promotion: { findUnique: vi.fn(async () => ({ ...campaign(), ruleDefinition: catalogDefinition, startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01') })) },
    $queryRaw: vi.fn(async () => [{ selectorsJson: JSON.stringify([{ productId: 'p1', allVariants: true, groupKey: 'benefit' }]) }]),
    product: { findMany: vi.fn(async () => [{ id: 'p1', name: 'Product', catalogNumber: 'CAT-1', hazardous: false, deletedAt: null }]) },
    productVariant: { findMany: vi.fn(async () => [
      { id: 'v1', productId: 'p1', catalogNumber: 'CAT-1-A', spec: 'A' },
      { id: 'v2', productId: 'p1', catalogNumber: 'CAT-1-B', spec: 'B' },
    ]) },
  };
  return { tx, client: { $transaction: vi.fn(async (action: (tx: unknown) => unknown) => action(tx)) } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCampaign.mockReturnValue(campaign());
  mocks.calculate.mockReturnValue({ discountCents: 123, statuses: [] });
  mocks.createSnapshot.mockImplementation(async (_tx: unknown, requestInput: { lines: Array<{ quantity: number }>; previewCampaign: unknown }) => ({
    evidence: { lines: requestInput.lines.map((line) => ({ catalogReferenceCents: 2000, unitPriceCents: 1000, quantity: line.quantity })) },
    evidenceHash: 'private-hash',
    pricing: { totalCents: 900, lines: [], promotionIds: ['draft-1'], allocationIds: ['alloc'] },
  }));
});
afterEach(() => vi.unstubAllEnvs());

it('requires every runtime prerequisite and defaults to disabled', () => {
  const keys = ['PROMOTION_UNIFIED_ENABLED', 'PROMOTION_FOUNDATION_ENABLED', 'PROMOTION_CREATE_IDEMPOTENCY_ENABLED', 'PROMOTION_VERSION_CHECK_ENABLED'];
  keys.forEach((key) => vi.stubEnv(key, ''));
  expect(unifiedPromotionRuntimeEnabled()).toBe(false);
  keys.forEach((key) => vi.stubEnv(key, 'true'));
  expect(unifiedPromotionRuntimeEnabled()).toBe(true);
  for (const key of keys) {
    vi.stubEnv(key, 'false');
    expect(unifiedPromotionRuntimeEnabled()).toBe(false);
    vi.stubEnv(key, 'true');
  }
});

it('keeps catalog previews denied on the production HTTP handler', async () => {
  const response = await POST(request([{ productId: 'p1', variantId: 'v1', quantity: 1 }]), {
    params: Promise.resolve({ id: 'draft-1' }),
  });

  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: 'PROMOTION_CATALOG_RUNTIME_NOT_READY' });
  expect(mocks.createSnapshot).not.toHaveBeenCalled();
});

it('uses the production handler only when all four server gates are enabled', async () => {
  vi.stubEnv('PROMOTION_UNIFIED_ENABLED', 'true');
  vi.stubEnv('PROMOTION_FOUNDATION_ENABLED', 'true');
  vi.stubEnv('PROMOTION_CREATE_IDEMPOTENCY_ENABLED', 'true');
  vi.stubEnv('PROMOTION_VERSION_CHECK_ENABLED', 'false');
  const makeRequest = () => request([{ productId: 'p1', variantId: 'v1', quantity: 1 }]);
  const context = { params: Promise.resolve({ id: 'draft-1' }) };
  expect((await POST(makeRequest(), context)).status).toBe(503);
  const { tx } = transactionClient();
  mocks.transaction.mockImplementation(async (action: (client: unknown) => unknown) => action(tx));
  vi.stubEnv('PROMOTION_VERSION_CHECK_ENABLED', 'true');
  expect((await POST(makeRequest(), context)).status).toBe(200);
  expect(mocks.createSnapshot).toHaveBeenCalledTimes(1);
});


it('uses one transaction for target, current allVariants expansion, and snapshot reads in the injected path', async () => {
  const { tx, client } = transactionClient();
  const response = await POST.forTest(request([
    { productId: 'p1', variantId: 'v1', quantity: 2, price: 0.01 },
    { productId: 'p1', variantId: 'v2', quantity: 1, unitPriceCents: 1 },
  ]), { params: Promise.resolve({ id: 'draft-1' }) }, client as never);

  expect(response.status).toBe(200);
  expect(mocks.createSnapshot).toHaveBeenCalledTimes(1);
  const [snapshotTx, snapshotInput] = mocks.createSnapshot.mock.calls[0];
  expect(snapshotTx).toBe(tx);
  expect(snapshotInput.lines).toEqual([
    { productId: 'p1', variantId: 'v1', quantity: 2 },
    { productId: 'p1', variantId: 'v2', quantity: 1 },
  ]);
  expect(snapshotInput.previewCampaign).toMatchObject({ id: 'draft-1', status: 'active', version: 4,
    bindings: [
      { productId: 'p1', variantId: 'v1', groupKey: 'benefit' },
      { productId: 'p1', variantId: 'v2', groupKey: 'benefit' },
    ] });
  expect(tx.productVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2001 }));
  const payload = await response.json();
  expect(payload).toMatchObject({ totalCents: 900, referenceTotalCents: 6000, targetApplied: true,
    previewBindings: [
      { productId: 'p1', variantId: 'v1', variant: { spec: 'A' } },
      { productId: 'p1', variantId: 'v2', variant: { spec: 'B' } },
    ] });
  expect(payload).not.toHaveProperty('evidence');
  expect(payload).not.toHaveProperty('evidenceHash');
});

it('resolves all variants before an editor requests quantities', async () => {
  const { client } = transactionClient();
  const response = await POST.forTest(request({ resolveBindings: true }), { params: Promise.resolve({ id: 'draft-1' }) }, client as never);
  expect(response.status).toBe(200);
  expect((await response.json()).previewBindings).toHaveLength(2);
  expect(mocks.createSnapshot).not.toHaveBeenCalled();
});

it('does not attribute ordinary-price savings to an unselected catalog activity', async () => {
  mocks.createSnapshot.mockResolvedValueOnce({
    evidence: { lines: [{ catalogReferenceCents: 10000, unitPriceCents: 5000, quantity: 1 }] },
    evidenceHash: 'private-hash', pricing: { totalCents: 5000, lines: [], promotionIds: [], allocationIds: [] },
  });
  const { client } = transactionClient();
  const response = await POST.forTest(request([{ productId: 'p1', variantId: 'v1', quantity: 1 }]),
    { params: Promise.resolve({ id: 'draft-1' }) }, client as never);
  expect(await response.json()).toMatchObject({ targetApplied: false, referenceTotalCents: 10000, totalCents: 5000 });
  expect(response.status).toBe(200);
});

it('uses shared pricing for existing non-catalog rule definitions', async () => {
  const { tx, client } = transactionClient();
  const definition = { ...JSON.parse(catalogDefinition) };
  delete definition.priceBasis;
  tx.promotion.findUnique.mockResolvedValueOnce({ ...campaign(false), ruleDefinition: JSON.stringify(definition),
    startsAt: new Date('2026-01-01'), endsAt: new Date('2027-01-01') } as never);
  const response = await POST.forTest(request([{ productId: 'p1', variantId: 'v1', quantity: 1 }]),
    { params: Promise.resolve({ id: 'draft-1' }) }, client as never);
  expect(response.status).toBe(200);
  expect(tx.$queryRaw).not.toHaveBeenCalled();
  expect(mocks.createSnapshot).toHaveBeenCalledTimes(1);
});

it('rejects a truncated allVariants expansion from the bounded database query', async () => {
  const { tx, client } = transactionClient();
  tx.productVariant.findMany.mockResolvedValue(Array.from({ length: 2001 }, (_, index) => ({
    id: `v${index}`, productId: 'p1', catalogNumber: `CAT-${index}`, spec: String(index),
  })) as never);
  const response = await POST.forTest(request([{ productId: 'p1', variantId: 'v0', quantity: 1 }]), {
    params: Promise.resolve({ id: 'draft-1' }),
  }, client as never);

  expect(tx.productVariant.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2001 }));
  expect(response.status).toBe(400);
  expect(mocks.createSnapshot).not.toHaveBeenCalled();
});

it('preserves the non-catalog legacy preview and reads its price from the database', async () => {
  mocks.getCampaign.mockReturnValue(campaign(false));
  const response = await POST(request([{ productId: 'p1', variantId: 'v1', quantity: 2, unitPriceCents: 1, price: 0.01 }]), {
    params: Promise.resolve({ id: 'draft-1' }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ discountCents: 123, statuses: [] });
  expect(mocks.calculate.mock.calls[0][0]).toEqual([{ id: '0', productId: 'p1', variantId: 'v1', quantity: 2,
    unitPriceCents: 700, basePriceCents: 700 }]);
});

it('rejects request SKU identities outside the current expanded selector set', async () => {
  const { client } = transactionClient();
  const response = await POST.forTest(request([{ productId: 'p1', variantId: 'v3', quantity: 1 }]), {
    params: Promise.resolve({ id: 'draft-1' }),
  }, client as never);

  expect(response.status).toBe(400);
  expect(mocks.createSnapshot).not.toHaveBeenCalled();
});
