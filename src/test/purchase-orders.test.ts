import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as orderGET, PATCH as orderPATCH } from '@/app/api/admin/orders/[id]/route';
import { POST as quotePOST } from '@/app/api/orders/[id]/quote/route';
import { PATCH as legacyOrderPATCH } from '@/app/api/orders/[id]/route';
import { reserveOrderCredit } from '@/lib/customer-credit';
import { prisma } from '@/lib/prisma';
import { verifyAndPriceItems } from '@/lib/pricing';
import { prepareSupplierQuoteReview, recordSupplierQuoteReply } from '@/lib/supplier-quote-review';
import { applyPurchaseAction, prepareOrderPurchases, previewPurchaseAction, purchaseWorkspace, savePurchaseLine } from '@/lib/purchase-orders';
import { applyPurchaseStartAction, previewPurchaseStartAction, type PurchaseStartInput } from '@/lib/purchase-start';
import type { PurchaseTerms } from '@/lib/purchase-terms';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

const merchant = { id: 'test-merchant', email: 'merchant@example.test' };
const buyer = { id: 'test-buyer', email: 'buyer@example.test' };
const preparer = { id: 'test-preparer', email: 'preparer@example.test' };
const approver = { id: 'test-approver', email: 'approver@example.test' };

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'test-merchant', email: 'merchant@example.test', role: 'admin', sessionId: 'synthetic-merchant-session' },
  }),
}));
vi.mock('@/lib/admin-mfa-settings', () => ({
  requiresAdminMfaForPermission: async () => false,
}));

type Workspace = Awaited<ReturnType<typeof purchaseWorkspace>>;
type PurchaseAction = Parameters<typeof applyPurchaseAction>[1];
type ActionRequest = Omit<Parameters<typeof previewPurchaseAction>[1], 'orderId' | 'purchaseOrderId' | 'version'>;

function terms(quantity: number, overrides: Partial<PurchaseTerms> = {}): PurchaseTerms {
  const supplier = overrides.supplier ?? '合成供应商甲';
  return {
    supplier, writtenSupplier: supplier, payee: '合成收款方甲', paymentTerms: '对公转账，供货方书面确认后按约分两次支付',
    unitPriceCents: 1375, linePayableCents: quantity * 1375, currency: 'CNY', taxBasis: 'included',
    freightTerms: '含运费，无另计金额', leadTime: '3个工作日',
    validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
    sourceReference: 'TEST-SUPPLIER-REPLY-01', sourceSha256: 'a'.repeat(64), supplierConditions: '合成供货条款',
    settlementReference: 'TEST-BANK-TERMS', settlementSha256: 'b'.repeat(64),
    coordinationReference: 'TEST-DELIVERY-CHECK-01', leadTimeAssessment: 'within_agreement',
    ...overrides,
  };
}

async function seedOrder(id: string, input: {
  quantities?: number[];
  status?: string;
  paymentMethod?: 'bank_transfer' | 'alipay';
  paidAt?: Date;
} = {}) {
  const quantities = input.quantities ?? [2];
  const total = quantities.reduce((sum, quantity) => sum + quantity * 100, 0);
  return prisma.order.create({
    data: {
      id, email: buyer.email, customerId: buyer.id, status: input.status ?? 'pending',
      paymentMethod: input.paymentMethod ?? 'bank_transfer', paidAt: input.paidAt,
      subtotal: total, total,
      orderItems: {
        create: quantities.map((quantity, position) => ({
          id: `${id}-line-${position}`, position, productId: 'test-product',
          catalogNumber: 'TEST-SKU', name: '合成商品', brand: '合成品牌', quantity, unitPrice: 100,
        })),
      },
    },
    include: { orderItems: { orderBy: { position: 'asc' } } },
  });
}

async function acceptAsMerchant(orderId: string, route: 'admin PATCH' | 'legacy PATCH' | 'quote POST' = 'admin PATCH') {
  const adminUrl = `http://localhost/api/admin/orders/${orderId}`;
  const read = await orderGET(new NextRequest(adminUrl), { params: Promise.resolve({ id: orderId }) });
  expect(read.status).toBe(200);
  const { order } = await read.json();
  expect(order.approvalPreview).toMatchObject({ action: 'accept_order', version: expect.stringMatching(/^[a-f0-9]{64}$/) });

  const customerUrl = `http://localhost/api/orders/${orderId}`;
  const endpoint = route === 'admin PATCH' ? orderPATCH : route === 'legacy PATCH' ? legacyOrderPATCH : quotePOST;
  const url = route === 'admin PATCH' ? adminUrl : route === 'legacy PATCH' ? customerUrl : `${customerUrl}/quote`;
  const response = await endpoint(new NextRequest(url, {
    method: route === 'quote POST' ? 'POST' : 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'confirmed', action: 'accept_order', approvalVersion: order.approvalPreview.version,
    }),
  }), { params: Promise.resolve({ id: orderId }) });
  expect(response.status, JSON.stringify(await response.json())).toBe(200);
  const history = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId, toStatus: 'confirmed' } });
  expect(history).toMatchObject({ fromStatus: 'pending', actorId: merchant.id });
  expect(JSON.parse(history.metadata!)).toMatchObject({
    action: 'accept_order', actorType: 'libereal_admin', version: 2, orderVersion: order.approvalPreview.version,
  });
}

function prepare(orderId: string) {
  return prisma.$transaction((tx) => prepareOrderPurchases(tx, orderId, preparer));
}

function readWorkspace(orderId: string) {
  return prisma.$transaction((tx) => purchaseWorkspace(tx, orderId));
}

function saveLine(workspace: Workspace, lineIndex: number, input: PurchaseTerms) {
  const { orderItemId, revision } = workspace.lines[lineIndex];
  return prisma.$transaction((tx) => savePurchaseLine(tx, {
    orderId: workspace.orderId, orderItemId, revision, terms: input, checkedEvidence: true,
  }, preparer));
}

async function previewAction(orderId: string, purchase: Workspace['orders'][number], request: ActionRequest) {
  const input = { ...request, orderId, purchaseOrderId: purchase.id, version: purchase.version };
  const preview = await prisma.$transaction(tx => previewPurchaseAction(tx, input, approver));
  return { ...input, actionHash: preview.actionHash };
}

function apply(input: PurchaseAction) {
  return prisma.$transaction(tx => applyPurchaseAction(tx, input, approver));
}

async function submit(orderId: string, purchase: Workspace['orders'][number], request: ActionRequest) {
  return apply(await previewAction(orderId, purchase, request));
}

async function startReview(orderId: string, request: Omit<PurchaseStartInput, 'orderId' | 'version' | 'actionHash'>) {
  const workspace = await readWorkspace(orderId);
  const input = { ...request, orderId, version: workspace.startReview.version };
  const preview = await prisma.$transaction(tx => previewPurchaseStartAction(tx, input, approver));
  return { input: { ...input, actionHash: preview.actionHash }, preview };
}

function applyStart(input: PurchaseStartInput) {
  return prisma.$transaction(tx => applyPurchaseStartAction(tx, input, approver));
}

const reviewEvidence = { reference: 'TEST-ARCHIVED-DOCUMENT', sha256: 'c'.repeat(64), description: '合成书面凭证已核对' };
const registrationEvidence = () => ({ occurredAt: new Date().toISOString(), referenceSha256: 'd'.repeat(64) });

function activities(purchaseOrderId: string, action: string) {
  return getTestDb().prepare(
    'SELECT "actorId","amountCents" FROM "PurchaseActivity" WHERE "purchaseOrderId" = ? AND "action" = ?',
  ).all(purchaseOrderId, action);
}

beforeAll(() => { getTestDb(); });
afterAll(() => { closeTestDb(); });

beforeEach(async () => {
  const db = getTestDb();
  clearAllTables(db);
  seedAdmin(db, merchant.id, merchant.email);
  seedAdmin(db, preparer.id, preparer.email);
  seedAdmin(db, approver.id, approver.email);
  seedUser(db, buyer);
  await prisma.creditAccount.create({ data: { userId: buyer.id, baseLimit: 10000, paymentTermDays: 30 } });
  await prisma.product.create({
    data: { id: 'test-product', name: '合成商品', catalogNumber: 'TEST-SKU', brand: '合成品牌', price: 100, costPrice: 30, stockQuantity: 100 },
  });
});

describe('purchase preparation from an accepted customer order', () => {
  it.each(['legacy PATCH', 'quote POST'] as const)('persists a purchase requirement automatically through %s', async (route) => {
    const order = await seedOrder('test-order-auto-prepare');
    await acceptAsMerchant(order.id, route);

    const workspace = await readWorkspace(order.id);
    expect(workspace.eligibility).toMatchObject({ eligible: true, reason: null });
    expect(workspace.lines).toEqual([
      expect.objectContaining({ orderItemId: order.orderItems[0].id, ownerId: merchant.id, purchaseOrderId: null }),
    ]);
    expect(workspace.activities.filter(entry => entry.action === 'prepare')).toHaveLength(1);
    expect(await prepare(order.id)).toEqual(workspace);
  });

  it('starts an internal review on each exact order line, then groups complete terms into persistent drafts', async () => {
    const order = await seedOrder('test-order-group', { quantities: [2, 3, 4] });
    await acceptAsMerchant(order.id);
    expect(await prisma.accountReceivable.findUniqueOrThrow({ where: { orderId: order.id } })).toMatchObject({
      userId: buyer.id, amount: 900, status: 'open', paymentTermDaysSnapshot: 30, termStartedAt: null, dueAt: null,
    });
    expect(await prisma.creditTransaction.findFirst({ where: { orderId: order.id, type: 'reserve' } })).toMatchObject({
      userId: buyer.id, amount: 900, actorId: merchant.id,
    });

    const prepared = await readWorkspace(order.id);
    expect(prepared.eligibility).toMatchObject({ eligible: true, reason: null });
    expect(prepared.lines).toHaveLength(3);
    expect(prepared.activities.filter(entry => entry.action === 'prepare')).toHaveLength(3);
    for (const item of order.orderItems) {
      expect(prepared.lines).toContainEqual(expect.objectContaining({ orderItemId: item.id, purchaseOrderId: null }));
    }
    expect(prepared.orders).toEqual([]);
    expect(await readWorkspace(order.id)).toEqual(prepared);

    const alpha = terms(2);
    await saveLine(prepared, 0, { supplier: alpha.supplier });
    const incomplete = await readWorkspace(order.id);
    expect(incomplete.orders).toEqual([]);
    expect(incomplete.lines.find((line) => line.orderItemId === order.orderItems[0].id)).toMatchObject({
      orderItemId: order.orderItems[0].id, purchaseOrderId: null, terms: { supplier: alpha.supplier },
    });

    await saveLine(incomplete, 0, alpha);
    await saveLine(await readWorkspace(order.id), 1, {
      ...alpha, linePayableCents: 3 * alpha.unitPriceCents!, sourceReference: 'TEST-SUPPLIER-REPLY-02',
    });
    await saveLine(await readWorkspace(order.id), 2, {
      ...alpha, linePayableCents: 4 * alpha.unitPriceCents!, payee: '合成收款方乙', sourceReference: 'TEST-SUPPLIER-REPLY-03',
    });

    const grouped = await readWorkspace(order.id);
    expect(grouped.orders).toHaveLength(2);
    const [first, second, third] = order.orderItems.map((item) => grouped.lines.find((line) => line.orderItemId === item.id)!);
    expect(first.purchaseOrderId).toBeTruthy();
    expect(second.purchaseOrderId).toBe(first.purchaseOrderId);
    expect(third.purchaseOrderId).toBeTruthy();
    expect(third.purchaseOrderId).not.toBe(first.purchaseOrderId);
    expect(grouped.orders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.purchaseOrderId, status: 'draft', totalCents: 6875 }),
      expect.objectContaining({ id: third.purchaseOrderId, status: 'draft', totalCents: 5500 }),
    ]));
    expect((await prepare(order.id)).orders).toEqual(grouped.orders);
    expect((await readWorkspace(order.id)).orders).toEqual(grouped.orders);
    expect(await prisma.backgroundTask.count({ where: { type: 'email.send' } })).toBe(0);
  });

  it('traces the original written supplier reply on a closed inquiry and leaves missing purchasing terms for review', async () => {
    const order = await seedOrder('test-order-written-reply');
    const brand = await prisma.brand.create({
      data: { name: '合成品牌', supplierQuoteRequiredAbove: 50, defaultDiscountRate: 0.8 },
    });
    await prisma.product.update({
      where: { id: 'test-product' },
      data: { brandRecordId: brand.id, originalPrice: 100 },
    });
    const product = { productId: 'test-product', name: '合成商品', catalogNumber: 'TEST-SKU', quantity: 2 };
    const inquiry = await prisma.inquiry.create({
      data: {
        email: buyer.email, userId: buyer.id, name: '合成询价人', phone: '00000000000',
        institution: '合成机构', paymentMethod: 'bank_transfer', status: 'pending_quote',
        inquiryItems: { create: { ...product, position: 0, unitPrice: 100, lineTotal: 200 } },
      },
      include: { inquiryItems: true },
    });
    const inquiryItemId = inquiry.inquiryItems[0].id;
    const review = await prisma.$transaction(tx => prepareSupplierQuoteReview(tx, { inquiryId: inquiry.id, inquiryItemId, actor: preparer }));
    const reply = {
      supplier: '合成书面供货方', channel: '合成书面回执', reference: 'TEST-ORIGINAL-SUPPLIER-REPLY',
      supplierUnitPrice: 13.75, customerUnitPrice: review.scope.customerPricing.finalPrice,
      currency: 'CNY', taxBasis: 'included', leadTime: '3个工作日',
      validUntil: terms(2).validUntil, conditions: '合成原书面回复，付款运费仍需采购人工核对', customerConditions: '合成客户供货条件',
    };
    const written = await prisma.$transaction(tx => recordSupplierQuoteReply(tx, {
      reviewId: review.reviewId, inquiryId: inquiry.id, requestHash: review.requestHash, reply, actor: preparer,
    }));
    const priced = await verifyAndPriceItems(
      [{ ...product, inquiryItemId, price: reply.customerUnitPrice }],
      { inquiryId: inquiry.id, userId: buyer.id, customerEmail: buyer.email },
    );
    const [line] = priced.verifiedItems;
    expect(JSON.parse(line.pricingSnapshot)).toMatchObject({ supplierQuoteReviewId: review.reviewId, supplierQuoteReplyHash: written.replyHash });
    const quote = await prisma.quote.create({
      data: {
        inquiryId: inquiry.id, version: 1, status: 'accepted', subtotal: line.lineTotal,
        items: { create: { ...product, inquiryItemId, position: 0, unitPrice: line.unitPrice, leadTime: line.leadTime,
          lineTotal: line.lineTotal, orderedQty: 2, pricingSnapshot: line.pricingSnapshot } },
      },
      include: { items: true },
    });
    await prisma.order.update({
      where: { id: order.id },
      data: {
        inquiryId: inquiry.id, subtotal: line.lineTotal, total: line.lineTotal,
        orderItems: { update: { where: { id: order.orderItems[0].id }, data: {
          catalogNumber: null, brand: null, unitPrice: line.unitPrice, leadTime: line.leadTime,
          quotedQuantity: 2, pricingSnapshot: line.pricingSnapshot,
        } } },
      },
    });
    await prisma.quoteConfirmation.create({
      data: {
        quoteId: quote.id, userId: buyer.id, email: buyer.email, action: 'accept',
        details: JSON.stringify({ orderId: order.id, items: [{ quoteItemId: quote.items[0].id, quotedQuantity: 2, orderedQuantity: 2, quantity: 2 }] }),
      },
    });
    await prisma.inquiry.update({ where: { id: inquiry.id }, data: { status: 'closed' } });
    await acceptAsMerchant(order.id);

    const workspace = await prepare(order.id);
    const [requirement] = workspace.lines;
    expect(requirement).toMatchObject({ orderItemId: order.orderItems[0].id, purchaseOrderId: null });
    expect(requirement.source).toMatchObject({
      orderItemId: order.orderItems[0].id, quantity: 2,
      written: { reviewId: review.reviewId, replyHash: written.replyHash, unitPriceCents: 1375, reference: reply.reference },
    });
    expect(requirement.terms).toMatchObject({ unitPriceCents: 1375, sourceReference: reply.reference });
    expect(workspace.orders).toEqual([]);

    const completed = { ...terms(2, { supplier: reply.supplier }), sourceReference: reply.reference,
      validUntil: reply.validUntil, supplierConditions: reply.conditions, sourceSha256: written.replyHash,
      settlementReference: undefined, settlementSha256: undefined };
    await saveLine(workspace, 0, completed);
    const pendingSettlementTerms = await readWorkspace(order.id);
    expect(pendingSettlementTerms.orders).toEqual([]);
    expect(pendingSettlementTerms.lines[0].missing).toContain('收款方及付款条件的书面依据');

    const alias = { ...completed, supplier: '合成法人供货有限公司', settlementReference: 'TEST-SUPPLIER-SETTLEMENT-ADDENDUM',
      settlementSha256: 'e'.repeat(64) };
    const noMapping = await saveLine(pendingSettlementTerms, 0, alias);
    expect(noMapping.orders).toEqual([]);
    expect(noMapping.lines[0].missing).toContain('原供货方名称对应实际法人主体的书面核对');
    const wrongSource = await saveLine(noMapping, 0, { ...alias, writtenSupplier: alias.supplier });
    expect(wrongSource.lines[0].missing).toContain('与原函供货方及版本一致的书面依据');
    const verified = await saveLine(wrongSource, 0, { ...alias, identityReference: 'TEST-LEGAL-NAME-ARCHIVE', identitySha256: 'f'.repeat(64) });
    expect(verified.orders).toEqual([expect.objectContaining({ status: 'draft', totalCents: 2750 })]);
    expect(verified.lines[0].terms.verification).toMatchObject({ actorId: preparer.id, version: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it('blocks a customer-accepted quote awaiting platform acceptance', async () => {
    const order = await seedOrder('test-order-customer-only');
    const inquiry = await prisma.inquiry.create({
      data: {
        email: buyer.email, userId: buyer.id, name: '合成询价人', phone: '00000000000',
        institution: '合成机构', status: 'closed',
      },
    });
    await prisma.order.update({ where: { id: order.id }, data: { inquiryId: inquiry.id } });
    const quote = await prisma.quote.create({
      data: { inquiryId: inquiry.id, version: 1, status: 'accepted', subtotal: order.total },
    });
    await prisma.quoteConfirmation.create({
      data: {
        quoteId: quote.id, userId: buyer.id, email: buyer.email, action: 'accept',
        details: JSON.stringify({ orderId: order.id, items: [] }),
      },
    });
    const prepared = await prepare(order.id);
    expect(prepared.eligibility).toMatchObject({ eligible: false });
    expect(prepared.lines).toEqual([]);
    expect(prepared.orders).toEqual([]);
  });

  it('prepares a legacy personal order when the original confirmation and credit reservation agree', async () => {
    const order = await seedOrder('test-order-old-verified', { status: 'confirmed' });
    const quoteSentAt = new Date();
    await prisma.$transaction(async tx => {
      await tx.order.update({ where: { id: order.id }, data: { quoteSent: true, quoteSentAt } });
      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id, fromStatus: 'pending', toStatus: 'confirmed', actorId: merchant.id,
          reason: 'quote_sent', createdAt: quoteSentAt,
        },
      });
      await tx.backgroundTask.create({
        data: {
          type: 'email.send', dedupeKey: `order-confirmation-email:${order.id}`,
          payload: JSON.stringify({ kind: 'quote', subject: 'LIBEREAL · 订单确认', to: order.email }),
        },
      });
      await reserveOrderCredit(tx, order.id, merchant.id);
    });

    const workspace = await prepare(order.id);
    expect(workspace.eligibility).toMatchObject({ eligible: true, reason: null });
    expect(workspace.lines).toEqual([expect.objectContaining({ orderItemId: order.orderItems[0].id })]);
    expect(workspace.orders).toEqual([]);
  });

  it('leaves a historically confirmed order without merchant provenance unprepared even with a credit reservation', async () => {
    const order = await seedOrder('test-order-legacy', { status: 'confirmed' });
    await prisma.$transaction(async (tx) => {
      await tx.orderStatusHistory.create({
        data: { orderId: order.id, fromStatus: 'pending', toStatus: 'confirmed', actorId: merchant.id, reason: 'quote_sent' },
      });
      await reserveOrderCredit(tx, order.id, merchant.id);
    });

    const prepared = await prepare(order.id);
    expect(prepared.eligibility).toMatchObject({ eligible: false });
    expect(prepared.lines).toEqual([]);
    expect(prepared.orders).toEqual([]);
  });

  it('holds a post-delivery order when its credit account can no longer support the reservation', async () => {
    const order = await seedOrder('test-order-credit-hold');
    await acceptAsMerchant(order.id);
    const accepted = await readWorkspace(order.id);
    expect(accepted.lines).toHaveLength(1);
    await prisma.creditAccount.update({ where: { userId: buyer.id }, data: { baseLimit: 199 } });

    const workspace = await prepare(order.id);
    expect(workspace.eligibility).toMatchObject({ eligible: false, reason: expect.stringContaining('授信') });
    expect(workspace.lines).toEqual(accepted.lines);
    expect(workspace.activities).toEqual(accepted.activities);
    expect(workspace.orders).toEqual([]);
    await expect(saveLine(workspace, 0, terms(2))).rejects.toThrow();
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: 'confirmed' });
  });

  it.each([false, true])('requires a matching customer payment for Alipay (has payment evidence: %s)', async (withEvidence) => {
    const paidAt = new Date();
    const order = await seedOrder('test-order-prepay', { paymentMethod: 'alipay', paidAt });
    if (withEvidence) {
      const attempt = await prisma.paymentAttempt.create({
        data: {
          orderId: order.id, provider: 'alipay', status: 'paid', paidAt, notifiedAt: paidAt,
          amount: order.total, outTradeNo: 'TEST-CUSTOMER-ALIPAY-01', tradeNo: 'TEST-CUSTOMER-TRADE-01',
        },
      });
      await prisma.orderEvent.create({
        data: {
          orderId: order.id, type: 'payment_received', message: '合成支付成功记录',
          metadata: JSON.stringify({ outTradeNo: attempt.outTradeNo, tradeNo: attempt.tradeNo, pointsSettlement: 'none' }),
        },
      });
    }
    await acceptAsMerchant(order.id);

    const prepared = await prepare(order.id);
    expect(prepared.eligibility).toMatchObject({ eligible: withEvidence });
    expect(prepared.lines).toHaveLength(withEvidence ? 1 : 0);
    expect(prepared.orders).toEqual([]);
    expect(await prisma.accountReceivable.count()).toBe(0);
  });
});

describe('purchase order approval and execution records', () => {
  it('requires a current independent approval, records a supplier order and partial payment once, and holds on a supply change', async () => {
    const order = await seedOrder('test-order-actions', { quantities: [2, 1] });
    await acceptAsMerchant(order.id);
    const workspace = await prepare(order.id);
    const supplierTerms = terms(2);
    await saveLine(workspace, 0, supplierTerms);
    const [firstDraft] = (await readWorkspace(order.id)).orders;
    expect(firstDraft).toMatchObject({ status: 'draft', totalCents: 2750 });

    await expect(submit(order.id, firstDraft, {
      action: 'register_order', requestId: 'test-register-too-early', reference: 'TEST-PO-TOO-EARLY',
    })).rejects.toThrow();
    const staleApproval = await previewAction(order.id, firstDraft, { action: 'approve', requestId: 'test-approve-before-edit' });
    await saveLine(await readWorkspace(order.id), 0, {
      ...supplierTerms, unitPriceCents: 1500, linePayableCents: 3000, sourceReference: 'TEST-REVISED-REPLY',
    });
    const [current] = (await readWorkspace(order.id)).orders;
    expect(current).toMatchObject({ status: 'draft', totalCents: 3000 });
    expect(current.version).not.toBe(firstDraft.version);
    await expect(apply(staleApproval)).rejects.toThrow();
    expect(activities(current.id, 'approve')).toEqual([]);

    const approval = await previewAction(order.id, current, { action: 'approve', requestId: 'test-approve-once' });
    await apply(approval);
    await apply(approval);
    const [approved] = (await readWorkspace(order.id)).orders;
    expect(approved).toMatchObject({ id: current.id, status: 'approved', totalCents: 3000 });
    expect(activities(current.id, 'approve')).toEqual([{ actorId: approver.id, amountCents: null }]);

    const registration = await previewAction(order.id, approved, {
      action: 'register_order', requestId: 'test-register-once', reference: 'TEST-SUPPLIER-ORDER-01', ...registrationEvidence(),
    });
    await apply(registration);
    await apply(registration);
    const [ordered] = (await readWorkspace(order.id)).orders;
    expect(ordered).toMatchObject({ id: current.id, status: 'ordered' });
    expect(activities(current.id, 'register_order')).toEqual([{ actorId: approver.id, amountCents: null }]);

    const payment = await previewAction(order.id, ordered, {
      action: 'record_payment', requestId: 'test-pay-partial', reference: 'TEST-SUPPLIER-PAY-01',
      amountCents: 900, conditionReference: 'TEST-DUE-INITIAL-DEPOSIT',
    });
    await expect(apply({ ...payment, amountCents: 901 })).rejects.toThrow();
    expect(activities(current.id, 'record_payment')).toEqual([]);
    await apply(payment);
    await apply(payment);
    const [partial] = (await readWorkspace(order.id)).orders;
    expect(partial).toMatchObject({ totalCents: 3000, paidCents: 900 });
    expect(activities(current.id, 'record_payment')).toEqual([{ actorId: approver.id, amountCents: 900 }]);
    await expect(submit(order.id, partial, {
      action: 'record_payment', requestId: 'test-pay-over-total', reference: 'TEST-SUPPLIER-PAY-02',
      amountCents: 2101, conditionReference: 'TEST-DUE-SUPPLIER-BALANCE',
    })).rejects.toThrow();
    expect(activities(current.id, 'record_payment')).toHaveLength(1);

    const change = await previewAction(order.id, partial, {
      action: 'report_change', requestId: 'test-report-change', changeKind: 'delay',
      reference: 'TEST-SUPPLIER-DELAY-NOTICE', description: '合成供货延期，待人工确认原条件是否仍有效。',
    });
    await apply(change);
    await apply(change);
    const [held] = (await readWorkspace(order.id)).orders;
    expect(held).toMatchObject({ id: current.id, status: 'on_hold' });
    expect(activities(current.id, 'report_change')).toEqual([{ actorId: approver.id, amountCents: null }]);
    await expect(submit(order.id, held, {
      action: 'record_payment', requestId: 'test-pay-while-held', reference: 'TEST-DO-NOT-PAY-HOLD',
      amountCents: 100, conditionReference: 'TEST-DUE-SUPPLIER-BALANCE',
    })).rejects.toThrow();
    expect((await prepare(order.id)).orders).toEqual([held]);

    await submit(order.id, held, {
      action: 'resolve_change', requestId: 'test-resolve-original', outcome: 'original_terms',
      supplierReference: 'TEST-SUPPLIER-ORIGINAL-TERMS', customerReference: 'TEST-CUSTOMER-ORIGINAL-TERMS',
      supplierSha256: 'a'.repeat(64), customerSha256: 'b'.repeat(64),
      description: '合成双方确认恢复原约定。',
    });
    const [resolved] = (await readWorkspace(order.id)).orders;
    expect(resolved).toMatchObject({ id: current.id, status: 'ordered' });
    expect(activities(current.id, 'resolve_change')).toEqual([{ actorId: approver.id, amountCents: null }]);
    expect(activities(current.id, 'record_payment')).toHaveLength(1);
    expect((await prepare(order.id)).orders).toEqual([resolved]);

    await submit(order.id, resolved, {
      action: 'report_change', requestId: 'test-report-updated-price', changeKind: 'price',
      reference: 'TEST-SUPPLIER-PRICE-CHANGE', description: '合成供货价格调整，待核对新条款。',
    });
    const [priceHold] = (await readWorkspace(order.id)).orders;
    const written = { supplierReference: 'TEST-SUPPLIER-REVISED-TERMS', customerReference: 'TEST-CUSTOMER-REVISED-TERMS',
      supplierSha256: 'a'.repeat(64), customerSha256: 'b'.repeat(64), description: '合成双方书面同意另行替代采购。' };
    await expect(submit(order.id, priceHold, {
      action: 'resolve_change', requestId: 'test-disallow-in-place', outcome: 'revised_terms', ...written,
      revisedTerms: [{ orderItemId: order.orderItems[0].id, terms: terms(2, { unitPriceCents: 1750, linePayableCents: 3500 }) }],
    })).rejects.toThrow(/另建替代采购/);
    const replacement = {
      name: '合成替代品', brand: '合成替代品牌', catalogNumber: 'TEST-ALTERNATE', spec: '合成规格', unit: '件',
      terms: terms(1, { unitPriceCents: 1750, linePayableCents: 1750, sourceReference: 'TEST-PRICE-REPLY-02' }),
    };
    const direction = { action: 'resolve_change', requestId: 'test-new-replacement', outcome: 'replacement', ...written,
      refundFollowup: '原付款留在原单，由财务核对退回凭据。',
      dispositions: [{ orderItemId: order.orderItems[0].id, quantity: 1, outcome: 'replace', replacement }],
    } as const;
    await expect(submit(order.id, priceHold, {
      ...direction, requestId: 'test-no-excess-replacement',
      dispositions: [{ ...direction.dispositions[0], quantity: 3 }],
    })).rejects.toThrow(/累计数量/);
    await prisma.orderItem.update({ where: { id: order.orderItems[0].id }, data: { shippedQty: 1 } });
    await expect(submit(order.id, priceHold, { ...direction, requestId: 'test-respect-shipped-quantity',
      dispositions: [{ ...direction.dispositions[0], quantity: 2 }] })).rejects.toThrow(/未发货数量/);
    const authorized = await previewAction(order.id, priceHold, { ...direction, dispositions: [...direction.dispositions] });
    await apply(authorized);
    await apply(authorized);

    const after = await readWorkspace(order.id);
    const original = after.orders.find(row => row.id === current.id)!;
    const derived = after.orders.find(row => row.id !== current.id)!;
    expect(original).toMatchObject({ status: 'on_hold', totalCents: 3000, paidCents: 900, orderedBefore: true });
    expect(original.lines).toHaveLength(1);
    expect(original.ledger.at(-1)?.detail).toMatchObject({ snapshot: { operation: { refund: { status: 'pending_review', paidCents: 900 } } } });
    expect(derived).toMatchObject({ status: 'draft', approvedHash: null, totalCents: 1750, paidCents: 0, orderedBefore: false,
      lines: [{ orderItemId: order.orderItems[0].id, fromPurchaseOrderId: original.id, source: { quantity: 1, name: '合成替代品' } }] });
    await expect(submit(order.id, derived, {
      action: 'record_payment', requestId: 'test-pay-before-reapproval', reference: 'TEST-PAY-REAPPROVAL',
      amountCents: 100, conditionReference: 'TEST-DUE-SUPPLIER-BALANCE',
    })).rejects.toThrow();

    const withLaterLine = await saveLine(after, 1, terms(1));
    const later = withLaterLine.orders.find(row => row.id !== original.id && row.id !== derived.id)!;
    expect(later).toMatchObject({ status: 'draft', lines: [{ orderItemId: order.orderItems[1].id }] });
    expect(withLaterLine.orders.find(row => row.id === original.id)).toEqual(original);
    expect(withLaterLine.orders.find(row => row.id === derived.id)).toEqual(derived);
    await submit(order.id, derived, { action: 'approve', requestId: 'test-independent-replacement-approval' });
    await expect(submit(order.id, original, {
      action: 'register_order', requestId: 'test-register-again', reference: 'TEST-SECOND-SUPPLIER-ORDER', ...registrationEvidence(),
    })).rejects.toThrow();
    expect(activities(original.id, 'register_order')).toHaveLength(1);
    expect(activities(original.id, 'approve')).toHaveLength(1);
    expect(activities(derived.id, 'approve')).toHaveLength(1);
    expect(await prisma.backgroundTask.count({ where: { type: 'email.send' } })).toBe(0);
  });
});

describe('recorded customer acceptance and per-order funding', () => {
  it.each([
    { scope: 'personal', adminAudit: true, expected: 'legacy_admin_patch' },
    { scope: 'personal', adminAudit: false, expected: 'legacy_personal_patch' },
    { scope: 'organization', adminAudit: true, expected: 'legacy_admin_patch' },
    { scope: 'organization', adminAudit: false, expected: null },
  ])('recognizes only the supported legacy PATCH evidence $scope / $adminAudit', async ({ scope, adminAudit, expected }) => {
    const order = await seedOrder('test-old-patch', { status: 'confirmed' });
    await prisma.order.update({ where: { id: order.id }, data: { ownerScope: scope } });
    await prisma.orderStatusHistory.create({ data: {
      orderId: order.id, fromStatus: 'pending', toStatus: 'confirmed', actorId: merchant.id, actorEmail: merchant.email,
    } });
    await prisma.orderEvent.create({ data: {
      orderId: order.id, type: 'status_changed', actorId: merchant.id, actorEmail: merchant.email,
      metadata: JSON.stringify({ fromStatus: 'pending', toStatus: 'confirmed', reason: null }),
    } });
    if (adminAudit) {
      await prisma.auditLog.create({ data: {
        actorId: merchant.id, actorEmail: merchant.email, action: 'order.status_changed', resource: 'orders',
        targetType: 'Order', targetId: order.id, beforeData: '{"status":"pending"}', afterData: '{"status":"confirmed"}',
      } });
    }
    await prisma.$transaction(tx => reserveOrderCredit(tx, order.id, merchant.id));
    const workspace = await prepare(order.id);
    expect(workspace.eligibility.eligible).toBe(Boolean(expected));
    expect(workspace.startReview.acceptance?.origin ?? null).toBe(expected);
    expect(workspace.lines).toHaveLength(expected ? 1 : 0);
  });

  it('records a manual review of previously accepted terms without replaying acceptance and credit', async () => {
    const order = await seedOrder('test-archived-acceptance', { status: 'confirmed' });
    await prisma.$transaction(tx => reserveOrderCredit(tx, order.id, merchant.id));
    expect((await prepare(order.id)).startReview).toMatchObject({ canVerifyAcceptance: true, acceptance: null });
    const request = { ...reviewEvidence, action: 'verify_acceptance', requestId: 'manual-history-1',
      originalActor: merchant.id, authorityReference: 'TEST-ORIGINAL-PLATFORM-DELEGATION',
      occurredAt: order.createdAt.toISOString() } as const;
    await expect(startReview(order.id, { ...request, originalActor: buyer.id })).rejects.toThrow(/平台接单人/);
    const { input, preview } = await startReview(order.id, request);
    expect(preview.snapshot.review.orderTerms).toMatchObject({ orderId: order.id, total: 200, lines: [{ quantity: 2, unitPrice: 100 }] });
    await applyStart(input);
    await applyStart(input);
    const eligible = await prepare(order.id);
    expect(eligible.startReview.acceptance).toMatchObject({ origin: 'reviewed_archive', actor: merchant.id });
    expect(eligible.lines).toHaveLength(1);
    expect(eligible.activities.filter(row => row.action === 'verify_acceptance')).toHaveLength(1);
    const database = getTestDb();
    expect(database.prepare('SELECT COUNT(*) AS count FROM OrderStatusHistory WHERE orderId = ?').get(order.id)).toEqual({ count: 0 });
    expect(await prisma.creditTransaction.count({ where: { orderId: order.id, type: 'reserve' } })).toBe(1);
    expect(await prisma.accountReceivable.findUnique({ where: { orderId: order.id } })).toMatchObject({ status: 'open', amount: 200 });
    await prisma.orderItem.update({ where: { id: order.orderItems[0].id }, data: { unitPrice: 101 } });
    expect((await prepare(order.id)).eligibility.eligible).toBe(false);
  });

  it('uses actual cash allocations and verifies residual credit for each partially prepaid order', async () => {
    const first = await seedOrder('test-split-customer-first');
    const second = await seedOrder('test-split-customer-second');
    await acceptAsMerchant(first.id);
    await acceptAsMerchant(second.id);
    for (const order of [first, second]) {
      const review = await startReview(order.id, {
        ...reviewEvidence, action: 'review_customer_terms', requestId: 'test-split-terms',
        paymentMode: 'partial_prepay', requiredPrepayCents: 15000, balanceTerms: '合成约定，余款按账期。',
      });
      await applyStart(review.input);
      expect((await prepare(order.id)).eligibility.eligible).toBe(false);
    }

    const cash = {
      ...reviewEvidence, action: 'record_customer_receipt', transactionReference: 'TEST-BANK-TRANSACTION-1',
      occurredAt: new Date().toISOString(), receiptTotalCents: 20000,
    } as const;
    await expect(startReview(first.id, { ...cash, requestId: 'test-invoice-not-receipt', receiptKind: 'invoice',
      allocationReference: 'TEST-INVOICE', amountCents: 15000 })).rejects.toThrow(/实际到账凭证/);
    const firstShare = await startReview(first.id, { ...cash, receiptKind: 'bank_receipt', requestId: 'test-first-share',
      allocationReference: 'TEST-ALLOC-1', amountCents: 15000 });
    await applyStart(firstShare.input);
    await applyStart(firstShare.input);
    expect((await readWorkspace(first.id)).eligibility).toMatchObject({ eligible: true, basis: {
      mode: 'partial_prepay', payment: { receivedCents: 15000 }, credit: { owedCents: 5000 },
    } });
    const secondShare = await startReview(second.id, { ...cash, receiptKind: 'bank_receipt', requestId: 'test-second-share',
      allocationReference: 'TEST-ALLOC-2', amountCents: 5000 });
    await applyStart(secondShare.input);
    expect((await readWorkspace(second.id)).startReview.payment.receivedCents).toBe(5000);
    expect((await readWorkspace(second.id)).eligibility.eligible).toBe(false);
    await expect(startReview(second.id, { ...cash, receiptKind: 'bank_receipt', requestId: 'test-improper-overallocation',
      allocationReference: 'TEST-ALLOC-3', amountCents: 1 })).rejects.toThrow(/可用分配金额/);

    const duplicate = await startReview(second.id, { ...cash, receiptKind: 'bank_receipt', requestId: 'test-duplicate-allocation',
      transactionReference: 'TEST-BANK-TRANSACTION-2', sha256: 'f'.repeat(64), allocationReference: 'TEST-ALLOC-2', amountCents: 10000 });
    await expect(applyStart(duplicate.input)).rejects.toThrow();
    const newShare = await startReview(second.id, { ...cash, receiptKind: 'bank_receipt', requestId: 'test-new-actual-cash',
      transactionReference: 'TEST-BANK-TRANSACTION-2', sha256: 'f'.repeat(64), allocationReference: 'TEST-ALLOC-4', amountCents: 10000 });
    await applyStart(newShare.input);
    expect((await readWorkspace(second.id)).eligibility).toMatchObject({ eligible: true, basis: {
      mode: 'partial_prepay', payment: { receivedCents: 15000 }, credit: { owedCents: 5000 },
    } });
    expect(await prisma.creditTransaction.count({ where: { type: 'reserve' } })).toBe(2);
  });

  it('requires distinct current over-credit and extended lead-time approvals', async () => {
    const order = await seedOrder('test-exceptions');
    await acceptAsMerchant(order.id);
    await prisma.creditAccount.update({ where: { userId: buyer.id }, data: { baseLimit: 199 } });
    expect((await readWorkspace(order.id)).startReview.creditExceptionRequired).toBe(true);
    const funding = await startReview(order.id, { ...reviewEvidence, action: 'approve_credit_exception', requestId: 'credit-exception-1' });
    await applyStart(funding.input);
    expect((await readWorkspace(order.id)).eligibility).toMatchObject({ eligible: true, basis: { exceptionId: expect.any(String) } });
    await prisma.creditAccount.update({ where: { userId: buyer.id }, data: { baseLimit: 198 } });
    expect((await readWorkspace(order.id)).eligibility.eligible).toBe(false);
    await applyStart((await startReview(order.id, { ...reviewEvidence, action: 'approve_credit_exception', requestId: 'credit-exception-2' })).input);

    const [draft] = (await saveLine(await prepare(order.id), 0, terms(2, { leadTimeAssessment: 'exception_required' }))).orders;
    await expect(submit(order.id, draft, { action: 'approve', requestId: 'cannot-skip-lead-approval' })).rejects.toThrow(/单独批准例外/);
    const [reviewed] = (await submit(order.id, draft, { action: 'approve_lead_time', requestId: 'lead-review',
      reference: 'TEST-TERMS-EXTENSION', referenceSha256: 'e'.repeat(64), description: '合成逐单交期例外核准。' })).orders;
    expect(reviewed).toMatchObject({ status: 'draft', leadTimeApproved: true });
    const [approved] = (await submit(order.id, reviewed, { action: 'approve', requestId: 'procurement-review' })).orders;
    expect(approved.status).toBe('approved');
    expect(activities(approved.id, 'approve_lead_time')).toHaveLength(1);
    expect(activities(approved.id, 'approve')).toHaveLength(1);
  });

  it('registers only a documented order within its approval and written term dates', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2031-04-01T08:00:00.000Z'));
      const order = await seedOrder('test-bounded-registration', { quantities: [2, 1] });
      await acceptAsMerchant(order.id);
      const expiry = '2031-04-02T08:00:00.000Z';
      const firstDraft = await saveLine(await prepare(order.id), 0, terms(2, { validUntil: expiry }));
      const allDrafts = await saveLine(firstDraft, 1, terms(1, { supplier: '另一合成供方', validUntil: expiry }));
      const first = allDrafts.orders.find(row => row.lines[0].orderItemId === order.orderItems[0].id)!;
      const withApproval = await submit(order.id, first, { action: 'approve', requestId: 'test-active-authority' });
      vi.setSystemTime(new Date('2031-04-01T09:00:00.000Z'));
      const withHold = await submit(order.id, withApproval.orders.find(row => row.id === first.id)!, {
        action: 'report_change', requestId: 'test-supplier-hold', changeKind: 'delay', reference: 'TEST-DELAY', description: '待核对原供方履约。',
      });
      vi.setSystemTime(new Date('2031-04-01T10:30:00.000Z'));
      await submit(order.id, withHold.orders.find(row => row.id === first.id)!, {
        action: 'resolve_change', requestId: 'test-supplier-hold-release', outcome: 'original_terms',
        supplierReference: 'TEST-ORIGINAL-SUPPLIER-REPLY', customerReference: 'TEST-ORIGINAL-CUSTOMER-REPLY',
        description: '双方确认按原条款继续。',
      });

      vi.setSystemTime(new Date('2031-04-03T12:00:00.000Z'));
      const afterExpiry = await readWorkspace(order.id);
      const approved = afterExpiry.orders.find(row => row.id === first.id)!;
      const other = afterExpiry.orders.find(row => row.id !== first.id)!;
      await expect(submit(order.id, other, { action: 'approve', requestId: 'test-expired-new-authority' })).rejects.toThrow(/有效期/);
      const receipt = { action: 'register_order', reference: 'TEST-DATED-SUPPLIER-RECEIPT', referenceSha256: 'b'.repeat(64) } as const;
      await expect(submit(order.id, approved, { ...receipt, requestId: 'before-approved', occurredAt: '2031-03-31T08:00:00.000Z' })).rejects.toThrow(/批准后/);
      await expect(submit(order.id, approved, { ...receipt, requestId: 'after-expired', occurredAt: '2031-04-02T09:00:00.000Z' })).rejects.toThrow(/有效期间/);
      await expect(submit(order.id, approved, { ...receipt, requestId: 'during-hold', occurredAt: '2031-04-01T09:30:00.000Z' })).rejects.toThrow();
      const actual = await previewAction(order.id, approved, { ...receipt, requestId: 'test-delayed-registration',
        occurredAt: '2031-04-01T12:00:00.000Z' });
      await apply(actual);
      await apply(actual);
      const registered = (await readWorkspace(order.id)).orders.find(row => row.id === first.id);
      expect(registered).toMatchObject({ status: 'ordered', orderReceipt: { occurredAt: actual.occurredAt,
        registeredAt: '2031-04-03T12:00:00.000Z', reference: receipt.reference } });
      expect(activities(first.id, 'register_order')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
