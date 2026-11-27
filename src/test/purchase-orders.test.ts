import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { GET as orderGET, PATCH as orderPATCH } from '@/app/api/admin/orders/[id]/route';
import { POST as quotePOST } from '@/app/api/orders/[id]/quote/route';
import { PATCH as legacyOrderPATCH } from '@/app/api/orders/[id]/route';
import { PATCH as creditPATCH } from '@/app/api/admin/users/[id]/credit/route';
import { reserveOrderCredit } from '@/lib/customer-credit';
import { prisma } from '@/lib/prisma';
import { discoverOrderPurchaseWork, runOrderPurchaseContinuationOnce } from '@/lib/purchase-continuation-worker';
import { PURCHASE_CONTINUATION, PURCHASE_READY, purchaseContinuationKey } from '@/lib/purchase-continuation-state';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { verifyAndPriceItems } from '@/lib/pricing';
import { prepareSupplierQuoteReview, recordSupplierQuoteReply } from '@/lib/supplier-quote-review';
import {
  applyPurchaseAction, applyPurchaseShipment, prepareOrderPurchases, previewPurchaseAction, previewPurchaseShipment, purchaseWorkspace, savePurchaseLine,
} from '@/lib/purchase-orders';
import { applyPurchaseStartAction, previewPurchaseStartAction, type PurchaseStartInput } from '@/lib/purchase-start';
import { creditLimitTerms } from '@/lib/purchase-credit-history';
import { attestPurchaseTerms, type PurchaseTerms } from '@/lib/purchase-terms';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';
import { supplierPaymentProof } from './supplier-payment-proof';

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
  isAdminMfaScenarioEnabled: async () => false,
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
    sourceReference: 'TEST-SUPPLIER-REPLY-01', sourceSha256: pricingContentHash({ quantity, supplier }), supplierConditions: '合成供货条款',
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
  const evidence = request.action === 'record_payment' ? supplierPaymentProof(request.reference ?? request.requestId, purchase.lines[0].terms.payee) : {};
  const input = { ...evidence, ...request, orderId, purchaseOrderId: purchase.id, version: purchase.version };
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

function bankProof(bankTrace: string, overrides: Partial<PurchaseStartInput> = {}) {
  return { ...reviewEvidence, action: 'verify_bank_receipt', requestId: `verify-${bankTrace}`,
    bankTrace, receivingAccount: 'TEST-RECEIVING-ACCOUNT', payer: '合成银行付款人', receiptTotalCents: 20000,
    documentKind: 'single_receipt', occurredAt: new Date().toISOString(), ...overrides,
  } satisfies Omit<PurchaseStartInput, 'orderId' | 'version'>;
}

async function verifyBank(orderId: string, proof: ReturnType<typeof bankProof>) {
  await applyStart((await startReview(orderId, proof)).input);
  const bank = (await readWorkspace(orderId)).startReview.bankReceipts.find(row => row.bank.bankTrace === proof.bankTrace);
  expect(bank).toBeDefined();
  return bank!;
}

async function adjustCredit(body: Record<string, unknown>) {
  const response = await creditPATCH(new NextRequest(`http://localhost/api/admin/users/${buyer.id}/credit`, {
    method: 'PATCH', body: JSON.stringify({ ...body, reason: '合成财务调额凭据' }),
  }), { params: Promise.resolve({ id: buyer.id }) });
  expect(response.status, JSON.stringify(await response.json())).toBe(200);
}

function activities(purchaseOrderId: string, action: string) {
  return getTestDb().prepare(
    'SELECT "actorId","amountCents" FROM "PurchaseActivity" WHERE "purchaseOrderId" = ? AND "action" = ?',
  ).all(purchaseOrderId, action);
}

async function omitDocumentRowsFromArchivedPurchase(orderId: string, purchase: Workspace['orders'][number]) {
  await prisma.$transaction(async tx => {
    // The older format signed each line while retaining only the file reference and digest.
    const archived = purchase.lines.map(line => {
      const old = { ...line.terms, sourceDocumentKind: undefined, sourceDocumentRow: undefined };
      const terms = attestPurchaseTerms(old, line.source, preparer, true, new Date(line.terms.verification!.verifiedAt));
      return { orderItemId: line.orderItemId, source: line.source, terms, revision: line.revision };
    });
    const hash = pricingContentHash({ orderId, purchaseOrderId: purchase.id, totalCents: purchase.totalCents, lines: archived });
    for (const line of archived) await tx.purchaseRequirement.update({ where: { orderItemId: line.orderItemId }, data: { terms: JSON.stringify(line.terms) } });
    await tx.purchaseOrder.update({ where: { id: purchase.id }, data: { approvedHash: hash } });
    await tx.purchaseActivity.deleteMany({ where: { orderId, action: 'review_supplier_document_scope' } });
    for (const row of purchase.ledger.filter(row => row.action === 'approve' || row.action === 'record_payment')) {
      const detail = { ...row.detail };
      const original = detail.snapshot as Record<string, unknown>;
      detail.snapshot = { ...original, lines: archived.map(line => ({ ...line, fromPurchaseOrderId: null })) };
      delete detail.fundingTermsVersion;
      detail.contentHash = hash;
      detail.actionHash = pricingContentHash(detail.snapshot);
      await tx.purchaseActivity.update({ where: { id: row.id }, data: { detail: JSON.stringify(detail) } });
    }
  });
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

describe('supplier commitments and customer fulfilment stay bound to actual evidence', () => {
  const written = {
    supplierReference: 'TEST-SUPPLIER-WRITTEN-CHANGE', supplierSha256: 'd'.repeat(64),
    customerReference: 'TEST-CUSTOMER-WRITTEN-CHANGE', customerSha256: 'e'.repeat(64),
    description: '按合成书面回复处理受影响商品。',
  };
  const hold = (orderId: string, po: Workspace['orders'][number], requestId: string) => submit(orderId, po, {
    action: 'report_change', requestId, changeKind: 'unavailable', reference: `TEST-SUPPLY-${requestId}`, description: '合成供货变化。',
  });
  const register = (orderId: string, po: Workspace['orders'][number], requestId: string) => submit(orderId, po, {
    action: 'register_order', requestId, reference: `TEST-ORDER-${requestId}`, ...registrationEvidence(),
  });
  const payment = (requestId: string, amountCents: number) => ({
    action: 'record_payment', requestId, reference: `TEST-PAYMENT-${requestId}`, amountCents, conditionReference: 'TEST-SUPPLIER-INVOICE-DUE',
  } as const);

  it('does not allocate native Alipay funds to another order and excludes an older allocation if its native alias arrives later', async () => {
    const paidAt = new Date();
    const nativeOrder = await seedOrder('test-native-alipay', { paymentMethod: 'alipay', paidAt });
    const recipient = await seedOrder('test-manual-alipay-recipient');
    const attempt = await prisma.paymentAttempt.create({ data: { orderId: nativeOrder.id, provider: 'alipay',
      status: 'paid', paidAt, amount: nativeOrder.total, outTradeNo: 'TEST-NATIVE-ORDER-TRACE' } });
    await acceptAsMerchant(nativeOrder.id);
    await acceptAsMerchant(recipient.id);
    await applyStart((await startReview(recipient.id, { ...reviewEvidence, action: 'review_customer_terms', requestId: 'part-prepay',
      paymentMode: 'partial_prepay', requiredPrepayCents: 5000, balanceTerms: '合成约定余额走账期。' })).input);
    const request = { ...reviewEvidence, action: 'record_customer_receipt', requestId: 'native-receipt', receiptKind: 'bank_receipt',
      transactionReference: attempt.outTradeNo, allocationReference: 'TEST-OTHER-ORDER-ALLOCATION', occurredAt: paidAt.toISOString(),
      receiptTotalCents: 20000, amountCents: 5000 } as const;
    await expect(startReview(recipient.id, request)).rejects.toThrow(/已核验.*银行到账/);
    await expect(startReview(recipient.id, bankProof(attempt.outTradeNo))).rejects.toThrow(/原生流水.*归属原订单/);

    const tradeNo = 'TEST-LATER-ALIPAY-ALIAS';
    await expect(startReview(recipient.id, { ...request, transactionReference: tradeNo, receiptKind: 'platform_receipt' })).rejects.toThrow(/平台交易.*待核对/);
    await prisma.purchaseActivity.create({ data: { orderId: recipient.id, id: 'legacy-unverified-alipay', action: 'record_customer_receipt', actorId: approver.id,
      amountCents: BigInt(5000), createdAt: paidAt.toISOString(), detail: JSON.stringify({ snapshot: { operation: { ...request, transactionReference: tradeNo } } }),
    } });
    expect((await readWorkspace(recipient.id)).startReview.payment.receivedCents).toBe(0);
    expect((await prepare(recipient.id)).eligibility.eligible).toBe(false);
    await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { tradeNo } });
    await prisma.orderEvent.create({ data: { orderId: nativeOrder.id, type: 'payment_received', message: '合成实际收款',
      metadata: JSON.stringify({ outTradeNo: attempt.outTradeNo, tradeNo }) } });

    const checked = await readWorkspace(recipient.id);
    expect(checked.eligibility.eligible).toBe(false);
    expect(checked.startReview.payment).toMatchObject({ receivedCents: 0, receipts: [{ transactionReference: tradeNo, amountCents: 5000 }],
      excludedReceiptIds: [expect.any(String)] });
    expect((await readWorkspace(nativeOrder.id)).startReview.payment).toMatchObject({ receivedCents: 20000, paymentAttemptId: attempt.id });
    await expect(startReview(recipient.id, bankProof(tradeNo))).rejects.toThrow(/原生流水.*归属原订单/);
  });

  it.each([false,true])('reapproves separate and repeat draft revisions by row, with an unnumbered first approval = %s', async historicalFirst => {
    const order = await seedOrder('test-reverify-substitute-customer', { quantities:[2] });
    const [item] = order.orderItems;
    await acceptAsMerchant(order.id);
    const [draft] = (await saveLine(await readWorkspace(order.id),0,terms(2))).orders;
    const [approved] = (await submit(order.id,draft,{action:'approve',requestId:'material-original-approve'})).orders;
    const [ordered] = (await register(order.id,approved,'material-original-register')).orders;
    const alternates = [];
    for (const tag of ['A','B']) {
      const original = (await readWorkspace(order.id)).orders.find(row=>row.id===ordered.id)!;
      const held = (await hold(order.id,original,'material-original-review-'+tag)).orders.find(row=>row.id===ordered.id)!;
      const state = await submit(order.id,held,{
        ...written,action:'resolve_change',requestId:'approve-original-alternate-'+tag,outcome:'replacement',
        supplierSha256:pricingContentHash({tag,role:'original supplier'}),customerSha256:pricingContentHash({tag,role:'original customer'}),
        confirmsFullIncidentScope: true, dispositions:[{orderItemId:item.id,quantity:1,outcome:'replace',replacement:{
          name:'合成替代商品 '+tag,brand:'合成替代品牌',catalogNumber:'TEST-MATERIAL-ORIGINAL-ALTERNATE-'+tag,spec:'合成规格',unit:'件',
          terms:terms(1,{sourceReference:'TEST-MATERIAL-ORIGINAL-ALTERNATE-QUOTE-'+tag,sourceSha256:pricingContentHash({tag,proof:'original replacement quote'})}),
        }}],
      });
      alternates.push(state.orders.find(row=>row.lines[0].source.catalogNumber==='TEST-MATERIAL-ORIGINAL-ALTERNATE-'+tag)!);
    }

    const customerSha256 = pricingContentHash('customer-signed-three-revised-alternative-rows');
    let old: { id: string; detail: string } | undefined;
    for (const [index,alternate] of [alternates[0],alternates[1],alternates[0]].entries()) {
      const current = (await readWorkspace(order.id)).orders.find(row=>row.id===alternate.id)!;
      const review = (await hold(order.id,current,'new-supplier-terms-'+index)).orders.find(row=>row.id===alternate.id)!;
      const line = review.lines[0];
      const amount = 2000+index*100;
      const changed = {...line.terms,unitPriceCents:amount,linePayableCents:amount,sourceReference:'TEST-NEW-REPLACEMENT-QUOTE-'+index,
        sourceSha256:pricingContentHash({index,proof:'new replacement price'})};
      const request = {
        orderId:order.id,purchaseOrderId:alternate.id,version:review.version,action:'resolve_change' as const,
        requestId:'accept-new-replacement-price-'+index,outcome:'revised_terms' as const,supplierReference:'TEST-REPLACEMENT-NEW-SUPPLIER-TERMS-'+index,
        customerReference:'TEST-REPLACEMENT-NEW-CUSTOMER-DECISION',description:'按客户各行新的书面决定重新确认价格。',
        confirmsFullIncidentScope: true, revisedTerms:[{orderItemId:item.id,terms:changed}],
      };
      await expect(prisma.$transaction(tx=>previewPurchaseAction(tx,request,preparer))).rejects.toThrow(/替代条件变更后客户同意/);
      if (index===0) {
        await expect(prisma.$transaction(tx=>previewPurchaseAction(tx,{...request,
          customerSha256:pricingContentHash({tag:'A',role:'original customer'})},preparer))).rejects.toThrow(/客户新的书面同意/);
      }
      const legacy = old && index===1 ? {customerLegacyLocations:[{activityId:old.id,orderItemId:item.id,row:5,quantity:1}]} : {};
      if (index>0) {
        await expect(prisma.$transaction(tx=>previewPurchaseAction(tx,{...request,customerSha256,
          decisionDocumentLines:[{orderItemId:item.id,customerDocumentRow:5,...legacy}]},preparer))).rejects.toThrow(/商业决定、供方或实质条件已变化/);
      }
      const row = 5+index;
      const actual = {...request,customerSha256,decisionDocumentLines:[{orderItemId:item.id,customerDocumentRow:row,...legacy}]};
      if (old && index===1) {
        await expect(prisma.$transaction(tx=>previewPurchaseAction(tx,{...actual,
          decisionDocumentLines:[{orderItemId:item.id,customerDocumentRow:row}]},preparer))).rejects.toThrow(/未定位的旧批准/);
      }
      const preview = await prisma.$transaction(tx=>previewPurchaseAction(tx,actual,preparer));
      const amended = await prisma.$transaction(tx=>applyPurchaseAction(tx,{...actual,actionHash:preview.actionHash},preparer));
      const after = amended.orders.find(row=>row.id===alternate.id)!;
      expect(after).toMatchObject({status:'draft',approvedHash:null,totalCents:amount});
      expect(amended.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{customerSha256,decisionDocuments:[
        {row,role:'customer',authority:{purpose:'reconfirm_terms',alternate:{unitPriceCents:amount}},
          allocations:[{orderId:order.id,purchaseOrderId:after.id,orderItemId:item.id,quantity:1}]},
      ]}});
      const signed = await submit(order.id,after,{action:'approve',requestId:'independent-reapprove-new-price-'+index});
      expect(signed.orders.find(row=>row.id===alternate.id)).toMatchObject({status:'approved',totalCents:amount});
      if (historicalFirst && index===0) {
        const stored = await prisma.purchaseActivity.findUniqueOrThrow({where:{id:amended.activities.at(-1)!.id}});
        const legacyDetail = JSON.parse(stored.detail);
        delete legacyDetail.snapshot.operation.decisionDocuments; // A version that did not store the row for draft revisions.
        old = {id:stored.id,detail:JSON.stringify(legacyDetail)};
        await prisma.purchaseActivity.update({where:{id:old.id},data:{detail:old.detail}});
      } else if (old) {
        expect(await prisma.purchaseActivity.findUnique({where:{id:old.id},select:{id:true,detail:true}})).toEqual(old);
      }
    }
  });

  it('counts live sibling and nested replacement quantities together and rechecks new shipments before confirmation', async () => {
    const order = await seedOrder('test-replacement-tree', { quantities: [10] });
    const [item] = order.orderItems;
    await acceptAsMerchant(order.id);
    const [draft] = (await saveLine(await readWorkspace(order.id), 0, terms(10))).orders;
    const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approve-root' })).orders;
    const [root] = (await register(order.id, approved, 'register-root')).orders;
    await prisma.order.update({ where: { id: order.id }, data: { status: 'partially_shipped' } });
    await prisma.orderItem.update({ where: { id: item.id }, data: { shippedQty: 5 } });

    const replace = (quantity: number, requestId: string): ActionRequest => ({
      action: 'resolve_change', outcome: 'replacement', requestId, ...written,
      supplierSha256: pricingContentHash({requestId,source:'supplier'}), customerSha256: pricingContentHash({requestId,source:'customer'}),
      confirmsFullIncidentScope: true, dispositions: [{ orderItemId: item.id, quantity, outcome: 'replace', replacement: {
        name: `合成替代商品 ${requestId}`, brand: '合成品牌', catalogNumber: `TEST-${requestId}`, spec: '合成规格', unit: '件',
        terms: terms(quantity, { sourceReference: `TEST-QUOTE-${requestId}`, sourceSha256: pricingContentHash(requestId) }),
      } }],
    });
    const firstHold = (await hold(order.id, root, 'root-first')).orders[0];
    const first = await submit(order.id, firstHold, replace(3, 'first-alternate'));
    const firstAlternate = first.orders.find(po => po.id !== root.id)!;
    const firstApproved = (await submit(order.id, firstAlternate, { action: 'approve', requestId: 'approve-first-alternate' })).orders.find(po => po.id === firstAlternate.id)!;
    const firstOrdered = (await register(order.id, firstApproved, 'register-first-alternate')).orders.find(po => po.id === firstAlternate.id)!;

    const nextHold = (await hold(order.id, first.orders.find(po => po.id === root.id)!, 'root-second')).orders.find(po => po.id === root.id)!;
    const stale = await previewAction(order.id, nextHold, replace(2, 'too-many-after-shipment'));
    await prisma.orderItem.update({ where: { id: item.id }, data: { shippedQty: 6 } });
    await expect(apply(stale)).rejects.toThrow(/累计有效替代采购.*未发货数量/);
    expect((await readWorkspace(order.id)).orders).toHaveLength(2);
    const second = await submit(order.id, nextHold, replace(1, 'second-alternate'));
    const secondAlternate = second.orders.find(po => po.id !== root.id && po.id !== firstAlternate.id)!;
    expect(secondAlternate.remaining).toEqual([{ orderItemId: item.id, quantity: 1 }]);

    const childHold = (await hold(order.id, firstOrdered, 'child-first')).orders.find(po => po.id === firstAlternate.id)!;
    const nested = await submit(order.id, childHold, replace(2, 'nested-alternate'));
    const grandchild = nested.orders.find(po => po.lines[0].fromPurchaseOrderId === firstAlternate.id)!;
    expect(nested.orders.find(po => po.id === firstAlternate.id)?.remaining).toEqual([{ orderItemId: item.id, quantity: 1 }]);
    expect(grandchild.remaining).toEqual([{ orderItemId: item.id, quantity: 2 }]);
    const preview = await previewAction(order.id, grandchild, { action: 'approve', requestId: 'approve-nested' });
    await prisma.orderItem.update({ where: { id: item.id }, data: { shippedQty: 7 } });
    await expect(apply(preview)).rejects.toThrow(/未发货数量/);
    expect((await readWorkspace(order.id)).orders.find(po => po.id === grandchild.id)?.status).toBe('draft');
  });

  it('frees only the actual replacement units attributed in a split shipment, once', async () => {
    const order = await seedOrder('test-shipment-split', { quantities: [10] });
    const [item] = order.orderItems;
    await acceptAsMerchant(order.id);
    const [draft] = (await saveLine(await readWorkspace(order.id), 0, terms(10))).orders;
    const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approve-shipping-original' })).orders;
    const [ordered] = (await register(order.id, approved, 'register-shipping-original')).orders;
    const replace = (quantity: number, id: string): ActionRequest => ({ action: 'resolve_change', outcome: 'replacement', requestId: id, ...written,
      supplierSha256: pricingContentHash({id,source:'supplier'}), customerSha256: pricingContentHash({id,source:'customer'}),
      confirmsFullIncidentScope: true, dispositions: [{ orderItemId: item.id, quantity, outcome: 'replace', replacement: {
        name: '合成替代商品', brand: '合成品牌', catalogNumber: 'TEST-ALTERNATE-SHIP', spec: '合成规格', unit: '件',
        terms: terms(quantity, { sourceSha256: pricingContentHash(id) }),
      } }],
    });
    const [held] = (await hold(order.id, ordered, 'first-quantity-shortage')).orders;
    const first = await submit(order.id, held, replace(3, 'first-three-alternatives'));
    const alternate = first.orders.find(po => po.id !== ordered.id)!;
    const next = (await submit(order.id, alternate, { action: 'approve', requestId: 'approve-alternate-to-ship' })).orders.find(po => po.id === alternate.id)!;
    await register(order.id, next, 'register-alternate-to-ship');
    await prisma.$transaction(async tx => {
      await tx.shipment.create({ data: { id: 'TEST-SPLIT-SHIPMENT', orderId: order.id, status: 'shipped', shippedAt: new Date(),
        items: { create: { id: 'TEST-SPLIT-LINE', orderItemId: item.id, quantity: 8 } } } });
      await tx.orderItem.update({ where: { id: item.id }, data: { shippedQty: 8, status: 'partially_shipped' } });
      await tx.order.update({ where: { id: order.id }, data: { status: 'partially_shipped' } });
    });
    const current = (await readWorkspace(order.id)).orders.find(po => po.id === ordered.id)!;
    const again = await hold(order.id, current, 'second-quantity-shortage');
    const root = again.orders.find(po => po.id === ordered.id)!;
    await expect(submit(order.id, root, replace(2, 'no-guess-remaining'))).rejects.toThrow(/累计有效替代采购/);
    const base = { ...reviewEvidence, orderId: order.id, version: again.fulfillment.version, requestId: 'checked-shipping-origin', targetId: 'TEST-SPLIT-LINE' };
    const sources = [{ purchaseOrderId: ordered.id, quantity: 5 }, { purchaseOrderId: alternate.id, quantity: 3 }];
    await expect(prisma.$transaction(tx => previewPurchaseShipment(tx, { ...base, sources: [sources[0], { ...sources[1], quantity: 4 }] }, approver)))
      .rejects.toThrow(/剩余可归属数量/);
    const preview = await prisma.$transaction(tx => previewPurchaseShipment(tx, { ...base, sources }, approver));
    const confirmed = { ...base, sources, actionHash: preview.actionHash };
    const apportioned = await prisma.$transaction(tx => applyPurchaseShipment(tx, confirmed, approver));
    await prisma.$transaction(tx => applyPurchaseShipment(tx, confirmed, approver));
    expect(apportioned.fulfillment).toMatchObject({ targets: [], delivered: expect.arrayContaining([
      { purchaseOrderId: ordered.id, orderItemId: item.id, quantity: 5 }, { purchaseOrderId: alternate.id, orderItemId: item.id, quantity: 3 },
    ]), ledger: [{ actorId: approver.id }] });
    await expect(prisma.$transaction(tx => previewPurchaseShipment(tx, { ...base, version: apportioned.fulfillment.version, sources,
      requestId: 'duplicate-shipment' }, approver))).rejects.toThrow(/已经关联/);
    const finished = await submit(order.id, apportioned.orders.find(po => po.id === ordered.id)!, replace(2, 'replace-two-unshipped'));
    expect(finished.orders).toHaveLength(3);
    expect(finished.orders.find(po => po.id === ordered.id)).toMatchObject({ totalCents: 13750, orderedBefore: true });
    expect((await prisma.orderItem.findUnique({ where: { id: item.id } }))?.shippedQty).toBe(8);
  });

  it('uses named archive evidence for historical quantities without an original ShipmentItem', async () => {
    const order = await seedOrder('test-legacy-shipment-evidence', { quantities: [5] });
    const [item] = order.orderItems;
    await acceptAsMerchant(order.id);
    const [draft] = (await saveLine(await readWorkspace(order.id), 0, terms(5))).orders;
    const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approve-before-historic-shipment' })).orders;
    const [ordered] = (await register(order.id, approved, 'register-before-historic-shipment')).orders;
    await prisma.orderItem.update({ where: { id: item.id }, data: { shippedQty: 3, status: 'partially_shipped' } });
    const history = (await readWorkspace(order.id)).fulfillment;
    expect(history.targets).toMatchObject([{ id: `historical:${item.id}`, shipmentId: null, quantity: 3 }]);
    const input = { ...reviewEvidence, orderId: order.id, requestId: 'restore-one-shipment-from-archive', version: history.version,
      targetId: history.targets[0].id, occurredAt: new Date().toISOString(), documentRow: 1,
      sources: [{ purchaseOrderId: ordered.id, quantity: 1 }] };
    const preview = await prisma.$transaction(tx => previewPurchaseShipment(tx, input, approver));
    const recorded = await prisma.$transaction(tx => applyPurchaseShipment(tx, { ...input, actionHash: preview.actionHash }, approver));
    expect(recorded.fulfillment.targets).toMatchObject([{ id: `historical:${item.id}`, quantity: 2 }]);
    expect(recorded.fulfillment.delivered).toEqual([{ purchaseOrderId: ordered.id, orderItemId: item.id, quantity: 1 }]);
    const repeat = { ...input, requestId: 'duplicate-old-proof', version: recorded.fulfillment.version };
    const secondPreview = await prisma.$transaction(tx => previewPurchaseShipment(tx, repeat, approver));
    await expect(prisma.$transaction(tx => applyPurchaseShipment(tx, { ...repeat, actionHash: secondPreview.actionHash }, approver))).rejects.toThrow();
    expect((await readWorkspace(order.id)).fulfillment.ledger).toHaveLength(1);
  });

  it('accepts distinct supplier rows of a verified multi-item document but rejects reuse of the original row for an alternative', async () => {
    const order = await seedOrder('test-supplier-file-line-scope');
    await acceptAsMerchant(order.id);
    const quoted = terms(2, { sourceDocumentKind: 'multiple_items', sourceDocumentRow: 1 });
    const [draft] = (await saveLine(await readWorkspace(order.id), 0, quoted)).orders;
    const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approve-doc-line-one' })).orders;
    const [ordered] = (await register(order.id, approved, 'register-doc-line-one')).orders;
    const [held] = (await hold(order.id, ordered, 'book-scope-change')).orders;
    const replacement = (sourceDocumentRow: number, requestId: string): ActionRequest => ({
      ...written, action: 'resolve_change', outcome: 'replacement', requestId,
      confirmsFullIncidentScope: true, dispositions: [{ orderItemId: order.orderItems[0].id, quantity: 1, outcome: 'replace', replacement: {
        name: '合成替代规格', brand: '合成品牌', catalogNumber: 'TEST-SCOPE-SKU-2', spec: '不同合成规格', unit: '件',
        terms: terms(1, { sourceSha256: quoted.sourceSha256, validUntil: quoted.validUntil, sourceDocumentKind: 'multiple_items', sourceDocumentRow }),
      } }],
    });
    await expect(submit(order.id, held, replacement(1, 'incorrect-reuse'))).rejects.toThrow(/书证行已对应其他商品/);
    const authorized = await submit(order.id, held, replacement(2, 'checked-actual-quote-row-two'));
    const alternate = authorized.orders.find(po => po.id !== ordered.id)!;
    expect(alternate.lines).toMatchObject([{ source: { catalogNumber: 'TEST-SCOPE-SKU-2' }, terms: { sourceDocumentRow: 2 } }]);
    const final = await submit(order.id, alternate, { action: 'approve', requestId: 'approve-actual-quote-row-two' });
    expect(final.orders.find(po => po.id === alternate.id)?.status).toBe('approved');
  });

  it.each([false, true])('authorizes only explicit unaffected payables after a deposit (supplier already ordered=%s)', async (orderedBefore) => {
    const order = await seedOrder(`test-remaining-payable-${orderedBefore}`, { quantities: [2, 1] });
    const [cancelled, unaffected] = order.orderItems;
    await acceptAsMerchant(order.id);
    const first = await saveLine(await readWorkspace(order.id), 0, terms(2));
    const [draft] = (await saveLine(first, 1, terms(1))).orders;
    const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approve-deposit-case' })).orders;
    const [deposited] = (await submit(order.id, approved, payment('original-deposit', 1200))).orders;
    const before = orderedBefore ? (await register(order.id, deposited, 'register-before-partial-cancellation')).orders[0] : deposited;
    const [held] = (await hold(order.id, before, 'partial-cancellation')).orders;
    const [adjusted] = (await submit(order.id, held, { action: 'resolve_change', requestId: 'agreed-partial-cancellation', outcome: 'declined',
      ...written, refundFollowup: '财务核对原款与退款安排。', confirmsFullIncidentScope: true, dispositions: [{ orderItemId: cancelled.id, quantity: 2, outcome: 'cancel' }],
    })).orders;
    expect(adjusted).toMatchObject({ totalCents: 4125, paidCents: 1200, dueCents: null, needsRemainingReview: true,
      remaining: [{ orderItemId: unaffected.id, quantity: 1 }] });
    await expect(submit(order.id, adjusted, payment('unreviewed-entire-order', 2925))).rejects.toThrow();
    const review = { action: 'approve_remaining', requestId: 'review-unaffected-only', reference: 'TEST-SIGNED-REMAINING-STATEMENT',
      referenceSha256: 'f'.repeat(64), description: '剩余一件与已付归属经双方书面核实。', remainingLines: [{ orderItemId: unaffected.id, payableCents: 1300 }],
    } as const;
    await expect(submit(order.id, adjusted, { ...review, remainingLines: [...review.remainingLines] })).rejects.toThrow(/已付款中抵扣/);
    const [reviewed] = (await submit(order.id, adjusted, { ...review, remainingLines: [...review.remainingLines], appliedPaidCents: 600 })).orders;
    expect(reviewed).toMatchObject({ status: orderedBefore ? 'ordered' : 'approved', totalCents: 4125, paidCents: 1200, dueCents: 700,
      remainingScope: { totalCents: 1300, appliedPaidCents: 600, payments: [{ id: expect.any(String), amountCents: 1200 }] } });
    const [ready] = orderedBefore ? [reviewed] : (await register(order.id, reviewed, 'register-unaffected-only')).orders;
    if (!orderedBefore) expect(ready.ledger.find(row => row.action === 'register_order')?.detail).toMatchObject({ snapshot: { operation: { execution: {
      totalCents: 1300, lines: [{ orderItemId: unaffected.id, quantity: 1, payableCents: 1300 }],
    } } } });
    await expect(register(order.id, ready, 'no-second-register')).rejects.toThrow(/已登记过/);
    await expect(submit(order.id, ready, payment('over-reviewed-payable', 701))).rejects.toThrow(/未付合计/);
    const [final] = (await submit(order.id, ready, payment('reviewed-payable', 700))).orders;
    expect(final).toMatchObject({ totalCents: 4125, paidCents: 1900, dueCents: 0, orderedBefore: true });
    expect(final.ledger.find(row => row.action === 'resolve_change')?.detail).toMatchObject({ snapshot: { operation: { refund: { status: 'pending_review', paidCents: 1200 } } } });
    expect(activities(final.id, 'register_order')).toHaveLength(1);
    expect(activities(final.id, 'record_payment')).toHaveLength(2);
  });

  it('keeps an entirely cancelled commitment closed after credit restoration and releases demand for a new purchase', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2031-07-02T08:00:00.000Z'));
      await adjustCredit({ overrideLimit: 200 });
      vi.setSystemTime(new Date('2031-07-02T08:05:00.000Z'));
      const order = await seedOrder('test-entire-supplier-cancellation');
      const [item] = order.orderItems;
      await acceptAsMerchant(order.id);
      const [draft] = (await saveLine(await readWorkspace(order.id), 0, terms(2))).orders;
      const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approve-root-purchase' })).orders;
      vi.setSystemTime(new Date('2031-07-02T08:10:00.000Z'));
      const [registered] = (await register(order.id, approved, 'register-root-purchase')).orders;
      const replacement = (requestId: string, quantity: number): ActionRequest => ({
        action: 'resolve_change', requestId, outcome: 'replacement', ...written,
        supplierSha256: pricingContentHash({requestId,source:'supplier'}), customerSha256: pricingContentHash({requestId,source:'customer'}),
        refundFollowup: '核对原付款、费用和退款。',
        confirmsFullIncidentScope: true, dispositions: [{ orderItemId: item.id, quantity, outcome: 'replace', replacement: {
          name: '合成替代品', brand: '合成品牌', catalogNumber: `TEST-SUB-${requestId}`, spec: '测试规格', unit: '件',
          terms: terms(quantity, { sourceSha256: pricingContentHash(requestId), sourceReference: `TEST-QUOTE-${requestId}` }),
        } }],
      });
      const [rootHeld] = (await hold(order.id, registered, 'replace-root')).orders;
      const child = (await submit(order.id, rootHeld, replacement('source-one', 2))).orders.find(row => row.id !== registered.id)!;
      const childFrom = (workspace: Workspace) => workspace.orders.find(row => row.id === child.id)!;
      const selected = childFrom(await submit(order.id, child, { action: 'approve', requestId: 'approve-first-replacement' }));
      const deposited = childFrom(await submit(order.id, selected, payment('replacement-deposit', 900)));
      const prior = await prisma.purchaseActivity.findMany({ where: { purchaseOrderId: child.id, action: { in: ['approve', 'record_payment'] } },
        orderBy: { id: 'asc' } });

      vi.setSystemTime(new Date('2031-07-02T09:00:00.000Z'));
      await adjustCredit({ overrideLimit: 199 });
      vi.setSystemTime(new Date('2031-07-02T10:00:00.000Z'));
      const pending = childFrom(await submit(order.id, deposited, { action: 'record_late_order_exception', requestId: 'record-credit-exception',
        reference: 'TEST-ACTUAL-REPLACEMENT-COMMITMENT', ...registrationEvidence(), exceptionOutcome: 'liability_review', description: '原供方实际承诺待核。' }));
      const partialHold = childFrom(await hold(order.id, pending, 'partial-cancel-child'));
      const partial = childFrom(await submit(order.id, partialHold, { action: 'resolve_change', requestId: 'cancel-one-replacement-unit',
        outcome: 'declined', ...written, refundFollowup: '部分取消后核对已付定金。',
        supplierSha256: pricingContentHash('changed-supplier-decision-for-child'),
        customerSha256: pricingContentHash('changed-customer-decision-for-child'),
        confirmsFullIncidentScope: true, dispositions: [{ orderItemId: item.id, outcome: 'cancel', quantity: 1 }],
      }));
      expect(partial).toMatchObject({ commitmentState: 'pending', needsRemainingReview: true, canApproveRemaining: false });
      const followup = '书面确认整笔取消，按供方档案核对原定金与取消事宜，待财务确认实际结果。';
      const cancelled = childFrom(await submit(order.id, partial, { action: 'resolve_order_exception', requestId: 'confirm-entire-cancellation',
        exceptionId: pending.commitmentExceptions[0].id, exceptionResolution: 'supplier_cancelled',
        reference: 'TEST-SUPPLIER-CANCELS-ENTIRE-COMMITMENT', referenceSha256: 'e'.repeat(64), description: followup,
      }));
      expect(cancelled).toMatchObject({ status: 'on_hold', commitmentState: 'supplier_cancelled', orderReceipt: null, paidCents: 900,
        dueCents: null, remainingScope: null, needsRemainingReview: false, canApproveRemaining: false, canRegisterOrder: false });
      expect(cancelled.ledger.at(-1)?.detail).toMatchObject({ snapshot: { operation: {
        resolution: 'supplier_cancelled', referenceSha256: 'e'.repeat(64), responsibleActor: approver.id,
        refund: { status: 'pending_review', paidCents: 900, responsibleActor: approver.id, followup },
      } } });

      vi.setSystemTime(new Date('2031-07-02T11:00:00.000Z'));
      await adjustCredit({ overrideLimit: 200 });
      const restoredCredit = await readWorkspace(order.id);
      expect(restoredCredit.eligibility.eligible).toBe(true);
      await expect(previewAction(order.id, childFrom(restoredCredit), { action: 'approve_remaining', requestId: 'do-not-reapprove-cancelled-goods',
        reference: 'TEST-PREVIOUS-PARTIAL-DOCUMENT', referenceSha256: 'f'.repeat(64), description: '原部分取消尚余一行。',
        remainingLines: [{ orderItemId: item.id, payableCents: 1375 }], appliedPaidCents: 0,
      })).rejects.toThrow();
      // A header displaying an approval cannot re-open the goods balance established by the signed cancellation.
      await prisma.purchaseOrder.update({ where: { id: child.id }, data: { status: 'approved' } });
      const archived = childFrom(await readWorkspace(order.id));
      await expect(previewAction(order.id, archived, payment('do-not-pay-cancelled-goods', 100))).rejects.toThrow(/未付合计/);
      await expect(register(order.id, archived, 'do-not-reopen-cancelled-commitment')).rejects.toThrow(/已有实际承诺异常/);

      const change = childFrom(await hold(order.id, archived, 'remaining-customer-demand'));
      await expect(previewAction(order.id, change, { action: 'resolve_change', requestId: 'attempt-old-terms', outcome: 'original_terms',
        ...written })).rejects.toThrow(/另建采购并独立批准/);
      const request = replacement('new-supplier-commitment', 1);
      const input = { ...request, orderId: order.id, purchaseOrderId: child.id, version: change.version };
      const preview = await prisma.$transaction(tx => previewPurchaseAction(tx, input, approver));
      expect(preview.snapshot.demand).toMatchObject([{ orderItemId: item.id, unshipped: 2, activeReplacements: 0 }]);
      const workspace = await apply({ ...input, actionHash: preview.actionHash });
      const newDraft = workspace.orders.find(row => row.lines.some(line => line.fromPurchaseOrderId === child.id))!;
      expect(newDraft).toMatchObject({ status: 'draft', approvedHash: null, paidCents: 0, orderReceipt: null });
      await expect(previewAction(order.id, newDraft, payment('no-independent-approval-yet', 100))).rejects.toThrow();
      const newlyApproved = (await submit(order.id, newDraft, { action: 'approve', requestId: 'approve-new-obligation' })).orders.find(row => row.id === newDraft.id)!;
      vi.setSystemTime(new Date('2031-07-02T11:05:00.000Z'));
      const result = await register(order.id, newlyApproved, 'register-new-obligation');
      expect(result.orders.find(row => row.id === newDraft.id)).toMatchObject({ orderedBefore: true, totalCents: 1375, paidCents: 0 });
      expect(childFrom(result)).toMatchObject({ commitmentState: 'supplier_cancelled', paidCents: 900, dueCents: null });
      expect(await prisma.purchaseActivity.findMany({ where: { purchaseOrderId: child.id, action: { in: ['approve', 'record_payment'] } },
        orderBy: { id: 'asc' } })).toEqual(prior);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['before the change', 'during the change', 'after cancellation', 'an archived ordered header'])(
    'reconciles the surviving quantity when actual commitment liability is verified %s',
    async (sequence) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime(new Date('2031-07-01T08:00:00.000Z'));
        await adjustCredit({ overrideLimit: 200 });
        const order = await seedOrder('test-credit-exception-partial-cancellation');
        const [item] = order.orderItems;
        await acceptAsMerchant(order.id);
        const [draft] = (await saveLine(await readWorkspace(order.id), 0, terms(2))).orders;
        const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approve-before-credit-change' })).orders;
        const [deposited] = (await submit(order.id, approved, payment('credit-case-deposit', 900))).orders;
        const original = await prisma.purchaseActivity.findMany({ where: { purchaseOrderId: approved.id, action: { in: ['approve', 'record_payment'] } },
          orderBy: { id: 'asc' } });
        vi.setSystemTime(new Date('2031-07-01T09:00:00.000Z'));
        await adjustCredit({ overrideLimit: 199 });
        vi.setSystemTime(new Date('2031-07-01T10:00:00.000Z'));
        const [exception] = (await submit(order.id, deposited, {
          action: 'record_late_order_exception', requestId: 'actual-commitment-after-credit-change', ...registrationEvidence(),
          reference: 'TEST-SUPPLIER-COMMITMENT', exceptionOutcome: 'liability_review', description: '供方已承诺，原合同责任待核。',
        })).orders;
        const verifyLiability = (current: typeof exception) => submit(order.id, current, {
          action: 'resolve_order_exception', requestId: 'verify-archived-liability', exceptionId: exception.commitmentExceptions[0].id,
          exceptionResolution: 'payable_verified', reference: 'TEST-CONTRACT-LIABILITY', referenceSha256: 'e'.repeat(64),
          description: '已核实实际承诺和原应付，原定金留存。',
        });
        const review = {
          action: 'approve_remaining', requestId: 'approve-surviving-unit', reference: 'TEST-SIGNED-SURVIVING-UNIT', referenceSha256: 'f'.repeat(64),
          description: '核实原单剩余一件的应付与定金抵扣。', remainingLines: [{ orderItemId: item.id, payableCents: 1375 }], appliedPaidCents: 500,
        } satisfies ActionRequest;

        const [prior] = sequence === 'before the change' ? (await verifyLiability(exception)).orders : [exception];
        const [incident] = (await hold(order.id, prior, 'report-quantity-reduction')).orders;
        expect(incident).toMatchObject({ status: 'on_hold', canApproveRemaining: false, paidCents: 900 });
        const [beforeCancellation] = sequence === 'during the change' ? (await verifyLiability(incident)).orders : [incident];
        const [cancelled] = (await submit(order.id, beforeCancellation, { action: 'resolve_change', requestId: 'agree-cancel-one',
          outcome: 'declined', ...written, refundFollowup: '定金单据继续留存，未抵扣款列入退款待核。',
          confirmsFullIncidentScope: true, dispositions: [{ orderItemId: item.id, quantity: 1, outcome: 'cancel' }],
        })).orders;
        const liabilityPending = sequence === 'after cancellation' || sequence === 'an archived ordered header';
        expect(cancelled).toMatchObject({ status: 'on_hold', dueCents: null, paidCents: 900, needsRemainingReview: true,
          canApproveRemaining: !liabilityPending, remaining: [{ orderItemId: item.id, quantity: 1 }] });
        if (liabilityPending) {
          await expect(previewAction(order.id, cancelled, review)).rejects.toThrow();
        }
        const [confirmed] = liabilityPending ? (await verifyLiability(cancelled)).orders : [cancelled];
        expect(confirmed).toMatchObject({ status: 'on_hold', orderedBefore: true, totalCents: 2750, paidCents: 900, dueCents: null,
          canApproveRemaining: true, orderReceipt: { exception: true }, commitmentExceptions: [{ resolution: 'payable_verified' }] });
        if (sequence === 'an archived ordered header') {
          // The prior version stored ordered even though the current dispositions had no approval.
          await prisma.purchaseOrder.update({ where: { id: confirmed.id }, data: { status: 'ordered' } });
        }
        const [readyForReview] = (await readWorkspace(order.id)).orders;
        await expect(previewAction(order.id, readyForReview, payment('unreviewed-original-balance', 1850))).rejects.toThrow();
        const [reviewed] = (await submit(order.id, readyForReview, review)).orders;
        expect(reviewed).toMatchObject({ status: 'ordered', orderedBefore: true, totalCents: 2750, paidCents: 900, dueCents: 875,
          needsRemainingReview: false, canApproveRemaining: false, remainingScope: {
            lines: [{ orderItemId: item.id, quantity: 1, payableCents: 1375 }], totalCents: 1375, appliedPaidCents: 500,
          } });
        expect(reviewed.ledger.find(row => row.action === 'resolve_change')?.detail).toMatchObject({ snapshot: { operation: {
          refund: { status: 'pending_review', paidCents: 900 },
        } } });
        expect(await prisma.purchaseActivity.findMany({ where: { id: { in: original.map(row => row.id) } }, orderBy: { id: 'asc' } })).toEqual(original);
        await expect(previewAction(order.id, reviewed, payment('over-surviving-balance', 876))).rejects.toThrow(/未付合计/);
        const [paid] = (await submit(order.id, reviewed, payment('pay-surviving-balance', 875))).orders;
        expect(paid).toMatchObject({ paidCents: 1775, dueCents: 0 });
        expect(activities(paid.id, 'register_order')).toEqual([]);
        expect(activities(paid.id, 'record_payment')).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('prepares only the outstanding quantities of a historically partially shipped customer order', async () => {
    const order = await seedOrder('test-historic-partial-shipment', { quantities: [5, 2, 1] });
    await acceptAsMerchant(order.id);
    const [partial, done, alreadyPrepared] = order.orderItems;
    await prisma.$transaction([
      prisma.purchaseActivity.deleteMany({ where: { orderId: order.id, action: 'prepare', orderItemId: { in: [partial.id, done.id] } } }),
      prisma.purchaseRequirement.deleteMany({ where: { orderItemId: { in: [partial.id, done.id] } } }),
      prisma.orderItem.update({ where: { id: partial.id }, data: { shippedQty: 3, status: 'partially_shipped' } }),
      prisma.orderItem.update({ where: { id: done.id }, data: { shippedQty: 2, status: 'shipped' } }),
      prisma.order.update({ where: { id: order.id }, data: { status: 'partially_shipped' } }),
    ]);
    const before = await readWorkspace(order.id);
    expect(before).toMatchObject({ canPrepare: true, lines: [{ orderItemId: alreadyPrepared.id, revision: 1 }] });
    const prepared = await prepare(order.id);
    expect(prepared.canPrepare).toBe(false);
    expect(prepared.lines).toMatchObject([{ orderItemId: partial.id, source: { quantity: 2 } }, { orderItemId: alreadyPrepared.id, revision: 1 }]);
    expect(await prepare(order.id)).toEqual(prepared);
    const [purchase] = (await saveLine(prepared, 0, terms(2))).orders;
    const [approved] = (await submit(order.id, purchase, { action: 'approve', requestId: 'approve-partial-remainder' })).orders;
    expect(approved).toMatchObject({ status: 'approved', lines: [{ orderItemId: partial.id, source: { quantity: 2 } }] });
  });

  it('preserves a pre-cancellation supplier confirmation and uses a separately audited action for a late one', async () => {
    const order = await seedOrder('test-registered-after-cancellation');
    await acceptAsMerchant(order.id);
    const [draft] = (await saveLine(await readWorkspace(order.id), 0, terms(2))).orders;
    const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approved-before-customer-cancellation' })).orders;
    const at = approved.ledger.find(row => row.action === 'approve')!.createdAt;
    const result = await orderPATCH(new NextRequest(`http://localhost/api/admin/orders/${order.id}`, { method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled', reason: '合成客户取消' }) }), { params: Promise.resolve({ id: order.id }) });
    expect(result.status, JSON.stringify(await result.json())).toBe(200);
    const closed = await readWorkspace(order.id);
    expect(closed).toMatchObject({ orderStatus: 'cancelled', eligibility: { eligible: false }, cancellation: { id: expect.any(String) } });
    expect(Date.parse(closed.cancellation!.occurredAt)).toBeGreaterThan(Date.parse(at));
    expect(closed.orders[0].canRegisterOrder).toBe(true);
    const late = { ...registrationEvidence(), occurredAt: closed.cancellation!.occurredAt, reference: 'TEST-AFTER-CUTOFF' };
    await expect(submit(order.id, closed.orders[0], { ...late, action: 'register_order', requestId: 'normal-register-too-late' })).rejects.toThrow(/须走异常处理/);
    const [exception] = (await submit(order.id, closed.orders[0], { ...late, action: 'record_late_order_exception',
      requestId: 'late-order-resolved', exceptionOutcome: 'supplier_cancelled', description: '供方书面确认撤销迟发的订购。' })).orders;
    expect(exception).toMatchObject({ orderedBefore: false, paidCents: 0, orderReceipt: null });
    expect(exception.ledger.at(-1)?.detail).toMatchObject({ snapshot: { operation: {
      exceptionOutcome: 'supplier_cancelled', responsibleActor: approver.id, cancellation: { id: closed.cancellation!.id },
    } } });
    const original = { action: 'register_order', requestId: 'register-earlier-business-fact', referenceSha256: 'e'.repeat(64), occurredAt: at } as const;
    await expect(submit(order.id, exception, { ...original, reference: late.reference })).rejects.toThrow(/同一笔实际业务凭证/);
    const documented = await previewAction(order.id, exception, { ...original, reference: 'TEST-BEFORE-CUTOFF' });
    await apply(documented);
    await apply(documented);
    const final = await readWorkspace(order.id);
    expect(final).toMatchObject({ orderStatus: 'cancelled', canPrepare: false,
      orders: [{ orderedBefore: true, paidCents: 0, orderReceipt: { occurredAt: at, reference: 'TEST-BEFORE-CUTOFF' } }] });
    expect(activities(approved.id, 'register_order')).toHaveLength(1);
    expect(activities(approved.id, 'record_late_order_exception')).toHaveLength(1);
    expect(activities(approved.id, 'record_payment')).toHaveLength(0);
  });

  it('continues an actual v1-shaped approved deposit without changing the legacy approval, request or payment rows', async () => {
    const order = await seedOrder('test-legacy-v1-deposit');
    await acceptAsMerchant(order.id);
    const workspace = await readWorkspace(order.id);
    const id = 'PO-TEST-V1-DEPOSIT';
    const source = workspace.lines[0].source;
    const fullTerms = terms(source.quantity);
    // The previous version's approval/payment snapshots had these commercial fields and no injected plan version.
    const oldTerms = Object.fromEntries(Object.entries(fullTerms).filter(([key]) => ![
      'writtenSupplier', 'supplierConditions', 'sourceSha256', 'settlementReference', 'settlementSha256', 'leadTimeAssessment',
    ].includes(key)));
    const totalCents = fullTerms.linePayableCents!;
    const lines = [{ orderItemId: source.orderItemId, source, terms: oldTerms, revision: 2 }];
    const contentHash = pricingContentHash({ orderId: order.id, purchaseOrderId: id, totalCents, lines });
    const basis = workspace.eligibility.basis!;
    const eligibility = { eligible: true, reason: null, basis: { acceptanceId: basis.acceptanceId,
      receivableId: basis.receivableId, reserveId: basis.reserveId, amount: order.total } };
    const stamp = new Date().toISOString();
    const approval = { action: 'approve' };
    const deposit = { action: 'record_payment', reference: 'TEST-V1-DEPOSIT-RECEIPT', amountCents: 900, conditionReference: 'TEST-V1-BOOKING-CONDITION' };
    await prisma.$transaction(async tx => {
      await tx.purchaseOrder.create({ data: { id, orderId: order.id, status: 'approved', groupKey: 'TEST-V1-TERMS', revision: 4,
        approvedHash: contentHash, createdAt: stamp, updatedAt: stamp } });
      await tx.purchaseRequirement.update({ where: { orderItemId: source.orderItemId }, data: {
        purchaseOrderId: id, terms: JSON.stringify(oldTerms), revision: 2, updatedAt: stamp,
      } });
      await tx.purchaseActivity.create({ data: { id: 'TEST-V1-SAVED-LINE', orderId: order.id, purchaseOrderId: id, orderItemId: source.orderItemId,
        action: 'save_line', actorId: preparer.id, createdAt: stamp,
        detail: JSON.stringify({ previous: {}, terms: oldTerms, fromPurchase: null, missing: [] }) } });
      for (const operation of [approval, deposit]) {
        const approving = operation.action === 'approve';
        const requestId = `v1-${operation.action}`;
        const version = pricingContentHash({ contentHash, revision: approving ? 2 : 3, status: approving ? 'draft' : 'approved',
          approvedHash: approving ? null : contentHash, paidCents: 0, eligibility, orderStatus: 'confirmed' });
        const snapshot = { actorId: approver.id, requestId, orderId: order.id, purchaseOrderId: id, version,
          totalCents, paidCents: 0, lines, eligibility, operation };
        const intent = pricingContentHash({ actorId: approver.id, input: { orderId: order.id, purchaseOrderId: id, version, requestId, ...operation } });
        await tx.purchaseActivity.create({ data: { id: `TEST-${requestId}`, orderId: order.id, purchaseOrderId: id, actorId: approver.id,
          action: operation.action, createdAt: stamp, requestKey: pricingContentHash({ orderId: order.id, purchaseOrderId: id, requestId }),
          referenceKey: approving ? null : pricingContentHash({ action: operation.action, party: fullTerms.payee, reference: deposit.reference }),
          amountCents: approving ? null : BigInt(900), detail: JSON.stringify({ intent, actionHash: pricingContentHash(snapshot), snapshot }) } });
      }
    });
    const readLegacyRows = () => prisma.purchaseActivity.findMany({ where: { orderId: order.id, action: { in: ['approve', 'record_payment'] } }, orderBy: { id: 'asc' } });
    const archive = await readLegacyRows();
    const [before] = (await readWorkspace(order.id)).orders;
    expect(before).toMatchObject({ needsLegacyReview: true, totalCents, paidCents: 900, orderedBefore: false });
    await expect(register(order.id, before, 'requires-legacy-proof')).rejects.toThrow(/旧采购批准须先具名核对/);
    const review = {
      action: 'review_legacy_approval', requestId: 'archive-proof-review', reference: 'TEST-V1-APPROVAL-ARCHIVE', referenceSha256: 'e'.repeat(64),
      paymentReference: deposit.reference, paymentSha256: '3'.repeat(64), description: '原授权、定金与供货记录相符。',
      revisedTerms: [{ orderItemId: source.orderItemId, terms: fullTerms }],
    } as const;
    await expect(submit(order.id, before, { ...review, revisedTerms: [{ orderItemId: source.orderItemId, terms: { ...fullTerms, linePayableCents: 4000 } }] })).rejects.toThrow(/不改变原授权/);
    const checked = await previewAction(order.id, before, { ...review, revisedTerms: [...review.revisedTerms] });
    await apply(checked);
    await apply(checked);
    const [reviewed] = (await readWorkspace(order.id)).orders;
    expect(reviewed).toMatchObject({ needsLegacyReview: false, totalCents, paidCents: 900, orderedBefore: false });
    expect(reviewed.ledger.at(-1)?.detail).toMatchObject({ snapshot: { operation: { legacyApprovalId: 'TEST-v1-approve',
      evidence: { payments: [{ requestId: 'v1-record_payment', amountCents: 900, receiptReference: deposit.reference }] },
    } } });
    const [registered] = (await submit(order.id, reviewed, { action: 'register_order', requestId: 'continue-historical-registration',
      occurredAt: stamp, reference: 'TEST-V1-DOCUMENTED-SUPPLIER-ORDER', referenceSha256: '4'.repeat(64) })).orders;
    expect(registered).toMatchObject({ totalCents, paidCents: 900, orderedBefore: true, orderReceipt: { occurredAt: stamp } });
    expect(await readLegacyRows()).toEqual(archive);
    expect(activities(id, 'review_legacy_approval')).toHaveLength(1);
    expect(activities(id, 'record_payment')).toHaveLength(1);
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
    const accepted = await prisma.orderStatusHistory.findFirstOrThrow({
      where: { orderId: order.id, actorId: merchant.id, fromStatus: 'pending', toStatus: 'confirmed' },
    });
    expect(await prisma.accountReceivable.findUniqueOrThrow({ where: { orderId: order.id } })).toMatchObject({
      userId: buyer.id, amount: 900, status: 'open', paymentTermDaysSnapshot: 30,
      confirmedAt: accepted.createdAt, termStartedAt: accepted.createdAt, dueAt: new Date(accepted.createdAt.getTime() + 30 * 86400000),
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
      ...alpha, linePayableCents: 3 * alpha.unitPriceCents!, sourceReference: 'TEST-SUPPLIER-REPLY-02', sourceSha256: '2'.repeat(64),
    });
    await saveLine(await readWorkspace(order.id), 2, {
      ...alpha, linePayableCents: 4 * alpha.unitPriceCents!, payee: '合成收款方乙', sourceReference: 'TEST-SUPPLIER-REPLY-03', sourceSha256: '3'.repeat(64),
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
    const mapped = { ...alias, identityReference: 'TEST-LEGAL-NAME-ARCHIVE', identitySha256: 'f'.repeat(64) };
    const relabelled = await saveLine(wrongSource, 0, {
      ...mapped, sourceReference: 'TEST-RENAMED-SAME-FILE', writtenSupplier: alias.supplier,
      unitPriceCents: 1400, linePayableCents: 2800, leadTime: '改成次日', supplierConditions: '改写报盘条件',
      validUntil: new Date(Date.parse(reply.validUntil!) + 86_400_000).toISOString(),
    });
    expect(relabelled.orders).toEqual([]);
    expect(relabelled.lines[0].missing).toEqual(expect.arrayContaining(['与原函供货方及版本一致的书面依据', '覆盖变更后条款的新供应商书面依据']));
    const verified = await saveLine(relabelled, 0, { ...mapped, sourceReference: 'TEST-ARCHIVE-ALIAS-FOR-ORIGINAL' });
    expect(verified.orders).toEqual([expect.objectContaining({ status: 'draft', totalCents: 2750 })]);
    expect(verified.lines[0].terms.verification).toMatchObject({ actorId: preparer.id, version: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const newTerms = { ...verified.lines[0].terms, sourceReference: 'TEST-NEW-SUPPLIER-QUOTE', leadTime: '10个工作日' };
    await expect(saveLine(verified, 0, newTerms)).rejects.toThrow(/新的供货书证/);
    const newVersion = await saveLine(verified, 0, { ...newTerms, sourceSha256: '6'.repeat(64) });
    expect(newVersion.orders[0].contentHash).not.toBe(verified.orders[0].contentHash);
    const [approved] = (await submit(order.id, newVersion.orders[0], { action: 'approve', requestId: 'approve-native-parent' })).orders;
    const [ordered] = (await submit(order.id, approved, { action: 'register_order', requestId: 'register-native-parent', reference: 'TEST-NATIVE-SUPPLIER-ORDER',
      ...registrationEvidence() })).orders;
    const [held] = (await submit(order.id, ordered, { action: 'report_change', requestId: 'report-native-alternative', changeKind: 'unavailable',
      reference: 'TEST-NATIVE-SHORTAGE', description: '原报价的一部分货物缺货。' })).orders;
    await expect(submit(order.id, held, { action: 'resolve_change', requestId: 'deny-native-book-on-new-product', outcome: 'replacement',
      supplierReference: 'TEST-SUPPLIER-NATIVE-CHANGE', supplierSha256: 'b'.repeat(64), customerReference: 'TEST-CUSTOMER-NATIVE-CHANGE', customerSha256: 'd'.repeat(64),
      description: '需要独立书面替代报价。', confirmsFullIncidentScope: true, dispositions: [{ orderItemId: requirement.orderItemId, quantity: 1, outcome: 'replace', replacement: {
        name: '合成不同商品', brand: '不同合成品牌', catalogNumber: 'TEST-NEW-ITEM', spec: '替代规格', unit: '件',
        terms: { ...verified.lines[0].terms, linePayableCents: 1375 },
      } }],
    })).rejects.toThrow(/只涵盖已核准的原品牌、货号、规格及数量/);
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
      ...supplierTerms, unitPriceCents: 1500, linePayableCents: 3000, sourceReference: 'TEST-REVISED-REPLY', sourceSha256: 'c'.repeat(64),
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
      affectedLines:[{orderItemId:order.orderItems[0].id,quantity:2}],
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
      supplierSha256: pricingContentHash('supplier-agrees-to-new-alternate'), customerSha256: pricingContentHash('customer-agrees-to-new-alternate'),
      description: '合成双方书面同意另行替代采购。' };
    await expect(submit(order.id, priceHold, {
      action: 'resolve_change', requestId: 'test-disallow-in-place', outcome: 'revised_terms', ...written,
      revisedTerms: [{ orderItemId: order.orderItems[0].id, terms: terms(2, { unitPriceCents: 1750, linePayableCents: 3500 }) }],
    })).rejects.toThrow(/另建替代采购/);
    const replacement = {
      name: '合成替代品', brand: '合成替代品牌', catalogNumber: 'TEST-ALTERNATE', spec: '合成规格', unit: '件',
      terms: terms(1, { unitPriceCents: 1750, linePayableCents: 1750, sourceReference: 'TEST-PRICE-REPLY-02', sourceSha256: 'e'.repeat(64) }),
    };
    const direction = { action: 'resolve_change', requestId: 'test-new-replacement', outcome: 'replacement', ...written,
      refundFollowup: '原付款留在原单，由财务核对退回凭据。',
      confirmsFullIncidentScope: true, dispositions: [{ orderItemId: order.orderItems[0].id, quantity: 1, outcome: 'replace', replacement }],
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
  it('uses the actual commitment date across a finance adjustment and keeps an unauthorized event in the exception workflow', async () => {
    await adjustCredit({ overrideLimit: 200 });
    const order = await seedOrder('test-as-of-credit-reduction');
    await acceptAsMerchant(order.id);
    const [draft] = (await saveLine(await readWorkspace(order.id), 0, terms(2))).orders;
    const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approval-before-decrease' })).orders;
    const originalApproval = approved.ledger.find(row => row.action === 'approve')!;
    const [deposited] = (await submit(order.id, approved, { action: 'record_payment', requestId: 'deposit-before-decrease',
      amountCents: 900, reference: 'TEST-PRE-CREDIT-DEPOSIT', conditionReference: 'TEST-DEPOSIT-DUE' })).orders;
    await adjustCredit({ overrideLimit: 199 });
    const adjustment = await prisma.auditLog.findFirstOrThrow({ where: { action: 'customer.credit_changed' }, orderBy: { createdAt: 'desc' } });
    expect(adjustment.createdAt.getTime()).toBeGreaterThan(Date.parse(originalApproval.createdAt));
    const at = new Date(adjustment.createdAt.getTime() + 1).toISOString();
    const proof = { reference: 'TEST-DATED-SUPPLIER-COMMITMENT', referenceSha256: 'e'.repeat(64), occurredAt: at };
    const normal = { ...proof, action: 'register_order', requestId: 'register-as-original-approval' } as const;
    const actualEarly = await prisma.$transaction(tx => previewPurchaseAction(tx, { ...normal, orderId: order.id, purchaseOrderId: deposited.id,
      version: deposited.version, occurredAt: originalApproval.createdAt }, approver));
    expect(actualEarly.snapshot.operation).toMatchObject({ credit: { status: 'within_limit', credit: { limitCents: 20000, occupiedCents: 20000 } } });
    await expect(previewAction(order.id, deposited, { ...normal, occurredAt: adjustment.createdAt.toISOString() })).rejects.toThrow(/依据或先后无法确认/);
    await expect(previewAction(order.id, deposited, normal)).rejects.toThrow(/超过授信额度.*当时适用/);
    const [held] = (await submit(order.id, deposited, { ...proof, action: 'record_late_order_exception', requestId: 'register-actual-credit-exception',
      exceptionOutcome: 'liability_review', description: '供方确认实际接受订购，核查原合同义务与定金。' })).orders;
    const [exception] = held.commitmentExceptions;
    expect(held).toMatchObject({ status: 'on_hold', orderedBefore: false, totalCents: 2750, paidCents: 900 });
    expect(exception).toMatchObject({ reference: proof.reference, actorId: approver.id, resolution: null });
    expect(activities(held.id, 'register_order')).toEqual([]);
    await expect(submit(order.id, held, { ...normal, requestId: 'no-duplicate-established-fact' })).rejects.toThrow(/已有实际承诺异常/);
    await expect(submit(order.id, held, { action: 'record_payment', requestId: 'payment-while-checking', amountCents: 100,
      reference: 'TEST-UNVERIFIED-LIABILITY', conditionReference: 'TEST-SUPPLIER-CAUSE' })).rejects.toThrow();
    const [checked] = (await submit(order.id, held, { action: 'resolve_order_exception', requestId: 'confirmed-original-liability',
      exceptionId: exception.id, exceptionResolution: 'payable_verified', reference: 'TEST-SUPPLIER-LIABILITY-ARCHIVE', referenceSha256: 'f'.repeat(64),
      description: '核对原合同应付和已付的900分，确认后续可按原合同处理。' })).orders;
    expect(checked).toMatchObject({ status: 'ordered', orderedBefore: true, totalCents: 2750, paidCents: 900,
      orderReceipt: { exception: true, occurredAt: at }, commitmentExceptions: [{ resolution: 'payable_verified' }] });
    const [paid] = (await submit(order.id, checked, { action: 'record_payment', requestId: 'pay-after-documented-liability', amountCents: 100,
      reference: 'TEST-AP-UNDER-REVIEWED-LIABILITY', conditionReference: 'TEST-ORIGINAL-CONTRACT-DUE' })).orders;
    expect(paid.ledger.at(-1)?.detail).toMatchObject({ snapshot: { operation: { exceptionResolutionId: checked.commitmentExceptions[0].resolutionId } } });
    expect(paid.ledger.find(row => row.id === originalApproval.id)).toEqual(originalApproval);
  });

  it('checks temporary expiry at the commitment instant and only uses a prior matching finance exception', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2031-06-01T08:00:00.000Z'));
      await adjustCredit({ overrideLimit: 199, temporaryLimit: 1, temporaryUntil: '2031-06-01' });
      const order = await seedOrder('test-credit-expiry-at-supplier-commitment');
      await acceptAsMerchant(order.id);
      const [draft] = (await saveLine(await readWorkspace(order.id), 0, terms(2))).orders;
      const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approved-with-temporary-limit' })).orders;
      const account = await prisma.creditAccount.findUniqueOrThrow({ where: { userId: buyer.id } });
      const expiresAt = account.temporaryUntil!.getTime();
      expect(creditLimitTerms(account)).toMatchObject({ overrideLimit: 199, temporaryLimit: 1, temporaryUntil: account.temporaryUntil!.toISOString() });
      vi.setSystemTime(new Date(expiresAt + 2_000));
      const proof = { action: 'register_order', requestId: 'supplier-credit-expiry', reference: 'TEST-DATED-EXPIRY-ORDER', referenceSha256: 'd'.repeat(64) } as const;
      await expect(previewAction(order.id, approved, { ...proof, occurredAt: new Date(expiresAt - 1).toISOString() })).resolves.toMatchObject({ actionHash: expect.any(String) });
      const afterExpiry = new Date(expiresAt + 1).toISOString();
      await expect(previewAction(order.id, approved, { ...proof, occurredAt: afterExpiry })).rejects.toThrow(/超过授信额度/);
      const exception = await startReview(order.id, { ...reviewEvidence, action: 'approve_credit_exception', requestId: 'credit-exception-after-expiry' });
      await applyStart(exception.input);
      await expect(previewAction(order.id, approved, { ...proof, occurredAt: afterExpiry })).rejects.toThrow(/当时适用/);
      vi.setSystemTime(new Date(expiresAt + 4_000));
      const [registered] = (await submit(order.id, approved, { ...proof, occurredAt: new Date().toISOString() })).orders;
      expect(registered.ledger.at(-1)?.detail).toMatchObject({ snapshot: { operation: { credit: { status: 'over_limit', exceptionId: expect.any(String) } } } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reopens a paid historical multi-line PDF only after explicit original document row review', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2031-06-01T08:00:00.000Z'));
      const order = await seedOrder('test-old-multiple-quote-lines', { quantities: [2, 1] });
      await prisma.product.create({ data: { id: 'test-product-b', name: '第二种合成商品', catalogNumber: 'TEST-QUOTE-B', brand: '合成品牌',
        price: 100, costPrice: 30, stockQuantity: 10 } });
      await prisma.orderItem.update({ where: { id: order.orderItems[1].id }, data: { productId: 'test-product-b', name: '第二种合成商品', catalogNumber: 'TEST-QUOTE-B' } });
      await acceptAsMerchant(order.id);
      const finance = (id: string, balanceTerms: string) => startReview(order.id, { ...reviewEvidence, action: 'review_customer_terms',
        requestId: id, paymentMode: 'credit', balanceTerms });
      await applyStart((await finance('credit-origin', '原客户账期条件')).input);
      const sha256 = 'e'.repeat(64);
      const quoted = (quantity: number, row: number) => terms(quantity, { sourceSha256: sha256, sourceReference: 'TEST-LEGACY-MULTILINE-PDF',
        sourceDocumentKind: 'multiple_items', sourceDocumentRow: row });
      const first = await saveLine(await readWorkspace(order.id), 0, quoted(2, 1));
      const [draft] = (await saveLine(first, 1, quoted(1, 2))).orders;
      const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'old-shared-doc-approve' })).orders;
      const [deposited] = (await submit(order.id, approved, { action: 'record_payment', requestId: 'old-shared-doc-deposit', amountCents: 900,
        reference: 'TEST-HISTORICAL-DOC-DEPOSIT', conditionReference: 'TEST-PREPAY-DUE' })).orders;
      await omitDocumentRowsFromArchivedPurchase(order.id, deposited);
      const oldRows = () => prisma.purchaseActivity.findMany({ where: { purchaseOrderId: deposited.id, action: { in: ['approve', 'record_payment'] } }, orderBy: { id: 'asc' } });
      const original = await oldRows();
      const linesBefore = await prisma.purchaseRequirement.findMany({ where: { orderId: order.id }, orderBy: { orderItemId: 'asc' } });
      vi.setSystemTime(new Date('2031-06-01T09:00:00.000Z'));
      await applyStart((await finance('credit-revised', '实质变更后的客户账期条件')).input);
      const [old] = (await readWorkspace(order.id)).orders;
      expect(old).toMatchObject({ needsFundingReapproval: true, paidCents: 900, documentReviewLines: order.orderItems.map(item => ({ orderItemId: item.id, sha256 })) });
      const request = { action: 'reapprove_purchase', requestId: 'review-old-pdf', reference: 'TEST-CURRENT-CONDITIONS', referenceSha256: 'b'.repeat(64),
        description: '同一原件中两项实价报价，按原文件逐行核对。' } as const;
      await expect(submit(order.id, old, request)).rejects.toThrow(/逐行核对旧供货书证/);
      const scopes = order.orderItems.map((item, i) => ({ orderItemId: item.id, sha256, kind: 'multiple_items', row: i + 1 }));
      await expect(submit(order.id, old, { ...request, documentScopes: scopes.map(row => ({ ...row, row: 1 })) })).rejects.toThrow(/各自的报价行/);
      await expect(submit(order.id, old, { ...request, documentScopes: scopes.map(row => ({ ...row, sha256: 'a'.repeat(64) })) })).rejects.toThrow(/同一供货文件/);
      const [restored] = (await submit(order.id, old, { ...request, documentScopes: scopes })).orders;
      expect(restored).toMatchObject({ paidCents: 900, totalCents: 4125, needsFundingReapproval: false, documentReviewLines: [] });
      expect(restored.ledger.at(-1)?.detail).toMatchObject({ snapshot: { operation: { documentScopes: [
        { terms: { sourceSha256: sha256, sourceDocumentRow: 1 } }, { terms: { sourceSha256: sha256, sourceDocumentRow: 2 } },
      ] } } });
      expect(await oldRows()).toEqual(original);
      expect(await prisma.purchaseRequirement.findMany({ where: { orderId: order.id }, orderBy: { orderItemId: 'asc' } })).toEqual(linesBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([false, true])('restores the sole selected row of a historical multi-item PDF (another old order uses it=%s)', async shared => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2031-06-02T08:00:00.000Z'));
      const sha256 = 'a'.repeat(64);
      const finance = async (orderId: string, revised = false) => applyStart((await startReview(orderId, { ...reviewEvidence,
        action: 'review_customer_terms', requestId: revised ? 'revised-customer-credit' : 'initial-customer-credit',
        paymentMode: 'credit', balanceTerms: revised ? '更改后的合成账期' : '原合成客户账期' })).input);
      const create = async (label: string, row: number, unitPriceCents: number) => {
        const order = await seedOrder(`test-old-document-${label}`, { quantities: [1] });
        const [item] = order.orderItems;
        const product = await prisma.product.create({ data: { id: `test-doc-sku-${label}`, name: `合成商品 ${label}`, catalogNumber: `TEST-QUOTE-${label}`,
          brand: '合成品牌', price: 100, costPrice: 30, stockQuantity: 10 } });
        await prisma.orderItem.update({ where: { id: item.id }, data: { productId: product.id, name: product.name, catalogNumber: product.catalogNumber } });
        await acceptAsMerchant(order.id);
        await finance(order.id);
        const [draft] = (await saveLine(await readWorkspace(order.id), 0, terms(1, {
          sourceSha256: sha256, sourceReference: 'TEST-ORIGINAL-QUOTE-FILE', sourceDocumentKind: 'multiple_items', sourceDocumentRow: row,
          unitPriceCents, linePayableCents: unitPriceCents,
        }))).orders;
        const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approve-archival-purchase' })).orders;
        const [purchase] = (await submit(order.id, approved, { action: 'record_payment', requestId: 'record-archival-deposit', amountCents: 900,
          reference: `TEST-ARCHIVAL-DEPOSIT-${label}`, conditionReference: 'TEST-DEPOSIT-DUE' })).orders;
        return { order, item, purchase, row, unitPriceCents };
      };
      const first = await create('FIRST', 3, 3673);
      const second = shared ? await create('SECOND', 7, 2500) : null;
      for (const evidence of second ? [first, second] : [first]) {
        await omitDocumentRowsFromArchivedPurchase(evidence.order.id, evidence.purchase);
      }
      vi.setSystemTime(new Date('2031-06-02T09:00:00.000Z'));
      await finance(first.order.id, true);
      if (second) await finance(second.order.id, true);
      const request = (evidence: typeof first, row = evidence.row): ActionRequest => ({
        action: 'reapprove_purchase', requestId: 'review-selected-original-row', reference: 'TEST-REVISED-CREDIT', referenceSha256: 'f'.repeat(64),
        description: '比对原件中的对应报价行，定金及原批准继续留存。',
        documentScopes: [{ orderItemId: evidence.item.id, sha256, kind: 'multiple_items', row }],
      });
      const [firstPending] = (await readWorkspace(first.order.id)).orders;
      expect(firstPending.documentReviewLines).toMatchObject([{ orderItemId: first.item.id, sha256 }]);
      const proposedConflict = second
        ? await previewAction(second.order.id, (await readWorkspace(second.order.id)).orders[0], request(second, 3))
        : null;
      const [firstChecked] = (await submit(first.order.id, firstPending, request(first))).orders;
      expect(firstChecked).toMatchObject({ needsFundingReapproval: false, documentReviewLines: [], totalCents: first.unitPriceCents, paidCents: 900 });
      expect(firstChecked.ledger).toContainEqual(expect.objectContaining({
        action: 'review_supplier_document_scope', purchaseOrderId: first.purchase.id, orderItemId: first.item.id, actorId: approver.id,
        detail: expect.objectContaining({ document: expect.objectContaining({ sha256, row: 3 }) }),
      }));
      const incoming = await seedOrder('test-new-purchase-same-document', { quantities: [1] });
      await acceptAsMerchant(incoming.id);
      await finance(incoming.id);
      const incomingWorkspace = await readWorkspace(incoming.id);
      const anotherRow = terms(1, { sourceSha256: sha256, sourceReference: 'TEST-ORIGINAL-QUOTE-FILE',
        sourceDocumentKind: 'multiple_items', sourceDocumentRow: 2, validUntil: firstChecked.lines[0].terms.validUntil });
      if (second) {
        const [stillPending] = (await readWorkspace(second.order.id)).orders;
        expect(stillPending).toMatchObject({ needsFundingReapproval: true, documentReviewLines: [{ orderItemId: second.item.id, sha256 }], paidCents: 900 });
        await expect(saveLine(incomingWorkspace, 0, anotherRow)).rejects.toThrow(/旧供货书证须先以原件逐行核对/);
        await expect(apply(proposedConflict!)).rejects.toThrow(/该供货书证行已对应其他商品/);
        await expect(submit(second.order.id, stillPending, request(second, 3))).rejects.toThrow(/该供货书证行已对应其他商品/);
        expect((await readWorkspace(second.order.id)).orders[0].version).toBe(stillPending.version);
        const [secondChecked] = (await submit(second.order.id, stillPending, request(second))).orders;
        expect(secondChecked).toMatchObject({ needsFundingReapproval: false, documentReviewLines: [], totalCents: second.unitPriceCents, paidCents: 900 });
        expect(secondChecked.ledger.at(-1)?.detail).toMatchObject({ snapshot: { operation: { documentScopes: [
          { terms: { sourceSha256: sha256, sourceDocumentRow: 7, unitPriceCents: second.unitPriceCents } },
        ] } } });
      }
      await expect(saveLine(incomingWorkspace, 0, { ...anotherRow, sourceDocumentRow: 3 })).rejects.toThrow(/该供货书证行已对应其他商品/);
      const [nextDraft] = (await saveLine(incomingWorkspace, 0, anotherRow)).orders;
      expect(nextDraft).toMatchObject({ status: 'draft', paidCents: 0, approvedHash: null });
      const [nextApproved] = (await submit(incoming.id, nextDraft, { action: 'approve', requestId: 'approve-new-quote-row' })).orders;
      expect(nextApproved.ledger.find(row => row.action === 'approve')?.detail).toMatchObject({ snapshot: { purchaseOrderId: nextDraft.id,
        lines: [{ source: { catalogNumber: 'TEST-SKU' }, terms: { sourceSha256: sha256, sourceDocumentRow: 2 } }],
      } });

      const same = await seedOrder('test-new-purchase-same-approved-quote-line', { quantities: [1] });
      const [oldLine] = firstChecked.lines;
      await prisma.orderItem.update({ where: { id: same.orderItems[0].id }, data: {
        productId: oldLine.source.productId, catalogNumber: oldLine.source.catalogNumber, name: oldLine.source.name,
      } });
      await acceptAsMerchant(same.id);
      const [sameDraft] = (await saveLine(await readWorkspace(same.id), 0, {
        ...oldLine.terms, sourceDocumentKind: 'multiple_items', sourceDocumentRow: 3,
      })).orders;
      expect(sameDraft).toMatchObject({ status: 'draft', approvedHash: null });
      const [independent] = (await submit(same.id, sameDraft, { action: 'approve', requestId: 'approve-same-quote-separately' })).orders;
      expect(independent.ledger.find(row => row.action === 'approve')).toMatchObject({ purchaseOrderId: sameDraft.id, actorId: approver.id });
      expect(await prisma.purchaseRequirement.findUnique({ where: { orderItemId: first.item.id } })).toMatchObject({
        terms: expect.not.stringContaining('sourceDocumentKind'),
      });
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([false, true])('keeps a paid deposit through equivalent finance review and explicitly reapproves changed future terms (prior digest=%s)', async olderDigest => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2031-05-01T08:00:00.000Z'));
      const order = await seedOrder(`test-semantic-funding-${olderDigest}`);
      await acceptAsMerchant(order.id);
      const finance = (id: string, balanceTerms: string) => startReview(order.id, { ...reviewEvidence, reference: `TEST-AGREEMENT-${id}`,
        action: 'review_customer_terms', requestId: id, paymentMode: 'credit', balanceTerms });
      await applyStart((await finance('initial-net30', '合成账期 30 天')).input);
      const [draft] = (await saveLine(await readWorkspace(order.id), 0, terms(2))).orders;
      const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'approve-net30' })).orders;
      const approvalId = approved.ledger.find(row => row.action === 'approve')!.id;
      await submit(order.id, approved, { action: 'record_payment', requestId: 'supplier-deposit-before-review', amountCents: 900,
        reference: 'TEST-HISTORY-DEPOSIT', conditionReference: 'TEST-DEPOSIT-DUE' });
      if (olderDigest) {
        const old = await prisma.purchaseActivity.findUniqueOrThrow({ where: { id: approvalId } });
        const detail = JSON.parse(old.detail);
        delete detail.fundingTermsVersion;
        delete detail.snapshot.funding;
        detail.actionHash = pricingContentHash(detail.snapshot);
        await prisma.purchaseActivity.update({ where: { id: approvalId }, data: { detail: JSON.stringify(detail) } });
      }
      const original = await prisma.purchaseActivity.findMany({ where: { orderId: order.id, action: { in: ['approve', 'record_payment'] } } });
      vi.setSystemTime(new Date('2031-05-01T09:00:00.000Z'));
      await applyStart((await finance('equivalent-net30', '合成账期   30 天')).input);
      const [unchanged] = (await readWorkspace(order.id)).orders;
      expect(unchanged).toMatchObject({ paidCents: 900, needsFundingReapproval: false });
      const register = { action: 'register_order', requestId: 'actual-old-time', reference: 'TEST-ORDER-UNDER-ORIGINAL-TERMS',
        occurredAt: new Date().toISOString(), referenceSha256: 'd'.repeat(64) } as const;
      await expect(previewAction(order.id, unchanged, register)).resolves.toMatchObject({ actionHash: expect.any(String) });
      vi.setSystemTime(new Date('2031-05-01T10:00:00.000Z'));
      await applyStart((await finance('different-net60', '合成账期 60 天')).input);
      const [changed] = (await readWorkspace(order.id)).orders;
      expect(changed).toMatchObject({ paidCents: 900, needsFundingReapproval: true, orderedBefore: false });
      await expect(previewAction(order.id, changed, { ...register, occurredAt: new Date().toISOString() })).rejects.toThrow(/业务条件与该版采购批准不一致/);
      const historical = await prisma.$transaction(tx => previewPurchaseAction(tx, { ...register, orderId: order.id, purchaseOrderId: changed.id, version: changed.version }, approver));
      expect(historical.snapshot.operation).toMatchObject({ execution: { approvalId }, fundingPlan: { balanceTerms: '合成账期   30 天' } });
      vi.setSystemTime(new Date('2031-05-01T10:30:00.000Z'));
      await applyStart((await finance('later-reverted-to-net30', '合成账期 30 天')).input);
      expect((await readWorkspace(order.id)).orders[0].needsFundingReapproval).toBe(true);
      vi.setSystemTime(new Date('2031-05-01T11:00:00.000Z'));
      await applyStart((await finance('current-net60', '合成账期 60 天')).input);
      const [toReview] = (await readWorkspace(order.id)).orders;
      const [renewed] = (await submit(order.id, toReview, { action: 'reapprove_purchase', requestId: 'approve-future-net60',
        reference: 'TEST-NEW-AGREEMENT', referenceSha256: 'f'.repeat(64), description: '核对后续订购沿用原供应商与定金。' })).orders;
      expect(renewed).toMatchObject({ needsFundingReapproval: false, paidCents: 900, orderedBefore: false });
      expect(renewed.ledger.at(-1)?.detail).toMatchObject({ snapshot: { operation: { originalApprovalId: approvalId, payments: [{ amountCents: 900, reference: 'TEST-HISTORY-DEPOSIT' }] } } });
      const [final] = (await submit(order.id, renewed, { ...register, requestId: 'actually-order-under-renewed-terms', occurredAt: new Date().toISOString() })).orders;
      expect(final).toMatchObject({ paidCents: 900, orderedBefore: true });
      expect(final.ledger.find(row => row.action === 'register_order')?.detail).toMatchObject({ snapshot: { operation: {
        fundingPlan: { balanceTerms: '合成账期 60 天' }, execution: { approvalId: renewed.ledger.at(-1)?.id },
      } } });
      expect(await prisma.purchaseActivity.findMany({ where: { orderId: order.id, action: { in: ['approve', 'record_payment'] } } })).toEqual(original);
    } finally {
      vi.useRealTimers();
    }
  });

  it('backfills a documented supplier order from before a supply hold while leaving the hold open', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2031-05-01T08:00:00.000Z'));
      const order = await seedOrder('test-actual-order-before-supply-hold');
      await acceptAsMerchant(order.id);
      const [draft] = (await saveLine(await readWorkspace(order.id), 0, terms(2))).orders;
      const [approved] = (await submit(order.id, draft, { action: 'approve', requestId: 'before-hold-approval' })).orders;
      vi.setSystemTime(new Date('2031-05-01T10:00:00.000Z'));
      const [held] = (await submit(order.id, approved, { action: 'report_change', requestId: 'after-actual-order-hold', changeKind: 'price',
        reference: 'TEST-HOLD-NOTICE', description: '合成供应商变更仍待核对。' })).orders;
      expect(held.canRegisterOrder).toBe(true);
      const receipt = { action: 'register_order', requestId: 'actual-proof-while-held', reference: 'TEST-PRE-HOLD-ORDER', referenceSha256: 'c'.repeat(64) } as const;
      await expect(submit(order.id, held, { ...receipt, occurredAt: new Date().toISOString() })).rejects.toThrow(/供应条件未暂停/);
      const [recorded] = (await submit(order.id, held, { ...receipt, occurredAt: '2031-05-01T09:00:00.000Z' })).orders;
      expect(recorded).toMatchObject({ status: 'on_hold', orderedBefore: true, openIncidentId: held.openIncidentId,
        orderReceipt: { occurredAt: '2031-05-01T09:00:00.000Z' } });
      expect(activities(recorded.id, 'register_order')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
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

    const proof = bankProof('TEST-BANK-TRANSACTION-1');
    const verified = await verifyBank(first.id, proof);
    await expect(startReview(second.id, bankProof('TEST-RENAMED-ALIAS', { reference: 'TEST-RENAMED-SAME-SINGLE-RECEIPT' })))
      .rejects.toThrow(/这笔银行到账已经核验/);
    await expect(startReview(second.id, bankProof('TEST-RENAMED-AS-STATEMENT', { documentKind: 'statement', statementRow: 2 })))
      .rejects.toThrow(/这笔银行到账已经核验/);
    const cash = { ...reviewEvidence, action: 'record_customer_receipt', bankReceiptId: verified.id } as const;
    await expect(startReview(first.id, { ...cash, requestId: 'test-invoice-not-receipt', receiptKind: 'invoice',
      allocationReference: 'TEST-INVOICE', amountCents: 15000 })).rejects.toThrow(/实际到账凭证/);
    const firstShare = await startReview(first.id, { ...cash, receiptKind: 'bank_receipt', requestId: 'test-first-share',
      allocationReference: 'TEST-ALLOC-1', amountCents: 15000 });
    const secondBefore = await startReview(second.id, { ...cash, requestId: 'test-second-share', allocationReference: 'TEST-ALLOC-2', amountCents: 5000 });
    await applyStart(firstShare.input);
    await applyStart(firstShare.input);
    expect((await readWorkspace(first.id)).eligibility).toMatchObject({ eligible: true, basis: {
      mode: 'partial_prepay', payment: { receivedCents: 15000 }, credit: { owedCents: 5000 },
    } });
    await expect(applyStart(secondBefore.input)).rejects.toThrow(/依据已变化/);
    const secondShare = await startReview(second.id, { ...cash, receiptKind: 'bank_receipt', requestId: 'test-second-share',
      allocationReference: 'TEST-ALLOC-2', amountCents: 5000 });
    await applyStart(secondShare.input);
    expect((await readWorkspace(second.id)).startReview.payment.receivedCents).toBe(5000);
    expect((await readWorkspace(second.id)).eligibility.eligible).toBe(false);
    await expect(startReview(second.id, { ...cash, receiptKind: 'bank_receipt', requestId: 'test-improper-overallocation',
      allocationReference: 'TEST-ALLOC-3', amountCents: 1 })).rejects.toThrow(/剩余可用金额/);

    const statement = { sha256: 'f'.repeat(64), reference: 'TEST-MULTI-ROW-BANK-STATEMENT', documentKind: 'statement' } as const;
    const actualSecond = await verifyBank(second.id, bankProof('TEST-BANK-TRANSACTION-2', { ...statement, statementRow: 1 }));
    const anotherStatementRow = await verifyBank(second.id, bankProof('TEST-BANK-TRANSACTION-3', { ...statement, statementRow: 2 }));
    expect(anotherStatementRow.id).not.toBe(actualSecond.id);
    const duplicate = await startReview(second.id, { ...cash, bankReceiptId: actualSecond.id, requestId: 'test-duplicate-allocation',
      allocationReference: 'TEST-ALLOC-2', amountCents: 10000 });
    await expect(applyStart(duplicate.input)).rejects.toThrow();
    const newShare = await startReview(second.id, { ...cash, bankReceiptId: actualSecond.id, requestId: 'test-new-actual-cash',
      allocationReference: 'TEST-ALLOC-4', amountCents: 10000 });
    await applyStart(newShare.input);
    expect((await readWorkspace(second.id)).eligibility).toMatchObject({ eligible: true, basis: {
      mode: 'partial_prepay', payment: { receivedCents: 15000 }, credit: { owedCents: 5000 },
    } });
    expect(await prisma.creditTransaction.count({ where: { type: 'reserve' } })).toBe(2);
  });

  it('associates a legacy bank split once with the verified debtor without rewriting its original record', async () => {
    const order = await seedOrder('test-legacy-bank-receipt');
    const outsider = { id: 'test-unrelated-debtor', email: 'other-debtor@example.test' };
    seedUser(getTestDb(), outsider);
    await prisma.creditAccount.create({ data: { userId: outsider.id, baseLimit: 10000, paymentTermDays: 30 } });
    const unrelated = await seedOrder('test-other-bank-owner');
    await prisma.order.update({ where: { id: unrelated.id }, data: { customerId: outsider.id, email: outsider.email } });
    await acceptAsMerchant(unrelated.id);
    await acceptAsMerchant(order.id);
    await applyStart((await startReview(order.id, { ...reviewEvidence, action: 'review_customer_terms', requestId: 'test-legacy-cash-plan',
      paymentMode: 'partial_prepay', requiredPrepayCents: 5000, balanceTerms: '合成余款约定' })).input);
    const proof = bankProof('TEST-VERIFIED-REAL-TRACE');
    const original = { receiptKind: 'bank_receipt', transactionReference: 'TEST-OLD-ALIAS', allocationReference: 'TEST-OLD-SPLIT',
      sha256: proof.sha256, occurredAt: proof.occurredAt, receiptTotalCents: 20000, amountCents: 5000 };
    const detail = JSON.stringify({ snapshot: { operation: original } });
    await prisma.purchaseActivity.create({ data: { orderId: order.id, action: 'record_customer_receipt', id: 'TEST-ORIGINAL-MANUAL', actorId: approver.id,
      amountCents: BigInt(5000), createdAt: new Date().toISOString(), detail } });
    expect((await readWorkspace(order.id)).startReview.payment.receivedCents).toBe(0);
    const bank = await verifyBank(order.id, proof);
    const split = { ...reviewEvidence, action: 'record_customer_receipt', requestId: 'attach-old-split', bankReceiptId: bank.id,
      legacyAllocationId: 'TEST-ORIGINAL-MANUAL', amountCents: 5000 } as const;
    await expect(startReview(unrelated.id, split)).rejects.toThrow(/尚未核验归属/);
    await expect(startReview(order.id, { ...split, amountCents: 5001 })).rejects.toThrow(/原人工分摊.*一致/);
    const checked = await startReview(order.id, split);
    await applyStart(checked.input);
    await applyStart(checked.input);
    await expect(startReview(order.id, { ...split, requestId: 'attach-old-again' })).rejects.toThrow(/已经核验关联/);
    expect((await readWorkspace(order.id)).startReview.payment).toMatchObject({ receivedCents: 5000, excludedReceiptIds: [] });
    expect(await prisma.purchaseActivity.findUnique({ where: { id: 'TEST-ORIGINAL-MANUAL' } })).toMatchObject({ detail });
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
      const item = order.orderItems[0].id;
      const withHold = await submit(order.id, withApproval.orders.find(row => row.id === first.id)!, {
        action: 'report_change', requestId: 'test-supplier-hold', changeKind: 'delay', reference: 'TEST-DELAY', description: '待核对原供方履约。',
        affectedLines:[{orderItemId:item,quantity:2}],
      });
      vi.setSystemTime(new Date('2031-04-01T10:00:00.000Z'));
      const partiallyReleased = await submit(order.id, withHold.orders.find(row => row.id === first.id)!, {
        action:'resolve_change',requestId:'test-release-only-one-unit',outcome:'original_terms',coordinationLines:[{orderItemId:item,quantity:1}],
        supplierReference:'TEST-PARTIAL-SUPPLIER-REPLY',customerReference:'TEST-PARTIAL-CUSTOMER-REPLY',
        supplierSha256:pricingContentHash('supplier continuation only for one unit'),customerSha256:pricingContentHash('customer continuation only for one unit'),
        description:'仅一件核对完毕，另一件仍待核对。',
      });
      const stillHeld = partiallyReleased.orders.find(row=>row.id===first.id)!;
      expect(stillHeld).toMatchObject({status:'on_hold',incident:{outstanding:[{orderItemId:item,quantity:1}]}});
      vi.setSystemTime(new Date('2031-04-01T10:15:00.000Z'));
      await expect(previewAction(order.id,stillHeld,{action:'register_order',requestId:'test-disallow-buy-after-partial-release',
        reference:'TEST-COMMITMENT-DURING-PARTIAL-HOLD',referenceSha256:pricingContentHash('during partial hold'),
        occurredAt:'2031-04-01T10:14:00.000Z'})).rejects.toThrow();

      vi.setSystemTime(new Date('2031-04-01T10:30:00.000Z'));
      await submit(order.id, stillHeld, {
        action: 'resolve_change', requestId: 'test-supplier-hold-release', outcome: 'original_terms',
        supplierReference: 'TEST-ORIGINAL-SUPPLIER-REPLY', customerReference: 'TEST-ORIGINAL-CUSTOMER-REPLY',
        supplierSha256: pricingContentHash('supplier-confirmed-continuing-this-approved-order'),
        customerSha256: pricingContentHash('customer-confirmed-continuing-this-approved-order'),
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

describe('order purchase continuation', () => {
  it('settles the eligible order, resumes its waiting neighbour after a documented decision and retains one original line', async () => {
    const waiting = await seedOrder('office-clip-order-waiting', { status: 'confirmed' });
    await prisma.$transaction(tx => reserveOrderCredit(tx, waiting.id, merchant.id));
    expect(await discoverOrderPurchaseWork()).toBe(1);
    expect(await runOrderPurchaseContinuationOnce()).toMatchObject({ status: 'awaiting_human' });
    const other = await seedOrder('office-box-order-active');
    await acceptAsMerchant(other.id);
    expect(await discoverOrderPurchaseWork()).toBe(0);
    expect(await runOrderPurchaseContinuationOnce()).toMatchObject({ status: 'succeeded' });
    const where = (orderId: string) => ({ dedupeKey: purchaseContinuationKey(orderId) });
    const old = await prisma.backgroundTask.findUniqueOrThrow({ where: where(waiting.id) });
    const ready = await prisma.backgroundTask.findUniqueOrThrow({ where: where(other.id) });
    expect(old.status).toBe('awaiting_human');
    expect(old.attempts).toBe(0);
    expect(JSON.parse(ready.result!)).toMatchObject({ orderId: other.id, orderItemIds: [other.orderItems[0].id] });
    const record = await startReview(waiting.id, { ...reviewEvidence, action: 'verify_acceptance', requestId: 'office-archive',
      originalActor: merchant.id, authorityReference: 'OFFICE-ARCHIVED-ACCEPTANCE', occurredAt: waiting.createdAt.toISOString() });
    await applyStart(record.input);
    expect(await runOrderPurchaseContinuationOnce(new Date(Date.now() + 16 * 60_000))).toMatchObject({ id: old.id, status: 'succeeded' });
    const current = await prisma.backgroundTask.findUniqueOrThrow({ where: where(waiting.id) });
    expect(JSON.parse(current.result!)).toMatchObject({ ownerId: approver.id, orderItemIds: [waiting.orderItems[0].id], outcome: 'prepared' });
    expect(await prisma.purchaseRequirement.findUniqueOrThrow({ where: { orderItemId: waiting.orderItems[0].id } })).toMatchObject({ ownerId: approver.id, purchaseOrderId: null });
    expect(await prisma.purchaseActivity.count({ where: { orderId: waiting.id, action: 'prepare', actorId: 'system:purchase-preparation' } })).toBe(1);
    expect(await runOrderPurchaseContinuationOnce(new Date(Date.now() + 24 * 3_600_000))).toBeNull();
    expect(await prisma.backgroundTask.findUniqueOrThrow({ where: where(other.id) })).toEqual(ready);
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });

  it('isolates a malformed source without touching a different order or the supplier wait', async () => {
    const damaged = await prisma.backgroundTask.create({ data: { type: PURCHASE_CONTINUATION, status: PURCHASE_READY,
      dedupeKey: purchaseContinuationKey('damaged'), payload: JSON.stringify({ orderId: 'other', version: null }), runAt: new Date(0), maxAttempts: 1 } });
    const human = await prisma.backgroundTask.create({ data: { type: 'inquiry.supplier_written_quote', payload: '{}', status: 'awaiting_human' } });
    const order = await seedOrder('office-paper-other-order');
    await acceptAsMerchant(order.id);
    expect(await runOrderPurchaseContinuationOnce()).toMatchObject({ id: damaged.id, status: 'attempt_failed' });
    expect(await runOrderPurchaseContinuationOnce()).toMatchObject({ status: 'succeeded' });
    expect(await prisma.backgroundTask.findUniqueOrThrow({ where: { id: human.id } })).toEqual(human);
    expect(await prisma.backgroundTask.findUniqueOrThrow({ where: { id: damaged.id } })).toMatchObject({ status: 'failed', attempts: 1 });
    expect(await prisma.auditLog.count({ where: { targetId: damaged.id, action: 'purchase.continuation_failed' } })).toBe(1);
    expect(await prisma.purchaseActivity.count({ where: { orderId: order.id, action: 'prepare' } })).toBe(1);
  });

  it('does not spend the failure budget on waiting, and rolls back a stopped preparation before retrying',async()=>{
    const id='office-atomic-purchase-continuation';
    const order=await seedOrder(id,{status:'confirmed'});
    await prisma.$transaction(tx=>reserveOrderCredit(tx,id,merchant.id));
    await discoverOrderPurchaseWork();
    expect(await runOrderPurchaseContinuationOnce()).toMatchObject({status:'awaiting_human'});
    const task=await prisma.backgroundTask.findUniqueOrThrow({where:{dedupeKey:purchaseContinuationKey(id)}});
    await prisma.backgroundTask.update({where:{id:task.id},data:{attempts:9,lastError:'legacy busy',maxAttempts:3}});
    const later=new Date(Date.now()+60*60_000);
    expect(await runOrderPurchaseContinuationOnce(later)).toMatchObject({status:'awaiting_human'});
    expect(await prisma.backgroundTask.findUniqueOrThrow({where:{id:task.id}})).toMatchObject({attempts:0,status:'awaiting_human'});
    expect(await prisma.auditLog.findFirst({where:{targetId:task.id,beforeData:{contains:'legacy busy'}}})).not.toBeNull();
    await applyStart((await startReview(id,{...reviewEvidence,action:'verify_acceptance',requestId:'office-atomic-archive',
      originalActor:merchant.id,authorityReference:'ORIGINAL-OFFICE-APPROVAL',occurredAt:order.createdAt.toISOString()})).input);

    const db=getTestDb();
    db.exec(`CREATE TRIGGER test_stop_purchase_activity BEFORE INSERT ON "PurchaseActivity"
      WHEN NEW.orderId='office-atomic-purchase-continuation' AND NEW.action='prepare'
      BEGIN SELECT RAISE(ABORT, 'synthetic stop after writing purchase requirement'); END`);
    const retryAt=new Date(later.getTime()+16*60_000);
    try {
      expect(await runOrderPurchaseContinuationOnce(retryAt)).toMatchObject({id:task.id,status:'attempt_failed'});
      expect(await prisma.backgroundTask.findUniqueOrThrow({where:{id:task.id}})).toMatchObject({
        status:PURCHASE_READY,attempts:1,lockedBy:null,lockedAt:null,completedAt:null,
      });
      expect(await prisma.purchaseRequirement.count({where:{orderId:id}})).toBe(0);
      expect(await runOrderPurchaseContinuationOnce(new Date(retryAt.getTime()+2*60_000))).toMatchObject({status:'attempt_failed'});
      expect(await prisma.backgroundTask.findUniqueOrThrow({where:{id:task.id}})).toMatchObject({status:PURCHASE_READY,attempts:2});
    } finally { db.exec('DROP TRIGGER test_stop_purchase_activity'); }

    expect(await runOrderPurchaseContinuationOnce(new Date(retryAt.getTime()+10*60_000))).toMatchObject({status:'succeeded'});
    expect(await prisma.backgroundTask.findUniqueOrThrow({where:{id:task.id}})).toMatchObject({status:'succeeded',attempts:0,lastError:null});
    expect(await prisma.auditLog.count({where:{targetId:task.id,action:'purchase.continuation_failed'}})).toBe(2);
    expect(await prisma.purchaseRequirement.count({where:{orderId:id}})).toBe(1);
    expect(await prisma.purchaseActivity.count({where:{orderId:id,action:'prepare'}})).toBe(1);
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });

  it('does not report a business failure when the claim rolled back and another version was written',async()=>{
    const id='office-replaced-continuation-while-recording-failure';
    const task=await prisma.backgroundTask.create({data:{type:PURCHASE_CONTINUATION,status:PURCHASE_READY,
      dedupeKey:purchaseContinuationKey(id),payload:'damaged-json',runAt:new Date(0)}});
    const replacement=JSON.stringify({orderId:id,version:'a'.repeat(64)});
    const transaction=prisma.$transaction.bind(prisma);
    const spy=vi.spyOn(prisma,'$transaction').mockImplementationOnce((async(fn:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>{
      try { return await transaction(fn); }
      catch(error) {
        await prisma.backgroundTask.update({where:{id:task.id},data:{payload:replacement}});
        throw error;
      }
    }) as typeof prisma.$transaction);
    try { expect(await runOrderPurchaseContinuationOnce()).toBeNull(); }
    finally { spy.mockRestore(); }
    expect(await prisma.backgroundTask.findUniqueOrThrow({where:{id:task.id}})).toMatchObject({
      status:PURCHASE_READY,payload:replacement,attempts:0,lastError:null,lockedBy:null,lockedAt:null,
    });
    expect(await prisma.auditLog.count({where:{targetId:task.id,action:'purchase.continuation_failed'}})).toBe(0);
  });

  it('preserves a real acceptance beside a damaged task, then keeps the failed attempt on explicit repair',async()=>{
    const order=await seedOrder('office-acceptance-with-damaged-continuation');
    const task=await prisma.backgroundTask.create({data:{type:PURCHASE_CONTINUATION,status:'awaiting_human',
      dedupeKey:purchaseContinuationKey(order.id),payload:'damaged-input',result:'damaged-receipt',runAt:new Date(0),maxAttempts:1}});
    await acceptAsMerchant(order.id);
    const view=await readWorkspace(order.id);
    expect(view).toMatchObject({eligibility:{eligible:true},continuation:{status:'awaiting_human',reason:'请核对本单原采购接续记录'}});
    expect(await runOrderPurchaseContinuationOnce()).toMatchObject({id:task.id,status:'attempt_failed'});
    await prisma.$transaction(tx=>prepareOrderPurchases(tx,order.id,preparer,true));
    expect(await prisma.auditLog.findFirst({where:{targetId:task.id,action:'purchase.continuation_requested',beforeData:{contains:'damaged-input'}}})).not.toBeNull();
    expect(await runOrderPurchaseContinuationOnce()).toMatchObject({id:task.id,status:'succeeded'});
    expect(await prisma.auditLog.count({where:{targetId:task.id,action:'purchase.continuation_failed'}})).toBe(1);
    expect(await prisma.purchaseActivity.count({where:{orderId:order.id,action:'prepare'}})).toBe(1);
    expect(await prisma.orderStatusHistory.count({where:{orderId:order.id,toStatus:'confirmed'}})).toBe(1);
  });

  it('continues a confirmed order after documented cash and leaves a completed original alone',async()=>{
    const order=await seedOrder('office-b6-waiting-for-bank-cash',{status:'confirmed'});
    await prisma.$transaction(tx=>reserveOrderCredit(tx,order.id,merchant.id));
    await applyStart((await startReview(order.id,{...reviewEvidence,action:'verify_acceptance',requestId:'office-archived-original-acceptance',
      originalActor:merchant.id,authorityReference:'ORIGINAL-PLATFORM-WORKFLOW',occurredAt:order.createdAt.toISOString()})).input);
    await applyStart((await startReview(order.id,{...reviewEvidence,action:'review_customer_terms',requestId:'office-prepaid-terms',
      paymentMode:'prepay'})).input);
    expect(await discoverOrderPurchaseWork()).toBe(1);
    expect(await runOrderPurchaseContinuationOnce()).toMatchObject({status:'awaiting_human'});
    expect(await prisma.purchaseRequirement.count({where:{orderId:order.id}})).toBe(0);

    const verified=await verifyBank(order.id,bankProof('OFFICE-ACTUAL-CASH-FOR-CONTINUATION'));
    const posting=await startReview(order.id,{...reviewEvidence,action:'record_customer_receipt',requestId:'office-confirm-actual-bank-cash',
      bankReceiptId:verified.id,allocationReference:'OFFICE-CONFIRMED-ALLOCATION',amountCents:20000});
    await applyStart(posting.input);
    await applyStart(posting.input);
    const later=new Date(Date.now()+60*60_000);
    expect(await runOrderPurchaseContinuationOnce(later)).toMatchObject({status:'succeeded'});
    expect(await prisma.customerCashPosting.count({where:{orderId:order.id}})).toBe(1);
    expect(await prisma.purchaseActivity.count({where:{orderId:order.id,action:'prepare'}})).toBe(1);
    expect(await prisma.purchaseRequirement.count({where:{orderId:order.id}})).toBe(1);

    const completed=await seedOrder('office-b6-already-completed',{status:'completed'});
    const old=await prisma.backgroundTask.create({data:{type:PURCHASE_CONTINUATION,status:PURCHASE_READY,
      payload:JSON.stringify({orderId:completed.id,version:null}),dedupeKey:purchaseContinuationKey(completed.id)}});
    expect(await runOrderPurchaseContinuationOnce(later)).toMatchObject({id:old.id,status:'succeeded'});
    const result=await prisma.backgroundTask.findUniqueOrThrow({where:{id:old.id}});
    expect(JSON.parse(result.result!)).toMatchObject({outcome:'no_open_demand',orderItemIds:[]});
    expect(await runOrderPurchaseContinuationOnce(later)).toBeNull();
    expect(await prisma.order.findUniqueOrThrow({where:{id:completed.id}})).toMatchObject({status:'completed'});
    expect(await prisma.purchaseActivity.count({where:{orderId:completed.id}})).toBe(0);
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });
});
