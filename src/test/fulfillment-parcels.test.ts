import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as orderGET, PATCH as orderPATCH } from '@/app/api/admin/orders/[id]/route';
import { dispatchParcel, fulfillmentWorkspace, recordParcelEvent } from '@/lib/fulfillment-parcels';
import { receiveCarrierNotice } from '@/lib/fulfillment-carrier';
import { linkLegacyShipment } from '@/lib/fulfillment-legacy';
import { receiveInventoryBatch, reserveOrderInventory } from '@/lib/inventory';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { applyPurchaseAction, previewPurchaseAction, purchaseWorkspace, savePurchaseLine } from '@/lib/purchase-orders';
import type { PurchaseTerms } from '@/lib/purchase-terms';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

const merchant = { id: 'test-b3-merchant', email: 'merchant@example.test' };
const operator = { id: 'test-b3-operator', email: 'warehouse@example.test' };
const approver = { id: 'test-b3-approver', email: 'approve@example.test' };
const buyer = { id: 'test-b3-buyer', email: 'buyer@example.test' };
const productId = 'test-b3-product';
const orderId = 'test-b3-order';
const directLineId = 'test-b3-line-direct';
const relayLineId = 'test-b3-line-relay';
const oldLot = 'TEST-EXISTING-LOT';
const receivedLotA = 'TEST-PURCHASE-LOT-A';
const receivedLotB = 'TEST-PURCHASE-LOT-B';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'test-b3-merchant', email: 'merchant@example.test', role: 'admin', sessionId: 'synthetic-b3-session' },
  }),
}));
vi.mock('@/lib/admin-mfa-settings', () => ({
  requiresAdminMfaForPermission: async () => false,
  isAdminMfaScenarioEnabled: async () => false,
}));

type Route = 'supplier_to_customer' | 'supplier_to_libereal' | 'libereal_to_customer';
type DispatchLine = { purchaseOrderId: string; orderItemId: string; quantity: number; sourceReceiptId?: string; resendApprovalId?: string };
type EventLine = { parcelLineId: string; quantity: number; batchNumber?: string; productId?: string };
type PurchaseAction = Omit<Parameters<typeof previewPurchaseAction>[1], 'orderId' | 'purchaseOrderId' | 'version'>;

function nextOccurrence() {
  vi.setSystemTime(Date.now() + 1000);
  return new Date().toISOString();
}

function purchaseTerms(quantity: number, supplier: string): PurchaseTerms {
  return {
    supplier, writtenSupplier: supplier, payee: `合成收款方-${supplier}`,
    paymentTerms: '供方书面确认后按约结算', unitPriceCents: 2500, linePayableCents: 2500 * quantity,
    currency: 'CNY', taxBasis: 'included', freightTerms: '含运费', supplierConditions: '合成逐单采购条款',
    leadTime: '3 个工作日', validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
    sourceReference: `TEST-SUPPLY-QUOTE-${supplier}`, sourceSha256: pricingContentHash({ supplier, quantity }),
    settlementReference: 'TEST-SUPPLY-SETTLEMENT', settlementSha256: pricingContentHash({ supplier, evidence: 'settlement' }),
    coordinationReference: 'TEST-SUPPLY-COORDINATION', leadTimeAssessment: 'within_agreement',
  };
}

async function acceptCustomerOrder() {
  const url = `http://localhost/api/admin/orders/${orderId}`;
  const params = Promise.resolve({ id: orderId });
  const response = await orderGET(new NextRequest(url), { params });
  expect(response.status).toBe(200);
  const { order } = await response.json();
  expect(order.approvalPreview).toMatchObject({ action: 'accept_order', version: expect.any(String) });
  const accepted = await orderPATCH(new NextRequest(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'confirmed', action: 'accept_order', approvalVersion: order.approvalPreview.version,
    }),
  }), { params });
  expect(accepted.status, JSON.stringify(await accepted.json())).toBe(200);
}

async function purchaseAction(purchaseOrderId: string, action: PurchaseAction, actor = approver) {
  return prisma.$transaction(async tx => {
    const current = (await purchaseWorkspace(tx, orderId)).orders.find(purchase => purchase.id === purchaseOrderId);
    if (!current) throw new Error('Missing synthetic purchase order');
    const input = { ...action, orderId, purchaseOrderId, version: current.version };
    const preview = await previewPurchaseAction(tx, input, actor);
    return applyPurchaseAction(tx, { ...input, actionHash: preview.actionHash }, actor);
  });
}

async function orderFromSuppliers() {
  const suppliers = [
    { orderItemId: directLineId, supplier: 'TEST-DIRECT-SUPPLIER', quantity: 1 },
    { orderItemId: relayLineId, supplier: 'TEST-RELAY-SUPPLIER', quantity: 2 },
  ];
  for (const { orderItemId, supplier, quantity } of suppliers) {
    await prisma.$transaction(async tx => {
      const workspace = await purchaseWorkspace(tx, orderId);
      const line = workspace.lines.find(row => row.orderItemId === orderItemId);
      if (!line) throw new Error('Missing original customer line');
      await savePurchaseLine(tx, {
        orderId, orderItemId, revision: line.revision, terms: purchaseTerms(quantity, supplier), checkedEvidence: true,
      }, operator);
    });
  }

  const drafts = await prisma.$transaction(tx => purchaseWorkspace(tx, orderId));
  expect(drafts.orders).toHaveLength(2);
  for (const purchase of drafts.orders) {
    await purchaseAction(purchase.id, { action: 'approve', requestId: `approve-${purchase.id}` });
    await purchaseAction(purchase.id, {
      action: 'register_order', requestId: `register-${purchase.id}`, reference: `TEST-ORDER-${purchase.id}`,
      referenceSha256: pricingContentHash({ purchaseId: purchase.id, evidence: 'supplier-order' }),
      occurredAt: nextOccurrence(),
    });
  }

  const ordered = await prisma.$transaction(tx => purchaseWorkspace(tx, orderId));
  const purchaseFor = (id: string, quantity: number) => {
    const purchase = ordered.orders.find(row => row.orderReceipt?.lines.some(line => line.orderItemId === id));
    expect(purchase).toMatchObject({
      status: 'ordered', orderReceipt: { lines: [expect.objectContaining({ orderItemId: id, quantity })] },
    });
    return purchase!.id;
  };
  return { direct: purchaseFor(directLineId, 1), relay: purchaseFor(relayLineId, 2) };
}

function dispatchInput(requestId: string, route: Route, lines: DispatchLine[]) {
  return {
    requestId, route, lines, carrier: '合成承运人', trackingNumber: `TEST-TRACK-${requestId}`,
    occurredAt: nextOccurrence(), reference: `TEST-DISPATCH-${requestId}`,
    sha256: pricingContentHash({ requestId, route }), documentRow: 1,
  };
}

function eventInput(requestId: string, kind: 'warehouse_receipt' | 'customer_delivery', lines: EventLine[]) {
  return {
    requestId, kind, lines, occurredAt: nextOccurrence(),
    reference: `TEST-PARCEL-EVIDENCE-${requestId}`, sha256: pricingContentHash({ requestId, kind }),
    description: '合成物流书面依据',
  };
}

function dispatch(input: ReturnType<typeof dispatchInput>) {
  return prisma.$transaction(tx => dispatchParcel(tx, orderId, input, operator), { isolationLevel: 'Serializable' });
}

function event(parcelId: string, input: unknown) {
  return prisma.$transaction(tx => recordParcelEvent(tx, orderId, parcelId, input, operator), { isolationLevel: 'Serializable' });
}

function workspace() {
  return prisma.$transaction(tx => fulfillmentWorkspace(tx, orderId));
}

function inventory() {
  return prisma.inventoryAccount.findFirstOrThrow({ where: { productId, variantId: null } });
}

function batch(batchNumber: string) {
  return prisma.inventoryBatch.findFirstOrThrow({ where: { batchNumber } });
}

function receipt(parcelLineId: string, batchNumber: string) {
  return prisma.fulfillmentReceipt.findFirstOrThrow({
    where: { parcelLineId, inventoryBatch: { batchNumber } },
  });
}

beforeAll(() => { getTestDb(); });
afterAll(() => { closeTestDb(); });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date());
  const db = getTestDb();
  clearAllTables(db);
  seedAdmin(db, merchant.id, merchant.email);
  seedAdmin(db, operator.id, operator.email);
  seedAdmin(db, approver.id, approver.email);
  seedUser(db, buyer);
  await prisma.creditAccount.create({ data: { userId: buyer.id, baseLimit: 10000, paymentTermDays: 30 } });
  await prisma.product.create({
    data: { id: productId, name: '合成商品', catalogNumber: 'TEST-B3-SKU', brand: '合成品牌', price: 100, stockQuantity: -1 },
  });
  await prisma.$transaction(tx => receiveInventoryBatch(tx, { productId, batchNumber: oldLot, quantity: 10, actorId: operator.id }));
  await prisma.order.create({
    data: {
      id: orderId, customerId: buyer.id, email: buyer.email, status: 'pending',
      paymentMethod: 'bank_transfer', subtotal: 300, total: 300,
      orderItems: {
        create: [{ id: directLineId, quantity: 1 }, { id: relayLineId, quantity: 2 }].map((line, position) => ({
          ...line, position, productId, catalogNumber: 'TEST-B3-SKU', name: '合成商品', brand: '合成品牌', unitPrice: 100,
        })),
      },
    },
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('procurement-bound fulfillment parcels', () => {
  const agreement = {
    supplierReference: 'TEST-INITIAL-SELLER-DECISION', supplierSha256: 'a'.repeat(64),
    customerReference: 'TEST-INITIAL-CUSTOMER-DECISION', customerSha256: 'b'.repeat(64),
    description: '合成物流短失和双方书面处理决定',
  };
  const replacement = {
    name: '合成另采补发品', brand: '合成品牌', catalogNumber: 'TEST-INDEPENDENT-REPLACEMENT',
    spec: '合成规格', unit: '件', terms: purchaseTerms(1, 'TEST-INDEPENDENT-SUPPLIER'),
  };

  const originalHold = async () => {
    const { id, quantity, fulfilledQuantity, releasedQuantity } = await prisma.inventoryReservation.findUniqueOrThrow({
      where: { orderItemId: relayLineId },
    });
    const { _sum } = await prisma.inventoryTransaction.aggregate({ where: { reservationId: id, type: 'release' }, _sum: { quantity: true } });
    return { pending: quantity - fulfilledQuantity - releasedQuantity, released: releasedQuantity, loggedReleases: _sum.quantity ?? 0 };
  };

  it.each([
    { source: 'direct', decision: 'free_resend', toWarehouse: false },
    { source: 'direct', decision: 'new_purchase', toWarehouse: false },
    { source: 'warehouse', decision: 'free_resend', toWarehouse: true },
    { source: 'warehouse', decision: 'new_purchase', toWarehouse: false },
    { source: 'forward', decision: 'free_resend', toWarehouse: true },
    { source: 'forward', decision: 'new_purchase', toWarehouse: false },
  ] as const)('moves the original hold only once for $source and $decision', async ({ source, decision, toWarehouse }) => {
    await acceptCustomerOrder();
    const { relay } = await orderFromSuppliers();
    const original = { purchaseOrderId: relay, orderItemId: relayLineId, quantity: 1 };
    let parcel = await dispatch(dispatchInput('original-unit', source === 'direct' ? 'supplier_to_customer' : 'supplier_to_libereal', [original]));
    if (source === 'forward') {
      const id = parcel.lines[0].id;
      await event(parcel.id,eventInput('original-warehouse-receipt','warehouse_receipt',[{parcelLineId:id,quantity:1,batchNumber:receivedLotA}]));
      const received = await receipt(id,receivedLotA);
      parcel = await dispatch(dispatchInput('original-forward','libereal_to_customer',[{ ...original, sourceReceiptId: received.id }]));
    }
    await event(parcel.id,{...eventInput('confirmed-original-loss','customer_delivery',[]),...agreement,kind:'confirm_shortfall',
      lines:[{parcelLineId:parcel.lines[0].id,quantity:1,outcome:'loss'}]});
    const firstHold = await originalHold();
    expect(firstHold).toEqual(source === 'warehouse'
      ? { pending: 2, released: 0, loggedReleases: 0 } : { pending: 1, released: 1, loggedReleases: 1 });

    const state = await prisma.$transaction(tx => purchaseWorkspace(tx,orderId));
    const [loss] = state.fulfillment.shortfalls;
    await purchaseAction(relay,{action:'report_change',requestId:'one-unit-missing',changeKind:'other',reference:loss.reference,description:agreement.description});
    const next = await purchaseAction(relay,{action:'resolve_change',requestId:'written-one-unit-fix',outcome:'shortfall',...agreement,
      confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:decision==='free_resend'?'cancel':'replace',
        shortfallId:loss.resolutionId,shortfallDecision:decision,...(decision==='new_purchase'?{replacement}:{})}]});
    let supplies: DispatchLine = { ...original, resendApprovalId: next.fulfillment.freeResends[0]?.approvalId };
    if (decision === 'new_purchase') {
      const draft = next.orders.find(row=>row.lines.some(line=>line.fromPurchaseOrderId===relay))!;
      await purchaseAction(draft.id,{action:'approve',requestId:'independent-alternate-approval'},merchant);
      await purchaseAction(draft.id,{action:'register_order',requestId:'independent-commitment',reference:'TEST-INDEPENDENT-ORDER',
        referenceSha256:'c'.repeat(64),occurredAt:nextOccurrence()},merchant);
      supplies = { ...original, purchaseOrderId: draft.id };
    }
    const restocked = await dispatch(dispatchInput('actual-replacement',toWarehouse?'supplier_to_libereal':'supplier_to_customer',[supplies]));
    if (toWarehouse) {
      expect(await originalHold()).toEqual(firstHold);
      await event(restocked.id,eventInput('real-replacement-receipt','warehouse_receipt',[
        {parcelLineId:restocked.lines[0].id,quantity:1,batchNumber:receivedLotB},
      ]));
    }
    expect(await originalHold()).toEqual({ pending: 1, released: 1, loggedReleases: 1 });
    expect(await batch(oldLot)).toMatchObject({ reservedQuantity: 2 }); // This unit and the separate customer line are still held.
    await dispatch(dispatchInput('remaining-original-unit','supplier_to_customer',[original]));
    expect(await originalHold()).toEqual({ pending: 0, released: 2, loggedReleases: 2 });
    expect(await batch(oldLot)).toMatchObject({ reservedQuantity: 1 });
  });

  it('keeps the hold already transferred when a free inbound replacement is lost again before receipt', async () => {
    await acceptCustomerOrder();
    const { relay } = await orderFromSuppliers();
    const source = { purchaseOrderId: relay, orderItemId: relayLineId, quantity: 1 };
    let parcel = await dispatch(dispatchInput('original-direct-unit','supplier_to_customer',[source]));
    for (const attempt of [1,2]) {
      await event(parcel.id,{...eventInput('repeated-physical-loss-'+attempt,'customer_delivery',[]),...agreement,kind:'confirm_shortfall',
        lines:[{parcelLineId:parcel.lines[0].id,quantity:1,outcome:'loss'}]});
      const state = await prisma.$transaction(tx => purchaseWorkspace(tx,orderId));
      const loss = state.fulfillment.shortfalls.find(row=>row.available>0)!;
      await purchaseAction(relay,{action:'report_change',requestId:'repeated-loss-'+attempt,changeKind:'other',reference:loss.reference,description:agreement.description});
      const approved = await purchaseAction(relay,{action:'resolve_change',requestId:'written-repeated-resend-'+attempt,outcome:'shortfall',...agreement,
        supplierSha256:pricingContentHash({attempt,source:'written-supplier-resend'}),
        customerSha256:pricingContentHash({attempt,source:'written-customer-consent'}),
        confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'cancel',shortfallId:loss.resolutionId,shortfallDecision:'free_resend'}]});
      const authorization = approved.fulfillment.freeResends.find(row=>row.shortfallId===loss.resolutionId)!;
      parcel = await dispatch(dispatchInput('inbound-again-'+attempt,'supplier_to_libereal',[{...source,resendApprovalId:authorization.approvalId}]));
    }
    await event(parcel.id,eventInput('subsequent-real-receipt','warehouse_receipt',[
      {parcelLineId:parcel.lines[0].id,quantity:1,batchNumber:receivedLotB},
    ]));
    expect(await originalHold()).toEqual({pending:1,released:1,loggedReleases:1});
  });

  it.each(['new_purchase','change_contract'] as const)('replaces only the unused free approval by %s with new written evidence', async decision => {
    await acceptCustomerOrder();
    const { relay } = await orderFromSuppliers();
    const original = { purchaseOrderId: relay, orderItemId: relayLineId, quantity: 2 };
    const first = await dispatch(dispatchInput('first-two-actual-units','supplier_to_customer',[original]));
    await purchaseAction(relay,{action:'record_payment',requestId:'old-documented-payment',reference:'TEST-OLD-PAYMENT',
      amountCents:500,conditionReference:'TEST-ORIGINAL-TERMS'});
    await event(first.id,{...eventInput('two-real-units-lost','customer_delivery',[]),...agreement,kind:'confirm_shortfall',
      lines:[{parcelLineId:first.lines[0].id,quantity:2,outcome:'loss'}]});
    const state = await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    const [loss] = state.fulfillment.shortfalls;
    await purchaseAction(relay,{action:'report_change',requestId:'start-first-decision',changeKind:'other',reference:loss.reference,description:agreement.description});
    const authorized = await purchaseAction(relay,{action:'resolve_change',requestId:'old-free-two',outcome:'shortfall',...agreement,
      dispositions:[{orderItemId:relayLineId,quantity:2,outcome:'cancel',shortfallId:loss.resolutionId,shortfallDecision:'free_resend'}]});
    const [{ approvalId }] = authorized.fulfillment.freeResends;
    const previousApproval = await prisma.purchaseActivity.findUniqueOrThrow({where:{id:approvalId}});
    const priorDispatch = { ...original, quantity:1, resendApprovalId:approvalId };
    const sent = await dispatch(dispatchInput('first-free-unit-was-dispatched','supplier_to_customer',[priorDispatch]));
    await purchaseAction(relay,{action:'report_change',requestId:'investigate-unused-free',changeKind:'unavailable',reference:'TEST-FRESH-SUPPLIER-NOTICE',
      description:'合成事实，免费补件仅发一件，未发的一件再次缺货。'});

    const before = await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    expect(before.fulfillment.shortfalls[0].available).toBe(0);
    expect(before.fulfillment.freeResends[0]).toMatchObject({quantity:2,dispatched:1,redirected:0,available:1});
    const line = { orderItemId:relayLineId, quantity:1, outcome:decision==='new_purchase'?'replace' as const:'cancel' as const,
      shortfallId:loss.resolutionId,shortfallDecision:decision,revisesResendApprovalId:approvalId,
      ...(decision==='new_purchase'?{replacement}:{}) };
    const change = {
      ...agreement, supplierReference:'TEST-FRESH-SELLER-SIGNED',supplierSha256:'c'.repeat(64),
      customerReference:'TEST-FRESH-CUSTOMER-SIGNED',customerSha256:'d'.repeat(64),
      action:'resolve_change' as const, outcome:'shortfall' as const, requestId:'fresh-scope-approval',
      ...(decision==='change_contract'?{refundFollowup:'原已付款待财务按实际归属核对'}:{}),
      confirmsFullIncidentScope: true, dispositions:[line],
    };
    await expect(purchaseAction(relay,{...change,dispositions:[{...line,quantity:2}]})).rejects.toThrow(/尚未发货或改办/);
    await expect(purchaseAction(relay,{...change,supplierSha256:agreement.supplierSha256})).rejects.toThrow(/新的供应商书面决定/);

    const version = before.orders.find(row=>row.id===relay)!.version;
    const input = { ...change, orderId, purchaseOrderId:relay, version };
    const stale = {...input,requestId:'competing-new-approval'};
    const preview = await prisma.$transaction(tx=>previewPurchaseAction(tx,input,merchant));
    const other = await prisma.$transaction(tx=>previewPurchaseAction(tx,stale,merchant));
    expect(preview.snapshot.operation).toMatchObject({dispositions:[{revisesResendApprovalId:approvalId,
      priorResend:{authorized:2,dispatched:1,redirected:0,available:1},quantity:1}]});
    const accept = {...input,actionHash:preview.actionHash};
    const applied = await prisma.$transaction(tx=>applyPurchaseAction(tx,accept,merchant));
    const repeat = await prisma.$transaction(tx=>applyPurchaseAction(tx,accept,merchant));
    await expect(prisma.$transaction(tx=>applyPurchaseAction(tx,{...stale,actionHash:other.actionHash},merchant))).rejects.toThrow(/变化|版本/);
    expect(repeat.fulfillment.freeResends[0]).toMatchObject({quantity:2,dispatched:1,redirected:1,available:0});
    expect(repeat.activities.map(row=>row.id)).toEqual(applied.activities.map(row=>row.id));
    expect(await prisma.purchaseActivity.findUnique({where:{id:approvalId}})).toEqual(previousApproval);
    expect(await prisma.fulfillmentParcel.findUnique({where:{id:sent.id},include:{lines:true}})).toMatchObject({
      id:sent.id,lines:[expect.objectContaining({id:sent.lines[0].id,quantity:1})],
    });
    const po = applied.orders.find(row=>row.id===relay)!;
    expect(po).toMatchObject({paidCents:500,totalCents:5000});
    if (decision === 'new_purchase') {
      expect(po).toMatchObject({status:'ordered',dueCents:4500,remaining:[{orderItemId:relayLineId,quantity:2}]});
      expect(applied.orders.filter(row=>row.lines.some(line=>line.fromPurchaseOrderId===relay)))
        .toMatchObject([{status:'draft',approvedHash:null,paidCents:0}]);
      await expect(dispatch(dispatchInput('attempt-free-unit-after-revision','supplier_to_customer',[priorDispatch])))
        .rejects.toThrow(/本行免费重发/);
    } else {
      expect(po).toMatchObject({dueCents:null,needsRemainingReview:true,remaining:[{orderItemId:relayLineId,quantity:1}]});
      await expect(purchaseAction(relay,{action:'record_payment',requestId:'no-automatic-deduction',reference:'TEST-UNREVIEWED-PAY',
        amountCents:2000,conditionReference:'TEST-UNREVIEWED-CONDITIONS'})).rejects.toThrow(/剩余|版本/);
      const reviewed = await purchaseAction(relay,{action:'approve_remaining',requestId:'review-later-amended-payable',
        reference:'TEST-CONFIRMED-AMENDED-REMAINING',referenceSha256:'e'.repeat(64),description:'获批发出的一件单独核对原应付。',
        remainingLines:[{orderItemId:relayLineId,payableCents:2500}],appliedPaidCents:500});
      expect(reviewed.orders.find(row=>row.id===relay)).toMatchObject({paidCents:500,dueCents:2000});
    }
  });

  it('requires new written decisions for each later redirection while the old approval still has unused quantity', async () => {
    await acceptCustomerOrder();
    const { relay } = await orderFromSuppliers();
    const parcel = await dispatch(dispatchInput('two-before-free-plan','supplier_to_customer',[
      {purchaseOrderId:relay,orderItemId:relayLineId,quantity:2},
    ]));
    await event(parcel.id,{...eventInput('two-before-revision','customer_delivery',[]),...agreement,kind:'confirm_shortfall',
      lines:[{parcelLineId:parcel.lines[0].id,quantity:2,outcome:'loss'}]});
    const { fulfillment } = await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    const [loss] = fulfillment.shortfalls;
    const report = (requestId: string) => purchaseAction(relay,{action:'report_change',requestId,changeKind:'unavailable',
      reference:loss.reference,description:'按来函复核尚未发出的货物'});
    await report('first-both-unshipped');
    const authorized = await purchaseAction(relay,{action:'resolve_change',requestId:'allow-both-free',outcome:'shortfall',...agreement,
      dispositions:[{orderItemId:relayLineId,quantity:2,outcome:'cancel',shortfallId:loss.resolutionId,shortfallDecision:'free_resend'}]});
    const [{ approvalId }] = authorized.fulfillment.freeResends;
    const redirect: PurchaseAction = {action:'resolve_change',requestId:'new-decision-for-one',outcome:'shortfall',...agreement,
      supplierSha256:'c'.repeat(64),customerSha256:'d'.repeat(64),description:'经核对只改办一件',
      confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'replace',replacement,shortfallId:loss.resolutionId,
        shortfallDecision:'new_purchase',revisesResendApprovalId:approvalId}]};
    await report('first-unused-unit-review');
    const changed = await purchaseAction(relay,redirect);
    expect(changed.fulfillment.freeResends[0]).toMatchObject({dispatched:0,redirected:1,available:1});
    await report('second-unused-unit-review');
    await expect(purchaseAction(relay,{...redirect,requestId:'different-id-same-document',
      supplierReference:'TEST-SAME-SUPPLIER-FILE-NEW-NAME',customerReference:'TEST-SAME-CUSTOMER-FILE-NEW-NAME'}))
      .rejects.toThrow(/新的供应商书面决定/);
    const state = await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    expect(state.fulfillment.freeResends[0]).toMatchObject({redirected:1,available:1});
    expect(state.orders.filter(row=>row.lines.some(line=>line.fromPurchaseOrderId===relay))).toHaveLength(1);
  });

  describe('original inventory and contract shares across replacements', () => {
    const revisedAgreement = {
      supplierReference: 'TEST-NEW-WRITTEN-SUPPLIER-AGREEMENT', supplierSha256: 'c'.repeat(64),
      customerReference: 'TEST-NEW-WRITTEN-CUSTOMER-AGREEMENT', customerSha256: 'd'.repeat(64),
      description: '双方书面确认具体补货或合同变更范围',
    };
    const current = () => prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    const goods = (purchaseOrderId:string,quantity=1) => ({purchaseOrderId,orderItemId:relayLineId,quantity});
    const alternative = (tag:string) => ({
      name:'合成补件'+tag,brand:'合成供方品牌',catalogNumber:'TEST-LINEAGE-SKU-'+tag,spec:'合成规格',unit:'件',
      terms:purchaseTerms(1,'TEST-LINEAGE-SUPPLIER-'+tag),
    });
    const report = (purchaseOrderId:string,tag:string) => purchaseAction(purchaseOrderId,{
      action:'report_change',requestId:'report-'+tag,changeKind:'unavailable',
      reference:'TEST-SUPPLIER-WRITTEN-NOTICE-'+tag,description:'核对书面供货变化和实际未履行数量',
    });
    async function verifyLoss(parcel:Awaited<ReturnType<typeof dispatch>>,tag:string,quantity=1) {
      const evidence = eventInput('actual-lineage-loss-'+tag,'customer_delivery',[]);
      await event(parcel.id,{...evidence,...agreement,kind:'confirm_shortfall',lines:[{parcelLineId:parcel.lines[0].id,quantity,outcome:'loss'}]});
      return (await current()).fulfillment.shortfalls.find(row=>row.reference===evidence.reference)!;
    }
    async function authorizeTwoResends(purchaseOrderId:string, shortfallId:string, quantity:number) {
      await report(purchaseOrderId,'review-written-free');
      const result = await purchaseAction(purchaseOrderId,{action:'resolve_change',requestId:'authorize-written-free',outcome:'shortfall',...agreement,
        confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity,outcome:'cancel',shortfallId,shortfallDecision:'free_resend'}]});
      return result.fulfillment.freeResends.find(row=>row.shortfallId===shortfallId)!;
    }
    async function commitReplacement(purchaseOrderId:string,tag:string) {
      await purchaseAction(purchaseOrderId,{action:'approve',requestId:'independent-lineage-approval-'+tag},merchant);
      await purchaseAction(purchaseOrderId,{action:'register_order',requestId:'register-lineage-commitment-'+tag,
        reference:'TEST-COMMITMENT-'+tag,referenceSha256:pricingContentHash({tag}),occurredAt:nextOccurrence()},merchant);
    }

    it.each([
      {originalRoute:'supplier_to_customer',laterRoute:'supplier_to_customer'},
      {originalRoute:'supplier_to_customer',laterRoute:'supplier_to_libereal'},
      {originalRoute:'supplier_to_libereal',laterRoute:'supplier_to_libereal'},
    ] as const)('inherits the hold through an unshipped B2 replacement from $originalRoute to $laterRoute', async ({originalRoute,laterRoute})=>{
      await acceptCustomerOrder();
      const {relay} = await orderFromSuppliers();
      const original = await dispatch(dispatchInput('lineage-original',originalRoute,[goods(relay)]));
      const loss = await verifyLoss(original,'original');
      await report(relay,'new-order-after-first-physical-loss');
      const one = await purchaseAction(relay,{action:'resolve_change',requestId:'allow-first-separate-order',outcome:'shortfall',...agreement,
        confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'replace',shortfallId:loss.resolutionId,shortfallDecision:'new_purchase',
          replacement:alternative('R1')}]});
      const r1 = one.orders.find(row=>row.lines.some(line=>line.fromPurchaseOrderId===relay))!;
      await commitReplacement(r1.id,'R1');
      await report(r1.id,'R1-unavailable-before-dispatch');
      const replacementGoods = alternative('R2');
      const two = await purchaseAction(r1.id,{action:'resolve_change',requestId:'allow-ordinary-R2',outcome:'replacement',...revisedAgreement,
        confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'replace',replacement:replacementGoods}]});
      const r2 = two.orders.find(row=>row.lines.some(line=>line.fromPurchaseOrderId===r1.id))!;
      await commitReplacement(r2.id,'R2');
      if (laterRoute === 'supplier_to_libereal') {
        await prisma.product.create({data:{id:'test-exact-r2-stock',name:replacementGoods.name,brand:replacementGoods.brand,
          catalogNumber:replacementGoods.catalogNumber,spec:replacementGoods.spec,salesUnit:replacementGoods.unit,price:100,stockQuantity:0}});
      }
      const before = await originalHold();
      expect(before.pending).toBe(originalRoute==='supplier_to_customer'?1:2);
      const later = await dispatch(dispatchInput('send-R2',laterRoute,[goods(r2.id)]));
      if (laterRoute === 'supplier_to_libereal') {
        expect(await originalHold()).toEqual(before);
        await event(later.id,eventInput('actual-R2-receipt','warehouse_receipt',[{parcelLineId:later.lines[0].id,quantity:1,batchNumber:receivedLotA}]));
      }
      expect(await originalHold()).toEqual({pending:1,released:1,loggedReleases:1});
      expect(await batch(oldLot)).toMatchObject({reservedQuantity:2});
      const state = await current();
      expect(state.orders.find(row=>row.id===relay)).toMatchObject({dueCents:5000,paidCents:0});
      expect(state.orders.find(row=>row.id===r2.id)).toMatchObject({dueCents:2500,paidCents:0});
    });

    it('amends the exact original contracted share after an actual free resend is also lost', async ()=>{
      await acceptCustomerOrder();
      const {relay} = await orderFromSuppliers();
      await purchaseAction(relay,{action:'record_payment',requestId:'real-original-lineage-deposit',amountCents:500,
        reference:'TEST-ORIGINAL-DEPOSIT-RECEIPT',conditionReference:'TEST-ORIGINAL-CONTRACT'});
      const first = await dispatch(dispatchInput('lineage-original-direct','supplier_to_customer',[goods(relay)]));
      const firstLoss = await verifyLoss(first,'direct-original');
      const free = await authorizeTwoResends(relay,firstLoss.resolutionId,1);
      const second = await dispatch(dispatchInput('lineage-direct-free','supplier_to_customer',[{...goods(relay),resendApprovalId:free.approvalId}]));
      const secondLoss = await verifyLoss(second,'actual-free-supply');
      expect(secondLoss.contractSource).toMatchObject({purchaseOrderId:relay,parcelLineId:first.lines[0].id,orderItemId:relayLineId,reference:first.reference});
      const evidence = await prisma.shipment.findMany({where:{orderId},include:{items:true},orderBy:{id:'asc'}});
      const accountReceivable = await prisma.accountReceivable.findUnique({where:{orderId}});
      const originalPayment = (await current()).activities.find(row=>row.action==='record_payment');
      await report(relay,'amend-same-contract-after-free-loss');
      const applied = await purchaseAction(relay,{action:'resolve_change',requestId:'approve-original-contract-change',outcome:'shortfall',...revisedAgreement,
        refundFollowup:'原已付款独立核对，按实有安排继续',
        confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'cancel',shortfallId:secondLoss.resolutionId,shortfallDecision:'change_contract'}]});
      expect(applied.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{
        dispositions:[{shortfallId:secondLoss.resolutionId,quantity:1,contractSource:secondLoss.contractSource}],
        refund:{status:'pending_review',paidCents:500,responsibleActor:approver.id},
      }});
      expect(applied.orders.find(row=>row.id===relay)).toMatchObject({totalCents:5000,paidCents:500,dueCents:null,needsRemainingReview:true,
        remaining:[{orderItemId:relayLineId,quantity:1}]});
      expect(applied.fulfillment.shortfalls.filter(row=>[firstLoss.resolutionId,secondLoss.resolutionId].includes(row.resolutionId))
        .map(row=>row.available)).toEqual([0,0]);
      expect(applied.activities.filter(row=>row.action==='record_payment')).toEqual([originalPayment]);
      expect(await prisma.shipment.findMany({where:{orderId},include:{items:true},orderBy:{id:'asc'}})).toEqual(evidence);
      expect(await prisma.accountReceivable.findUnique({where:{orderId}})).toEqual(accountReceivable);
      expect(await originalHold()).toEqual({pending:1,released:1,loggedReleases:1});
    });

    it.each(['new_purchase','change_contract'] as const)('keeps free-only written decisions from becoming %s', async decision=>{
      await acceptCustomerOrder();
      const {relay} = await orderFromSuppliers();
      const original = await dispatch(dispatchInput('purpose-original-two','supplier_to_customer',[goods(relay,2)]));
      const loss = await verifyLoss(original,'purpose-original-two',2);
      const cover = {orderId,purchaseOrderId:relay,orderItemId:relayLineId,shortfallId:loss.resolutionId,quantity:2};
      const documents = {supplierDocumentRow:8,customerDocumentRow:12,supplierDocumentScope:[cover],customerDocumentScope:[cover]};
      const shared = {action:'resolve_change' as const,outcome:'shortfall' as const,...agreement};
      const free = {orderItemId:relayLineId,quantity:1,shortfallId:loss.resolutionId,shortfallDecision:'free_resend' as const,outcome:'cancel' as const,...documents};
      await report(relay,'approve-one-of-two-free');
      const first = await purchaseAction(relay,{...shared,requestId:'one-of-two-free-approved',confirmsFullIncidentScope: true, dispositions:[free]});
      const [approval] = first.fulfillment.freeResends;
      expect(approval).toMatchObject({quantity:1,dispatched:0,available:1});
      await report(relay,'wrong-use-of-free-only-document');
      await expect(purchaseAction(relay,{...shared,requestId:'move-free-to-other-purpose',confirmsFullIncidentScope: true, dispositions:[{
        ...free,outcome:decision==='new_purchase'?'replace':'cancel',shortfallDecision:decision,revisesResendApprovalId:approval.approvalId,
        ...(decision==='new_purchase'?{replacement:alternative('NOT-AUTHORIZED')}:{})}]})).rejects.toThrow(/商业决定、供方或实质条件已变化/);
      const inReview = await current();
      expect(inReview.fulfillment.freeResends[0].available).toBe(1);
      expect(inReview.orders.find(row=>row.id===relay)).toMatchObject({totalCents:5000,paidCents:0,remaining:[{orderItemId:relayLineId,quantity:2}]});
      const samePurpose = await purchaseAction(relay,{...shared,requestId:'same-purpose-second-unit',confirmsFullIncidentScope: true, dispositions:[free]});
      expect(samePurpose.fulfillment.freeResends).toHaveLength(2);
      expect(samePurpose.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{decisionDocuments:[
        expect.objectContaining({authority:{purpose:'free_resend'},balances:[{...cover,usedBefore:1,using:1,remaining:0}]}),
        expect.objectContaining({authority:{purpose:'free_resend'},balances:[{...cover,usedBefore:1,using:1,remaining:0}]}),
      ]}});
    });

    it('keeps a supplier facts row usable while requiring new customer proof for changed alternative supplier or price', async ()=>{
      await acceptCustomerOrder();
      const {relay} = await orderFromSuppliers();
      await purchaseAction(relay,{action:'record_payment',requestId:'original-paid-under-facts-only',amountCents:500,
        reference:'TEST-ORIGINAL-PAID-UNDER-FACTS-ROW',conditionReference:'TEST-ORIGINAL-TERMS'});
      const original = await dispatch(dispatchInput('facts-only-original-two','supplier_to_customer',[goods(relay,2)]));
      const loss = await verifyLoss(original,'facts-only-loss',2);
      const approval = await authorizeTwoResends(relay,loss.resolutionId,2);
      const coverage = [{orderId,purchaseOrderId:relay,orderItemId:relayLineId,shortfallId:loss.resolutionId,quantity:2}];
      const chosen = alternative('APPROVED-BY-CUSTOMER');
      const redirect = (requestId:string,replacement:typeof chosen,customerSha256=revisedAgreement.customerSha256): PurchaseAction => ({
        action:'resolve_change',outcome:'shortfall',requestId,...revisedAgreement,customerSha256,
        confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'replace',shortfallId:loss.resolutionId,shortfallDecision:'new_purchase',
          revisesResendApprovalId:approval.approvalId,replacement,supplierDocumentRow:8,customerDocumentRow:12,
          supplierDocumentScope:coverage,...(customerSha256===revisedAgreement.customerSha256?{customerDocumentScope:coverage}:{})}],
      });
      await report(relay,'original-supplier-fact-one');
      const first = await purchaseAction(relay,redirect('approved-specific-alternate',chosen));
      expect(first.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{decisionDocuments:[
        expect.objectContaining({authority:{purpose:'supplier_facts'}}),
        expect.objectContaining({authority:expect.objectContaining({purpose:'new_purchase',alternate:expect.objectContaining({supplier:chosen.terms.supplier,unitPriceCents:2500})})}),
      ]}});
      await report(relay,'original-supplier-fact-two');
      const newSeller = alternative('DIFFERENT-ACTUAL-SUPPLIER');
      await expect(purchaseAction(relay,redirect('same-approval-different-seller',newSeller))).rejects.toThrow(/客户书证的商业决定、供方或实质条件已变化/);
      const changedPrice = {...chosen,terms:{...chosen.terms,unitPriceCents:2800,linePayableCents:2800,
        sourceReference:'TEST-NEW-PRICE-PROOF',sourceSha256:pricingContentHash('new-actual-price')}};
      await expect(purchaseAction(relay,redirect('same-approval-different-price',changedPrice))).rejects.toThrow(/客户书证的商业决定、供方或实质条件已变化/);
      const supplemented = await purchaseAction(relay,redirect('customer-later-approves-different-supplier',newSeller,
        pricingContentHash('newly-signed-specific-customer-acceptance')));
      expect(supplemented.fulfillment.freeResends[0].available).toBe(0);
      expect(supplemented.orders.filter(row=>row.lines.some(line=>line.fromPurchaseOrderId===relay))).toHaveLength(2);
      expect(supplemented.orders.find(row=>row.id===relay)).toMatchObject({paidCents:500,dueCents:4500});
      expect(supplemented.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{decisionDocuments:[
        expect.objectContaining({role:'supplier',authority:{purpose:'supplier_facts'},balances:[expect.objectContaining({usedBefore:1,remaining:0})]}),
        expect.objectContaining({role:'customer',authority:expect.objectContaining({purpose:'new_purchase',alternate:expect.objectContaining({supplier:newSeller.terms.supplier})})}),
      ]}});
      const draft = supplemented.orders.find(row=>row.lines.some(line=>line.fromPurchaseOrderId===relay))!;
      await report(draft.id,'new-price-for-separate-draft');
      const updatedQuote = {...draft.lines[0].terms,unitPriceCents:2900,linePayableCents:2900,
        sourceReference:'TEST-FOLLOWUP-QUOTE',sourceSha256:pricingContentHash('actual-quote-for-changed-alternate')};
      await expect(purchaseAction(draft.id,{action:'resolve_change',outcome:'revised_terms',requestId:'try-free-consent-for-new-price',
        ...agreement,revisedTerms:[{orderItemId:relayLineId,terms:updatedQuote}]}))
        .rejects.toThrow(/客户书证的商业决定、供方或实质条件已变化/);
    });

    it('applies one signed scope to exact same-line losses A and B and excludes a third physical loss C', async ()=>{
      await acceptCustomerOrder();
      const {relay,direct} = await orderFromSuppliers();
      const losses = [];
      for (const [tag,po,orderItemId] of [['A',relay,relayLineId],['B',relay,relayLineId],['C',direct,directLineId]]) {
        const parcel = await dispatch(dispatchInput('precise-source-'+tag,'supplier_to_customer',[{purchaseOrderId:po,orderItemId,quantity:1}]));
        const loss = await verifyLoss(parcel,'precise-'+tag);
        losses.push({orderId,purchaseOrderId:po,orderItemId,shortfallId:loss.resolutionId,quantity:1});
      }
      const [a,b,c] = losses;
      const authorize = async (claim:typeof a, tag:string) => {
        await report(claim.purchaseOrderId,'precise-scope-'+tag);
        return purchaseAction(claim.purchaseOrderId,{action:'resolve_change',requestId:'consent-only-two-'+tag,outcome:'shortfall',...revisedAgreement,
          supplierSha256:pricingContentHash({tag,scope:'specific supplier confirmation'}),
          confirmsFullIncidentScope: true, dispositions:[{orderItemId:claim.orderItemId,quantity:1,shortfallId:claim.shortfallId,shortfallDecision:'free_resend',outcome:'cancel',
            customerDocumentRow:9,...(tag==='A'?{customerDocumentScope:[a,b]}:{})}]});
      };
      await authorize(a,'A');
      const checked = await authorize(b,'B');
      expect(checked.fulfillment.freeResends.map(row=>row.shortfallId)).toEqual([a.shortfallId,b.shortfallId]);
      await expect(authorize(c,'C')).rejects.toThrow(/不包含本次办理对象/);
      expect((await current()).fulfillment.shortfalls.find(row=>row.resolutionId===c.shortfallId)?.available).toBe(1);
    });

    it.each([false,true])('reuses one supplier reduction with separate customer choices, after an actual shortfall = %s', async dispatched=>{
      await acceptCustomerOrder();
      const {relay} = await orderFromSuppliers();
      await purchaseAction(relay,{action:'record_payment',requestId:'supplier-reduction-original-payment',amountCents:500,
        reference:'TEST-ORIGINAL-REDUCTION-PAYMENT',conditionReference:'TEST-ORIGINAL-REDUCTION-TERMS'});
      const firstPayment = (await current()).activities.find(row=>row.purchaseOrderId===relay && row.action==='record_payment');
      const loss = dispatched ? await verifyLoss(await dispatch(dispatchInput('reduction-after-dispatch','supplier_to_customer',[goods(relay,2)])),
        'two-physical-shortfalls',2) : null;
      const subject = {orderId,purchaseOrderId:relay,orderItemId:relayLineId,quantity:2,...(loss ? {shortfallId:loss.resolutionId} : {})};
      const line = {orderItemId:relayLineId,quantity:1,supplierDocumentRow:8,supplierDocumentScope:[subject],
        ...(loss ? {shortfallId:loss.resolutionId,shortfallDecision:'change_contract' as const} : {})};
      const common = {action:'resolve_change' as const,...revisedAgreement,refundFollowup:'原定金及可能的退款各按原书证待核。'};
      await report(relay,'supplier-reduces-first-unit');
      const first = await purchaseAction(relay,{...common,outcome:loss?'shortfall':'declined',requestId:'supplier-reduce-customer-stop-one',
        confirmsFullIncidentScope: true, dispositions:[{...line,outcome:'cancel',customerDocumentRow:12}]});
      expect(first.orders.find(row=>row.id===relay)).toMatchObject({paidCents:500,dueCents:null,remaining:[{orderItemId:relayLineId,quantity:1}]});
      await report(relay,'supplier-reduces-second-unit');
      const second = await purchaseAction(relay,{...common,outcome:loss?'shortfall':'replacement',requestId:'supplier-reduce-customer-alternate-one',
        confirmsFullIncidentScope: true, dispositions:[{...line,outcome:'replace',replacement:alternative('AFTER-CONTRACT-REDUCTION'),customerDocumentRow:13}]});
      expect(second.orders.find(row=>row.id===relay)).toMatchObject({paidCents:500,totalCents:5000,remaining:[]});
      expect(second.orders.find(row=>row.lines.some(item=>item.fromPurchaseOrderId===relay))).toMatchObject({status:'draft',approvedHash:null,paidCents:0});
      expect(second.activities.find(row=>row.id===firstPayment?.id)).toEqual(firstPayment);
      expect(second.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{decisionDocuments:[
        {role:'supplier',row:8,authority:{purpose:'reduce_contract'},balances:[{...subject,usedBefore:1,using:1,remaining:0}]},
        {role:'customer',row:13,authority:{purpose:loss?'amend_and_replace':'replace_unshipped'}},
      ]}});
    });

    it.each(['continue_first','reduce_first'] as const)('cannot reuse one numbered document for continuing and reducing an existing contract in %s', async first=>{
      await acceptCustomerOrder();
      const {relay} = await orderFromSuppliers();
      const subject = {orderId,purchaseOrderId:relay,orderItemId:relayLineId,quantity:2};
      const paper = {orderItemId:relayLineId,supplierDocumentRow:8,customerDocumentRow:12,supplierDocumentScope:[subject],customerDocumentScope:[subject]};
      const continuation = {action:'resolve_change' as const,outcome:'original_terms' as const,...agreement,decisionDocumentLines:[paper],
        affectedLines:[{orderItemId:relayLineId,quantity:first==='continue_first'?2:1}]};
      const reduction = {action:'resolve_change' as const,outcome:'declined' as const,...agreement,
        confirmsFullIncidentScope: true, dispositions:[{...paper,quantity:1,outcome:'cancel' as const}]};
      await report(relay,'supplier-first-contract-decision');
      if (first === 'continue_first') {
        const continued = await purchaseAction(relay,{...continuation,requestId:'approve-original-terms'});
        expect(continued.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{decisionDocuments:[
          {authority:{purpose:'continue_contract'},balances:[{...subject,usedBefore:0,using:2,remaining:0}]},
          {authority:{purpose:'continue_contract'}},
        ]}});
      } else {
        await purchaseAction(relay,{...reduction,requestId:'approve-material-reduction'});
        await purchaseAction(relay,{action:'approve_remaining',requestId:'verify-remaining-original-contract',
          reference:'TEST-ORIGINAL-REMAINING-ONE',referenceSha256:'e'.repeat(64),description:'核对原合同真正剩余的一件。',
          remainingLines:[{orderItemId:relayLineId,payableCents:2500}],appliedPaidCents:0});
      }
      await report(relay,'reviews-separate-contract-decision');
      const opposite = first === 'continue_first' ? reduction : continuation;
      await expect(purchaseAction(relay,{...opposite,requestId:'opposite-same-paper'})).rejects.toThrow(/商业决定、供方或实质条件已变化/);
      const valid = await purchaseAction(relay,{...opposite,...revisedAgreement,requestId:'opposite-with-separate-signed-decision'});
      expect(valid.orders.find(row=>row.id===relay)?.remaining).toEqual([{orderItemId:relayLineId,quantity:1}]);
    });

    it.each([false,true])('independently allocates the two units with a shared two-unit supplier row = %s', async sharedSupplier=>{
      await acceptCustomerOrder();
      const {relay} = await orderFromSuppliers();
      const original = await dispatch(dispatchInput('lineage-two-original','supplier_to_customer',[goods(relay,2)]));
      const loss = await verifyLoss(original,'two-affected-lineage-units',2);
      const approval = await authorizeTwoResends(relay,loss.resolutionId,2);
      const cover = {orderId,purchaseOrderId:relay,orderItemId:relayLineId,shortfallId:loss.resolutionId,quantity:2};
      const redirect = (tag:string,supplierDocumentRow:number,customerDocumentRow:number): PurchaseAction => ({
        action:'resolve_change',requestId:'approve-lineage-doc-row-'+tag,outcome:'shortfall',...revisedAgreement,
        confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'replace',shortfallId:loss.resolutionId,
          shortfallDecision:'new_purchase',revisesResendApprovalId:approval.approvalId,replacement:alternative(tag),
          supplierDocumentRow,customerDocumentRow,...(sharedSupplier?{supplierDocumentScope:[cover]}:{})}],
      });
      await report(relay,'lineage-doc-first-portion');
      await expect(purchaseAction(relay,redirect('invalid-row',0,12))).rejects.toThrow(/原件所载的正整数/);
      const a = await purchaseAction(relay,redirect('A',2,12));
      expect(a.fulfillment.freeResends[0]).toMatchObject({redirected:1,dispatched:0,available:1});
      await report(relay,'lineage-doc-second-portion');
      const nextSupplierRow = sharedSupplier ? 2 : 3;
      if (!sharedSupplier) {
        const wrong = {...redirect('same-supplier-row',2,13),supplierReference:'TEST-EXACT-SUPPLIER-DOC-RENAMED'};
        await expect(purchaseAction(relay,wrong)).rejects.toThrow(/尚未使用的独立行/);
      } else {
        const changedScope = redirect('changed-supplier-scope',2,13);
        changedScope.dispositions![0].supplierDocumentScope = [{...cover,quantity:3}];
        await expect(purchaseAction(relay,changedScope)).rejects.toThrow(/覆盖范围发生冲突/);
      }
      await expect(purchaseAction(relay,redirect('same-customer-row',nextSupplierRow,12))).rejects.toThrow(/尚未使用的独立行/);
      const b = await purchaseAction(relay,redirect('B',nextSupplierRow,13));
      expect(b.fulfillment.freeResends[0]).toMatchObject({redirected:2,dispatched:0,available:0});
      const separateOrders = b.orders.filter(row=>row.lines.some(line=>line.fromPurchaseOrderId===relay));
      expect(separateOrders).toMatchObject([{status:'draft',approvedHash:null},{status:'draft',approvedHash:null}]);
      for (const draft of separateOrders) await commitReplacement(draft.id,draft.lines[0].source.catalogNumber!);
      expect((await current()).orders.filter(row=>separateOrders.some(draft=>draft.id===row.id)))
        .toMatchObject([{status:'ordered',dueCents:2500},{status:'ordered',dueCents:2500}]);
      expect(b.orders.find(row=>row.id===relay)).toMatchObject({dueCents:5000,paidCents:0});
      expect(b.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{dispositions:[
        {revisesResendApprovalId:approval.approvalId,quantity:1,supplierDocumentRow:nextSupplierRow,customerDocumentRow:13},
      ], ...(sharedSupplier ? { decisionDocuments: expect.arrayContaining([
        expect.objectContaining({role:'supplier',row:2,coverage:[cover],balances:[{...cover,usedBefore:1,using:1,remaining:0}]}),
        expect.objectContaining({role:'customer',row:13,balances:[expect.objectContaining({quantity:1,usedBefore:0,using:1,remaining:0})]}),
      ]) } : {}) }});
      await report(relay,'lineage-doc-no-third-portion');
      await expect(purchaseAction(relay,redirect('outside-approved-count',4,14))).rejects.toThrow(/尚未发货或改办/);
    });
  });

  it.each([false,true])('uses one customer document across actual suppliers only when both lines are covered = %s', async bothCovered=>{
    await acceptCustomerOrder();
    const {direct,relay} = await orderFromSuppliers();
    const orders = [{purchaseOrderId:direct,orderItemId:directLineId},{purchaseOrderId:relay,orderItemId:relayLineId}];
    const buyerFile = {customerReference:'TEST-CUSTOMER-WRITTEN-COMMON-CONSENT',customerSha256:pricingContentHash('actual-common-client-decision')};
    for (const [index,row] of orders.entries()) {
      const sent = await dispatch(dispatchInput('book-scope-original-'+index,'supplier_to_customer',[{...row,quantity:1}]));
      await event(sent.id,{...eventInput('scope-physical-evidence-'+index,'customer_delivery',[]),...agreement,...buyerFile,
        kind:'confirm_shortfall',lines:[{parcelLineId:sent.lines[0].id,quantity:1,outcome:'loss'}]});
      await purchaseAction(row.purchaseOrderId,{action:'report_change',requestId:'scope-supply-change-'+index,changeKind:'unavailable',
        reference:'TEST-SUPPLIER-SPECIFIC-CHANGE-'+index,description:'核对该供方实际短少的一件'});
    }
    const {fulfillment} = await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    const actual = orders.map(row=>({orderId,...row,shortfallId:fulfillment.shortfalls.find(loss=>loss.purchaseOrderId===row.purchaseOrderId)!.resolutionId,quantity:1}));
    const coverage = bothCovered ? actual : [actual[0]];
    const resolve = (row:typeof actual[number], tag:number) => purchaseAction(row.purchaseOrderId,{
      action:'resolve_change',requestId:'scope-confirm-'+tag,outcome:'shortfall',...agreement,...buyerFile,
      supplierSha256:pricingContentHash({tag,proof:'specific-supplier-authorization'}),
      confirmsFullIncidentScope: true, dispositions:[{orderItemId:row.orderItemId,shortfallId:row.shortfallId,quantity:1,outcome:'cancel',shortfallDecision:'free_resend',
        customerDocumentRow:10,...(tag===0?{customerDocumentScope:coverage}:{})}],
    });
    await resolve(actual[0],0);
    if (bothCovered) {
      const done = await resolve(actual[1],1);
      expect(done.fulfillment.freeResends).toHaveLength(2);
      expect(done.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{decisionDocuments:expect.arrayContaining([
        expect.objectContaining({role:'customer',row:10,balances:expect.arrayContaining([
          {...actual[0],usedBefore:1,using:0,remaining:0},{...actual[1],usedBefore:0,using:1,remaining:0},
        ])}),
      ])}});
    } else {
      await expect(resolve(actual[1],1)).rejects.toThrow(/不包含本次办理对象/);
      expect((await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId))).fulfillment.freeResends).toHaveLength(1);
    }
  });

  it('accepts two one-unit receipts against an unlimited account without moving another reservation', async () => {
    await prisma.inventoryBatch.deleteMany({ where: { batchNumber: oldLot } });
    await prisma.inventoryAccount.update({ where: { id: (await inventory()).id }, data: { actualQuantity: -1, availableQuantity: -1 } });
    await prisma.product.update({ where: { id: productId }, data: { stockQuantity: -1 } });
    const other = await prisma.order.create({ data: { id: 'test-unrelated-inventory-order', email: buyer.email, status: 'confirmed', subtotal: 200, total: 200,
      orderItems: { create: { id: 'test-unrelated-inventory-item', position:0, productId, name: '合成商品', unitPrice: 100, quantity: 2 } } } });
    await prisma.$transaction(tx => reserveOrderInventory(tx, other.id, operator.id));
    await acceptCustomerOrder();
    const { relay } = await orderFromSuppliers();
    const first = await dispatch(dispatchInput('unlimited-a','supplier_to_libereal',[{ purchaseOrderId: relay, orderItemId: relayLineId, quantity: 1 }]));
    const second = await dispatch(dispatchInput('unlimited-b','supplier_to_libereal',[{ purchaseOrderId: relay, orderItemId: relayLineId, quantity: 1 }]));
    await event(first.id,eventInput('unlimited-receipt-a','warehouse_receipt',[{ parcelLineId: first.lines[0].id, quantity: 1, batchNumber: receivedLotA }]));
    expect(await inventory()).toMatchObject({ actualQuantity: -1, availableQuantity: -1, reservedQuantity: 5 });
    expect(await prisma.inventoryReservation.findUnique({ where:{ orderItemId: relayLineId } })).toMatchObject({ releasedQuantity: 1, status: 'active' });
    await event(second.id,eventInput('unlimited-receipt-b','warehouse_receipt',[{ parcelLineId: second.lines[0].id, quantity: 1, batchNumber: receivedLotB }]));
    expect(await batch(receivedLotB)).toMatchObject({ quantity:1,reservedQuantity:1 });
    await dispatch(dispatchInput('unlimited-forward-a','libereal_to_customer',[
      { purchaseOrderId: relay, orderItemId: relayLineId, quantity: 1, sourceReceiptId: (await receipt(first.lines[0].id,receivedLotA)).id },
    ]));
    expect(await batch(receivedLotA)).toMatchObject({ quantity:0,reservedQuantity:0 });
    expect(await batch(receivedLotB)).toMatchObject({ quantity:1,reservedQuantity:1 });
    expect(await prisma.inventoryReservation.findUnique({ where:{ orderItemId: 'test-unrelated-inventory-item' } }))
      .toMatchObject({ quantity:2,releasedQuantity:0,fulfilledQuantity:0,status:'active' });
  });

  it('preserves a receipt before cancellation and one received afterward until evidenced stock disposition', async () => {
    await acceptCustomerOrder();
    const { relay } = await orderFromSuppliers();
    const inbound = await dispatch(dispatchInput('inbound-before-cancel','supplier_to_libereal',[{ purchaseOrderId: relay, orderItemId: relayLineId, quantity: 2 }]));
    const [line] = inbound.lines;
    await event(inbound.id,eventInput('received-before-cancel','warehouse_receipt',[{ parcelLineId: line.id, quantity:1, batchNumber: receivedLotA }]));
    const url = 'http://localhost/api/admin/orders/'+orderId;
    const cancelled = await orderPATCH(new NextRequest(url,{ method:'PATCH', body:JSON.stringify({ status:'cancelled' }) }),{ params:Promise.resolve({ id:orderId }) });
    expect(cancelled.status).toBe(200);
    const finance = await prisma.accountReceivable.findUnique({ where:{ orderId } });
    await event(inbound.id,eventInput('actually-arrived-after-cancel','warehouse_receipt',[{ parcelLineId: line.id, quantity:1, batchNumber: receivedLotB }]));
    expect((await workspace()).receipts).toEqual([]);
    expect((await workspace()).parcels.find(row => row.id === inbound.id)?.lines[0].receivedQuantity).toBe(2);
    const a = await receipt(line.id,receivedLotA);
    const b = await receipt(line.id,receivedLotB);
    await expect(dispatch(dispatchInput('cannot-forward-cancelled','libereal_to_customer',[
      { purchaseOrderId:relay,orderItemId:relayLineId,quantity:1,sourceReceiptId:a.id },
    ]))).rejects.toThrow(/当前订单不能/);
    const dispose = (id: string, receiptId: string, disposition:string) => ({
      ...eventInput(id,'warehouse_receipt',[]),kind:'dispose_receipt', receiptId, quantity:1, disposition,
    });
    const released = dispose('reconcile-cancelled-lot-a',a.id,'released_to_stock');
    await event(inbound.id,released);
    await event(inbound.id,released);
    await expect(event(inbound.id,dispose('duplicate-new-proof',a.id,'released_to_stock'))).rejects.toThrow(/尚未转发或处置/);
    await event(inbound.id,dispose('real-return-to-supplier',b.id,'returned_to_supplier'));
    expect(await batch(receivedLotA)).toMatchObject({ quantity:1,reservedQuantity:0 });
    expect(await batch(receivedLotB)).toMatchObject({ quantity:0,reservedQuantity:0 });
    expect(await prisma.fulfillmentReceipt.findMany({ where:{ parcelLineId:line.id } })).toMatchObject([
      { quantity:1,forwardedQuantity:0,releasedQuantity:1 },{ quantity:1,forwardedQuantity:0,releasedQuantity:1 },
    ]);
    expect(await prisma.accountReceivable.findUnique({ where:{ orderId } })).toEqual(finance);
    expect(await prisma.shipment.count({ where:{ orderId } })).toBe(0);
  });

  it('requires exact catalog specificity and a named review when two real stock packages share the approved spec', async () => {
    await acceptCustomerOrder();
    const { relay } = await orderFromSuppliers();
    await purchaseAction(relay,{ action:'report_change',requestId:'report-alt-stock',changeKind:'unavailable',reference:'TEST-ORIGINAL-PROVIDER',description:'原件供货变化' });
    const updated = await purchaseAction(relay,{ action:'resolve_change',requestId:'confirm-alt',outcome:'replacement',supplierReference:'TEST-SUPPLIER-LETTER',
      customerReference:'TEST-CUSTOMER-LETTER',supplierSha256:'c'.repeat(64),customerSha256:'d'.repeat(64),description:'确认替代商品',
      dispositions:[{ orderItemId:relayLineId,quantity:2,outcome:'replace',replacement:{
        name:'合成替代品',brand:'合成品牌',catalogNumber:'TEST-ALT-SAME-CATALOG',spec:'100 μL',unit:'盒',terms:purchaseTerms(2,'TEST-ALTERNATE-SUPPLIER'),
      } }],
    });
    const replacement = updated.orders.find(po => po.lines.some(line => line.fromPurchaseOrderId === relay))!;
    await purchaseAction(replacement.id,{ action:'approve',requestId:'approve-alt' });
    await purchaseAction(replacement.id,{ action:'register_order',requestId:'register-alt',reference:'TEST-ALTERNATE-RECEIPT',
      referenceSha256:'e'.repeat(64),occurredAt:nextOccurrence() });
    const alternate = await prisma.product.create({ data:{ id:'test-catalog-parent',name:'母商品显示名称',brand:'合成品牌',catalogNumber:'TEST-ALT-SAME-CATALOG',
      spec:'100 μL',salesUnit:'盒',price:1,stockQuantity:50,variants:{create:[
        { id:'test-alt-variant-a',catalogNumber:'TEST-ALT-SAME-CATALOG',spec:'100 μL',salesUnit:'盒',packageType:'box',baseQuantity:1,price:1 },
        { id:'test-alt-variant-b',catalogNumber:'TEST-ALT-SAME-CATALOG',spec:'100 μL',salesUnit:'盒',packageType:'case',baseQuantity:8,price:1 },
        { id:'test-alt-variant-wrong',catalogNumber:'TEST-ALT-SAME-CATALOG',spec:'200 μL',salesUnit:'瓶',price:1 },
      ]} } });
    await prisma.inventoryAccount.create({ data:{ id:'test-exact-stock-account',productId:alternate.id,variantId:'test-alt-variant-b',
      actualQuantity:0,availableQuantity:0 } });
    const inbound = await dispatch(dispatchInput('alternate-inbound','supplier_to_libereal',[{ purchaseOrderId:replacement.id,orderItemId:relayLineId,quantity:2 }]));
    const [line] = inbound.lines;
    const options = (await workspace()).inventoryChoices.find(row => row.parcelLineId === line.id)!;
    expect(options.approved).toMatchObject({ catalogNumber:'TEST-ALT-SAME-CATALOG',spec:'100 μL',unit:'盒' });
    expect(options.candidates.map(row=>row.variantId)).toEqual(['test-alt-variant-a','test-alt-variant-b']);
    const attempt = (selection: object) => event(inbound.id,eventInput('alternate-receipt','warehouse_receipt',[
      { parcelLineId:line.id,quantity:1,batchNumber:receivedLotA,...selection },
    ]));
    await expect(attempt({productId:alternate.id})).rejects.toThrow(/规格和单位/);
    await expect(attempt({productId:alternate.id,variantId:'test-alt-variant-wrong'})).rejects.toThrow(/规格和单位/);
    await expect(attempt({inventoryAccountId:'test-exact-stock-account'})).rejects.toThrow(/核对书证出处/);
    const received = await attempt({inventoryAccountId:'test-exact-stock-account',identityReference:'TEST-ORIGINAL-CATALOG',
      identitySha256:'f'.repeat(64),identityDocumentRow:3 });
    expect(await batch(receivedLotA)).toMatchObject({ inventoryAccountId:'test-exact-stock-account', reservedQuantity:1 });
    const evidence = received.events.find(row=>row.kind==='warehouse_receipt')!;
    expect(evidence.actorId).toBe(operator.id);
    expect(JSON.parse(evidence.details)).toMatchObject({lines:[{inventory:{variantId:'test-alt-variant-b',identity:{
      version:options.version,evidence:{reference:'TEST-ORIGINAL-CATALOG',sha256:'f'.repeat(64),row:3},
    }}}]});
    expect(await prisma.inventoryAccount.findFirst({where:{productId:alternate.id,variantId:null}})).toBeNull();
  });

  it('preserves actual supplier and customer quantities through shortage, direct loss and an independently approved forward replacement', async () => {
    await acceptCustomerOrder();
    const { relay,direct } = await orderFromSuppliers();
    await purchaseAction(relay,{ action:'record_payment',requestId:'relay-deposit',reference:'TEST-ORIGINAL-SUPPLY-PAYMENT',amountCents:500,
      conditionReference:'TEST-ACTUAL-PAYMENT-CONDITION' });
    const inbound = await dispatch(dispatchInput('inbound-physical-two','supplier_to_libereal',[{purchaseOrderId:relay,orderItemId:relayLineId,quantity:2}]));
    const decision = { supplierReference:'TEST-SUPPLIER-DECISION', supplierSha256:'c'.repeat(64),
      customerReference:'TEST-CUSTOMER-DECISION', customerSha256:'d'.repeat(64), description:'合成双方书面决定按实际短失处理' };
    const report = (tag:string) => purchaseAction(relay,{action:'report_change',requestId:tag,changeKind:'unavailable',reference:'TEST-SUPPLIER-NOTICE',
      description:'须核对该采购原发货和签收数量' });
    await report('test-original-inbound-in-flight');
    await expect(purchaseAction(relay,{ action:'resolve_change',requestId:'cannot-cancel-traveling-supply',outcome:'declined',...decision,
      dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'cancel'}],refundFollowup:'原款核对' })).rejects.toThrow(/尚未发出/);
    await purchaseAction(relay,{ action:'resolve_change',requestId:'release-inbound-review',outcome:'original_terms',...decision,
      affectedLines:[{orderItemId:relayLineId,quantity:2}],supplierSha256:pricingContentHash('supplier-confirms-inbound-original-contract'),
      customerSha256:pricingContentHash('customer-confirms-inbound-original-contract') });
    await event(inbound.id,eventInput('one-actual-inbound-unit','warehouse_receipt',[{parcelLineId:inbound.lines[0].id,quantity:1,batchNumber:receivedLotA}]));
    const shortage = (tag:string, parcelLineId:string, outcome:string) => ({
      ...eventInput(tag,'warehouse_receipt',[]),...decision,kind:'confirm_shortfall',lines:[{parcelLineId,quantity:1,outcome}],
    });
    const missingInbound = shortage('one-documented-supplier-shortage',inbound.lines[0].id,'shortage');
    await event(inbound.id,missingInbound);
    await event(inbound.id,missingInbound);
    await expect(event(inbound.id,shortage('cannot-reopen-same-shortage',inbound.lines[0].id,'shortage'))).rejects.toThrow(/尚未签收/);
    expect((await workspace()).purchases.find(row=>row.purchaseOrderId===relay)?.available).toBe(0);
    await expect(dispatch(dispatchInput('unapproved-resend','supplier_to_libereal',[{purchaseOrderId:relay,orderItemId:relayLineId,quantity:1}]))).rejects.toThrow(/发货数量/);
    const approveFreeResend = async (purchaseOrderId:string, orderItemId:string, tag:string) => {
      const before = await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
      const loss = before.fulfillment.shortfalls.find(row=>row.purchaseOrderId===purchaseOrderId && row.orderItemId===orderItemId && row.available>0)!;
      await purchaseAction(purchaseOrderId,{action:'report_change',requestId:'report-'+tag,changeKind:'unavailable',reference:loss.reference,
        description:'核对供应商免费重发决定'});
      const resolved = await purchaseAction(purchaseOrderId,{action:'resolve_change',requestId:'approve-'+tag,outcome:'shortfall',...decision,
        supplierSha256:pricingContentHash({tag,source:'supplier-resend'}),customerSha256:pricingContentHash({tag,source:'customer-consent'}),
        confirmsFullIncidentScope: true, dispositions:[{orderItemId,quantity:1,outcome:'cancel',shortfallId:loss.resolutionId,shortfallDecision:'free_resend'}]});
      expect(resolved.fulfillment.shortfalls.find(row=>row.resolutionId===loss.resolutionId)?.available).toBe(0);
      const approval = resolved.fulfillment.freeResends.find(row=>row.shortfallId===loss.resolutionId)!;
      expect(approval.available).toBe(1);
      return approval.approvalId;
    };
    const warehouseApproval = await approveFreeResend(relay,relayLineId,'free-supplier-resend');
    await dispatch(dispatchInput('supplier-resends-one','supplier_to_libereal',[
      {purchaseOrderId:relay,orderItemId:relayLineId,quantity:1,resendApprovalId:warehouseApproval},
    ]));
    expect((await workspace()).purchases.find(row=>row.purchaseOrderId===relay)?.available).toBe(0);

    const outbound = await dispatch(dispatchInput('direct-first-dispatch','supplier_to_customer',[{purchaseOrderId:direct,orderItemId:directLineId,quantity:1}]));
    const firstShipment = await prisma.shipment.findUniqueOrThrow({ where:{id:outbound.shipmentId!},include:{items:true} });
    await event(outbound.id,shortage('direct-documented-loss',outbound.lines[0].id,'loss'));
    expect(await prisma.orderItem.findUnique({where:{id:directLineId}})).toMatchObject({shippedQty:0});
    expect(await prisma.shipment.findUnique({where:{id:firstShipment.id},include:{items:true}})).toEqual(firstShipment);
    const directApproval = await approveFreeResend(direct,directLineId,'free-direct-resend');
    const alreadyClaimed = (await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId))).fulfillment.shortfalls.find(row=>row.purchaseOrderId===direct)!;
    await purchaseAction(direct,{action:'report_change',requestId:'review-claimed-direct-loss',changeKind:'other',reference:alreadyClaimed.reference,
      description:'核对是否已走免费重发'});
    await expect(purchaseAction(direct,{action:'resolve_change',requestId:'try-separate-purchase-on-free-resend',outcome:'shortfall',...decision,
      dispositions:[{orderItemId:directLineId,quantity:1,outcome:'replace',shortfallId:alreadyClaimed.resolutionId,shortfallDecision:'new_purchase'}],
    })).rejects.toThrow(/尚未使用的实际物流书证/);
    await purchaseAction(direct,{action:'resolve_change',requestId:'confirm-keeping-free-approval',outcome:'original_terms',...decision,
      affectedLines:[{orderItemId:directLineId,quantity:1}],supplierSha256:pricingContentHash('supplier-confirms-original-direct-contract'),
      customerSha256:pricingContentHash('customer-confirms-original-direct-contract')});
    await expect(dispatch(dispatchInput('wrong-free-decision','supplier_to_customer',[
      {purchaseOrderId:direct,orderItemId:directLineId,quantity:1,resendApprovalId:warehouseApproval},
    ]))).rejects.toThrow(/本行免费重发/);
    const directReplacement = await dispatch(dispatchInput('direct-second-dispatch','supplier_to_customer',[
      {purchaseOrderId:direct,orderItemId:directLineId,quantity:1,resendApprovalId:directApproval},
    ]));
    await event(directReplacement.id,eventInput('direct-replacement-received','customer_delivery',[{parcelLineId:directReplacement.lines[0].id,quantity:1}]));
    await expect(dispatch(dispatchInput('direct-duplicate-dispatch','supplier_to_customer',[{purchaseOrderId:direct,orderItemId:directLineId,quantity:1}]))).rejects.toThrow(/发货数量/);

    const sourceReceipt = await receipt(inbound.lines[0].id,receivedLotA);
    const forwarded = await dispatch(dispatchInput('forward-purchased-batch','libereal_to_customer',[
      {purchaseOrderId:relay,orderItemId:relayLineId,quantity:1,sourceReceiptId:sourceReceipt.id},
    ]));
    await event(forwarded.id,shortage('forward-documented-loss',forwarded.lines[0].id,'loss'));
    const state = await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    const sourceUnits = state.fulfillment.supplierDispatched.filter(row=>row.purchaseOrderId===relay).reduce((sum,row)=>sum+row.quantity,0);
    expect(sourceUnits).toBe(2);
    const loss = state.fulfillment.shortfalls.find(row=>row.route==='libereal_to_customer')!;
    expect(loss).toMatchObject({purchaseOrderId:relay,available:1});
    const followUp = (requestId:string):PurchaseAction => ({
      action:'resolve_change',requestId,outcome:'shortfall',...decision,
      confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'replace',shortfallId:loss.resolutionId,shortfallDecision:'new_purchase',replacement:{
        name:'合成补发品',brand:'合成品牌',catalogNumber:'TEST-B3-REPLACEMENT-CATALOG',spec:'合成规格',unit:'件',
        terms:purchaseTerms(1,'TEST-B3-SEPARATE-REPLACEMENT-SUPPLIER'),
      }}],
    });
    await report('forward-loss-replacement-review');
    const updated = await purchaseAction(relay,followUp('approve-preparing-separate-loss-replacement'));
    expect(updated.orders.find(row=>row.id===relay)).toMatchObject({ status:'ordered', paidCents:500, dueCents:4500,
      remaining:[{orderItemId:relayLineId,quantity:2}] });
    expect(updated.orders.find(row=>row.lines.some(line=>line.fromPurchaseOrderId===relay))).toMatchObject({status:'draft',approvedHash:null,paidCents:0});
    expect(updated.fulfillment.shortfalls.find(row=>row.resolutionId===loss.resolutionId)?.available).toBe(0);
    const remainingPayable = await purchaseAction(relay,{action:'record_payment',requestId:'verified-original-tail',amountCents:4500,
      reference:'TEST-ACTUAL-ORIGINAL-BALANCE',conditionReference:'TEST-ORIGINAL-AGREED-TAIL'});
    expect(remainingPayable.orders.find(row=>row.id===relay)).toMatchObject({paidCents:5000,dueCents:0});
    await report('another-forward-loss-review');
    await expect(purchaseAction(relay,followUp('duplicate-loss-use'))).rejects.toThrow(/尚未使用的实际物流书证/);
  });

  it('can put an ordinary supplier unit and an explicitly free resend in one physical package with distinct evidence', async () => {
    await acceptCustomerOrder();
    const {relay}=await orderFromSuppliers();
    const ordinary={purchaseOrderId:relay,orderItemId:relayLineId,quantity:1};
    const original=await dispatch(dispatchInput('mixed-resend-first-unit','supplier_to_customer',[ordinary]));
    const agreement={supplierReference:'TEST-MIXED-RESEND-SUPPLIER',supplierSha256:'c'.repeat(64),customerReference:'TEST-MIXED-RESEND-CUSTOMER',
      customerSha256:'d'.repeat(64),description:'独立核实原寄件短失，供应方免费重发。'};
    await event(original.id,{...eventInput('mixed-resend-original-loss','customer_delivery',[]),...agreement,kind:'confirm_shortfall',
      lines:[{parcelLineId:original.lines[0].id,quantity:1,outcome:'loss'}]});
    const state=await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    const [loss]=state.fulfillment.shortfalls;
    await purchaseAction(relay,{action:'report_change',requestId:'report-mixed-resend',changeKind:'other',reference:loss.reference,description:agreement.description});
    const approved=await purchaseAction(relay,{action:'resolve_change',requestId:'approve-mixed-resend',outcome:'shortfall',...agreement,
      confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'cancel',shortfallId:loss.resolutionId,shortfallDecision:'free_resend'}]});
    const [resend]=approved.fulfillment.freeResends;
    const together=await dispatch(dispatchInput('normal-and-free-in-one','supplier_to_customer',[ordinary,{...ordinary,resendApprovalId:resend.approvalId}]));
    expect(together.lines).toHaveLength(2);
    const evidence=JSON.parse(together.events.find(row=>row.kind==='dispatch')!.details).lines;
    expect(evidence).toContainEqual(expect.objectContaining({resendApprovalId:resend.approvalId,parcelLineId:expect.any(String)}));
    const current=await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    expect(current.fulfillment.supplierDispatched.find(row=>row.purchaseOrderId===relay)?.quantity).toBe(2);
    expect(current.fulfillment.freeResends[0].available).toBe(0);
    expect(current.orders.find(row=>row.id===relay)).toMatchObject({totalCents:5000,dueCents:5000,paidCents:0});
  });

  it('accepts a dated earlier lot return and changes contract scope only after the written decision', async () => {
    await acceptCustomerOrder();
    const {relay} = await orderFromSuppliers();
    await purchaseAction(relay,{ action:'record_payment',requestId:'amended-goods-deposit',reference:'TEST-AMENDED-GOODS-DEPOSIT',
      amountCents:500,conditionReference:'TEST-AMENDED-VALID-DEPOSIT' });
    const inbound = await dispatch(dispatchInput('dated-return-inbound','supplier_to_libereal',[{purchaseOrderId:relay,orderItemId:relayLineId,quantity:2}]));
    const [line]=inbound.lines;
    await event(inbound.id,eventInput('first-real-lot','warehouse_receipt',[{parcelLineId:line.id,quantity:1,batchNumber:receivedLotA}]));
    const returningAt = nextOccurrence();
    await event(inbound.id,eventInput('later-other-lot','warehouse_receipt',[{parcelLineId:line.id,quantity:1,batchNumber:receivedLotB}]));
    const a = await receipt(line.id,receivedLotA);
    const paperwork = { supplierReference:'TEST-SIGNED-SUPPLIER-AMENDMENT',supplierSha256:'e'.repeat(64),
      customerReference:'TEST-CUSTOMER-DECISION-ON-RETURN',customerSha256:'f'.repeat(64),description:'供方已接收早批退回。' };
    const physicalReturn = (requestId:string,occurredAt:string) => ({
      ...eventInput(requestId,'warehouse_receipt',[]),...paperwork,kind:'confirm_shortfall',occurredAt,
      lines:[{parcelLineId:line.id,quantity:1,outcome:'return',receiptId:a.id}],
    });
    await expect(event(inbound.id,physicalReturn('too-early-lot-return',inbound.dispatchedAt.toISOString()))).rejects.toThrow(/尚未转发或处置/);
    await event(inbound.id,physicalReturn('earlier-lot-return',returningAt));
    await expect(event(inbound.id,physicalReturn('second-return-of-same-lot',returningAt))).rejects.toThrow(/尚未转发或处置/);
    const raw = await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    expect(raw.orders.find(row=>row.id===relay)).toMatchObject({status:'ordered',paidCents:500,dueCents:4500});
    expect(await batch(receivedLotA)).toMatchObject({quantity:0,reservedQuantity:0});
    expect(await batch(receivedLotB)).toMatchObject({quantity:1,reservedQuantity:1});
    const loss=raw.fulfillment.shortfalls.find(row=>row.purchaseOrderId===relay)!;
    await purchaseAction(relay,{action:'report_change',requestId:'document-actual-amendment',changeKind:'other',
      reference:paperwork.supplierReference,description:'原合同确已减量，尚余实际收到的一件。'});
    const result=await purchaseAction(relay,{action:'resolve_change',requestId:'apply-actual-amendment',outcome:'shortfall',...paperwork,
      confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'cancel',shortfallId:loss.resolutionId,shortfallDecision:'change_contract'}],
      refundFollowup:'已付定金由财务核对抵扣，待核实实际结果。'});
    expect(result.orders.find(row=>row.id===relay)).toMatchObject({dueCents:null,needsRemainingReview:true,paidCents:500});
    expect(result.orders).toHaveLength(2);
    const reviewed=await purchaseAction(relay,{action:'approve_remaining',requestId:'verify-amended-balance',reference:'TEST-SIGNED-COMMERCIAL-CHANGE',
      referenceSha256:'b'.repeat(64),description:'只结剩下的一件，原500分定金抵扣。',remainingLines:[{orderItemId:relayLineId,payableCents:2500}],appliedPaidCents:500});
    expect(reviewed.orders.find(row=>row.id===relay)).toMatchObject({dueCents:2000,paidCents:500,remaining:[{orderItemId:relayLineId,quantity:1}]});
  });

  it('uses the signed date on a linked legacy delivery for the actual customer return', async () => {
    await acceptCustomerOrder();
    const sentAt = new Date(nextOccurrence());
    const deliveredAt = new Date(nextOccurrence());
    const shipment = await prisma.shipment.create({data:{orderId,status:'delivered',method:'logistics',shippedAt:sentAt,deliveredAt,
      items:{create:{orderItemId:directLineId,quantity:1}}}});
    await prisma.orderItem.update({where:{id:directLineId},data:{shippedQty:1,status:'shipped'}});
    const linking={...eventInput('link-already-signed-old-waybill','customer_delivery',[]),shipmentId:shipment.id};
    const preview=await prisma.$transaction(tx=>linkLegacyShipment(tx,orderId,linking,operator));
    await prisma.$transaction(tx=>linkLegacyShipment(tx,orderId,linking,operator,preview.actionHash));
    const parcel=await prisma.fulfillmentParcel.findUniqueOrThrow({where:{shipmentId:shipment.id},include:{lines:true}});
    const returning=(requestId:string,occurredAt:string)=>({...eventInput(requestId,'customer_delivery',[]),kind:'confirm_shortfall',occurredAt,
      supplierReference:'TEST-OLD-RETURN',supplierSha256:'c'.repeat(64),customerReference:'TEST-OLD-CUSTOMER-RETURN',customerSha256:'d'.repeat(64),
      lines:[{parcelLineId:parcel.lines[0].id,quantity:1,outcome:'return'}]});
    await expect(event(parcel.id,returning('old-return-before-signature',sentAt.toISOString()))).rejects.toThrow(/有效签收数量/);
    await event(parcel.id,returning('old-return-after-signature',nextOccurrence()));
    await expect(event(parcel.id,returning('old-return-overrun',nextOccurrence()))).rejects.toThrow(/实收可退/);
    expect(await prisma.shipment.findUnique({where:{id:shipment.id}})).toMatchObject({deliveredAt,status:'delivered'});
  });

  it('syncs real partial receipt when the last exception closes and completes only after the later package is signed', async () => {
    vi.stubEnv('FULFILLMENT_CARRIER_SOURCE','TEST-SIGNATURE-CARRIER');
    vi.stubEnv('FULFILLMENT_CARRIER_SECRET','SYNTHETIC-CARRIER-SECRET-FOR-TESTS-ONLY');
    try {
      await acceptCustomerOrder();
      const {relay,direct}=await orderFromSuppliers();
      const input={...dispatchInput('exception-first-package','supplier_to_customer',[{purchaseOrderId:relay,orderItemId:relayLineId,quantity:2}]),
        feedSource:'TEST-SIGNATURE-CARRIER'};
      const first=await dispatch(input);
      const later=await dispatch(dispatchInput('exception-later-package','supplier_to_customer',[{purchaseOrderId:direct,orderItemId:directLineId,quantity:1}]));
      const signed=eventInput('partial-real-signature','customer_delivery',[{parcelLineId:first.lines[0].id,quantity:1}]);
      await event(first.id,signed);
      const firstIncident=await event(first.id,{...eventInput('first-unresolved-exception','customer_delivery',[]),kind:'exception'});
      const staff=firstIncident.events.find(row=>row.kind==='exception')!;
      const second=await prisma.$transaction(tx=>receiveCarrierNotice(tx,'TEST-SIGNATURE-CARRIER',{
        ...eventInput('second-unresolved-exception','customer_delivery',[]),eventId:'TEST-SECOND-REAL-CARRIER-EXCEPTION',kind:'exception',
        carrier:input.carrier,trackingNumber:input.trackingNumber,
      }));
      const agreement={supplierReference:'TEST-FREE-AGREEMENT-SUPPLIER',supplierSha256:'c'.repeat(64),
        customerReference:'TEST-FREE-AGREEMENT-CUSTOMER',customerSha256:'d'.repeat(64),description:'供方同意免费重发确实短少的一件。'};
      await event(first.id,{...eventInput('one-of-two-missing','customer_delivery',[]),...agreement,kind:'confirm_shortfall',exceptionId:staff.id,
        lines:[{parcelLineId:first.lines[0].id,quantity:1,outcome:'shortage'}]});
      expect(await prisma.shipment.findUnique({where:{id:first.shipmentId!}})).toMatchObject({status:'shipped',deliveredAt:null});
      await event(first.id,{...eventInput('last-exception-resolved','customer_delivery',[]),kind:'resolve_exception',exceptionId:second.id});
      expect(await prisma.shipment.findUnique({where:{id:first.shipmentId!}})).toMatchObject({status:'delivered',deliveredAt:new Date(signed.occurredAt)});
      const before = await prisma.accountReceivable.findUnique({where:{orderId}});
      const state=await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
      const [loss]=state.fulfillment.shortfalls;
      await purchaseAction(relay,{action:'report_change',requestId:'review-free-final',changeKind:'unavailable',reference:loss.reference,
        description:agreement.description});
      const decision=await purchaseAction(relay,{action:'resolve_change',requestId:'allow-one-free-final',outcome:'shortfall',...agreement,
        confirmsFullIncidentScope: true, dispositions:[{orderItemId:relayLineId,quantity:1,outcome:'cancel',shortfallId:loss.resolutionId,shortfallDecision:'free_resend'}]});
      const [authorized]=decision.fulfillment.freeResends;
      const resend=await dispatch(dispatchInput('final-free-resend','supplier_to_customer',[
        {purchaseOrderId:relay,orderItemId:relayLineId,quantity:1,resendApprovalId:authorized.approvalId},
      ]));
      await event(resend.id,eventInput('final-free-signature','customer_delivery',[{parcelLineId:resend.lines[0].id,quantity:1}]));
      expect(await prisma.order.findUnique({where:{id:orderId}})).toMatchObject({status:'shipped',paidAt:null});
      await event(later.id,eventInput('last-genuine-signature','customer_delivery',[{parcelLineId:later.lines[0].id,quantity:1}]));
      expect(await prisma.order.findUnique({where:{id:orderId}})).toMatchObject({status:'completed',paidAt:null});
      expect(await prisma.accountReceivable.findUnique({where:{orderId}})).toEqual(before);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('ships directly without consuming the warehouse and forwards only the units physically received into each batch', async () => {
    await acceptCustomerOrder();
    const supply = await orderFromSuppliers();
    const originalCredit = await prisma.creditAccount.findUniqueOrThrow({ where: { userId: buyer.id } });
    expect(originalCredit.usedAmount).toBe(300);
    expect(await inventory()).toMatchObject({ actualQuantity: 10, reservedQuantity: 3, availableQuantity: 7, shippedQuantity: 0 });
    expect(await batch(oldLot)).toMatchObject({ quantity: 10, reservedQuantity: 3 });

    const directSource = { purchaseOrderId: supply.direct, orderItemId: directLineId, quantity: 1 };
    await expect(dispatch(dispatchInput('wrong-supplier-line', 'supplier_to_customer', [
      { ...directSource, purchaseOrderId: supply.relay },
    ]))).rejects.toThrow(/已经生效的供应商订购/);
    expect(await prisma.shipment.count({ where: { orderId } })).toBe(0);

    const directInput = dispatchInput('direct', 'supplier_to_customer', [directSource]);
    const direct = await dispatch(directInput);
    expect(await dispatch(directInput)).toMatchObject({ id: direct.id });
    expect(await dispatch({ ...directInput, requestId: 'direct-same-carrier-evidence' })).toMatchObject({ id: direct.id });
    await expect(dispatch({ ...directInput, lines: [{ ...directSource, quantity: 2 }] })).rejects.toThrow(/凭据已用于其他内容/);
    await expect(event(direct.id, eventInput('direct-must-not-enter-warehouse', 'warehouse_receipt', [
      { parcelLineId: direct.lines[0].id, quantity: 1, batchNumber: 'TEST-INELIGIBLE-DIRECT-LOT', productId },
    ]))).rejects.toThrow(/收货对象与这个包裹的运输路线不同/);
    expect(await prisma.shipment.count({ where: { orderId } })).toBe(1);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: 'partially_shipped' });
    expect(await inventory()).toMatchObject({ actualQuantity: 10, reservedQuantity: 2, availableQuantity: 8, shippedQuantity: 0 });
    expect(await batch(oldLot)).toMatchObject({ quantity: 10, reservedQuantity: 2 });
    expect(await prisma.inventoryReservation.findUniqueOrThrow({ where: { orderItemId: directLineId } }))
      .toMatchObject({ fulfilledQuantity: 0, releasedQuantity: 1 });
    expect(await prisma.inventoryTransaction.count({ where: { orderId, type: 'ship' } })).toBe(0);

    const relaySource = { purchaseOrderId: supply.relay, orderItemId: relayLineId, quantity: 2 };
    const intake = await dispatch(dispatchInput('supplier-intake', 'supplier_to_libereal', [relaySource]));
    expect(await inventory()).toMatchObject({ actualQuantity: 10, shippedQuantity: 0 });
    expect(await prisma.shipment.count({ where: { orderId } })).toBe(1);
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: relayLineId } })).toMatchObject({ shippedQty: 0 });

    const allocated = await workspace();
    await expect(dispatch(dispatchInput('reallocate-stock-already-en-route', 'supplier_to_customer', [
      { ...relaySource, quantity: 1 },
    ]))).rejects.toThrow(/发货数量超过该采购行或实收批次可用数量/);
    await expect(dispatch(dispatchInput('forward-without-receipt', 'libereal_to_customer', [
      { ...relaySource, quantity: 1 },
    ]))).rejects.toThrow(/本仓转发须选用实际收到的批次/);
    expect(await workspace()).toEqual(allocated);

    const intakeLine = intake.lines[0];
    const firstReceipt = eventInput('receive-first', 'warehouse_receipt', [
      { parcelLineId: intakeLine.id, quantity: 1, batchNumber: receivedLotA, productId },
    ]);
    await event(intake.id, firstReceipt);
    await event(intake.id, firstReceipt);
    await event(intake.id, { ...firstReceipt, requestId: 'receive-first-same-evidence' });
    const receiptA = await receipt(intakeLine.id, receivedLotA);
    expect(receiptA).toMatchObject({ quantity: 1, forwardedQuantity: 0 });
    expect(await prisma.fulfillmentReceipt.count({ where: { parcelLineId: intakeLine.id } })).toBe(1);
    expect(await inventory()).toMatchObject({ actualQuantity: 11, shippedQuantity: 0 });
    expect(await batch(receivedLotA)).toMatchObject({ quantity: 1 });

    await expect(event(intake.id, eventInput('receive-more-than-intake', 'warehouse_receipt', [
      { parcelLineId: intakeLine.id, quantity: 2, batchNumber: 'TEST-OVER-RECEIPT', productId },
    ]))).rejects.toThrow(/实际签收数量超过/);
    await expect(dispatch(dispatchInput('forward-more-than-receipt', 'libereal_to_customer', [
      { ...relaySource, quantity: 2, sourceReceiptId: receiptA.id },
    ]))).rejects.toThrow(/发货数量超过该采购行或实收批次可用数量/);
    expect(await prisma.inventoryBatch.count({ where: { batchNumber: 'TEST-OVER-RECEIPT' } })).toBe(0);
    expect(await inventory()).toMatchObject({ actualQuantity: 11, shippedQuantity: 0 });

    const forwardAInput = dispatchInput('forward-first', 'libereal_to_customer', [
      { ...relaySource, quantity: 1, sourceReceiptId: receiptA.id },
    ]);
    const forwardA = await dispatch(forwardAInput);
    expect(await dispatch(forwardAInput)).toMatchObject({ id: forwardA.id });
    expect(await receipt(intakeLine.id, receivedLotA)).toMatchObject({ forwardedQuantity: 1 });
    expect(await batch(receivedLotA)).toMatchObject({ quantity: 0 });
    expect(await batch(oldLot)).toMatchObject({ quantity: 10 });
    expect(await inventory()).toMatchObject({ actualQuantity: 10, shippedQuantity: 1 });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: 'partially_shipped' });

    await expect(dispatch(dispatchInput('reuse-forwarded-receipt', 'libereal_to_customer', [
      { ...relaySource, quantity: 1, sourceReceiptId: receiptA.id },
    ]))).rejects.toThrow(/须先核实本单此采购行实际收到的批次/);

    await event(intake.id, eventInput('receive-second', 'warehouse_receipt', [
      { parcelLineId: intakeLine.id, quantity: 1, batchNumber: receivedLotB, productId },
    ]));
    const receiptB = await receipt(intakeLine.id, receivedLotB);
    expect(await inventory()).toMatchObject({ actualQuantity: 11, shippedQuantity: 1 });
    expect(await batch(receivedLotB)).toMatchObject({ quantity: 1 });
    const forwardB = await dispatch(dispatchInput('forward-second', 'libereal_to_customer', [
      { ...relaySource, quantity: 1, sourceReceiptId: receiptB.id },
    ]));
    expect(await receipt(intakeLine.id, receivedLotB)).toMatchObject({ forwardedQuantity: 1 });
    expect(await batch(receivedLotB)).toMatchObject({ quantity: 0 });
    expect(await batch(oldLot)).toMatchObject({ quantity: 10, reservedQuantity: 0 });
    expect(await inventory()).toMatchObject({ actualQuantity: 10, availableQuantity: 10, reservedQuantity: 0, shippedQuantity: 2 });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: 'shipped', paidAt: null });
    expect(await prisma.orderItem.findUniqueOrThrow({ where: { id: relayLineId } })).toMatchObject({ shippedQty: 2 });

    for (const [index, parcel] of [direct, forwardA, forwardB].entries()) {
      const delivered = eventInput(`signed-${parcel.id}`, 'customer_delivery', [
        { parcelLineId: parcel.lines[0].id, quantity: 1 },
      ]);
      await event(parcel.id, delivered);
      await event(parcel.id, delivered);
      if (index < 2) {
        expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: 'shipped', paidAt: null });
      }
    }
    expect(await prisma.fulfillmentParcel.count({ where: { orderId } })).toBe(4);
    expect(await prisma.fulfillmentEvent.count({ where: { parcel: { orderId }, kind: 'customer_delivery' } })).toBe(3);
    expect(await prisma.shipment.findMany({ where: { orderId } })).toHaveLength(3);
    expect(await prisma.notification.count({ where: { email: buyer.email, type: 'shipping_notification' } })).toBe(3);
    const purchased = await prisma.$transaction(tx => purchaseWorkspace(tx, orderId));
    expect(purchased.fulfillment.targets).toEqual([]);
    expect(purchased.fulfillment.historicalDelivered).toEqual([]);
    const suppliedQty = (purchaseOrderId: string) => purchased.fulfillment.delivered
      .filter(row => row.purchaseOrderId === purchaseOrderId).reduce((total, row) => total + row.quantity, 0);
    expect(suppliedQty(supply.direct)).toBe(1);
    expect(suppliedQty(supply.relay)).toBe(2);
    expect(await prisma.shipment.count({ where: { orderId, status: 'delivered', deliveredAt: { not: null } } })).toBe(3);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: 'completed', paidAt: null });
    expect(await prisma.orderStatusHistory.findFirst({ where: { orderId, toStatus: 'completed' } }))
      .toMatchObject({ fromStatus: 'shipped', reason: 'customer_delivery_confirmed' });
    expect(await prisma.accountReceivable.findUniqueOrThrow({ where: { orderId } })).toMatchObject({ status: 'open', amount: 300, paidAt: null });
    expect(await prisma.creditAccount.findUniqueOrThrow({ where: { userId: buyer.id } })).toMatchObject({ usedAmount: originalCredit.usedAmount });
    expect(await prisma.creditTransaction.count({ where: { orderId, type: 'release' } })).toBe(0);
    expect(await prisma.pointsLog.count({ where: { userId: buyer.id, relatedId: orderId, type: 'order_credit' } })).toBe(0);
  });
});

describe('actual scope of a supply incident', () => {
  const current = async (id: string) => (await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId))).orders.find(row=>row.id===id)!;
  const line = (orderItemId: string, quantity: number) => ({orderItemId,quantity});
  const goods = (purchaseOrderId: string, orderItemId: string, quantity = 1) => ({purchaseOrderId,orderItemId,quantity});
  const agreement = (tag: string) => ({
    supplierReference:'TEST-SUPPLY-LETTER-'+tag,supplierSha256:pricingContentHash({role:'supplier',tag}),
    customerReference:'TEST-CUSTOMER-LETTER-'+tag,customerSha256:pricingContentHash({role:'customer',tag}),
    description:'双方确认本次选定数量的处置，其余按原事实单独核对。',
  });
  const report = (id: string, tag: string, description: string, affectedLines?: PurchaseAction['affectedLines']) =>
    purchaseAction(id,{action:'report_change',requestId:'report-'+tag,changeKind:'delay', reference:'TEST-INCIDENT-'+tag,description,affectedLines},operator);

  async function groupedOrder(relayQuantity = 2) {
    const supplier = 'TEST-GROUPED-SUPPLY';
    for (const item of [line(directLineId,1),line(relayLineId,relayQuantity)]) {
      await prisma.$transaction(async tx=>{
        const source = (await purchaseWorkspace(tx,orderId)).lines.find(row=>row.orderItemId===item.orderItemId)!;
        await savePurchaseLine(tx,{orderId,orderItemId:item.orderItemId,revision:source.revision,
          terms:{...purchaseTerms(item.quantity,supplier),sourceReference:'TEST-GROUPED-QUOTE-'+item.orderItemId,
            sourceSha256:pricingContentHash({item,supplier})},checkedEvidence:true},operator);
      });
    }
    const {orders:[draft]}=await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    await purchaseAction(draft.id,{action:'approve',requestId:'approve-grouped-supply'});
    await purchaseAction(draft.id,{action:'register_order',requestId:'actual-grouped-supply',reference:'TEST-GROUPED-ORDER',
      referenceSha256:pricingContentHash('real grouped synthetic order'),occurredAt:nextOccurrence()},operator);
    return draft.id;
  }

  it.each([false,true])('continues the one delayed unit using only its evidence, with unrelated signed and inbound goods (grouped = %s)',async grouped=>{
    await acceptCustomerOrder();
    const id = grouped ? await groupedOrder() : (await orderFromSuppliers()).relay;
    const shippedItem = grouped ? directLineId : relayLineId;
    const sent = await dispatch(dispatchInput('original-already-sent','supplier_to_customer',[goods(id,shippedItem)]));
    await event(sent.id,eventInput('confirmed-original-signed','customer_delivery',[{parcelLineId:sent.lines[0].id,quantity:1}]));
    const inbound = grouped ? await dispatch(dispatchInput('original-already-inbound','supplier_to_libereal',[goods(id,relayLineId)])) : null;
    if (grouped) {
      await expect(report(id,'wrong-delayed-line','已签收的 A 不应作为新的延误处理。',[line(directLineId,1)]))
        .rejects.toThrow(/超出对应采购行/);
    }
    const delayed = line(relayLineId,1);
    const reported = await report(id,'only-one-delayed','仅剩一件延期，已实收及在途的商品照原记录。',[delayed]);
    expect(reported.orders.find(po=>po.id===id)?.incident).toMatchObject({reportedBy:operator.id,scope:[delayed],outstanding:[delayed]});
    const subject = {...delayed,orderId,purchaseOrderId:id};
    const resolved = await purchaseAction(id,{action:'resolve_change',requestId:'continue-real-one',outcome:'original_terms',...agreement('one-only'),
      decisionDocumentLines:[{orderItemId:relayLineId,supplierDocumentRow:8,customerDocumentRow:13,
        supplierDocumentScope:[subject],customerDocumentScope:[subject]}]});
    expect(resolved.orders.find(po=>po.id===id)).toMatchObject({status:'ordered',incident:null,paidCents:0});
    expect(resolved.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{
      incidentProgress:{scope:[delayed],handled:[delayed],outstanding:[]},
      supplyFacts:[{orderItemId:relayLineId,customerReceived:grouped?0:1,warehouseTransit:grouped?1:0,shortfalls:[]}],
      decisionDocuments:[
        {role:'supplier',row:8,balances:[{...subject,using:1,remaining:0}]},
        {role:'customer',row:13,balances:[{...subject,using:1,remaining:0}]},
      ],
    }});
    const parcels = (await workspace()).parcels;
    expect(parcels.find(parcel=>parcel.id===sent.id)).toMatchObject({status:'delivered'});
    if (inbound) expect(parcels.find(parcel=>parcel.id===inbound.id)).toMatchObject({status:'dispatched'});
  });

  it('lets an unaffected line dispatch during an actual PO delay but keeps the held units blocked',async()=>{
    await acceptCustomerOrder();
    const id = await groupedOrder();
    const affected = line(relayLineId,1);
    await purchaseAction(id,{action:'record_payment',requestId:'original-deposit',reference:'TEST-ORIGINAL-BANK-PAYMENT',amountCents:500,
      conditionReference:'TEST-ORIGINAL-DEPOSIT-CONDITION'});
    const held = (await report(id,'one-line-partial-hold','B 有一件延迟，另一件和 A 仍按原承诺。',[affected])).orders.find(row=>row.id===id)!;
    expect((await workspace()).purchases).toEqual([
      expect.objectContaining({purchaseOrderId:id,orderItemId:directLineId,available:1}),
      expect.objectContaining({purchaseOrderId:id,orderItemId:relayLineId,available:1}),
    ]);
    await expect(dispatch(dispatchInput('try-both-one-held','supplier_to_customer',[goods(id,relayLineId,2)]))).rejects.toThrow(/发货数量/);
    const first = await dispatch(dispatchInput('send-unaffected-a','supplier_to_customer',[goods(id,directLineId)]));
    const second = await dispatch(dispatchInput('send-unaffected-b-unit','supplier_to_libereal',[goods(id,relayLineId)]));
    await expect(dispatch(dispatchInput('try-held-b-unit','supplier_to_customer',[goods(id,relayLineId)]))).rejects.toThrow(/发货数量/);
    expect(first.lines).toMatchObject([{purchaseOrderId:id,orderItemId:directLineId,quantity:1}]);
    expect(second.lines).toMatchObject([{purchaseOrderId:id,orderItemId:relayLineId,quantity:1}]);
    expect(await current(id)).toMatchObject({openIncidentId:held.openIncidentId,status:'on_hold',paidCents:500,dueCents:7000,
      incident:{outstanding:[affected]}});
    expect(await prisma.accountReceivable.findUniqueOrThrow({where:{orderId}})).toMatchObject({status:'open',paidAt:null});
  });

  it('forwards the received batch of a partially delayed purchase line without releasing its other unit',async()=>{
    await acceptCustomerOrder();
    const {relay:id} = await orderFromSuppliers();
    const inbound = await dispatch(dispatchInput('one-purchase-unit-arrived','supplier_to_libereal',[goods(id,relayLineId)]));
    await event(inbound.id,eventInput('actual-inbound-receipt-before-delay','warehouse_receipt',[
      {parcelLineId:inbound.lines[0].id,quantity:1,batchNumber:receivedLotA},
    ]));
    const received = await receipt(inbound.lines[0].id,receivedLotA);
    const affected = line(relayLineId,1);
    await expect(report(id,'do-not-hold-actual-receipt','供方已交仓的货不能计作缺货。',[line(relayLineId,2)]))
      .rejects.toThrow(/超出对应采购行/);
    const held = await report(id,'the-other-unit-is-delayed','供方仅余下一件延期，仓库已实收一件继续按原计划转发。',[affected]);
    expect(held.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{supplyFacts:[
      {orderItemId:relayLineId,supplierReceived:1,warehouseReceived:1,warehouseTransit:0,customerReceived:0},
    ]}});
    const view = await workspace();
    expect(view.purchases.find(po=>po.purchaseOrderId===id)).toMatchObject({available:0});
    expect(view.receipts).toMatchObject([{id:received.id,orderItemId:relayLineId,available:1}]);
    const forwarded = await dispatch(dispatchInput('forward-real-received-unit','libereal_to_customer',[
      {...goods(id,relayLineId),sourceReceiptId:received.id},
    ]));
    await event(forwarded.id,eventInput('actual-customer-sign-for-forwarded','customer_delivery',[{parcelLineId:forwarded.lines[0].id,quantity:1}]));
    await expect(dispatch(dispatchInput('try-supplier-delayed-unit','supplier_to_customer',[goods(id,relayLineId)]))).rejects.toThrow(/发货数量/);
    expect(await current(id)).toMatchObject({status:'on_hold',incident:{outstanding:[affected]}});
    const review = await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    expect(review.fulfillment.supplierReceived).toEqual([{purchaseOrderId:id,orderItemId:relayLineId,quantity:1}]);
    expect(review.fulfillment.customerReceived).toEqual(review.fulfillment.supplierReceived);
    expect((await workspace()).receipts).toEqual([]);
  });

  it('requires the old scope to be verified, applies only the selected effects, and keeps remaining payable independent',async()=>{
    await acceptCustomerOrder();
    const id = await groupedOrder();
    await purchaseAction(id,{action:'record_payment',requestId:'older-paid-deposit',reference:'TEST-OLD-DEPOSIT',amountCents:500,
      conditionReference:'TEST-ORIGINAL-DEPOSIT-CLAUSE'});
    const deposit = (await current(id)).ledger.find(row=>row.action==='record_payment');
    const a = line(directLineId,1), b = line(relayLineId,2), oneB = line(relayLineId,1);
    const old = (await report(id,'historical-without-scope','原反馈注明 A 与 B 的未交货均待核对，A 一件与 B 两件。')).orders.find(row=>row.id===id)!;
    const cancel = {action:'resolve_change' as const,outcome:'declined' as const,...agreement('cancel-one-b'),
      dispositions:[{...oneB,outcome:'cancel' as const}],refundFollowup:'已付 500 分保留，另行核对抵扣和未决退款。'};
    await expect(purchaseAction(id,{...cancel,requestId:'cannot-close-rest-on-implicit-b'})).rejects.toThrow(/原供货事项全部涉及/);
    expect((await current(id)).incident).toMatchObject({id:old.openIncidentId,scope:null,outstanding:null});
    expect((await workspace()).purchases).toEqual([]);

    const seller = {...b,orderId,purchaseOrderId:id}, customer = {...oneB,orderId,purchaseOrderId:id};
    const request = {action:'resolve_change' as const,outcome:'original_terms' as const,requestId:'confirmed-one-b-only',
      orderId,purchaseOrderId:id,version:old.version,affectedLines:[a,b],coordinationLines:[oneB],...agreement('b-part-continues'),
      responsibility:'采购经办应向原供方核对第二件 B 和 A。',
      decisionDocumentLines:[{orderItemId:relayLineId,supplierDocumentRow:8,customerDocumentRow:13,supplierDocumentScope:[seller],
        customerDocumentScope:[customer]}]};
    const overview = await prisma.$transaction(tx=>previewPurchaseAction(tx,request,approver));
    const confirm = () => prisma.$transaction(tx=>applyPurchaseAction(tx,{...request,actionHash:overview.actionHash},approver));
    const first = await confirm();
    expect((await confirm()).activities).toEqual(first.activities);
    expect(first.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{incidentProgress:{scopeBasis:'reviewed',scope:[a,b],
      handled:[oneB],outstanding:[a,oneB]},decisionDocuments:[
        {role:'supplier',row:8,balances:[{...seller,using:1,remaining:1}]},
        {role:'customer',row:13,balances:[{...customer,using:1,remaining:0}]},
      ]}});
    expect(await current(id)).toMatchObject({status:'on_hold',paidCents:500,incident:{id:old.openIncidentId,scope:[a,b],
      outstanding:[a,oneB],reportedBy:operator.id,lastReviewedBy:approver.id}});

    const reduced = await purchaseAction(id,{...cancel,requestId:'actual-disposition-for-b'});
    expect(reduced.orders.find(row=>row.id===id)).toMatchObject({status:'on_hold',remaining:[a,oneB],paidCents:500,
      dueCents:null,needsRemainingReview:true,canApproveRemaining:false,incident:{id:old.openIncidentId,outstanding:[a]}});
    expect((await workspace()).purchases).toEqual([]);
    await purchaseAction(id,{action:'resolve_change',outcome:'original_terms',requestId:'remaining-a-can-continue',...agreement('a-continues')});
    expect(await current(id)).toMatchObject({status:'on_hold',incident:null,paidCents:500,dueCents:null,
      needsRemainingReview:true,canApproveRemaining:true});
    const newPayable = await purchaseAction(id,{action:'approve_remaining',requestId:'separately-approve-actual-balance',
      reference:'TEST-VERIFIED-REMAINING-PAYABLE',referenceSha256:pricingContentHash('verified remainder for A and B'),
      description:'逐行核对原剩余商品金额及实际定金部分抵扣。',
      remainingLines:[{orderItemId:directLineId,payableCents:2500},{orderItemId:relayLineId,payableCents:2500}],appliedPaidCents:300});
    expect(newPayable.orders.find(row=>row.id===id)).toMatchObject({status:'ordered',remaining:[a,oneB],totalCents:7500,paidCents:500,dueCents:4700});
    expect(newPayable.activities.find(row=>row.id===deposit?.id)).toEqual(deposit);
  });

  it('can review actual delay after another quantity was already cancelled with a deposit unresolved',async()=>{
    await prisma.orderItem.update({where:{id:relayLineId},data:{quantity:3}});
    await prisma.order.update({where:{id:orderId},data:{subtotal:400,total:400}});
    await acceptCustomerOrder();
    const id = await groupedOrder(3);
    await purchaseAction(id,{action:'record_payment',requestId:'prior-paid-deposit',reference:'TEST-PRIOR-PAID-DEPOSIT',amountCents:500,
      conditionReference:'TEST-PRIOR-PAYMENT-CLAUSE'});
    await report(id,'one-cancelled-first','B 的一件先按双方约定取消。',[line(relayLineId,1)]);
    const cancellation = await purchaseAction(id,{action:'resolve_change',requestId:'agreed-reduction-first',outcome:'declined',...agreement('actual-earlier-change'),
      dispositions:[{...line(relayLineId,1),outcome:'cancel'}],refundFollowup:'保留原款，财务单独核实尚未抵扣部分。'});
    const originalCancellation = cancellation.activities.at(-1);
    const delayed = line(relayLineId,2);
    await report(id,'remaining-two-late','B 剩余两件延迟，A 仍按合同。',[delayed]);
    const continued = await purchaseAction(id,{action:'resolve_change',outcome:'original_terms',requestId:'supply-continues-before-funding',
      ...agreement('continue-existing-two')});
    expect(continued.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{previousStatus:'on_hold',
      incidentProgress:{handled:[delayed],outstanding:[]}}});
    expect(await current(id)).toMatchObject({status:'on_hold',incident:null,paidCents:500,dueCents:null,
      needsRemainingReview:true,canApproveRemaining:true,remaining:[line(directLineId,1),delayed]});
    const payable = await purchaseAction(id,{action:'approve_remaining',requestId:'check-financial-balance',
      reference:'TEST-ORIGINAL-REMAINING-BALANCE',referenceSha256:pricingContentHash('working original items excluding the cancelled unit'),
      description:'核实未取消商品与原定金中的有效抵扣。',
      remainingLines:[{orderItemId:directLineId,payableCents:2500},{orderItemId:relayLineId,payableCents:5000}],appliedPaidCents:300});
    expect(payable.orders.find(row=>row.id===id)).toMatchObject({status:'ordered',paidCents:500,dueCents:7200,remaining:[line(directLineId,1),delayed]});
    expect(payable.activities.find(row=>row.id===originalCancellation?.id)).toEqual(originalCancellation);
  });
});
