import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/product-filter-cache', () => ({ invalidateProductFilters: vi.fn() }));
vi.mock('@/lib/background-tasks', () => ({ enqueueBackgroundTask: vi.fn() }));
vi.mock('@/lib/admin-mfa-settings', () => ({ isAdminMfaScenarioEnabled: vi.fn(async () => false), requiresAdminMfaForPermission: vi.fn(async () => false) }));
vi.mock('@/lib/security/mfa-config', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/security/mfa-config')>(),
  isMfaAdminRequired: vi.fn(() => false), isMfaPhase1Enabled: vi.fn(() => false) }));
import { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { POST as preview } from '@/app/api/admin/pricing-adjustments/preview/route';
import { POST as apply } from '@/app/api/admin/pricing-adjustments/apply/route';
import { GET as view, POST as supplierAction } from '@/app/api/inquiries/[id]/supplier-quote/route';
import { POST as publish } from '@/app/api/inquiries/[id]/quote/route';
import { POST as acceptQuote } from '@/app/api/orders/[id]/confirm-items/route';
import { PATCH as updateOrder } from '@/app/api/orders/[id]/route';
import { quoteContentHash } from '@/lib/quote-records';
import { verifyAndPriceItems } from '@/lib/pricing';
import { assertOrderPricingResolved, recordCustomerRepricingConfirmation } from '@/lib/order-catalog-repricing';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

const params = { params: Promise.resolve({ id: 'inquiry_supplier' }) };
function request(body: object) { return new NextRequest('http://localhost/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
const policy = { target: 'brand_default_discount', brand: 'Example Brand', brandDefaultDiscountRate: 0.8,
  supplierQuoteRequiredAbove: 500, reason: 'Synthetic confirmed policy' };
const reply = () => ({ supplier: 'Example Supplier', channel: 'Test email', reference: 'fixture:written-reply', supplierUnitPrice: 400,
  customerUnitPrice: 640, currency: 'CNY', taxBasis: 'included', leadTime: 'Confirmed test lead time',
  validUntil: new Date(Date.now() + 2 * 86400000).toISOString(), conditions: 'Private supplier payment terms', customerConditions: 'Confirmed customer freight and supply terms' });
const priceInput = (quantity = 2) => ({ productId: 'product_supplier', catalogNumber: 'EX-1', inquiryItemId: 'line_supplier',
  name: 'Example item', price: 640, quantity });
const priceContext = { inquiryId: 'inquiry_supplier', userId: 'customer_supplier', customerEmail: 'customer@example.test' };
async function prepare(quantity = 2) {
  const response = await supplierAction(request({ action: 'prepare', inquiryItemId: 'line_supplier', quantity }), params);
  const body = await response.json(); expect(response.status, JSON.stringify(body)).toBe(200); return body.result;
}
async function record(prepared: { reviewId: string; requestHash: string }, value = reply()) {
  return supplierAction(request({ action: 'record_reply', ...prepared, reply: value }), params);
}
async function activate() {
  const response = await preview(request(policy)); const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  const applied = await apply(request({ ...policy, approvalHash: body.preview.approvalHash }));
  const result = await applied.json(); expect(applied.status, JSON.stringify(result)).toBe(200); return result;
}
async function seedQuote(orderStatus?: string, orderedQty = 2) {
  await prisma.inquiry.update({ where: { id: 'inquiry_supplier' }, data: { status: orderStatus ? 'closed' : 'quote_sent' } });
  const quote = await prisma.quote.create({ data: { inquiryId: 'inquiry_supplier', version: 1, status: orderStatus ? 'accepted' : 'sent', subtotal: 1280,
    items: { create: [{ inquiryItemId: 'line_supplier', productId: 'product_supplier', catalogNumber: 'EX-1', name: 'Example item', position: 0,
      quantity: 2, orderedQty: orderStatus ? orderedQty : 0, unitPrice: 640, lineTotal: 1280, metadata: JSON.stringify({ brand: 'Example Brand' }) }] } }, include: { items: true } });
  const order = orderStatus ? await prisma.order.create({ data: { id: 'order_supplier', inquiryId: 'inquiry_supplier', email: 'customer@example.test', customerId: 'customer_supplier',
    status: orderStatus, subtotal: 640 * orderedQty, total: 640 * orderedQty,
    orderItems: { create: [{ position: 0, productId: 'product_supplier', catalogNumber: 'EX-1', name: 'Example item', unitPrice: 640, quantity: orderedQty, metadata: JSON.stringify({ brand: 'Example Brand' }) }] } }, include: { orderItems: true } }) : null;
  if (order) await prisma.quoteConfirmation.create({ data: { quoteId: quote.id, userId: 'customer_supplier', email: order.email, action: 'accept',
    details: JSON.stringify({ orderId: order.id, items: [{ quoteItemId: quote.items[0].id, orderedQuantity: orderedQty }] }) } });
  return { quote, order };
}

describe('written supplier quotation in the original inquiry', () => {
  beforeAll(() => getTestDb());
  afterAll(() => closeTestDb());
  afterEach(() => vi.useRealTimers());
  beforeEach(async () => {
    clearAllTables(getTestDb()); seedAdmin(getTestDb()); vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' } } as never);
    await prisma.user.create({ data: { id: 'customer_supplier', email: 'customer@example.test', name: 'Example customer', emailVerified: new Date() } });
    await prisma.brand.create({ data: { id: 'brand_supplier', name: 'Example Brand', defaultDiscountRate: 0.8 } });
    await prisma.product.create({ data: { id: 'product_supplier', catalogNumber: 'EX-1', name: 'Example item', brand: 'Example Brand',
      brandRecordId: 'brand_supplier', price: 640, originalPrice: 800 } });
    await prisma.inquiry.create({ data: { id: 'inquiry_supplier', userId: 'customer_supplier', email: 'customer@example.test', name: 'Example customer', phone: 'test', institution: 'test',
      operationLogs: '[{"historicalFailure":"preserve"}]', inquiryItems: { create: [{ id: 'line_supplier', position: 0, productId: 'product_supplier', catalogNumber: 'EX-1', name: 'Example item', quantity: 2,
        unitPrice: 640, lineTotal: 1280, metadata: JSON.stringify({ brand: 'Example Brand', originalEvidence: 'preserve' }) }] } } });
  });

  it('rejects a changed gate using an earlier preview approval', async () => {
    const body = await (await preview(request(policy))).json();
    expect((await apply(request({ ...policy, supplierQuoteRequiredAbove: 600, approvalHash: body.preview.approvalHash }))).status).toBe(409);
    expect((await prisma.brand.findUniqueOrThrow({ where: { id: 'brand_supplier' } })).supplierQuoteRequiredAbove).toBeNull();
  });

  it('requires the real admin permission and does not trust a claimed role', async () => {
    await activate();
    vi.mocked(auth).mockResolvedValue({ user: { id: 'customer_supplier', email: 'customer@example.test', role: 'customer', sessionId: 'session-customer' } } as never);
    expect((await supplierAction(request({ action: 'prepare', inquiryItemId: 'line_supplier', role: 'admin' }), params)).status).toBe(403);
    expect(await prisma.backgroundTask.count({ where: { type: 'inquiry.supplier_written_quote' } })).toBe(0);
  });

  it('blocks manual price bypass, records once, preserves the inquiry identity, and publishes the confirmed sales price', async () => {
    await activate();
    await expect(verifyAndPriceItems([priceInput()], { ...priceContext, allowManualAdjustment: true,
      manualAdjustments: { 'EX-1': { type: 'fixed_price', value: 1, reason: 'Attempted override' } } })).rejects.toThrow('SUPPLIER_WRITTEN_QUOTE_REQUIRED');
    const prepared = await prepare(); expect((await prepare()).reviewId).toBe(prepared.reviewId);
    const value = reply(); expect((await record(prepared, value)).status).toBe(200);
    expect((await (await record(prepared, value)).json()).result.recorded).toBe(false);
    expect(await prisma.backgroundTask.count({ where: { type: 'inquiry.supplier_written_quote' } })).toBe(1);
    expect(vi.mocked(enqueueBackgroundTask).mock.calls.filter(call => call[0] === 'email.send')).toHaveLength(0);
    const priced = await verifyAndPriceItems([priceInput()], priceContext);
    expect(priced.verifiedItems[0].unitPrice).toBe(640);
    const changedDisplay = await publish(request({ items: [{ ...priceInput(), price: 700 }] }), params);
    expect(changedDisplay.status).toBe(409);
    expect(await prisma.quote.count()).toBe(0);
    const published = await publish(request({}), params); const body = await published.json();
    expect(published.status, JSON.stringify(body)).toBe(200);
    const quote = await prisma.quote.findFirstOrThrow({ include: { items: true } });
    expect(quote.items[0]).toMatchObject({ inquiryItemId: 'line_supplier', unitPrice: 640 });
    expect(quote.validUntil?.toISOString()).toBe(value.validUntil);
    expect(await prisma.inquiryItem.count()).toBe(1);
    const item = await prisma.inquiryItem.findUniqueOrThrow({ where: { id: 'line_supplier' } });
    expect(JSON.parse(item.metadata!).originalEvidence).toBe('preserve');
    expect(JSON.parse((await prisma.inquiry.findUniqueOrThrow({ where: { id: 'inquiry_supplier' } })).operationLogs)[0]).toEqual({ historicalFailure: 'preserve' });
  });

  it.each(['quantity', 'catalogue', 'policy'] as const)('rejects an old reply after %s changes and preserves the pending record', async change => {
    await activate(); const prepared = await prepare();
    if (change === 'quantity') await prisma.inquiryItem.update({ where: { id: 'line_supplier' }, data: { quantity: 3 } });
    if (change === 'catalogue') await prisma.product.update({ where: { id: 'product_supplier' }, data: { originalPrice: 900 } });
    if (change === 'policy') await prisma.brand.update({ where: { id: 'brand_supplier' }, data: { supplierQuoteRequiredAbove: 550 } });
    expect((await record(prepared)).status).toBe(409);
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: prepared.reviewId } })).status).toBe('awaiting_human');
  });

  it('does not reuse a reply for another quantity, customer, or expired supply terms', async () => {
    await activate(); const prepared = await prepare(); const value = reply(); expect((await record(prepared, value)).status).toBe(200);
    await expect(verifyAndPriceItems([priceInput(1)], priceContext)).rejects.toThrow('SUPPLIER_WRITTEN_QUOTE_REQUIRED');
    await expect(verifyAndPriceItems([priceInput()], { ...priceContext, userId: undefined, customerEmail: 'other@example.test' })).rejects.toThrow('SUPPLIER_WRITTEN_QUOTE_REQUIRED');
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(Date.now() + 3 * 86400000));
    await expect(verifyAndPriceItems([priceInput()], priceContext)).rejects.toThrow('SUPPLIER_WRITTEN_QUOTE_REQUIRED');
    const next = await prepare(); expect(next.reviewId).not.toBe(prepared.reviewId);
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: prepared.reviewId } })).status).toBe('succeeded');
  });

  it('moves an existing quote to a human wait, then resumes repricing after the reply without sending', async () => {
    const { quote } = await seedQuote(); await activate();
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('superseded');
    const draft = await prisma.quote.findFirstOrThrow({ orderBy: { version: 'desc' }, include: { items: true } });
    expect(draft.items[0]).toMatchObject({ unitPrice: 0, available: false, inquiryItemId: 'line_supplier' });
    expect((await publish(request({}), params)).status).toBe(409);
    const prepared = await prepare(); expect((await record(prepared)).status).toBe(200);
    const successor = await prisma.quote.findFirstOrThrow({ orderBy: { version: 'desc' }, include: { items: true } });
    expect(successor).toMatchObject({ status: 'draft', version: 3, subtotal: 1280 });
    expect(successor.items[0]).toMatchObject({ available: true, unitPrice: 640, inquiryItemId: 'line_supplier' });
    expect(vi.mocked(enqueueBackgroundTask).mock.calls.filter(call => call[0] === 'email.send')).toHaveLength(0);
  });

  it('does not lock a customer-accepted pending order and keeps its original amount while awaiting supplier reply', async () => {
    const { order } = await seedQuote('pending', 1); await activate();
    const current = await prisma.order.findUniqueOrThrow({ where: { id: order!.id }, include: { orderItems: true } });
    expect(current).toEqual(order);
    expect(await prisma.orderEvent.count({ where: { type: 'catalog_repricing_required' } })).toBe(1);
    const prepared = await prepare(1); expect((await record(prepared)).status).toBe(200);
    const draft = await prisma.quote.findFirstOrThrow({ orderBy: { version: 'desc' }, include: { items: true } });
    expect(draft.items.every(line => line.unitPrice === 640 && line.quantity === 1 && line.available)).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order!.id } })).total).toBe(640);
  });

  it('leaves merchant-accepted order amounts and original quote unchanged', async () => {
    const { order, quote } = await seedQuote('confirmed'); await activate();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order!.id } })).total).toBe(order!.total);
    expect(await prisma.quote.count()).toBe(1);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } })).status).toBe('accepted');
    expect(await prisma.backgroundTask.count({ where: { type: 'inquiry.supplier_written_quote' } })).toBe(0);
  });

  it('revalidates supplier evidence when the customer accepts a sent quote', async () => {
    await activate(); const prepared = await prepare(); expect((await record(prepared)).status).toBe(200);
    expect((await publish(request({}), params)).status).toBe(200);
    const quote = await prisma.quote.findFirstOrThrow();
    await prisma.product.update({ where: { id: 'product_supplier' }, data: { originalPrice: 850 } });
    vi.mocked(auth).mockResolvedValue({ user: { id: 'customer_supplier', email: 'customer@example.test', role: 'customer', sessionId: 'session-customer' } } as never);
    const response = await acceptQuote(request({ quoteId: quote.id, quoteVersion: quote.version, itemIndices: [0] }), params);
    expect(response.status, await response.text()).toBe(409);
    expect(await prisma.order.count()).toBe(0);
  });

  it('reopens the original pending order review when supplier terms expire, without changing or accepting the order', async () => {
    await activate(); const prepared = await prepare(); expect((await record(prepared)).status).toBe(200);
    expect((await publish(request({}), params)).status).toBe(200);
    const quote = await prisma.quote.findFirstOrThrow();
    vi.mocked(auth).mockResolvedValue({ user: { id: 'customer_supplier', email: 'customer@example.test', role: 'customer', sessionId: 'session-customer' } } as never);
    const accepted = await acceptQuote(request({ quoteId: quote.id, quoteVersion: quote.version, itemIndices: [0] }), params);
    const response = await accepted.json(); expect(accepted.status, JSON.stringify(response)).toBe(200);
    const order = await prisma.order.findFirstOrThrow({ include: { orderItems: true } });
    expect(['pending', 'unpaid']).toContain(order.status);
    await prisma.$transaction(tx => assertOrderPricingResolved(tx, order.id));
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(Date.now() + 3 * 86400000));
    await expect(prisma.$transaction(tx => assertOrderPricingResolved(tx, order.id))).rejects.toThrow('QUOTE_REPRICE_REQUIRED');
    vi.mocked(auth).mockResolvedValue({ user: { id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' } } as never);
    const renewed = await prepare(); expect(renewed.reviewId).not.toBe(prepared.reviewId);
    const recorded = await record(renewed); const result = await recorded.json(); expect(recorded.status, JSON.stringify(result)).toBe(200);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { orderItems: true } })).toEqual(order);
    const successor = await prisma.quote.findFirstOrThrow({ orderBy: { version: 'desc' }, include: { items: true } });
    expect(successor.status).toBe('draft'); expect(successor.items[0].unitPrice).toBe(640);
    expect(await prisma.orderEvent.count({ where: { orderId: order.id, type: 'catalog_repricing_required' } })).toBeGreaterThan(0);
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: prepared.reviewId } })).status).toBe('succeeded');
  });

  it('shows the responsible person and current source scope through the existing admin permission', async () => {
    await activate(); await prepare();
    const response = await view(new NextRequest('http://localhost/api/test'), params);
    const body = await response.json(); expect(response.status).toBe(200);
    expect(body.entries[0]).toMatchObject({ owner: 'admin@test.com', status: 'awaiting_human', scope: { quantity: 2, cataloguePrice: 800 } });
  });

  async function acceptedPendingOrder() {
    await activate(); const prepared = await prepare(); expect((await record(prepared)).status).toBe(200);
    expect((await publish(request({}), params)).status).toBe(200);
    const quote = await prisma.quote.findFirstOrThrow();
    vi.mocked(auth).mockResolvedValue({ user: { id: 'customer_supplier', email: 'customer@example.test', role: 'customer', sessionId: 'session-customer' } } as never);
    expect((await acceptQuote(request({ quoteId: quote.id, quoteVersion: quote.version, itemIndices: [0] }), params)).status).toBe(200);
    vi.mocked(auth).mockResolvedValue({ user: { id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' } } as never);
    return prisma.order.findFirstOrThrow({ include: { orderItems: true } });
  }

  it.each(['quantity', 'price', 'clear_snapshot', 'clear_identity', 'erase_all_identity', 'foreign_product_id', 'lead_time'] as const)('rejects an order edit/confirm bypass via %s and rolls back every write', async change => {
    const order = await acceptedPendingOrder();
    const line = order.orderItems[0];
    const items = [{ ...line, price: line.unitPrice, ...(change === 'quantity' ? { quantity: 3 } : {}),
      ...(change === 'price' ? { price: 1 } : {}), ...(change === 'clear_snapshot' ? { pricingSnapshot: null } : {}),
      ...(change === 'clear_identity' ? { productId: null, catalogNumber: 'EX-1', pricingSnapshot: null } : {}),
      ...(change === 'erase_all_identity' ? { productId: null, catalogNumber: null, metadata: null, pricingSnapshot: null } : {}),
      ...(change === 'foreign_product_id' ? { productId: 'nonexistent', catalogNumber: 'EX-1', pricingSnapshot: null } : {}),
      ...(change === 'lead_time' ? { leadTime: 'Unapproved new lead time' } : {}) }];
    const response = await updateOrder(request({ items, confirmWarnings: true, ...(change !== 'clear_snapshot' ? { status: 'confirmed' } : {}) }),
      { params: Promise.resolve({ id: order.id }) });
    const rejection = await response.json();
    expect(response.status, JSON.stringify(rejection)).toBe(409);
    expect(rejection.code).toBe('QUOTE_REPRICE_REQUIRED');
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { orderItems: true } })).toEqual(order);
  });

  it.each([false, true])('rejects copied or split supplier lines before saving (confirm=%s)', async confirm => {
    const order = await acceptedPendingOrder(); const original = order.orderItems[0];
    for (const quantity of [2, 1]) {
      const line = { ...original, price: original.unitPrice, quantity };
      const response = await updateOrder(request({ items: [line, line], confirmWarnings: true, ...(confirm ? { status: 'confirmed' } : {}) }),
        { params: Promise.resolve({ id: order.id }) });
      const rejection = await response.json();
      expect(response.status, JSON.stringify(rejection)).toBe(409); expect(rejection.code).toBe('QUOTE_REPRICE_REQUIRED');
      expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { orderItems: true } })).toEqual(order);
    }
  });

  it.each(['changed', 'removed'] as const)('rejects %s policy labels and unapproved terms in separate saves and edit-confirm', async policy => {
    const order = await acceptedPendingOrder(); const original = order.orderItems[0];
    for (const confirm of [false, true]) {
      const snapshot = JSON.parse(original.pricingSnapshot!);
      if (policy === 'changed') snapshot.discountPolicy = 'brand_priority'; else delete snapshot.discountPolicy;
      snapshot.customerSupplyConditions = 'Unapproved customer supply terms';
      const response = await updateOrder(request({ items: [{ ...original, price: original.unitPrice,
        leadTime: 'Unapproved 7 day delivery', pricingSnapshot: JSON.stringify(snapshot) }], confirmWarnings: true,
        ...(confirm ? { status: 'confirmed' } : {}) }), { params: Promise.resolve({ id: order.id }) });
      const rejection = await response.json();
      expect(response.status, JSON.stringify(rejection)).toBe(409); expect(rejection.code).toBe('QUOTE_REPRICE_REQUIRED');
      expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { orderItems: true } })).toEqual(order);
    }
  });

  it('saves canonical server evidence for an unchanged valid order edit', async () => {
    const order = await acceptedPendingOrder(); const original = order.orderItems[0];
    const response = await updateOrder(request({ items: [{ ...original, price: original.unitPrice,
      pricingSnapshot: JSON.stringify({ ...JSON.parse(original.pricingSnapshot!), inventedApproval: 'not authority' }) }], confirmWarnings: true }),
      { params: Promise.resolve({ id: order.id }) });
    expect(response.status, await response.text()).toBe(200);
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { orderItems: true } });
    expect(saved.status).toBe(order.status);
    expect(JSON.parse(saved.orderItems[0].pricingSnapshot!)).not.toHaveProperty('inventedApproval');
    expect(saved.orderItems[0].leadTime).toBe(original.leadTime);
    await prisma.$transaction(tx => assertOrderPricingResolved(tx, order.id));
  });

  it('allows two independently evidenced inquiry lines while rejecting substitution of the original scope', async () => {
    await prisma.inquiryItem.create({ data: { id: 'line_supplier_2', inquiryId: 'inquiry_supplier', position: 1,
      productId: 'product_supplier', catalogNumber: 'EX-1', name: 'Example item', quantity: 2, unitPrice: 640,
      lineTotal: 1280, metadata: JSON.stringify({ brand: 'Example Brand' }) } });
    await activate(); const first = await prepare(); expect((await record(first)).status).toBe(200);
    const secondResponse = await supplierAction(request({ action: 'prepare', inquiryItemId: 'line_supplier_2', quantity: 2 }), params);
    const second = (await secondResponse.json()).result;
    expect(secondResponse.status).toBe(200); expect((await record(second)).status).toBe(200);
    expect((await publish(request({}), params)).status).toBe(200);
    const quote = await prisma.quote.findFirstOrThrow();
    vi.mocked(auth).mockResolvedValue({ user: { id: 'customer_supplier', email: 'customer@example.test', role: 'customer', sessionId: 'session-customer' } } as never);
    expect((await acceptQuote(request({ quoteId: quote.id, quoteVersion: quote.version, itemIndices: [0, 1] }), params)).status).toBe(200);
    vi.mocked(auth).mockResolvedValue({ user: { id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' } } as never);
    const order = await prisma.order.findFirstOrThrow({ include: { orderItems: { orderBy: { position: 'asc' } } } });
    const items = order.orderItems.map(line => ({ ...line, price: line.unitPrice }));
    const saved = await updateOrder(request({ items, confirmWarnings: true }), { params: Promise.resolve({ id: order.id }) });
    expect(saved.status, await saved.text()).toBe(200);
    const replaced = await updateOrder(request({ items: [items[1]], confirmWarnings: true, status: 'confirmed' }), { params: Promise.resolve({ id: order.id }) });
    expect(replaced.status, await replaced.text()).toBe(409);
    expect(await prisma.orderItem.count({ where: { orderId: order.id } })).toBe(2);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(order.status);
  });

  it('checks a pre-existing direct pending order even without an inquiry or pricing snapshot', async () => {
    const { order } = await seedQuote('pending');
    await prisma.order.update({ where: { id: order!.id }, data: { inquiryId: null } });
    await prisma.brand.update({ where: { id: 'brand_supplier' }, data: { supplierQuoteRequiredAbove: 500 } });
    const response = await updateOrder(request({ status: 'confirmed' }), { params: Promise.resolve({ id: order!.id }) });
    expect(response.status, await response.text()).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order!.id } })).status).toBe('pending');
  });

  it('keeps customer-specific discount priority and invalidates a reply when that source changes', async () => {
    await activate();
    await prisma.user.update({ where: { id: 'customer_supplier' }, data: { brandDiscounts: JSON.stringify({ 'Example Brand': 0.75 }) } });
    const prepared = await prepare();
    expect((await record(prepared, reply())).status).toBe(409);
    expect((await record(prepared, { ...reply(), customerUnitPrice: 600 })).status).toBe(200);
    const priced = (await verifyAndPriceItems([priceInput()], priceContext)).verifiedItems[0];
    expect(priced.unitPrice).toBe(600);
    expect(JSON.parse(priced.pricingSnapshot).appliedSource).toBe('customer_brand_discount');
    await prisma.user.update({ where: { id: 'customer_supplier' }, data: { brandDiscounts: JSON.stringify({ 'Example Brand': 0.7 }) } });
    await expect(verifyAndPriceItems([priceInput()], priceContext)).rejects.toThrow('SUPPLIER_WRITTEN_QUOTE_REQUIRED');
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: prepared.reviewId } })).status).toBe('succeeded');
    const successor = await prepare(); expect(successor.reviewId).not.toBe(prepared.reviewId);
    expect((await record(successor, { ...reply(), customerUnitPrice: 560 })).status).toBe(200);
    expect((await verifyAndPriceItems([priceInput()], priceContext)).verifiedItems[0].unitPrice).toBe(560);
  });

  it.each([5, 12])('records a real customer request for %i packages and resumes with a distinct reply and successor quote', async quantity => {
    await prisma.inquiryItem.update({ where: { id: 'line_supplier' }, data: { quantity: 10, lineTotal: 6400 } });
    const { quote } = await seedQuote();
    await prisma.quoteItem.update({ where: { id: quote.items[0].id }, data: { quantity: 10, lineTotal: 6400 } });
    await prisma.quote.update({ where: { id: quote.id }, data: { subtotal: 6400 } });
    await activate(); const original = await prepare(10); expect((await record(original)).status).toBe(200);
    const entries = (await (await view(new NextRequest('http://localhost/api/test'), params)).json()).entries;
    expect((await supplierAction(request({ action: 'prepare', inquiryItemId: 'line_supplier', quantity }), params)).status).toBe(409);
    const preparedResponse = await supplierAction(request({ action: 'prepare', inquiryItemId: 'line_supplier', quantity,
      quantityChange: { ...entries[0].quantityChangeSource, fromQuantity: 10, channel: 'Test email', reference: 'fixture:customer-changed-quantity' } }), params);
    const prepared = await preparedResponse.json(); expect(preparedResponse.status, JSON.stringify(prepared)).toBe(200);
    expect(prepared.result.reviewId).not.toBe(original.reviewId);
    let latest = await prisma.quote.findFirstOrThrow({ orderBy: { version: 'desc' }, include: { items: { orderBy: { position: 'asc' } } } });
    expect(latest.items[0]).toMatchObject({ quantity, available: false, unitPrice: 0 });
    const recorded = await record(prepared.result); expect(recorded.status, await recorded.text()).toBe(200);
    latest = await prisma.quote.findFirstOrThrow({ orderBy: { version: 'desc' }, include: { items: { orderBy: { position: 'asc' } } } });
    expect(latest.items[0]).toMatchObject({ quantity, available: true, unitPrice: 640 });
    const published = await publish(request({ catalogQuoteId: latest.id, catalogQuoteHash: quoteContentHash(latest) }), params);
    expect(published.status).toBe(200);
    const sent = (await published.json()).quote;
    expect(sent.items[0]).toMatchObject({ quantity, leadTime: reply().leadTime, notes: reply().customerConditions });
    expect((await prisma.inquiryItem.findUniqueOrThrow({ where: { id: 'line_supplier' } })).quantity).toBe(10);
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: original.reviewId } })).status).toBe('succeeded');
    expect((await prisma.quoteItem.findUniqueOrThrow({ where: { id: quote.items[0].id } })).quantity).toBe(10);
  });

  it('binds the new lead time and customer conditions to the displayed order proposal and applies them only after customer confirmation', async () => {
    const { order } = await seedQuote('pending');
    await prisma.orderItem.update({ where: { id: order!.orderItems[0].id }, data: { leadTime: '7 days' } });
    await activate(); const prepared = await prepare();
    expect((await record(prepared, { ...reply(), leadTime: '90 days' })).status).toBe(200);
    const draft = await prisma.quote.findFirstOrThrow({ orderBy: { version: 'desc' }, include: { items: true } });
    const line = draft.items[0]; const metadata = JSON.parse(line.metadata!);
    expect(line).toMatchObject({ leadTime: '90 days', notes: reply().customerConditions });
    expect(JSON.stringify(line)).not.toContain(reply().conditions);
    expect(metadata.previousLeadTime).toBe('7 days');
    expect((await prisma.orderItem.findUniqueOrThrow({ where: { id: order!.orderItems[0].id } })).leadTime).toBe('7 days');
    const identity = { inquiryId: 'inquiry_supplier', orderId: order!.id, quoteId: draft.id, proposalHash: metadata.repricingProposalHash,
      responseChannel: 'Test email', responseReference: 'fixture:customer-accepts-new-terms', actor: { id: 'admin_test_id', email: 'admin@test.com' } };
    await prisma.quoteItem.update({ where: { id: line.id }, data: { leadTime: 'Altered after display' } });
    await expect(prisma.$transaction(tx => recordCustomerRepricingConfirmation(tx, identity))).rejects.toThrow('REPRICING_VERSION_CHANGED');
    await prisma.quoteItem.update({ where: { id: line.id }, data: { leadTime: '90 days' } });
    const result = await prisma.$transaction(tx => recordCustomerRepricingConfirmation(tx, identity));
    expect(result.stage).toBe('applied');
    const applied = await prisma.order.findUniqueOrThrow({ where: { id: order!.id }, include: { orderItems: true } });
    expect(applied.status).toBe('pending'); expect(applied.orderItems[0].leadTime).toBe('90 days');
    expect(JSON.parse(applied.orderItems[0].pricingSnapshot!).customerSupplyConditions).toBe(reply().customerConditions);
  });

});
