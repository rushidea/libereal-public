import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/product-filter-cache', () => ({ invalidateProductFilters: vi.fn() }));
vi.mock('@/lib/background-tasks', () => ({ enqueueBackgroundTask: vi.fn() }));
vi.mock('@/lib/admin-mfa-settings', () => ({
  isAdminMfaScenarioEnabled: vi.fn(async () => false),
  requiresAdminMfaForPermission: vi.fn(async () => false),
}));
vi.mock('@/lib/security/mfa-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/security/mfa-config')>();
  return {
    ...actual,
    isMfaAdminRequired: vi.fn(() => false),
    isMfaPhase1Enabled: vi.fn(() => false),
  };
});
vi.mock('@/lib/pricing-adjustment-template', () => ({
  readPricingAdjustmentTemplate: vi.fn(() => ({
    fileName: '商品集中调价导入模板.xlsx',
    buffer: Buffer.from('xlsx-bytes'),
  })),
}));

import { NextRequest } from 'next/server';
import { GET as adminOrderDetail, PATCH as adminAcceptOrder } from '@/app/api/admin/orders/[id]/route';
import { ADMIN_ROLE_DEFINITIONS } from '@/lib/admin-permissions';
import { GET as inquiryList } from '@/app/api/inquiries/route';
import { PATCH as acceptOrder } from '@/app/api/orders/[id]/route';
import { POST as orderQuote } from '@/app/api/orders/[id]/quote/route';
import { GET as previewDetails } from '@/app/api/admin/pricing-adjustments/preview/details/route';
import { POST as publishQuote } from '@/app/api/inquiries/[id]/quote/route';
import { quoteContentHash } from '@/lib/quote-records';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { POST as recordRepricing } from '@/app/api/inquiries/[id]/quote/repricing/route';
import { GET as previewRepricingFinance, POST as approveRepricingFinance } from '@/app/api/inquiries/[id]/quote/repricing/finance/route';
import { assertOrderPricingResolved } from '@/lib/order-catalog-repricing';
import { closeStalePendingOrders } from '@/lib/order-auto-close';
import { requiresAdminMfaForPermission } from '@/lib/admin-mfa-settings';
import { isMfaAdminRequired, isMfaPhase1Enabled } from '@/lib/security/mfa-config';
import { readPricingAdjustmentTemplate } from '@/lib/pricing-adjustment-template';
import { POST as previewPricingRoute } from '@/app/api/admin/pricing-adjustments/preview/route';
import { POST as previewChunkRoute } from '@/app/api/admin/pricing-adjustments/preview/chunk/route';
import { POST as applyPricingRoute } from '@/app/api/admin/pricing-adjustments/apply/route';
import { POST as matchPricing } from '@/app/api/admin/pricing-adjustments/match/route';
import { POST as createMissingPricing } from '@/app/api/admin/pricing-adjustments/create-missing/route';
import { POST as classifyPreviewPricing } from '@/app/api/admin/pricing-adjustments/classify-preview/route';
import { GET as downloadPricingTemplate } from '@/app/api/admin/pricing-adjustments/template/route';
import { MAX_CLASSIFY_PREVIEW } from '@/lib/product-smart-classify-catalog';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin } from './db-helpers';

const authMock = auth as unknown as Mock;
const mfaRequiredMock = requiresAdminMfaForPermission as unknown as Mock;
const adminMfaRequiredMock = isMfaAdminRequired as unknown as Mock;
const phase1EnabledMock = isMfaPhase1Enabled as unknown as Mock;
const readTemplateMock = readPricingAdjustmentTemplate as unknown as Mock;

// Model the UI's retained preview: never generate a new preview while applying.
let displayedApprovalHash: string | undefined;
async function rememberPreview(response: Response) {
  const data = await response.clone().json();
  if (data.preview?.approvalHash) displayedApprovalHash = data.preview.approvalHash;
  return response;
}
async function previewPricing(req: Request) { return rememberPreview(await previewPricingRoute(req)); }
async function previewChunk(req: Request) { return rememberPreview(await previewChunkRoute(req)); }
async function applyDisplayedPreview(req: Request) {
  const body = await req.json();
  return applyPricingRoute(new Request(req.url, {
    method: 'POST', headers: req.headers,
    body: JSON.stringify({ ...body, approvalHash: displayedApprovalHash }),
  }));
}

async function seedQuoteCase(id: string, orderStatus?: string, actualQuantity = 2) {
  // Synthetic, explicitly confirmed brand policy; catalogue is distinct from the legacy market price.
  await prisma.brand.upsert({ where: { name: 'CST' }, create: { id: 'brand_cst', name: 'CST', defaultDiscountRate: 1 }, update: {} });
  await prisma.product.update({ where: { id: 'product_1' }, data: { originalPrice: 100 } });
  const inquiry = await prisma.inquiry.create({ data: { id: `inquiry_${id}`, userId: 'admin_test_id', name: '测试客户', email: 'admin@test.com', phone: 'test', institution: 'test', subtotal: 200, status: orderStatus ? 'closed' : 'quote_sent' } });
  const inquiryItem = await prisma.inquiryItem.create({ data: { inquiryId: inquiry.id, position: 0, productId: 'product_1', catalogNumber: 'CAT-1', name: '测试抗体', unitPrice: 100, quantity: 2, lineTotal: 200, metadata: JSON.stringify({ brand: 'CST' }) } });
  const quote = await prisma.quote.create({ data: { id: `quote_${id}`, inquiryId: inquiry.id, version: 1, status: orderStatus ? 'accepted' : 'sent', subtotal: 200, items: { create: [{ inquiryItemId: inquiryItem.id, position: 0, productId: 'product_1', catalogNumber: 'CAT-1', name: '测试抗体', quantity: 2, orderedQty: orderStatus ? actualQuantity : 0, unitPrice: 100, lineTotal: 200, metadata: JSON.stringify({ brand: 'CST' }) }] } }, include: { items: true } });
  const order = orderStatus ? await prisma.order.create({ data: { id: `order_${id}`, inquiryId: inquiry.id, email: inquiry.email, customerId: inquiry.userId, subtotal: actualQuantity * 100, total: actualQuantity * 100, status: orderStatus, orderItems: { create: [{ position: 0, productId: 'product_1', catalogNumber: 'CAT-1', name: '测试抗体', unitPrice: 100, quantity: actualQuantity, metadata: JSON.stringify({ brand: 'CST' }) }] } }, include: { orderItems: true } }) : null;
  if (order) await prisma.quoteConfirmation.create({ data: { quoteId: quote.id, email: inquiry.email, userId: inquiry.userId, action: 'accept', details: JSON.stringify({ orderId: order.id, items: [{ quoteItemId: quote.items[0].id, orderedQuantity: actualQuantity }] }) } });
  return { inquiry, quote, order };
}

async function prepareOrderRepricing(fixture: Awaited<ReturnType<typeof seedQuoteCase>>) {
  await previewPricing(catalogRequest('/preview', {}));
  expect((await applyDisplayedPreview(catalogRequest('/apply', {}))).status).toBe(200);
  const draft = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: true } });
  const metadata = JSON.parse(draft.items[0].metadata!);
  return { quoteId: draft.id, orderId: fixture.order!.id, proposalHash: metadata.repricingProposalHash as string,
    confirmedTotal: metadata.repricingProposedTotal as number, responseChannel: '测试邮件', responseReference: 'fixture customer response' };
}

async function financePreview(body: { quoteId: string; orderId: string; proposalHash: string }, inquiryId: string) {
  const query = new URLSearchParams({ quoteId: body.quoteId, orderId: body.orderId, proposalHash: body.proposalHash });
  return previewRepricingFinance(new Request(`http://localhost/finance?${query}`), { params: Promise.resolve({ id: inquiryId }) });
}

function seedProduct(overrides: {
  id: string;
  catalogNumber: string;
  price: number;
  pricingMode?: string;
  costPrice?: number;
  minimumSalePrice?: number | null;
  promotionalPrice?: number | null;
  brand?: string;
}) {
  getTestDb().prepare(`
    INSERT INTO Product (
      id, catalogNumber, name, brand, price, pricingMode, originalPrice, category, subcategory,
      applications, reactivity, inStock, promotion, hazardous, costPrice, minimumSalePrice,
      promotionalPrice, pmids, stockQuantity, createdAt, updatedAt
    ) VALUES (
      ?, ?, '测试抗体', ?, ?, ?, 120, '抗体', '一抗',
      '[]', '[]', 1, 0, 0, ?, ?,
      ?, '[]', -1, datetime('now'), datetime('now')
    )
  `).run(
    overrides.id,
    overrides.catalogNumber,
    overrides.brand ?? 'CST',
    overrides.price,
    overrides.pricingMode ?? 'fixed',
    overrides.costPrice ?? 40,
    overrides.minimumSalePrice ?? null,
    overrides.promotionalPrice ?? null,
  );
}

function request(path: string, body: Record<string, unknown>) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brand: 'CST',
      scope: 'category',
      category: '抗体',
      priceField: 'price',
      mode: 'percent',
      direction: 'increase',
      amount: 10,
      includeVariants: false,
      reason: '供应商调价',
      ...body,
    }),
  });
}

function catalogRequest(path: string, body: Record<string, unknown>) {
  return request(path, { priceField: 'originalPrice', ...body });
}

describe('admin pricing adjustment routes', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    displayedApprovalHash = undefined;
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedProduct({ id: 'product_1', catalogNumber: 'CAT-1', price: 100, costPrice: 40, minimumSalePrice: 90 });
    seedProduct({ id: 'product_2', catalogNumber: 'CAT-2', price: 50, pricingMode: 'inquiry', costPrice: 20 });
    authMock.mockResolvedValue({ user: { id: 'admin_test_id', email: 'admin@test.com', role: 'admin', sessionId: 'session-1' } });
    mfaRequiredMock.mockResolvedValue(false);
    adminMfaRequiredMock.mockReturnValue(false);
    phase1EnabledMock.mockReturnValue(false);
    readTemplateMock.mockReturnValue({
      fileName: '商品集中调价导入模板.xlsx',
      buffer: Buffer.from('xlsx-bytes'),
    });
  });

  it('requires the exact displayed approval and rejects a missing or tampered hash', async () => {
    await previewPricing(request('/preview', {}));
    for (const approvalHash of [undefined, '0'.repeat(64)]) {
      const response = await applyPricingRoute(request('/apply', { approvalHash }));
      expect(response.status).toBe(409);
    }
    expect(getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_1')).toEqual({ price: 100 });
    expect(getTestDb().prepare('SELECT COUNT(*) AS n FROM ProductPrice').get()).toEqual({ n: 0 });
  });

  it('does not execute a newer preview with an older approval', async () => {
    const first = await previewPricing(request('/preview', {}));
    const oldHash = (await first.json()).preview.approvalHash;
    getTestDb().prepare('UPDATE Product SET price = 105 WHERE id = ?').run('product_1');
    await previewPricing(request('/preview', {}));
    expect(displayedApprovalHash).not.toBe(oldHash);
    const response = await applyPricingRoute(request('/apply', { approvalHash: oldHash }));
    expect(response.status).toBe(409);
    expect(getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_1')).toEqual({ price: 105 });
  });

  it('rejects drift after preview without partially applying other rows', async () => {
    getTestDb().prepare("UPDATE Product SET pricingMode = 'fixed' WHERE id = 'product_2'").run();
    await previewPricing(request('/preview', {}));
    getTestDb().prepare('UPDATE Product SET price = 55 WHERE id = ?').run('product_2');
    const response = await applyDisplayedPreview(request('/apply', {}));
    expect(response.status).toBe(409);
    expect(getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_1')).toEqual({ price: 100 });
    expect(getTestDb().prepare('SELECT COUNT(*) AS n FROM ProductPrice').get()).toEqual({ n: 0 });
  });

  it('cannot change the approval reason while reusing the preview', async () => {
    await previewPricing(request('/preview', {}));
    const response = await applyDisplayedPreview(request('/apply', { reason: 'different authorization content' }));
    expect(response.status).toBe(409);
    expect(getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_1')).toEqual({ price: 100 });
  });

  it('recalculates a sent quote into the existing review flow while preserving merchant-accepted prices', async () => {
    const open = await seedQuoteCase('open');
    const locked = await seedQuoteCase('locked', 'confirmed');
    await previewPricing(catalogRequest('/preview', {}));
    const response = await applyDisplayedPreview(catalogRequest('/apply', {}));
    expect(response.status).toBe(200);
    const result = (await response.json()).result;
    expect(result.repricedQuotes).toHaveLength(1);
    const draft = await prisma.quote.findFirstOrThrow({ where: { inquiryId: open.inquiry.id }, orderBy: { version: 'desc' }, include: { items: true } });
    expect(draft).toMatchObject({ version: 2, status: 'draft', subtotal: 220 });
    expect(draft.items[0]).toMatchObject({ unitPrice: 110, quantity: 2 });
    expect((await prisma.inquiry.findUniqueOrThrow({ where: { id: open.inquiry.id } })).hasUnresolvedPricing).toBe(true);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: locked.order!.id } })).total).toBe(200);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: locked.quote.id } })).status).toBe('accepted');
  });

  it('uses the actual pending order quantity and resumes the same order after recorded customer confirmation', async () => {
    const fixture = await seedQuoteCase('pending', 'pending', 3);
    await previewPricing(catalogRequest('/preview', {}));
    expect((await applyDisplayedPreview(catalogRequest('/apply', {}))).status).toBe(200);
    const draft = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: true } });
    expect(draft).toMatchObject({ status: 'draft', subtotal: 330 });
    expect(draft.items[0]).toMatchObject({ quantity: 3, unitPrice: 110 });
    await expect(prisma.$transaction((tx) => assertOrderPricingResolved(tx, fixture.order!.id))).rejects.toThrow('QUOTE_REPRICE_REQUIRED');
    const proposal = JSON.parse(draft.items[0].metadata!);
    const payload = { quoteId: draft.id, orderId: fixture.order!.id, proposalHash: proposal.repricingProposalHash, responseChannel: '测试邮件', responseReference: 'fixture-only customer response' };
    const response = await recordRepricing(request('/repricing', payload), { params: Promise.resolve({ id: fixture.inquiry.id }) });
    expect(response.status).toBe(200);
    const updated = await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id }, include: { orderItems: true } });
    expect(updated).toMatchObject({ status: 'pending', total: 330 });
    expect(updated.orderItems[0].id).toBe(fixture.order!.orderItems[0].id);
    expect(await prisma.order.count()).toBe(1);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: fixture.quote.id } })).status).toBe('accepted');
    await prisma.$transaction((tx) => assertOrderPricingResolved(tx, fixture.order!.id));
    const replay = await recordRepricing(request('/repricing', payload), { params: Promise.resolve({ id: fixture.inquiry.id }) });
    expect(replay.status).toBe(200);
    expect((await replay.json()).result.replayed).toBe(true);
    expect(await prisma.orderEvent.count({ where: { type: 'catalog_repricing_resolved' } })).toBe(1);
  });

  it('creates only one successor on a second catalogue change and rejects the superseded customer confirmation', async () => {
    const fixture = await seedQuoteCase('twice', 'pending');
    await previewPricing(catalogRequest('/preview', {}));
    await applyDisplayedPreview(catalogRequest('/apply', {}));
    const first = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: true } });
    await previewPricing(catalogRequest('/preview', {}));
    const second = await applyDisplayedPreview(catalogRequest('/apply', {}));
    expect(second.status).toBe(200);
    expect((await second.json()).result.repricedQuotes).toHaveLength(1);
    expect(await prisma.quote.count({ where: { inquiryId: fixture.inquiry.id } })).toBe(3);
    const latest = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' } });
    expect(latest).toMatchObject({ version: 3, subtotal: 242 });
    const response = await recordRepricing(request('/repricing', { quoteId: first.id, orderId: fixture.order!.id, proposalHash: JSON.parse(first.items[0].metadata!).repricingProposalHash, responseChannel: '测试邮件', responseReference: 'stale fixture response' }), { params: Promise.resolve({ id: fixture.inquiry.id }) });
    expect(response.status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id } })).total).toBe(200);
  });

  it('binds quote contents as well as IDs to the price-change preview', async () => {
    const fixture = await seedQuoteCase('drift');
    await previewPricing(catalogRequest('/preview', {}));
    await prisma.quoteItem.update({ where: { id: fixture.quote.items[0].id }, data: { quantity: 4 } });
    expect((await applyDisplayedPreview(catalogRequest('/apply', {}))).status).toBe(409);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: 'product_1' } })).price).toBe(100);
    expect(await prisma.quote.count()).toBe(1);
  });

  it('keeps paid pending orders and their payment facts unchanged for financial reconciliation', async () => {
    const fixture = await seedQuoteCase('paid', 'pending');
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { paidAt: new Date('2026-11-15T00:00:00Z') } });
    const payment = await prisma.paymentAttempt.create({ data: { orderId: fixture.order!.id, provider: 'alipay', outTradeNo: 'original-paid', amount: 200, status: 'paid', paidAt: new Date('2026-11-15T00:00:00Z') } });
    const body = await prepareOrderRepricing(fixture);
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await recordRepricing(request('/repricing', body), context);
      expect(response.status).toBe(202);
      expect((await response.json()).result).toMatchObject({ stage: 'awaiting_finance_review', ownerId: 'admin_test_id', originalTotal: 200, proposedTotal: 220 });
    }
    expect(await prisma.quoteConfirmation.count({ where: { quoteId: body.quoteId, action: 'customer_repricing_recorded_by_staff' } })).toBe(1);
    const preview = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(preview).toMatchObject({ blocker: 'REPRICING_CASH_RESULT_REQUIRED', customerResponse: { responseReference: body.responseReference } });
    const approve = await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: preview.financeApprovalHash, preserveOriginalAdjustments: true, reason: 'fixture review' }), context);
    expect(approve.status).toBe(409);
    expect((await approve.json()).code).toBe('REPRICING_CASH_RESULT_REQUIRED');
    expect(await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(payment);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id } })).total).toBe(200);
    await expect(prisma.$transaction((tx) => assertOrderPricingResolved(tx, fixture.order!.id))).rejects.toThrow('QUOTE_REPRICE_REQUIRED');
  });

  it('requires the complete customer-approved total and finance review before preserving existing adjustments', async () => {
    const fixture = await seedQuoteCase('adjustments', 'pending');
    const adjustment = await prisma.orderAdjustment.create({ data: { orderId: fixture.order!.id, type: 'shipping', label: '原运费', amount: 12 } });
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { adjustmentTotal: 12, total: 212 } });
    const body = await prepareOrderRepricing(fixture);
    expect(body.confirmedTotal).toBe(232);
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    const incomplete = await recordRepricing(request('/repricing', { ...body, confirmedTotal: 220 }), context);
    expect(incomplete.status).toBe(409);
    expect((await incomplete.json()).code).toBe('REPRICING_TOTAL_CONFIRMATION_REQUIRED');
    expect(await prisma.quoteConfirmation.count({ where: { action: 'customer_repricing_recorded_by_staff' } })).toBe(0);
    expect((await recordRepricing(request('/repricing', body), context)).status).toBe(202);
    const preview = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(preview).toMatchObject({ blocker: null, originalTotal: 212, amounts: { subtotal: 220, adjustmentTotal: 12, total: 232 } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id } })).total).toBe(212);
    for (let attempt = 0; attempt < 2; attempt++) {
      const approved = await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: preview.financeApprovalHash, preserveOriginalAdjustments: true, reason: '原运费仍适用，客户确认了完整金额' }), context);
      expect(approved.status).toBe(200);
      expect((await approved.json()).result).toMatchObject({ stage: 'applied', total: 232, financeApprovalHash: preview.financeApprovalHash });
    }
    const order = await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id }, include: { orderItems: true, adjustments: true } });
    expect(order).toMatchObject({ status: 'pending', total: 232, adjustmentTotal: 12 });
    expect(order.orderItems[0]).toMatchObject({ id: fixture.order!.orderItems[0].id, unitPrice: 110 });
    expect(order.adjustments).toEqual([adjustment]);
    expect(await prisma.quoteConfirmation.count({ where: { action: 'catalog_repricing_finance_approved' } })).toBe(1);
    await expect(prisma.$transaction((tx) => assertOrderPricingResolved(tx, order.id))).resolves.toBeUndefined();
  });

  it('preserves the original applied points and ledger without another deduction', async () => {
    const fixture = await seedQuoteCase('points', 'pending');
    await prisma.orderAdjustment.create({ data: { orderId: fixture.order!.id, type: 'points_redeem', label: '个人积分抵扣', amount: -10 } });
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { adjustmentTotal: -10, total: 190, pointsPersonal: 10, pointsDiscount: 10, pointsApplied: true } });
    const log = await prisma.pointsLog.create({ data: { userId: 'admin_test_id', delta: -10, type: 'order_redeem', reason: 'fixture original redemption', relatedId: fixture.order!.id } });
    const originalUser = await prisma.user.findUniqueOrThrow({ where: { id: 'admin_test_id' } });
    const body = await prepareOrderRepricing(fixture);
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    expect((await recordRepricing(request('/repricing', body), context)).status).toBe(202);
    const preview = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(preview.blocker).toBeNull();
    expect((await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: preview.financeApprovalHash, preserveOriginalAdjustments: true, reason: '保留原积分抵扣' }), context)).status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id } }))).toMatchObject({ total: 210, pointsPersonal: 10, pointsApplied: true, pointsRefundedPersonal: 0 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'admin_test_id' } })).points).toBe(originalUser.points);
    expect(await prisma.pointsLog.findMany({ where: { relatedId: fixture.order!.id } })).toEqual([log]);
  });

  it('requires a fresh finance preview after a payment closes and retains the original customer reply', async () => {
    const fixture = await seedQuoteCase('payment_callback', 'pending');
    const attempt = await prisma.paymentAttempt.create({ data: { orderId: fixture.order!.id, provider: 'alipay', outTradeNo: 'active-payment', amount: 200, status: 'created' } });
    const body = await prepareOrderRepricing(fixture);
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    expect((await recordRepricing(request('/repricing', body), context)).status).toBe(202);
    const oldPreview = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(oldPreview.blocker).toBe('REPRICING_PAYMENT_RECONCILIATION_REQUIRED');
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { status: 'TRADE_CLOSED', notifiedAt: new Date() } });
    const stale = await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: oldPreview.financeApprovalHash, preserveOriginalAdjustments: true, reason: 'stale fixture review' }), context);
    expect(stale.status).toBe(409);
    const fresh = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(fresh.financeApprovalHash).not.toBe(oldPreview.financeApprovalHash);
    expect(fresh).toMatchObject({ blocker: null, customerResponse: { responseReference: body.responseReference } });
    expect((await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: fresh.financeApprovalHash, preserveOriginalAdjustments: true, reason: '原交易已关闭，尚无收款' }), context)).status).toBe(200);
    expect(await prisma.quoteConfirmation.count({ where: { action: 'customer_repricing_recorded_by_staff' } })).toBe(1);
    expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe('TRADE_CLOSED');
  });

  it('rejects changed financial terms and cannot be approved by a model-claimed finance role', async () => {
    const fixture = await seedQuoteCase('finance_permissions', 'pending');
    const adjustment = await prisma.orderAdjustment.create({ data: { orderId: fixture.order!.id, type: 'shipping', label: '运费', amount: 12 } });
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { total: 212, adjustmentTotal: 12 } });
    const body = await prepareOrderRepricing(fixture);
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    const noResponse = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect((await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: noResponse.financeApprovalHash, preserveOriginalAdjustments: true, reason: 'no customer reply' }), context)).status).toBe(409);
    await recordRepricing(request('/repricing', body), context);
    const preview = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    await prisma.adminRole.update({ where: { id: 'role_super_admin' }, data: { key: 'catalog_test_staff' } });
    await prisma.adminRolePermission.deleteMany({ where: { roleId: 'role_super_admin', permissionId: 'perm_finance_write' } });
    const denied = await approveRepricingFinance(request('/finance', { ...body, role: 'finance', financeApprovalHash: preview.financeApprovalHash, preserveOriginalAdjustments: true, reason: 'model claims finance role' }), context);
    expect(denied.status).toBe(403);
    expect((await denied.json()).requiredPermission).toBe('finance.write');
    await prisma.adminRole.update({ where: { id: 'role_super_admin' }, data: { key: 'super_admin' } });
    await prisma.orderAdjustment.update({ where: { id: adjustment.id }, data: { amount: 15 } });
    const changed = await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: preview.financeApprovalHash, preserveOriginalAdjustments: true, reason: 'old approval' }), context);
    expect(changed.status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id } })).total).toBe(212);
  });

  it('keeps points with an unresolved deduction or refund waiting without treating the customer reply as completion', async () => {
    const fixture = await seedQuoteCase('unsettled_points', 'pending');
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { pointsPersonal: 10, pointsApplied: false } });
    const body = await prepareOrderRepricing(fixture);
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    expect((await recordRepricing(request('/repricing', body), context)).status).toBe(202);
    let preview = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(preview.blocker).toBe('REPRICING_POINTS_RECONCILIATION_REQUIRED');
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { pointsApplied: true, pointsRefundedPersonal: 1 } });
    preview = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(preview.blocker).toBe('REPRICING_POINTS_RECONCILIATION_REQUIRED');
    expect((await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: preview.financeApprovalHash, preserveOriginalAdjustments: true, reason: 'fixture unresolved points' }), context)).status).toBe(409);
    expect(await prisma.quoteConfirmation.count({ where: { action: 'catalog_repricing_finance_approved' } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id } })).total).toBe(200);
  });

  it.each(['missing', 'wrong_type', 'wrong_owner', 'under_deducted', 'unrecorded_refund'])('rejects pointsApplied when the original points ledger is %s', async (condition) => {
    const fixture = await seedQuoteCase(`points_${condition}`, 'pending');
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { pointsPersonal: 10, pointsDiscount: 10, pointsApplied: true, adjustmentTotal: -10, total: 190 } });
    await prisma.orderAdjustment.create({ data: { orderId: fixture.order!.id, type: 'points_redeem', label: '原积分抵扣', amount: -10 } });
    if (condition === 'wrong_owner') seedAdmin(getTestDb(), 'other_customer', 'other@example.com');
    if (condition !== 'missing') await prisma.pointsLog.create({ data: {
      userId: condition === 'wrong_owner' ? 'other_customer' : 'admin_test_id', relatedId: fixture.order!.id,
      type: condition === 'wrong_type' ? 'redeem' : 'order_redeem', delta: condition === 'under_deducted' ? -8 : -10,
    } });
    if (condition === 'unrecorded_refund') await prisma.pointsLog.create({ data: {
      userId: 'admin_test_id', relatedId: fixture.order!.id, type: 'order_redeem_refund', delta: 2, reason: '已执行的退还',
    } });
    const body = await prepareOrderRepricing(fixture);
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    expect((await recordRepricing(request('/repricing', body), context)).status).toBe(202);
    const preview = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(preview.blocker).toBe('REPRICING_POINTS_RECONCILIATION_REQUIRED');
    const approved = await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: preview.financeApprovalHash, preserveOriginalAdjustments: true, reason: 'inconsistent points' }), context);
    expect(approved.status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id } })).total).toBe(190);
  });

  it('invalidates finance approval when only the group points ledger changes', async () => {
    const fixture = await seedQuoteCase('group_points_drift', 'pending');
    const group = await prisma.researchGroup.create({ data: { name: '测试课题组', status: 'approved', points: 90 } });
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { pointsGroup: 10, pointsGroupId: group.id, pointsDiscount: 10, pointsApplied: true, adjustmentTotal: -10, total: 190 } });
    await prisma.orderAdjustment.create({ data: { orderId: fixture.order!.id, type: 'points_redeem', label: '原课题组积分抵扣', amount: -10 } });
    await prisma.groupPointsLog.create({ data: { groupId: group.id, actorUserId: 'admin_test_id', relatedId: fixture.order!.id, type: 'order_redeem', delta: -10 } });
    const body = await prepareOrderRepricing(fixture);
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    await recordRepricing(request('/repricing', body), context);
    const previous = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(previous).toMatchObject({ blocker: null, pointsEvidence: { held: { personal: 0, group: 10 } } });
    await prisma.groupPointsLog.create({ data: { groupId: group.id, actorUserId: 'admin_test_id', relatedId: fixture.order!.id, type: 'order_redeem_refund', delta: 1, reason: '真实退还记录' } });
    const approved = await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: previous.financeApprovalHash, preserveOriginalAdjustments: true, reason: 'old ledger' }), context);
    expect(approved.status).toBe(409);
    const latest = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(latest.financeApprovalHash).not.toBe(previous.financeApprovalHash);
    expect(latest.blocker).toBe('REPRICING_POINTS_RECONCILIATION_REQUIRED');
    expect((await prisma.researchGroup.findUniqueOrThrow({ where: { id: group.id } })).points).toBe(90);
  });

  it.each([{ condition: 'zero intent with a real deduction', points: 0, discount: 0 },
    { condition: 'deduction worth less than the recorded discount', points: 10, discount: 100 }])('rejects $condition', async ({ condition, points, discount }) => {
    const fixture = await seedQuoteCase(condition, 'pending');
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { pointsPersonal: points, pointsDiscount: discount, pointsApplied: true, adjustmentTotal: -discount, total: 200 - discount } });
    if (discount) await prisma.orderAdjustment.create({ data: { orderId: fixture.order!.id, type: 'points_redeem', label: '原积分抵扣', amount: -discount } });
    const original = await prisma.pointsLog.create({ data: { userId: 'admin_test_id', relatedId: fixture.order!.id, type: 'order_redeem', delta: -10 } });
    const body = await prepareOrderRepricing(fixture);
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    expect((await recordRepricing(request('/repricing', body), context)).status).toBe(202);
    const preview = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(preview).toMatchObject({ blocker: 'REPRICING_POINTS_RECONCILIATION_REQUIRED', pointsEvidence: { recordedNet: { personal: 10, group: 0 } } });
    expect((await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: preview.financeApprovalHash, preserveOriginalAdjustments: true, reason: 'inconsistent original points' }), context)).status).toBe(409);
    expect(await prisma.pointsLog.findMany({ where: { relatedId: fixture.order!.id } })).toEqual([original]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id } })).total).toBe(200 - discount);
  });

  it.each(['pointsDiscount', 'pointsRefundedPersonal', 'pointsRefundedGroup', 'pointsRefundedCash'] as const)('cannot bypass finance through the customer-reply route when only %s is recorded', async (field) => {
    const fixture = await seedQuoteCase(`reply_bypass_${field}`, 'pending');
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { [field]: 10 } });
    const body = await prepareOrderRepricing(fixture);
    await prisma.adminRole.update({ where: { id: 'role_super_admin' }, data: { key: 'order_and_inquiry_staff' } });
    await prisma.adminRolePermission.deleteMany({ where: { roleId: 'role_super_admin' } });
    await prisma.adminRolePermission.createMany({ data: ['inquiries.read', 'inquiries.write', 'orders.read', 'orders.write'].map((key) => ({ roleId: 'role_super_admin', permissionId: `perm_${key.replace('.', '_')}` })) });
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    const recorded = await recordRepricing(request('/repricing', body), context);
    expect(recorded.status).toBe(202);
    expect((await recorded.json()).result.stage).toBe('awaiting_finance_review');
    expect((await financePreview(body, fixture.inquiry.id)).status).toBe(403);
    const original = await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id }, include: { orderItems: true } });
    expect(original.total).toBe(200);
    expect(original.orderItems[0].unitPrice).toBe(100);
    expect(await prisma.orderEvent.count({ where: { orderId: original.id, type: 'catalog_repricing_resolved' } })).toBe(0);
    expect(await prisma.quoteConfirmation.count({ where: { quoteId: body.quoteId, action: 'customer_repricing_recorded_by_staff' } })).toBe(1);
    await prisma.adminRole.update({ where: { id: 'role_super_admin' }, data: { key: 'super_admin' } });
    const preview = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(preview.blocker).toBe('REPRICING_POINTS_RECONCILIATION_REQUIRED');
    expect((await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: preview.financeApprovalHash, preserveOriginalAdjustments: true, reason: 'unresolved original amounts' }), context)).status).toBe(409);
  });

  it('compares unchanged repriced totals against the actual payment rather than the edited order total', async () => {
    const fixture = await seedQuoteCase('actual_receipt', 'pending', 1);
    await prisma.product.update({ where: { id: 'product_2' }, data: { price: 100, originalPrice: 100, pricingMode: 'fixed' } });
    await prisma.quoteItem.update({ where: { id: fixture.quote.items[0].id }, data: { quantity: 1, lineTotal: 100 } });
    const secondLine = await prisma.quoteItem.create({ data: { quoteId: fixture.quote.id, position: 1, productId: 'product_2', catalogNumber: 'CAT-2', name: '第二件测试商品', unitPrice: 100, quantity: 1, orderedQty: 1, lineTotal: 100, metadata: JSON.stringify({ brand: 'CST' }) } });
    await prisma.orderItem.create({ data: { orderId: fixture.order!.id, position: 1, productId: 'product_2', catalogNumber: 'CAT-2', name: '第二件测试商品', unitPrice: 100, quantity: 1, metadata: JSON.stringify({ brand: 'CST' }) } });
    await prisma.quoteConfirmation.updateMany({ where: { quoteId: fixture.quote.id, action: 'accept' }, data: { details: JSON.stringify({ orderId: fixture.order!.id, items: [{ quoteItemId: fixture.quote.items[0].id, orderedQuantity: 1 }, { quoteItemId: secondLine.id, orderedQuantity: 1 }] }) } });
    const paidAt = new Date('2026-11-15T00:00:00Z');
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { subtotal: 200, adjustmentTotal: 12, total: 212, paymentMethod: 'alipay', paidAt } });
    await prisma.orderAdjustment.create({ data: { orderId: fixture.order!.id, type: 'shipping', label: '收款之后增加的运费', amount: 12 } });
    const payment = await prisma.paymentAttempt.create({ data: { orderId: fixture.order!.id, provider: 'alipay', outTradeNo: 'original-200', tradeNo: 'verified-trade-200', amount: 200, status: 'paid', paidAt } });
    const change = { scope: 'catalog', mode: 'file', catalogItems: [{ catalogNumber: 'CAT-1', originalPrice: 110 }, { catalogNumber: 'CAT-2', originalPrice: 90 }] };
    await previewPricing(catalogRequest('/preview', change));
    expect((await applyDisplayedPreview(catalogRequest('/apply', change))).status).toBe(200);
    const draft = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: true } });
    const body = { quoteId: draft.id, orderId: fixture.order!.id, proposalHash: JSON.parse(draft.items[0].metadata!).repricingProposalHash, confirmedTotal: 212, responseChannel: '测试邮件', responseReference: '客户确认完整212元' };
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    await recordRepricing(request('/repricing', body), context);
    const preview = (await (await financePreview(body, fixture.inquiry.id)).json()).preview;
    expect(preview).toMatchObject({ originalTotal: 212, amounts: { total: 212 }, verifiedPaidAmount: 200, blocker: 'REPRICING_CASH_RESULT_REQUIRED' });
    const approved = await approveRepricingFinance(request('/finance', { ...body, financeApprovalHash: preview.financeApprovalHash, preserveOriginalAdjustments: true, reason: '仍少收12元' }), context);
    expect(approved.status).toBe(409);
    expect(await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: payment.id } })).toEqual(payment);
    expect(await prisma.orderEvent.count({ where: { orderId: fixture.order!.id, type: 'catalog_repricing_resolved' } })).toBe(0);
  });

  it('allows the standard finance role to discover and complete its review through the original order detail', async () => {
    const fixture = await seedQuoteCase('finance_entry', 'pending');
    await prisma.orderAdjustment.create({ data: { orderId: fixture.order!.id, type: 'shipping', label: '运费', amount: 12 } });
    await prisma.order.update({ where: { id: fixture.order!.id }, data: { total: 212, adjustmentTotal: 12 } });
    const body = await prepareOrderRepricing(fixture);
    await recordRepricing(request('/repricing', body), { params: Promise.resolve({ id: fixture.inquiry.id }) });
    await prisma.adminRole.update({ where: { id: 'role_super_admin' }, data: { key: 'finance_staff' } });
    await prisma.adminRolePermission.deleteMany({ where: { roleId: 'role_super_admin' } });
    await prisma.adminRolePermission.createMany({ data: ADMIN_ROLE_DEFINITIONS.finance_staff.permissions.map((key) => ({ roleId: 'role_super_admin', permissionId: `perm_${key.replace('.', '_')}` })) });
    expect((await inquiryList(new NextRequest('http://localhost/api/inquiries'))).status).toBe(403);
    const detail = await adminOrderDetail(new NextRequest('http://localhost/api/admin/orders/id'), { params: Promise.resolve({ id: fixture.order!.id }) });
    expect(detail.status).toBe(200);
    const identity = (await detail.json()).order.pendingCatalogRepricing;
    expect(identity).toEqual({ inquiryId: fixture.inquiry.id, quoteId: body.quoteId, orderId: body.orderId, proposalHash: body.proposalHash });
    const preview = (await (await financePreview(identity, identity.inquiryId)).json()).preview;
    const approved = await approveRepricingFinance(request('/finance', { ...identity, financeApprovalHash: preview.financeApprovalHash, preserveOriginalAdjustments: true, reason: '财务通过订单详情完成原费用核对' }), { params: Promise.resolve({ id: identity.inquiryId }) });
    expect(approved.status).toBe(200);
    const completed = await adminOrderDetail(new NextRequest('http://localhost/api/admin/orders/id'), { params: Promise.resolve({ id: fixture.order!.id }) });
    expect((await completed.json()).order).toMatchObject({ total: 232, status: 'pending', pendingCatalogRepricing: null });
  });

  it('exposes the complete immutable change list beyond the twenty sample rows', async () => {
    for (let index = 3; index <= 25; index++) seedProduct({ id: `product_${index}`, catalogNumber: `CAT-${index}`, price: 100 });
    await previewPricing(request('/preview', {}));
    const hash = displayedApprovalHash;
    const details = await previewDetails(new Request(`http://localhost/details?approvalHash=${hash}`));
    expect(details.status).toBe(200);
    expect((await details.json()).total).toBe(24);
    getTestDb().prepare('UPDATE Product SET price = 101 WHERE id = ?').run('product_25');
    const frozen = await previewDetails(new Request(`http://localhost/details?approvalHash=${hash}`));
    expect((await frozen.json()).rows.find((row: { productId: string }) => row.productId === 'product_25')).toMatchObject({ before: 100, after: 110 });
    expect((await applyDisplayedPreview(request('/apply', {}))).status).toBe(409);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: 'product_1' } })).price).toBe(100);
  });

  it('blocks all three merchant-acceptance entrances until original-order repricing is resolved', async () => {
    const fixture = await seedQuoteCase('acceptance_guard', 'pending');
    await previewPricing(catalogRequest('/preview', {}));
    expect((await applyDisplayedPreview(catalogRequest('/apply', {}))).status).toBe(200);
    for (const handler of [adminAcceptOrder, acceptOrder]) {
      const response = await handler(new NextRequest(`http://localhost/order/${fixture.order!.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'confirmed' }) }), { params: Promise.resolve({ id: fixture.order!.id }) });
      expect(response.status).toBe(409);
    }
    const response = await orderQuote(new NextRequest('http://localhost/order/quote', { method: 'POST' }), { params: Promise.resolve({ id: fixture.order!.id }) });
    expect(response.status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id } })).status).toBe('pending');
  });

  it('publishes exactly the recalculated quote that the administrator reviewed', async () => {
    const fixture = await seedQuoteCase('publish');
    await previewPricing(catalogRequest('/preview', {}));
    await applyDisplayedPreview(catalogRequest('/apply', {}));
    const draft = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: { orderBy: { position: 'asc' } } } });
    const response = await publishQuote(new NextRequest('http://localhost/inquiry/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalogQuoteId: draft.id, catalogQuoteHash: quoteContentHash(draft) }) }), { params: Promise.resolve({ id: fixture.inquiry.id }) });
    expect(response.status).toBe(200);
    const sent = (await response.json()).quote;
    expect(sent).toMatchObject({ status: 'sent', subtotal: 220 });
    expect(sent.items[0]).toMatchObject({ price: 110, quantity: 2 });
    expect((await prisma.inquiry.findUniqueOrThrow({ where: { id: fixture.inquiry.id } })).hasUnresolvedPricing).toBe(false);
  });

  it('invalidates the old proposal when the catalogue returns to the original order price', async () => {
    const fixture = await seedQuoteCase('return_price', 'pending');
    await previewPricing(catalogRequest('/preview', {})); await applyDisplayedPreview(catalogRequest('/apply', {}));
    const first = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: true } });
    await previewPricing(catalogRequest('/preview', { mode: 'set', amount: 100 }));
    expect((await applyDisplayedPreview(catalogRequest('/apply', { mode: 'set', amount: 100 }))).status).toBe(200);
    const latest = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: true } });
    expect(latest).toMatchObject({ version: 3, subtotal: 200 });
    const stale = await recordRepricing(request('/repricing', { quoteId: first.id, orderId: fixture.order!.id, proposalHash: JSON.parse(first.items[0].metadata!).repricingProposalHash, responseChannel: '测试邮件', responseReference: 'outdated response' }), { params: Promise.resolve({ id: fixture.inquiry.id }) });
    expect(stale.status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id } })).total).toBe(200);
  });

  it.each(['manual cancellation', 'automatic closure'])('continues remaining quote lines after %s of a pending order', async (closure) => {
    const fixture = await seedQuoteCase(`close_${closure}`, 'pending', 1);
    await prisma.quote.update({ where: { id: fixture.quote.id }, data: { status: 'sent' } });
    await prisma.inquiry.update({ where: { id: fixture.inquiry.id }, data: { status: 'quote_sent' } });
    await previewPricing(catalogRequest('/preview', {})); await applyDisplayedPreview(catalogRequest('/apply', {}));
    if (closure === 'manual cancellation') {
      const response = await adminAcceptOrder(new NextRequest('http://localhost/order', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'cancelled' }) }), { params: Promise.resolve({ id: fixture.order!.id }) });
      expect(response.status).toBe(200);
    } else {
      await prisma.order.update({ where: { id: fixture.order!.id }, data: { autoCloseAt: new Date('2026-01-01T00:00:00Z') } });
      expect((await closeStalePendingOrders(new Date('2026-11-16T00:00:00Z'))).closed).toBe(1);
    }
    const draft = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: { orderBy: { position: 'asc' } } } });
    expect(draft.items.filter((line) => line.available)).toHaveLength(1);
    const response = await publishQuote(new NextRequest('http://localhost/inquiry/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalogQuoteId: draft.id, catalogQuoteHash: quoteContentHash(draft) }) }), { params: Promise.resolve({ id: fixture.inquiry.id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).quote.items[0]).toMatchObject({ quantity: 1, price: 110 });
    expect(await prisma.order.count()).toBe(1);
  });

  it('preserves variant identity from the pricing snapshot through recalculation and publication', async () => {
    const fixture = await seedQuoteCase('snapshot_variant');
    await prisma.productVariant.create({ data: { id: 'variant_snapshot', productId: 'product_1', catalogNumber: 'CAT-1-10', spec: '10 ml', price: 100, originalPrice: 100 } });
    await prisma.quoteItem.update({ where: { id: fixture.quote.items[0].id }, data: { catalogNumber: 'CAT-1-10', pricingSnapshot: JSON.stringify({ variantId: 'variant_snapshot' }) } });
    const rule = { scope: 'catalog', catalogNumbers: ['CAT-1-10'], includeVariants: true };
    await previewPricing(catalogRequest('/preview', rule));
    expect((await applyDisplayedPreview(catalogRequest('/apply', rule))).status).toBe(200);
    const draft = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: { orderBy: { position: 'asc' } } } });
    expect(JSON.parse(draft.items[0].metadata!).variantId).toBe('variant_snapshot');
    const response = await publishQuote(new NextRequest('http://localhost/inquiry/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ catalogQuoteId: draft.id, catalogQuoteHash: quoteContentHash(draft) }) }), { params: Promise.resolve({ id: fixture.inquiry.id }) });
    expect(response.status).toBe(200);
    expect((await response.json()).quote.items[0]).toMatchObject({ catalogNumber: 'CAT-1-10', price: 110, variantId: 'variant_snapshot' });
  });

  it('previews public price changes and skips inquiry items', async () => {
    const response = await previewPricing(request('/api/admin/pricing-adjustments/preview', {}));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview.changeCount).toBe(1);
    expect(body.preview.skippedInquiryCount).toBe(1);
    expect(body.preview.samples[0]).toMatchObject({ catalogNumber: 'CAT-1', currentPrice: 100, nextPrice: 110 });
    expect(JSON.stringify(body)).not.toContain('costPrice');
  });

  it('confirms a specific shop-wide brand discount and continues all unaccepted quotes while preserving accepted orders', async () => {
    const open = await seedQuoteCase('brand_open');
    const pending = await seedQuoteCase('brand_pending', 'pending');
    const locked = await seedQuoteCase('brand_locked', 'confirmed');
    await prisma.brand.update({ where: { name: 'CST' }, data: { defaultDiscountRate: null } });
    const draft = { target: 'brand_default_discount', brandDefaultDiscountRate: 0.8, reason: '测试资料已核实' };
    const preview = await previewPricing(request('/preview', draft));
    expect(preview.status).toBe(200);
    const shown = (await preview.json()).preview;
    expect(shown).toMatchObject({ changeCount: 1, brandDefaultChange: { brandName: 'CST', beforeRate: null, afterRate: 0.8 },
      quoteImpact: { quoteCount: 2, pendingOrderCount: 1 } });
    const details = await previewDetails(new Request(`http://localhost/details?approvalHash=${shown.approvalHash}&offset=0`));
    expect((await details.json()).rows).toMatchObject([{ brand: 'CST', unit: 'rate', before: null, after: 0.8 }]);
    expect((await prisma.brand.findUniqueOrThrow({ where: { name: 'CST' } })).defaultDiscountRate).toBeNull();
    const applied = await applyDisplayedPreview(request('/apply', draft));
    expect(applied.status).toBe(200);
    expect((await applied.json()).result).toMatchObject({ updatedCount: 1, approvalHash: shown.approvalHash });
    for (const fixture of [open, pending]) {
      const latest = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: true } });
      expect(latest).toMatchObject({ version: 2, status: 'draft', subtotal: 160 });
      expect(JSON.parse(latest.items[0].pricingSnapshot!).appliedSource).toBe('brand_default_discount');
    }
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pending.order!.id } })).total).toBe(200);
    await expect(assertOrderPricingResolved(prisma, pending.order!.id)).rejects.toThrow();
    expect(await prisma.order.findUniqueOrThrow({ where: { id: locked.order!.id }, include: { orderItems: true } })).toEqual(locked.order);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: locked.quote.id } })).version).toBe(1);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: 'product_1' } })).price).toBe(100);
    const repeated = await applyDisplayedPreview(request('/apply', draft));
    expect((await repeated.json()).result.updatedCount).toBe(0);
    expect(await prisma.quote.count()).toBe(5);
  });

  it.each(['request rate', 'brand record', 'customer conditions'])('rejects old brand approval after a change to %s', async (changed) => {
    await seedQuoteCase('brand_changed');
    const draft = { target: 'brand_default_discount', brandDefaultDiscountRate: 0.8, reason: '核实测试资料' };
    await previewPricing(request('/preview', draft));
    if (changed === 'brand record') await prisma.brand.update({ where: { name: 'CST' }, data: { defaultDiscountRate: 0.95 } });
    if (changed === 'customer conditions') await prisma.user.update({ where: { id: 'admin_test_id' }, data: { brandDiscounts: '{"CST":0.9}' } });
    const response = await applyDisplayedPreview(request('/apply', { ...draft, ...(changed === 'request rate' ? { brandDefaultDiscountRate: 0.7 } : {}) }));
    expect(response.status).toBe(409);
    expect((await prisma.brand.findUniqueOrThrow({ where: { name: 'CST' } })).defaultDiscountRate).toBe(changed === 'brand record' ? 0.95 : 1);
    expect(await prisma.quote.count()).toBe(1);
    expect(await prisma.backgroundTask.count({ where: { type: 'pricing.apply' } })).toBe(0);
  });

  it('matches a catalogue-only specification to its brand and excludes another brand with the same catalogue', async () => {
    const target = await seedQuoteCase('brand_variant');
    const other = await seedQuoteCase('other_brand_variant');
    await prisma.productVariant.create({ data: { id: 'brand_variant', productId: 'product_1', catalogNumber: 'SAME-VARIANT', spec: '2 ml', price: 900, originalPrice: 300 } });
    for (const [fixture, brand] of [[target, 'CST'], [other, 'Other']] as const) {
      await prisma.quoteItem.update({ where: { id: fixture.quote.items[0].id }, data: {
        productId: null, catalogNumber: 'SAME-VARIANT', unitPrice: 300, lineTotal: 600, metadata: JSON.stringify({ brand }),
      } });
    }
    const draft = { target: 'brand_default_discount', brandDefaultDiscountRate: 0.8, reason: '测试品牌折扣' };
    const shown = (await (await previewPricing(request('/preview', draft))).json()).preview;
    expect(shown.quoteImpact.quoteCount).toBe(1);
    const response = await applyDisplayedPreview(request('/apply', draft));
    expect(response.status).toBe(200);
    const latest = await prisma.quote.findFirstOrThrow({ where: { inquiryId: target.inquiry.id }, orderBy: { version: 'desc' }, include: { items: true } });
    expect(latest).toMatchObject({ version: 2, subtotal: 480 });
    expect(JSON.parse(latest.items[0].pricingSnapshot!).variantId).toBe('brand_variant');
    expect(latest.items[0].productId).toBe('product_1');
    const publish = (confirmWarnings = false) => publishQuote(new NextRequest('http://localhost/inquiry/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogQuoteId: latest.id, catalogQuoteHash: quoteContentHash(latest), confirmWarnings }),
    }), { params: Promise.resolve({ id: target.inquiry.id }) });
    const warning = await publish();
    expect(warning.status).toBe(409);
    expect((await warning.json()).code).toBe('COMMERCE_LINE_WARNINGS');
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: latest.id } })).status).toBe('draft');
    const published = await publish(true);
    expect(published.status).toBe(200);
    expect((await published.json()).quote).toMatchObject({ status: 'sent', subtotal: 480, items: [{ productId: 'product_1', variantId: 'brand_variant', price: 240 }] });
    expect((await prisma.quoteItem.findUniqueOrThrow({ where: { id: target.quote.items[0].id } })).productId).toBeNull();
    expect(await prisma.quote.count({ where: { inquiryId: other.inquiry.id } })).toBe(1);
  });

  it('rejects a brand preview if the underlying before value changes between its two reads', async () => {
    await seedQuoteCase('brand_read_race');
    const original = prisma.brand.findUnique.bind(prisma.brand);
    const spy = vi.spyOn(prisma.brand, 'findUnique').mockImplementationOnce((async (args: Parameters<typeof original>[0]) => {
      const previous = await original(args);
      await prisma.brand.update({ where: { name: 'CST' }, data: { defaultDiscountRate: 0.9 } });
      return previous;
    }) as unknown as typeof prisma.brand.findUnique);
    try {
      const response = await previewPricing(request('/preview', { target: 'brand_default_discount', brandDefaultDiscountRate: 0.7, reason: '测试并发变化' }));
      expect(response.status).toBe(409);
      expect((await response.json()).preview).toBeUndefined();
      expect((await prisma.brand.findUniqueOrThrow({ where: { name: 'CST' } })).defaultDiscountRate).toBe(0.9);
      expect(await prisma.quote.count()).toBe(1);
    } finally { spy.mockRestore(); }
  });

  it.each(['customer discount without brand default', 'same amount with different sources'])('never publishes old catalogue confirmation after %s', async (condition) => {
    const fixture = await seedQuoteCase('publish_sources');
    if (condition === 'customer discount without brand default') {
      await prisma.brand.update({ where: { name: 'CST' }, data: { defaultDiscountRate: null } });
      await prisma.user.update({ where: { id: 'admin_test_id' }, data: { brandDiscounts: '{"CST":0.8}' } });
    } else await prisma.brand.update({ where: { name: 'CST' }, data: { defaultDiscountRate: 0.8 } });
    await previewPricing(catalogRequest('/preview', {}));
    expect((await applyDisplayedPreview(catalogRequest('/apply', {}))).status).toBe(200);
    const draft = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: { orderBy: { position: 'asc' } } } });
    expect(draft.items[0].unitPrice).toBe(88);
    if (condition === 'customer discount without brand default') {
      await prisma.user.update({ where: { id: 'admin_test_id' }, data: { brandDiscounts: '{"CST":0.7}' } });
    } else {
      await prisma.brand.update({ where: { name: 'CST' }, data: { defaultDiscountRate: 0.4 } });
      await prisma.product.update({ where: { id: 'product_1' }, data: { originalPrice: 220 } });
    }
    const response = await publishQuote(new NextRequest('http://localhost/inquiry/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogQuoteId: draft.id, catalogQuoteHash: quoteContentHash(draft) }),
    }), { params: Promise.resolve({ id: fixture.inquiry.id }) });
    expect(response.status).toBe(409);
    expect(await prisma.quote.count({ where: { inquiryId: fixture.inquiry.id } })).toBe(2);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('draft');
    const refresh = await publishQuote(new NextRequest('http://localhost/inquiry/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshCatalogQuote: true, catalogQuoteId: draft.id, catalogQuoteHash: quoteContentHash(draft) }),
    }), { params: Promise.resolve({ id: fixture.inquiry.id }) });
    expect(refresh.status).toBe(200);
    expect((await refresh.json()).result).toMatchObject({ refreshed: true, status: 'draft' });
    const revised = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: { orderBy: { position: 'asc' } } } });
    expect(revised.version).toBe(3);
    expect(revised.items[0].unitPrice).toBe(condition === 'customer discount without brand default' ? 77 : 88);
    const sent = await publishQuote(new NextRequest('http://localhost/inquiry/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogQuoteId: revised.id, catalogQuoteHash: quoteContentHash(revised) }),
    }), { params: Promise.resolve({ id: fixture.inquiry.id }) });
    expect(sent.status).toBe(200);
    expect((await sent.json()).quote.status).toBe('sent');
  });

  it('refreshes a stale pending-order proposal in the same inquiry without reusing the old customer approval', async () => {
    const fixture = await seedQuoteCase('pending_policy_refresh', 'pending');
    const old = await prepareOrderRepricing(fixture);
    const context = { params: Promise.resolve({ id: fixture.inquiry.id }) };
    const previous = await prisma.quote.findUniqueOrThrow({ where: { id: old.quoteId }, include: { items: { orderBy: { position: 'asc' } } } });
    await prisma.user.update({ where: { id: 'admin_test_id' }, data: { brandDiscounts: '{"CST":0.7}' } });
    expect((await recordRepricing(request('/repricing', old), context)).status).toBe(409);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id } })).total).toBe(200);
    const response = await publishQuote(new NextRequest('http://localhost/inquiry/quote', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshCatalogQuote: true, catalogQuoteId: previous.id, catalogQuoteHash: quoteContentHash(previous) }),
    }), context);
    expect(response.status).toBe(200);
    const latest = await prisma.quote.findFirstOrThrow({ where: { inquiryId: fixture.inquiry.id }, orderBy: { version: 'desc' }, include: { items: true } });
    expect(latest).toMatchObject({ version: 3, status: 'draft', subtotal: 154 });
    expect((await recordRepricing(request('/repricing', old), context)).status).toBe(409);
    const metadata = JSON.parse(latest.items[0].metadata!);
    const fresh = { ...old, quoteId: latest.id, proposalHash: metadata.repricingProposalHash, confirmedTotal: 154, responseReference: '客户确认新版154元' };
    expect((await recordRepricing(request('/repricing', fresh), context)).status).toBe(200);
    const sameOrder = await prisma.order.findUniqueOrThrow({ where: { id: fixture.order!.id }, include: { orderItems: true } });
    expect(sameOrder).toMatchObject({ id: fixture.order!.id, total: 154, status: 'pending' });
    expect(sameOrder.orderItems[0].id).toBe(fixture.order!.orderItems[0].id);
    expect(await prisma.order.count()).toBe(1);
    expect((await prisma.quote.findUniqueOrThrow({ where: { id: previous.id } })).status).toBe('superseded');
  });

  it.each(['missing catalogue', 'unresolved customer scalar'])('preserves all original facts when repricing requires review: %s', async (condition) => {
    await seedQuoteCase('brand_review');
    if (condition === 'missing catalogue') await prisma.product.update({ where: { id: 'product_1' }, data: { originalPrice: null } });
    else await prisma.user.update({ where: { id: 'admin_test_id' }, data: { discountRate: 0.6 } });
    const draft = { target: 'brand_default_discount', brandDefaultDiscountRate: 0.8, reason: '测试资料确认' };
    await previewPricing(request('/preview', draft));
    const response = await applyDisplayedPreview(request('/apply', draft));
    expect(response.status).toBe(409);
    expect((await prisma.brand.findUniqueOrThrow({ where: { name: 'CST' } })).defaultDiscountRate).toBe(1);
    expect(await prisma.quote.count()).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 'admin_test_id' } })).discountRate).toBe(condition === 'missing catalogue' ? null : 0.6);
  });

  it('applies public prices, keeps cost price unchanged, and floors to minimum sale price', async () => {
    await previewPricing(request('/api/admin/pricing-adjustments/preview', {
      mode: 'percent',
      direction: 'decrease',
      amount: 20,
    }));
    const response = await applyDisplayedPreview(request('/api/admin/pricing-adjustments/apply', {
      mode: 'percent',
      direction: 'decrease',
      amount: 20,
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.updatedCount).toBe(1);
    expect(body.result.flooredCount).toBe(1);

    const row = getTestDb().prepare('SELECT price, costPrice, minimumSalePrice FROM Product WHERE id = ?').get('product_1') as {
      price: number;
      costPrice: number;
      minimumSalePrice: number;
    };
    expect(row.price).toBe(90);
    expect(row.costPrice).toBe(40);
    expect(row.minimumSalePrice).toBe(90);
  });

  it('allows preview without MFA and asks for MFA before apply when pricing.write requires step-up', async () => {
    mfaRequiredMock.mockResolvedValue(true);
    adminMfaRequiredMock.mockReturnValue(true);

    const preview = await previewPricing(request('/api/admin/pricing-adjustments/preview', {}));
    expect(preview.status).toBe(200);

    const apply = await applyDisplayedPreview(request('/api/admin/pricing-adjustments/apply', {}));
    expect(apply.status).toBe(403);
    const body = await apply.json();
    expect(body.error).toMatch(/MFA|authenticator|验证/i);
  });

  it('asks for MFA again when apply sends a used step-up token', async () => {
    mfaRequiredMock.mockResolvedValue(true);
    adminMfaRequiredMock.mockReturnValue(true);
    await previewPricing(request('/api/admin/pricing-adjustments/preview', {}));
    const apply = await applyDisplayedPreview(request('/api/admin/pricing-adjustments/apply', {
      stepUpToken: 'already-used',
    }));
    expect(apply.status).toBe(403);
    expect((await apply.json()).error).toBe('Admin MFA required');
  });

  it('ignores leftover step-up tokens when pricing.write does not require MFA', async () => {
    await previewPricing(request('/api/admin/pricing-adjustments/preview', {
      mode: 'percent',
      direction: 'decrease',
      amount: 10,
    }));
    const apply = await applyDisplayedPreview(request('/api/admin/pricing-adjustments/apply', {
      mode: 'percent',
      direction: 'decrease',
      amount: 10,
      stepUpToken: 'leftover',
    }));
    expect(apply.status).toBe(200);
    expect((await apply.json()).result.updatedCount).toBe(1);
  });

  it('asks for MFA before apply when step-up is enabled even if admin MFA policy is off', async () => {
    phase1EnabledMock.mockReturnValue(true);
    await previewPricing(request('/api/admin/pricing-adjustments/preview', {}));
    const apply = await applyDisplayedPreview(request('/api/admin/pricing-adjustments/apply', {}));
    expect(apply.status).toBe(403);
    expect((await apply.json()).error).toBe('Admin MFA required');
  });

  it('lets catalog matching run without MFA when pricing.write requires step-up', async () => {
    mfaRequiredMock.mockResolvedValue(true);
    adminMfaRequiredMock.mockReturnValue(true);
    const response = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'CST', catalogItems: [{ catalogNumber: 'CAT-1' }] }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).matches[0]).toMatchObject({ catalogNumber: 'CAT-1', matched: true });
  });

  it('matches file catalogs without a brand and reviews duplicates across brands', async () => {
    seedProduct({ id: 'product_abcam', catalogNumber: 'CAT-1', price: 80, brand: 'Abcam' });
    const match = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogItems: [{ catalogNumber: 'CAT-1' }] }),
    }));
    expect(match.status).toBe(200);
    expect((await match.json()).matches[0]).toMatchObject({
      catalogNumber: 'CAT-1',
      matched: false,
      ambiguous: true,
    });

    const scoped = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ catalogItems: [{ catalogNumber: 'CAT-1', brand: 'CST' }] }),
    }));
    expect(scoped.status).toBe(200);
    expect((await scoped.json()).matches[0]).toMatchObject({ catalogNumber: 'CAT-1', matched: true });

    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'catalog',
        mode: 'file',
        reason: '按表格调价',
        catalogItems: [{ catalogNumber: 'CAT-2', price: 66 }],
      }),
    }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).preview.changeCount).toBe(1);
  });

  it('lets set mode assign a public price to inquiry products', async () => {
    const preview = await previewPricing(request('/api/admin/pricing-adjustments/preview', {
      mode: 'set',
      amount: 88,
    }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.preview.changeCount).toBe(2);
    expect(previewBody.preview.skippedInquiryCount).toBe(0);

    const apply = await applyDisplayedPreview(request('/api/admin/pricing-adjustments/apply', {
      mode: 'set',
      amount: 88,
    }));
    expect(apply.status).toBe(200);
    const row = getTestDb().prepare('SELECT price, pricingMode FROM Product WHERE id = ?').get('product_2') as {
      price: number;
      pricingMode: string;
    };
    expect(row.price).toBe(88);
    expect(row.pricingMode).toBe('fixed');
  });

  it('skips inquiry product variants during preview', async () => {
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice)
      VALUES ('variant_inquiry', 'product_2', 'CAT-2-V', '100ul', 50, 50)
    `).run();

    const response = await previewPricing(request('/api/admin/pricing-adjustments/preview', {
      includeVariants: true,
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview.changeCount).toBe(1);
    expect(body.preview.skippedInquiryCount).toBeGreaterThanOrEqual(2);
  });

  it('matches imported catalog numbers without regard to letter case', async () => {
    const response = await previewPricing(request('/api/admin/pricing-adjustments/preview', {
      scope: 'catalog',
      catalogNumbers: ['cat-1'],
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preview.changeCount).toBe(1);
    expect(body.preview.unmatchedCatalogs).toEqual([]);
  });

  it('does not stack percent changes when apply is retried', async () => {
    const previewBody = {
      mode: 'percent',
      direction: 'increase',
      amount: 10,
    };
    await previewPricing(request('/api/admin/pricing-adjustments/preview', previewBody));
    const first = await applyDisplayedPreview(request('/api/admin/pricing-adjustments/apply', previewBody));
    expect(first.status).toBe(200);
    expect((await first.json()).result.updatedCount).toBe(1);

    const second = await applyDisplayedPreview(request('/api/admin/pricing-adjustments/apply', {
      mode: 'percent',
      direction: 'increase',
      amount: 10,
    }));
    expect(second.status).toBe(200);
    expect((await second.json()).result.updatedCount).toBe(0);

    const row = getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_1') as { price: number };
    expect(row.price).toBe(110);
  });

  it('writes catalog, market, promo, cost and floor prices from imported rows, including specs', async () => {
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice, promotionalPrice, costPrice, minimumSalePrice)
      VALUES ('variant_1', 'product_1', 'CAT-1-100', '100ul', 50, 60, NULL, 20, 40)
    `).run();

    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [
        {
          catalogNumber: 'CAT-1',
          originalPrice: 130,
          price: 70,
          promotionalPrice: 65,
          costPrice: 45,
          minimumSalePrice: 90,
        },
        {
          catalogNumber: 'CAT-1',
          spec: '100ul',
          price: 88,
          costPrice: 30,
        },
      ],
    };

    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.preview.changeCount).toBe(2);
    expect(previewBody.preview.flooredCount).toBe(1);
    expect(previewBody.preview.samples.some((sample: { fieldLabel?: string }) => sample.fieldLabel === '目录价')).toBe(true);
    expect(previewBody.preview.samples.some((sample: { fieldLabel?: string }) => sample.fieldLabel === '进货价')).toBe(true);
    expect(JSON.stringify(previewBody)).not.toContain('costPrice');

    const apply = await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    expect((await apply.json()).result.updatedCount).toBe(2);

    const product = getTestDb().prepare('SELECT price, originalPrice, promotionalPrice, costPrice, minimumSalePrice, pricingMode FROM Product WHERE id = ?').get('product_1') as {
      price: number;
      originalPrice: number;
      promotionalPrice: number;
      costPrice: number;
      minimumSalePrice: number;
      pricingMode: string;
    };
    expect(product.price).toBe(90);
    expect(product.originalPrice).toBe(130);
    expect(product.promotionalPrice).toBe(90);
    expect(product.costPrice).toBe(45);
    expect(product.minimumSalePrice).toBe(90);

    const variant = getTestDb().prepare('SELECT price, costPrice, originalPrice FROM ProductVariant WHERE id = ?').get('variant_1') as {
      price: number;
      costPrice: number;
      originalPrice: number;
    };
    expect(variant.price).toBe(88);
    expect(variant.costPrice).toBe(30);
    expect(variant.originalPrice).toBe(60);
  });

  it('rejects unauthenticated template downloads', async () => {
    authMock.mockResolvedValue(null);
    const response = await downloadPricingTemplate();
    expect(response.status).toBe(401);
    expect(readTemplateMock).not.toHaveBeenCalled();
  });

  it('returns the spreadsheet only to pricing admins', async () => {
    const response = await downloadPricingTemplate();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('商品集中调价导入模板.xlsx'));
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe('xlsx-bytes');
  });

  it('rejects apply when preview has not been generated', async () => {
    const response = await applyDisplayedPreview(request('/api/admin/pricing-adjustments/apply', {}));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toContain('预览');
  });

  it('does not write a shared spec name onto another product', async () => {
    seedProduct({ id: 'product_3', catalogNumber: 'CAT-3', price: 200, costPrice: 80, minimumSalePrice: null });
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice)
      VALUES ('variant_3', 'product_3', 'CAT-3-100', '100ul', 55, 60)
    `).run();

    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [
        { catalogNumber: 'CAT-1', spec: '100ul', price: 999 },
        { catalogNumber: 'CAT-3', price: 200 },
      ],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    const body = await preview.json();
    expect(body.preview.unmatchedCatalogs).toContain('CAT-1 / 100ul');

    await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const variant = getTestDb().prepare('SELECT price FROM ProductVariant WHERE id = ?').get('variant_3') as { price: number };
    expect(variant.price).toBe(55);
  });

  it('does not treat another product catalog as a spec of the imported row', async () => {
    seedProduct({ id: 'product_3', catalogNumber: 'CAT-3', price: 200, costPrice: 80, minimumSalePrice: null });

    const match = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        catalogItems: [{ catalogNumber: 'CAT-1', spec: 'CAT-3' }],
      }),
    }));
    expect(match.status).toBe(200);
    expect((await match.json()).matches).toEqual([
      { catalogNumber: 'CAT-1', spec: 'CAT-3', matched: false, name: null, productName: null },
    ]);

    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [{ catalogNumber: 'CAT-1', spec: 'CAT-3', price: 999 }],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).preview.unmatchedCatalogs).toContain('CAT-1 / CAT-3');

    await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const row = getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_3') as { price: number };
    expect(row.price).toBe(200);
  });

  it('keeps promotional price at zero instead of flooring it to the minimum sale price', async () => {
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [{ catalogNumber: 'CAT-1', promotionalPrice: 0 }],
    };
    await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const apply = await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    const row = getTestDb().prepare('SELECT promotionalPrice, promotion, price FROM Product WHERE id = ?').get('product_1') as {
      promotionalPrice: number | null;
      promotion: number;
      price: number;
    };
    expect(row.promotionalPrice).toBe(0);
    expect(row.promotion).toBe(0);
    expect(row.price).toBe(100);
  });

  it('merges two file rows that resolve to the same pack', async () => {
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice, costPrice)
      VALUES ('variant_same', 'product_1', 'CAT-1-100', '100ul', 50, 60, 20)
    `).run();
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [
        { catalogNumber: 'CAT-1', spec: '100ul', price: 88 },
        { catalogNumber: 'CAT-1', spec: 'CAT-1-100', costPrice: 33 },
      ],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const body = await preview.json();
    expect(body.preview.changeCount).toBe(1);

    const apply = await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect((await apply.json()).result.updatedCount).toBe(1);
    const variant = getTestDb().prepare('SELECT price, costPrice FROM ProductVariant WHERE id = ?').get('variant_same') as {
      price: number;
      costPrice: number;
    };
    expect(variant.price).toBe(88);
    expect(variant.costPrice).toBe(33);
  });

  it('re-floors a merged selling price against the combined minimum sale price', async () => {
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice, costPrice, minimumSalePrice)
      VALUES ('variant_floor_merge', 'product_1', 'CAT-1-100', '100ul', 50, 60, 20, 40)
    `).run();
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [
        { catalogNumber: 'CAT-1', spec: '100ul', price: 88 },
        { catalogNumber: 'CAT-1', spec: 'CAT-1-100', minimumSalePrice: 90 },
      ],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    expect((await preview.json()).preview.flooredCount).toBe(1);

    const apply = await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    const variant = getTestDb().prepare('SELECT price, minimumSalePrice FROM ProductVariant WHERE id = ?').get('variant_floor_merge') as {
      price: number;
      minimumSalePrice: number;
    };
    expect(variant.price).toBe(90);
    expect(variant.minimumSalePrice).toBe(90);
  });

  it('lets file mode assign a public price to inquiry products', async () => {
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [{ catalogNumber: 'CAT-2', price: 88 }],
    };
    await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    const apply = await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    const row = getTestDb().prepare('SELECT price, pricingMode FROM Product WHERE id = ?').get('product_2') as {
      price: number;
      pricingMode: string;
    };
    expect(row.price).toBe(88);
    expect(row.pricingMode).toBe('fixed');
  });

  it('matches imported catalogs without requiring an adjustment amount', async () => {
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice)
      VALUES ('variant_match', 'product_1', 'CAT-1-100', '100ul', 50, 60)
    `).run();

    const response = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        catalogItems: [
          { catalogNumber: 'CAT-1' },
          { catalogNumber: 'CAT-1', spec: '100ul' },
          { catalogNumber: 'MISSING' },
        ],
      }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.matches).toEqual([
      { catalogNumber: 'CAT-1', spec: '', matched: true, name: '测试抗体', productName: '测试抗体' },
      { catalogNumber: 'CAT-1', spec: '100ul', matched: true, name: '测试抗体 / 100ul', productName: '测试抗体' },
      { catalogNumber: 'MISSING', spec: '', matched: false, name: null, productName: null },
    ]);
    expect(JSON.stringify(body)).not.toContain('costPrice');
  });

  it('flags catalog number collisions when imported names do not overlap', async () => {
    const response = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        catalogItems: [
          { catalogNumber: 'CAT-1', name: '另一商品' },
          { catalogNumber: 'CAT-1', name: '测试抗体 一抗' },
        ],
      }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.matches).toEqual([
      { catalogNumber: 'CAT-1', spec: '', matched: false, name: '测试抗体', productName: '测试抗体', nameConflict: true },
      { catalogNumber: 'CAT-1', spec: '', matched: true, name: '测试抗体', productName: '测试抗体' },
    ]);
    expect(JSON.stringify(body)).not.toContain('costPrice');
  });

  it('skips writing file prices when the catalog number hits a different product name', async () => {
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [
        { catalogNumber: 'CAT-1', name: '另一商品', price: 999 },
      ],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.preview.changeCount).toBe(0);
    expect(previewBody.preview.reviewCount).toBe(1);
    expect(previewBody.preview.reviewItems).toEqual([
      { catalogNumber: 'CAT-1', spec: '', importedName: '另一商品', productName: '测试抗体' },
    ]);
    expect(previewBody.preview.unmatchedCatalogs).toEqual([]);
    expect(JSON.stringify(previewBody)).not.toContain('costPrice');

    const apply = await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    const product = getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_1') as { price: number };
    expect(product.price).toBe(100);
  });

  it('skips percent catalog updates when imported names conflict', async () => {
    const payload = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'percent',
      direction: 'increase',
      amount: 10,
      includeVariants: false,
      priceField: 'price',
      reason: '供应商调价',
      catalogNumbers: ['CAT-1'],
      catalogItems: [{ catalogNumber: 'CAT-1', name: '另一商品' }],
    };
    const preview = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.preview.changeCount).toBe(0);
    expect(previewBody.preview.reviewCount).toBe(1);
    expect(previewBody.preview.reviewItems).toEqual([
      { catalogNumber: 'CAT-1', spec: '', importedName: '另一商品', productName: '测试抗体' },
    ]);

    const apply = await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
    expect(apply.status).toBe(200);
    const product = getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_1') as { price: number };
    expect(product.price).toBe(100);
  });

  it('creates catalog products that were missing during import', async () => {
    const response = await createMissingPricing(new Request('http://localhost/api/admin/pricing-adjustments/create-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        category: '抗体',
        subcategory: '一抗',
        drafts: [{
          catalogNumber: 'NEW-1',
          name: '新抗体',
          spec: '',
          originalPrice: 120,
          price: 88,
          promotionalPrice: 80,
          costPrice: 40,
          minimumSalePrice: 70,
          variants: [{
            catalogNumber: 'NEW-1-100ul',
            spec: '100ul',
            price: 160,
            costPrice: 70,
          }],
        }],
      }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchObject({ createdCount: 1, skippedCount: 0, createdCatalogs: ['NEW-1'] });
    expect(JSON.stringify(body)).not.toContain('costPrice');

    const product = getTestDb().prepare('SELECT name, price, originalPrice, promotionalPrice, costPrice, minimumSalePrice, pricingMode, category FROM Product WHERE catalogNumber = ?').get('NEW-1') as {
      name: string;
      price: number;
      originalPrice: number;
      promotionalPrice: number;
      costPrice: number;
      minimumSalePrice: number;
      pricingMode: string;
      category: string;
    };
    expect(product).toMatchObject({
      name: '新抗体',
      price: 88,
      originalPrice: 120,
      promotionalPrice: 80,
      costPrice: 40,
      minimumSalePrice: 70,
      pricingMode: 'fixed',
      category: '抗体',
    });
    const variant = getTestDb().prepare('SELECT spec, price, costPrice FROM ProductVariant WHERE catalogNumber = ?').get('NEW-1-100ul') as {
      spec: string;
      price: number;
      costPrice: number;
    };
    expect(variant).toEqual({ spec: '100ul', price: 160, costPrice: 70 });

    const again = await createMissingPricing(new Request('http://localhost/api/admin/pricing-adjustments/create-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        category: '抗体',
        drafts: [{ catalogNumber: 'NEW-1', name: '新抗体', price: 99 }],
      }),
    }));
    expect((await again.json()).result).toMatchObject({ createdCount: 0, skippedCount: 1 });
  });

  it('auto-classifies missing catalog products onto the current category tree', async () => {
    const response = await createMissingPricing(new Request('http://localhost/api/admin/pricing-adjustments/create-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        autoClassify: true,
        drafts: [{
          catalogNumber: 'SEC-1',
          name: 'Goat Anti-Rabbit IgG H&L (HRP)',
          price: 88,
        }],
      }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchObject({ createdCount: 1, classifiedCount: 1, createdCatalogs: ['SEC-1'] });
    const product = getTestDb().prepare('SELECT category, subcategory FROM Product WHERE catalogNumber = ?').get('SEC-1') as {
      category: string;
      subcategory: string;
    };
    expect(product).toEqual({ category: '二抗', subcategory: 'HRP偶联二抗' });
  });

  it('classifies missing catalog drafts with the same catalog index as create-missing', async () => {
    const missingBrand = await classifyPreviewPricing(new Request('http://localhost/api/admin/pricing-adjustments/classify-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ name: 'Goat Anti-Rabbit IgG H&L (HRP)', catalogNumber: 'SEC-1' }],
      }),
    }));
    expect(missingBrand.status).toBe(200);

    const tooMany = await classifyPreviewPricing(new Request('http://localhost/api/admin/pricing-adjustments/classify-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        items: Array.from({ length: MAX_CLASSIFY_PREVIEW + 1 }, (_, index) => ({
          name: `商品 ${index + 1}`,
          catalogNumber: `ITEM-${index + 1}`,
        })),
      }),
    }));
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error).toContain('200');

    const response = await classifyPreviewPricing(new Request('http://localhost/api/admin/pricing-adjustments/classify-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        items: [{
          name: 'Goat Anti-Rabbit IgG H&L (HRP)',
          catalogNumber: 'SEC-1',
          spec: '',
        }],
      }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      suggestions: [{
        catalogNumber: 'SEC-1',
        spec: '',
        ok: true,
        category: '二抗',
        subcategory: 'HRP偶联二抗',
      }],
    });
  });

  it('previews a large file sheet in chunks and still applies the assembled plan', async () => {
    getTestDb().prepare(`
      INSERT INTO ProductVariant (id, productId, catalogNumber, spec, price, originalPrice, costPrice, minimumSalePrice)
      VALUES ('variant_chunk', 'product_1', 'CAT-1-100', '100ul', 50, 60, 20, 40)
    `).run();
    const full = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'file',
      includeVariants: false,
      reason: '按表格调价',
      catalogItems: [
        { catalogNumber: 'CAT-1', spec: '100ul', price: 88 },
        { catalogNumber: 'cat-1', spec: 'CAT-1-100', minimumSalePrice: 90 },
      ],
    };
    const single = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(full),
    }));
    const singlePreview = (await single.json()).preview;
    getTestDb().prepare(`DELETE FROM TransientEntry WHERE key LIKE 'price-adjustment-plan:%'`).run();

    const first = await previewChunk(new Request('http://localhost/api/admin/pricing-adjustments/preview/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...full,
        catalogItems: [full.catalogItems[0]],
        chunkIndex: 0,
        chunkCount: 2,
      }),
    }));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.complete).toBe(false);
    expect(firstBody.chunkPreview.changeCount).toBe(1);
    expect(firstBody.preview).toBeNull();

    const earlyApply = await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(full),
    }));
    expect(earlyApply.status).toBe(409);

    const second = await previewChunk(new Request('http://localhost/api/admin/pricing-adjustments/preview/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...full,
        batchId: firstBody.batchId,
        catalogItems: [full.catalogItems[1]],
        chunkIndex: 1,
        chunkCount: 2,
      }),
    }));
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.complete).toBe(true);
    expect(secondBody.receivedCount).toBe(2);
    expect(secondBody.preview).toEqual(singlePreview);

    const apply = await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(full),
    }));
    expect(apply.status).toBe(200);
    expect((await apply.json()).result.updatedCount).toBe(1);
    const variant = getTestDb().prepare('SELECT price, minimumSalePrice FROM ProductVariant WHERE id = ?').get('variant_chunk') as {
      price: number;
      minimumSalePrice: number;
    };
    expect(variant).toEqual({ price: 90, minimumSalePrice: 90 });
  });

  it('keeps percent catalog chunks on the same apply payload', async () => {
    const full = {
      brand: 'CST',
      scope: 'catalog',
      mode: 'percent',
      direction: 'increase',
      amount: 10,
      includeVariants: false,
      priceField: 'price',
      reason: '供应商调价',
      catalogNumbers: ['CAT-1', 'CAT-2'],
    };
    const single = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(full),
    }));
    const singlePreview = (await single.json()).preview;

    const first = await previewChunk(new Request('http://localhost/api/admin/pricing-adjustments/preview/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...full, catalogNumbers: ['CAT-1'], chunkIndex: 0, chunkCount: 2 }),
    }));
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstBody.complete).toBe(false);
    expect(firstBody.chunkPreview).toBeNull();

    const second = await previewChunk(new Request('http://localhost/api/admin/pricing-adjustments/preview/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...full,
        batchId: firstBody.batchId,
        catalogNumbers: ['CAT-2'],
        chunkIndex: 1,
        chunkCount: 2,
      }),
    }));
    expect(second.status).toBe(200);
    expect((await second.json()).preview).toEqual(singlePreview);

    const apply = await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(full),
    }));
    expect(apply.status).toBe(200);
    const row = getTestDb().prepare('SELECT price FROM Product WHERE id = ?').get('product_1') as { price: number };
    expect(row.price).toBe(110);
  });

  it('rejects a preview chunk that changes the adjustment or exceeds the chunk size', async () => {
    const first = await previewChunk(new Request('http://localhost/api/admin/pricing-adjustments/preview/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        scope: 'catalog',
        mode: 'file',
        includeVariants: false,
        reason: '按表格调价',
        catalogItems: [{ catalogNumber: 'CAT-1', price: 80 }],
        chunkIndex: 0,
        chunkCount: 2,
      }),
    }));
    const firstBody = await first.json();
    const mismatched = await previewChunk(new Request('http://localhost/api/admin/pricing-adjustments/preview/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        scope: 'catalog',
        mode: 'file',
        includeVariants: false,
        reason: '另一条调价原因',
        batchId: firstBody.batchId,
        catalogItems: [{ catalogNumber: 'CAT-2', price: 70 }],
        chunkIndex: 1,
        chunkCount: 2,
      }),
    }));
    expect(mismatched.status).toBe(409);

    const oversized = await previewChunk(new Request('http://localhost/api/admin/pricing-adjustments/preview/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        scope: 'catalog',
        mode: 'file',
        includeVariants: false,
        reason: '按表格调价',
        catalogItems: Array.from({ length: 401 }, (_, index) => ({ catalogNumber: `CAT-${index}`, price: 10 })),
        chunkIndex: 0,
        chunkCount: 1,
      }),
    }));
    expect(oversized.status).toBe(400);
    expect((await oversized.json()).error).toContain('400');
  });

  it('does not ask for step-up while uploading preview chunks', async () => {
    mfaRequiredMock.mockResolvedValue(true);
    adminMfaRequiredMock.mockReturnValue(true);
    const response = await previewChunk(new Request('http://localhost/api/admin/pricing-adjustments/preview/chunk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        scope: 'catalog',
        mode: 'file',
        includeVariants: false,
        reason: '按表格调价',
        catalogItems: [{ catalogNumber: 'CAT-1', price: 80 }],
        chunkIndex: 0,
        chunkCount: 1,
      }),
    }));
    expect(response.status).toBe(200);
    const apply = await applyDisplayedPreview(new Request('http://localhost/api/admin/pricing-adjustments/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        scope: 'catalog',
        mode: 'file',
        includeVariants: false,
        reason: '按表格调价',
        catalogItems: [{ catalogNumber: 'CAT-1', price: 80 }],
      }),
    }));
    expect(apply.status).toBe(403);
    expect((await apply.json()).error).toBe('Admin MFA required');
  });

  it('keeps a catalog lookup index for case-insensitive matching', async () => {
    const response = await previewPricing(new Request('http://localhost/api/admin/pricing-adjustments/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        brand: 'CST',
        scope: 'catalog',
        mode: 'file',
        includeVariants: false,
        reason: '按表格调价',
        catalogItems: [{ catalogNumber: 'cat-1', price: 80 }],
      }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).preview.changeCount).toBe(1);
    const names = getTestDb().prepare(`
      SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE '%catalog_lower%'
    `).all() as Array<{ name: string }>;
    expect(names.map((row) => row.name).sort()).toEqual([
      'ProductVariant_catalog_lower_idx',
      'Product_brand_catalog_lower_idx',
      'Product_catalog_lower_idx',
    ]);
  });

  it('rejects unauthenticated catalog matching', async () => {
    authMock.mockResolvedValue(null);
    const response = await matchPricing(new Request('http://localhost/api/admin/pricing-adjustments/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand: 'CST', catalogItems: [{ catalogNumber: 'CAT-1' }] }),
    }));
    expect(response.status).toBe(401);
  });
});
