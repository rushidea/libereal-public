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
import { verifyAndPriceItems } from '@/lib/pricing';
import { assertOrderPricingResolved } from '@/lib/order-catalog-repricing';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

const params = { params: Promise.resolve({ id: 'inquiry_supplier' }) };
function request(body: object) { return new NextRequest('http://localhost/api/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
const policy = { target: 'brand_default_discount', brand: 'Example Brand', brandDefaultDiscountRate: 0.8,
  supplierQuoteRequiredAbove: 500, reason: 'Synthetic confirmed policy' };
const reply = () => ({ supplier: 'Example Supplier', channel: 'Test email', reference: 'fixture:written-reply', supplierUnitPrice: 400,
  customerUnitPrice: 650, currency: 'CNY', taxBasis: 'included', leadTime: 'Confirmed test lead time',
  validUntil: new Date(Date.now() + 2 * 86400000).toISOString(), conditions: 'Synthetic written payment, freight and supply terms' });
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
    expect(priced.verifiedItems[0].unitPrice).toBe(650);
    const changedDisplay = await publish(request({ items: [{ ...priceInput(), price: 700 }] }), params);
    expect(changedDisplay.status).toBe(409);
    expect(await prisma.quote.count()).toBe(0);
    const published = await publish(request({}), params); const body = await published.json();
    expect(published.status, JSON.stringify(body)).toBe(200);
    const quote = await prisma.quote.findFirstOrThrow({ include: { items: true } });
    expect(quote.items[0]).toMatchObject({ inquiryItemId: 'line_supplier', unitPrice: 650 });
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
    expect(successor).toMatchObject({ status: 'draft', version: 3, subtotal: 1300 });
    expect(successor.items[0]).toMatchObject({ available: true, unitPrice: 650, inquiryItemId: 'line_supplier' });
    expect(vi.mocked(enqueueBackgroundTask).mock.calls.filter(call => call[0] === 'email.send')).toHaveLength(0);
  });

  it('does not lock a customer-accepted pending order and keeps its original amount while awaiting supplier reply', async () => {
    const { order } = await seedQuote('pending', 1); await activate();
    const current = await prisma.order.findUniqueOrThrow({ where: { id: order!.id }, include: { orderItems: true } });
    expect(current).toEqual(order);
    expect(await prisma.orderEvent.count({ where: { type: 'catalog_repricing_required' } })).toBe(1);
    const prepared = await prepare(1); expect((await record(prepared)).status).toBe(200);
    const draft = await prisma.quote.findFirstOrThrow({ orderBy: { version: 'desc' }, include: { items: true } });
    expect(draft.items.every(line => line.unitPrice === 650 && line.quantity === 1 && line.available)).toBe(true);
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
    expect(successor.status).toBe('draft'); expect(successor.items[0].unitPrice).toBe(650);
    expect(await prisma.orderEvent.count({ where: { orderId: order.id, type: 'catalog_repricing_required' } })).toBeGreaterThan(0);
    expect((await prisma.backgroundTask.findUniqueOrThrow({ where: { id: prepared.reviewId } })).status).toBe('succeeded');
  });

  it('shows the responsible person and current source scope through the existing admin permission', async () => {
    await activate(); await prepare();
    const response = await view(new NextRequest('http://localhost/api/test'), params);
    const body = await response.json(); expect(response.status).toBe(200);
    expect(body.entries[0]).toMatchObject({ owner: 'admin@test.com', status: 'awaiting_human', scope: { quantity: 2, cataloguePrice: 800 } });
  });
});
