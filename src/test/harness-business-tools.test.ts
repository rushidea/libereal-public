import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as pricingContext } from '@/app/api/internal/harness/inquiries/[id]/pricing-context/route';
import { POST as pricingPreview } from '@/app/api/internal/harness/inquiries/[id]/pricing-impact-preview/route';
import { GET as orderContext } from '@/app/api/internal/harness/orders/[id]/context/route';
import { POST as merchantPreview } from '@/app/api/internal/harness/orders/[id]/merchant-approval-preview/route';
import { GET as purchaseWorkspace } from '@/app/api/internal/harness/orders/[id]/purchase-workspace/route';
import { POST as purchasePreparation } from '@/app/api/internal/harness/orders/[id]/purchase-preparation-preview/route';
import { POST as paymentPreview } from '@/app/api/internal/harness/orders/[id]/supplier-payment-preview/route';
import { POST as supplyPreview } from '@/app/api/internal/harness/orders/[id]/supply-change-preview/route';
import { sha256Hex } from '@/lib/harness-tools/auth';
import { prisma } from '@/lib/prisma';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

const token = 'synthetic-machine-token';
const environment = 'local-test';
const inquiryId = 'pilot-inquiry';
const orderId = 'pilot-order';
const scopes = [
  'pricing.read', 'pricing.impact.preview', 'order.read', 'order.approval.preview',
  'purchase.read', 'purchase.prepare.preview', 'purchase.payment.preview', 'purchase.supply_change.preview',
];

function configure(pilotInquiryIds?: string[]) {
  const client = { tokenSha256: sha256Hex(token), pilotPricingInquiryIds: [inquiryId], pilotOrderIds: [orderId] };
  vi.stubEnv('LIBEREAL_HARNESS_TOOLS_CONFIG', JSON.stringify({
    enabled: true, environment, pilotInquiryIds,
    clients: [
      { ...client, clientId: 'pilot', scopes },
      { ...client, clientId: 'reader', scopes: ['order.read'] },
      { clientId: 'unbound', tokenSha256: client.tokenSha256, scopes },
    ],
  }));
}

type Handler = typeof orderContext;
function call(handler: Handler, id: string, body?: Record<string, unknown>, clientId = 'pilot', query = '') {
  return handler(new NextRequest(`http://localhost/api/internal/harness/business/${id}${query}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      'x-libereal-harness-token': token,
      'x-libereal-harness-client-id': clientId,
      'x-libereal-harness-env': environment,
    },
    body: body ? JSON.stringify(body) : undefined,
  }), { params: Promise.resolve({ id }) });
}

function intent(tool: string, id: string, body: Record<string, unknown>) {
  const canonical = JSON.stringify([tool, id, body], (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value);
  return { ...body, idempotencyKey: sha256Hex(canonical) };
}

async function seedPricing(id: string) {
  await prisma.inquiry.create({
    data: {
      id, name: 'Hidden Customer', email: 'customer@example.invalid', phone: 'hidden-phone', institution: 'Hidden Institution',
      quotes: { create: { id: `${id}-quote`, version: 1, subtotal: 200, items: { create: {
        id: `${id}-line`, position: 0, productId: 'product-a', catalogNumber: 'SYNTH-SKU', name: 'Synthetic Product',
        unitPrice: 100, quantity: 2, lineTotal: 200,
      } } } },
    },
  });
}

async function seedOrder(id: string, options: { inquiry?: string; status?: string; paymentMethod?: string } = {}) {
  await prisma.order.create({ data: {
    id, customerId: 'customer', email: 'customer@example.invalid', inquiryId: options.inquiry,
    status: options.status ?? 'pending', subtotal: 200, total: 200, paymentMethod: options.paymentMethod ?? 'bank_transfer',
    orderItems: { create: {
      id: `${id}-line`, position: 0, productId: 'product-a', catalogNumber: 'SYNTH-SKU', name: 'Synthetic Product', unitPrice: 100, quantity: 2,
    } },
  } });
}

describe('Harness machine pricing, acceptance and purchase tools', () => {
  beforeAll(() => { getTestDb(); });
  beforeEach(async () => {
    clearAllTables(getTestDb());
    configure();
    seedUser(getTestDb(), { id: 'customer', email: 'customer@example.invalid' });
    await prisma.product.create({ data: {
      id: 'product-a', catalogNumber: 'SYNTH-SKU', name: 'Synthetic Product', brand: 'Synthetic Brand',
      price: 100, minimumSalePrice: 90, costPrice: 12,
    } });
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
    closeTestDb();
  });

  it('requires a per-client object grant and a distinct capability for each operation', async () => {
    await seedPricing(inquiryId);
    await seedOrder(orderId);
    expect((await call(pricingContext, inquiryId, undefined, 'unbound')).status).toBe(403);
    expect((await call(orderContext, orderId, undefined, 'unbound')).status).toBe(403);
    expect((await call(orderContext, 'unknown-object')).status).toBe(403);
    expect((await call(orderContext, orderId, undefined, 'reader')).status).toBe(200);
    expect((await call(purchaseWorkspace, orderId, undefined, 'reader')).status).toBe(403);
    expect((await call(merchantPreview, orderId, {}, 'reader')).status).toBe(403);
    expect((await call(orderContext, orderId, undefined, 'pilot', '?orderId=override')).status).toBe(400);
    expect((await call(orderContext, orderId, undefined, 'unknown-client')).status).toBe(401);
    configure([]);
    expect((await call(pricingContext, inquiryId)).status).toBe(403);
  });

  it('previews one catalog record and counts only the granted inquiry and orders without changing them', async () => {
    await seedPricing(inquiryId);
    await seedPricing('outside-inquiry');
    await seedOrder(orderId, { inquiry: inquiryId });
    await seedOrder('outside-order', { inquiry: inquiryId });
    await seedOrder('confirmed-order', { inquiry: inquiryId, status: 'confirmed' });
    await prisma.quoteItem.create({ data: {
      id: 'not-granted-order-line', quoteId: `${inquiryId}-quote`, position: 1, productId: 'product-a',
      catalogNumber: 'SYNTH-SKU', name: 'Scoped Quote Line', unitPrice: 150, quantity: 1, lineTotal: 150,
      metadata: JSON.stringify({ repricingOrderId: 'outside-order' }),
    } });
    const context = await call(pricingContext, inquiryId);
    expect(context.headers.get('cache-control')).toBe('private, no-store');
    const { objectVersion, data } = await context.json();
    expect(data.lines).toEqual([{
      quoteItemId: `${inquiryId}-line`, catalogNumber: 'SYNTH-SKU', currentCatalogPrice: 100,
      orderedQuantity: 0, quantity: 2, quoteUnitPrice: 100,
    }]);
    expect(JSON.stringify(data)).not.toContain('customer@example.invalid');

    const body = { expectedVersion: objectVersion, quoteItemId: `${inquiryId}-line`, newPrice: 80 };
    const request = intent('preview_pricing_impact', inquiryId, body);
    const first = await call(pricingPreview, inquiryId, request);
    expect(first.status).toBe(200);
    const outcome = await first.json();
    expect(outcome).toMatchObject({ objectVersion, requestKey: request.idempotencyKey, data: {
      allowed: true, humanActionRequired: true, affectedQuoteCount: 1, affectedPendingOrderCount: 1,
      confirmedOrdersRepriced: false, price: { currentPrice: 100, nextPrice: 90, floored: true, changed: true },
    } });
    expect((await (await call(pricingPreview, inquiryId, request)).json()).data).toEqual(outcome.data);
    const wrongKey = await call(pricingPreview, inquiryId, { ...request, newPrice: 200 });
    expect(wrongKey.status).toBe(409);
    expect(await wrongKey.json()).toMatchObject({ errorClass: 'idempotency_conflict' });
    expect((await call(pricingPreview, inquiryId, intent('preview_pricing_impact', inquiryId, {
      ...body, quoteItemId: 'outside-inquiry-line',
    }))).status).toBe(404);
    expect((await call(pricingPreview, inquiryId, { ...request, approved: true })).status).toBe(400);

    expect(await prisma.product.findUnique({ where: { id: 'product-a' }, select: { price: true } })).toEqual({ price: 100 });
    expect(await prisma.quote.count()).toBe(2);
    expect(await prisma.backgroundTask.count()).toBe(0);
    expect(await prisma.order.findUnique({ where: { id: 'confirmed-order' }, select: { total: true } })).toEqual({ total: 200 });
    await prisma.orderItem.update({ where: { id: `${orderId}-line` }, data: { catalogNumber: 'SYNTH-CHANGED', productId: null } });
    expect(await (await call(pricingPreview, inquiryId, request)).json()).toMatchObject({ code: 'OBJECT_VERSION_CHANGED' });
    const refreshed = await (await call(pricingContext, inquiryId)).json();
    await prisma.product.update({ where: { id: 'product-a' }, data: { price: 105 } });
    expect(await (await call(pricingPreview, inquiryId, intent('preview_pricing_impact', inquiryId, {
      ...body, expectedVersion: refreshed.objectVersion,
    }))).json()).toMatchObject({ code: 'OBJECT_VERSION_CHANGED' });
  });

  it('previews merchant credit and online-payment blockers without reserving credit or accepting the order', async () => {
    await seedOrder(orderId);
    await prisma.creditAccount.create({ data: { userId: 'customer', baseLimit: 150, usedAmount: 100 } });
    const first = await call(orderContext, orderId);
    const { objectVersion, data } = await first.json();
    expect(data).toMatchObject({ status: 'pending', receivablePosted: false, allowed: false, credit: { applicable: true, shortfall: 150 } });
    expect(JSON.stringify(data)).not.toMatch(/customer@example|effectiveLimit|usedAmount|bankTrace|approvalVersion/);
    const post = intent('preview_merchant_approval', orderId, { expectedVersion: objectVersion });
    expect(await (await call(merchantPreview, orderId, post)).json()).toMatchObject({
      data: { allowed: false, blockers: ['CREDIT_LIMIT_EXCEEDED'], humanActionRequired: true },
    });
    expect(await prisma.accountReceivable.count()).toBe(0);
    expect(await prisma.creditTransaction.count()).toBe(0);
    expect(await prisma.orderStatusHistory.count()).toBe(0);

    await prisma.order.update({ where: { id: orderId }, data: { paymentMethod: 'alipay' } });
    expect((await call(merchantPreview, orderId, post)).status).toBe(409);
    const changed = await (await call(orderContext, orderId)).json();
    expect(changed.data.blockers).toContain('ALIPAY_PAYMENT_REQUIRED');
  });

  it('rejects acceptance when lines sharing an inventory account exceed available stock without reserving', async () => {
    await seedOrder(orderId);
    await prisma.creditAccount.create({ data: { userId: 'customer', baseLimit: 1000 } });
    await prisma.product.update({ where: { id: 'product-a' }, data: { stockQuantity: 3 } });
    const prior = await (await call(orderContext, orderId)).json();
    expect(prior.data.allowed).toBe(true);
    await prisma.orderItem.create({ data: {
      id: 'additional-line', orderId, position: 1, productId: 'product-a', catalogNumber: 'SYNTH-SKU',
      name: 'Synthetic Product', unitPrice: 100, quantity: 2,
    } });
    expect((await call(merchantPreview, orderId, intent('preview_merchant_approval', orderId, {
      expectedVersion: prior.objectVersion,
    }))).status).toBe(409);
    const current = await (await call(orderContext, orderId)).json();
    const allowed = await (await call(merchantPreview, orderId, intent('preview_merchant_approval', orderId, {
      expectedVersion: current.objectVersion,
    }))).json();
    expect(allowed.data).toMatchObject({ allowed: false, blockers: ['INSUFFICIENT_AVAILABLE_INVENTORY'] });
    expect(await prisma.inventoryAccount.count()).toBe(0);
    expect(await prisma.inventoryReservation.count()).toBe(0);
  });

  it('reads an order-bound workspace, prepares no task for an unaccepted order, and rejects foreign purchases', async () => {
    await seedOrder(orderId);
    const result = await (await call(purchaseWorkspace, orderId)).json();
    expect(result.data).toMatchObject({ orderId, orderStatus: 'pending', canPrepare: false, purchases: [] });
    const prepared = await (await call(purchasePreparation, orderId, intent('preview_purchase_preparation', orderId, {
      expectedVersion: result.objectVersion,
    }))).json();
    expect(prepared.data).toMatchObject({ allowed: false, blockers: ['PURCHASE_NOT_ELIGIBLE', 'NO_UNPREPARED_PURCHASE_DEMAND'], candidates: [] });
    const purchase = { expectedVersion: result.objectVersion, purchaseOrderId: 'another-purchase' };
    expect((await call(paymentPreview, orderId, intent('preview_supplier_payment', orderId, { ...purchase, amountCents: 100 }))).status).toBe(404);
    expect((await call(supplyPreview, orderId, intent('preview_supply_change', orderId, {
      ...purchase, changeKind: 'delay', affectedLines: [{ orderItemId: 'foreign-line', quantity: 1 }],
    }))).status).toBe(404);
    expect((await call(supplyPreview, orderId, intent('preview_supply_change', orderId, {
      ...purchase, changeKind: 'delay', affectedLines: [{ orderItemId: 'foreign-line', quantity: 1, source: {} }],
    }))).status).toBe(400);
    expect(await prisma.purchaseRequirement.count()).toBe(0);
    expect(await prisma.purchaseActivity.count()).toBe(0);
    expect(await prisma.backgroundTask.count()).toBe(0);
  });
});
