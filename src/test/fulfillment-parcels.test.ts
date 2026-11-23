import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as orderGET, PATCH as orderPATCH } from '@/app/api/admin/orders/[id]/route';
import { dispatchParcel, fulfillmentWorkspace, previewDispatchParcel, previewParcelEvent, recordParcelEvent } from '@/lib/fulfillment-parcels';
import { receiveCarrierNotice } from '@/lib/fulfillment-carrier';
import { linkLegacyShipment } from '@/lib/fulfillment-legacy';
import { receiveInventoryBatch, reserveOrderInventory } from '@/lib/inventory';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { applyPurchaseAction, previewPurchaseAction, purchaseWorkspace, savePurchaseLine } from '@/lib/purchase-orders';
import type { PurchaseTerms } from '@/lib/purchase-terms';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';
import { supplierPaymentProof } from './supplier-payment-proof';

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
type DispatchLine = { purchaseOrderId: string; orderItemId: string; quantity: number; sourceReceiptId?: string; resendApprovalId?: string;
  holdAssignments?: {incidentId:string;quantity:number}[] };
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
    const evidence = action.action === 'record_payment' ? supplierPaymentProof(action.reference ?? action.requestId, current.lines[0].terms.payee) : {};
    const input = { ...evidence, ...action, orderId, purchaseOrderId, version: current.version };
    const preview = await previewPurchaseAction(tx, input, actor);
    return applyPurchaseAction(tx, { ...input, actionHash: preview.actionHash }, actor);
  });
}

async function orderFromSuppliers(relayQuantity=2) {
  const suppliers = [
    { orderItemId: directLineId, supplier: 'TEST-DIRECT-SUPPLIER', quantity: 1 },
    { orderItemId: relayLineId, supplier: 'TEST-RELAY-SUPPLIER', quantity: relayQuantity },
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
  return { direct: purchaseFor(directLineId, 1), relay: purchaseFor(relayLineId, relayQuantity) };
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

function dispatch(input: ReturnType<typeof dispatchInput> & {holdReview?: {status?:string;supplierReference:string;customerReference?:string;responsibility:string;description:string;sha256:string}}) {
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

  const waiting = (orderItemId:string, quantity:number) => ({...line(orderItemId,quantity),source:{kind:'unshipped' as const}});

  it('tracks two independently reported issues and closes only the explicitly selected one',async()=>{
    await acceptCustomerOrder();
    const id = await groupedOrder();
    const a = waiting(directLineId,1), b = waiting(relayLineId,2);
    const first = (await report(id,'a-independent-delay','A 延期，供方书面确认调查中。',[a])).orders.find(row=>row.id===id)!.incidents[0];
    const second = await purchaseAction(id,{action:'report_change',requestId:'report-independent-b',reference:'TEST-NEW-CONTRACT-PRICE-B',
      description:'另一份供方书证单独指出 B 调价。',changeKind:'price',affectedLines:[b]},operator);
    const issues = second.orders.find(row=>row.id===id)!.incidents;
    expect(issues).toMatchObject([{id:first.id,outstanding:[a]},{reference:'TEST-NEW-CONTRACT-PRICE-B',outstanding:[b]}]);
    const resolution = {action:'resolve_change' as const,outcome:'original_terms' as const,...agreement('only-first-incident')};
    await expect(purchaseAction(id,{...resolution,requestId:'cannot-guess-which-event'})).rejects.toThrow(/具体供货事项/);
    await expect(purchaseAction(id,{...resolution,incidentId:first.id,coordinationLines:[b],requestId:'cannot-apply-other-event'})).rejects.toThrow(/本次处理数量/);
    const resolved = await purchaseAction(id,{...resolution,incidentId:first.id,requestId:'resolve-only-a'});
    expect(resolved.orders.find(row=>row.id===id)).toMatchObject({status:'on_hold',incidents:[{id:issues[1].id,outstanding:[b]}]});
    await dispatch(dispatchInput('a-cleared-actual-dispatch','supplier_to_customer',[goods(id,directLineId)]));
    expect((await workspace()).purchases.find(row=>row.orderItemId===relayLineId)?.available).toBe(0);
    expect(await current(id)).toMatchObject({incidents:[{id:issues[1].id,outstanding:[b]}],paidCents:0,dueCents:7500});
  });

  it('adds named scope facts to the original unknown issue while awaiting a commercial decision and releases only unrelated stock',async()=>{
    await acceptCustomerOrder();
    const id = await groupedOrder();
    const raw = (await report(id,'archived-unstructured','旧原件待核清，尚未收到双方商业处理意见。')).orders.find(row=>row.id===id)!;
    expect((await workspace()).purchases).toEqual([]);
    const b = waiting(relayLineId,2);
    const reviewed = await purchaseAction(id,{action:'review_change_scope',incidentId:raw.openIncidentId!,requestId:'scope-verified-by-purchase-approver',
      affectedLines:[b],reference:'TEST-ORIGINAL-SUPPLIER-ONLY-B-DOCUMENT',
      referenceSha256:pricingContentHash('verified independent scope file'),description:'原件确定只有 B 有影响，仍未商定商务处理。'});
    const p = reviewed.orders.find(row=>row.id===id)!;
    expect(p).toMatchObject({status:'on_hold',paidCents:0,dueCents:7500,incidents:[{id:raw.openIncidentId,
      outstanding:[b],factReview:{actorId:approver.id,reference:'TEST-ORIGINAL-SUPPLIER-ONLY-B-DOCUMENT'}}]});
    expect(p.ledger.filter(row=>row.action==='resolve_change')).toEqual([]);
    expect(p.ledger.find(row=>row.id===raw.openIncidentId)).toEqual(raw.ledger.at(-1));
    await dispatch(dispatchInput('a-was-not-in-original-issue','supplier_to_customer',[goods(id,directLineId)]));
    await expect(dispatch(dispatchInput('b-still-pending-buyer-decision','supplier_to_customer',[goods(id,relayLineId)]))).rejects.toThrow(/发货数量/);
  });

  it('keeps an independently approved free dispatch available while the other unshipped unit is delayed',async()=>{
    await acceptCustomerOrder();
    const {relay:id} = await orderFromSuppliers();
    const original = await dispatch(dispatchInput('physical-original-later-lost','supplier_to_customer',[goods(id,relayLineId)]));
    await event(original.id,{...eventInput('confirm-original-loss','customer_delivery',[]),...agreement('confirm-loss'),
      kind:'confirm_shortfall',lines:[{parcelLineId:original.lines[0].id,quantity:1,outcome:'loss'}]});
    const v = await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    const loss = v.fulfillment.shortfalls[0];
    const lossScope={...line(relayLineId,1),source:{kind:'shortfall' as const,id:loss.resolutionId}};
    await report(id,'notes-only-this-loss','原物丢失，买卖双方正核对免费补发。',[lossScope]);
    const authorized = await purchaseAction(id,{action:'resolve_change',outcome:'shortfall',requestId:'independent-free-for-actual-lost-thing',
      ...agreement('free-allowed'),dispositions:[{...line(relayLineId,1),outcome:'cancel',shortfallId:loss.resolutionId,shortfallDecision:'free_resend'}]});
    const [free] = authorized.fulfillment.freeResends;
    const delayed = waiting(relayLineId,1);
    await report(id,'only-other-ordinary-unit-is-delayed','尚未发货的原货另有延期，签好的免费补发继续。',[delayed]);
    const logistics = await workspace();
    expect(logistics.freeResends).toMatchObject([{approvalId:free.approvalId,available:1}]);
    expect(logistics.purchases.find(row=>row.purchaseOrderId===id)?.available).toBe(0);
    await dispatch(dispatchInput('ship-this-distinct-approved-resend','supplier_to_customer',[{...goods(id,relayLineId),resendApprovalId:free.approvalId}]));
    expect(await current(id)).toMatchObject({incidents:[{outstanding:[delayed]}],paidCents:0,dueCents:5000});
    expect((await workspace()).freeResends).toEqual([]);
  });

  it('binds a separate commercial issue to the physical in-transit line without holding its unshipped sibling',async()=>{
    await acceptCustomerOrder();
    const {relay:id} = await orderFromSuppliers();
    const traveling = await dispatch(dispatchInput('purchase-one-is-travelling','supplier_to_libereal',[goods(id,relayLineId)]));
    const source = {...line(relayLineId,1),source:{kind:'parcel' as const,id:traveling.lines[0].id}};
    await expect(report(id,'foreign-parcel-is-not-owned','未关联此采购原货。',[{...source,source:{...source.source,id:'other-real-object'}}]))
      .rejects.toThrow(/货物来源/);
    await report(id,'commercial-term-change-on-this-parcel','原运单财务说明需核对，仅涉及已发这一件。',[source]);
    expect((await workspace()).purchases.find(row=>row.purchaseOrderId===id)?.available).toBe(1);
    const unrelated = await dispatch(dispatchInput('record-different-unit-as-sent','supplier_to_libereal',[goods(id,relayLineId)]));
    expect(unrelated.id).not.toBe(traveling.id);
    expect(await current(id)).toMatchObject({incidents:[{outstanding:[source]}],dueCents:5000});
    expect((await workspace()).parcels).toHaveLength(2);
    await event(traveling.id,eventInput('affected-parcel-arrived','warehouse_receipt',[
      {parcelLineId:traveling.lines[0].id,quantity:1,batchNumber:receivedLotA},
    ]));
    await event(unrelated.id,eventInput('unaffected-parcel-arrived','warehouse_receipt',[
      {parcelLineId:unrelated.lines[0].id,quantity:1,batchNumber:receivedLotB},
    ]));
    const held = await receipt(traveling.lines[0].id,receivedLotA);
    const releasable = await receipt(unrelated.lines[0].id,receivedLotB);
    expect((await workspace()).receipts).toMatchObject([{id:releasable.id,available:1}]);
    await expect(dispatch(dispatchInput('unresolved-parcel-lot','libereal_to_customer',[
      {...goods(id,relayLineId),sourceReceiptId:held.id},
    ]))).rejects.toThrow(/实际收到的批次/);
    const forward = await dispatch(dispatchInput('unaffected-arrival-forward','libereal_to_customer',[
      {...goods(id,relayLineId),sourceReceiptId:releasable.id},
    ]));
    expect(forward.lines[0].sourceReceiptId).toBe(releasable.id);
  });

  it('keeps a proved receipt available after another line changes payable, and holds it for its own explicit contract issue',async()=>{
    await acceptCustomerOrder();
    const id = await groupedOrder();
    await purchaseAction(id,{action:'record_payment',requestId:'paid-original-900',reference:'TEST-ORIGINAL-900',amountCents:900,
      conditionReference:'TEST-ORIGINAL-CONFIRMED-DEPOSIT'});
    const a = await dispatch(dispatchInput('actual-batch-before-b-cancellation','supplier_to_libereal',[goods(id,directLineId)]));
    await event(a.id,eventInput('receive-announced-a','warehouse_receipt',[{parcelLineId:a.lines[0].id,quantity:1,batchNumber:receivedLotA}]));
    const lot = await receipt(a.lines[0].id,receivedLotA);
    await report(id,'one-original-b-cannot-ship','只取消 B 未发一件，A 实际已到仓。',[waiting(relayLineId,1)]);
    await purchaseAction(id,{action:'resolve_change',outcome:'declined',requestId:'only-b-agreed-cancel',...agreement('only-b-cancelled'),
      dispositions:[{...line(relayLineId,1),outcome:'cancel'}],refundFollowup:'保持已付 900 分及需核对的退款。'});
    const base = await current(id);
    expect(base).toMatchObject({paidCents:900,dueCents:null,canApproveRemaining:true});
    expect((await workspace()).receipts).toMatchObject([{id:lot.id,available:1}]);
    await purchaseAction(id,{action:'report_change',requestId:'true-contract-hold-on-a-batch',changeKind:'other',
      reference:'TEST-A-LOT-CONTRACT-WRITING',description:'A 批次另有书面约定需先核对，已付定金先保留。',
      affectedLines:[{...line(directLineId,1),source:{kind:'receipt',id:lot.id}}]},operator);
    expect((await workspace()).receipts).toEqual([]);
    const forward = () => dispatch(dispatchInput('forward-a-actual-lot','libereal_to_customer',[{...goods(id,directLineId),sourceReceiptId:lot.id}]));
    await expect(forward()).rejects.toThrow();
    await purchaseAction(id,{action:'resolve_change',outcome:'original_terms',requestId:'a-confirmed-original-warehouse-terms',...agreement('a-lot-no-other-constraint')});
    const parcel = await forward();
    expect(parcel.lines[0]).toMatchObject({sourceReceiptId:lot.id,quantity:1});
    const after = await current(id);
    expect(after).toMatchObject({status:'on_hold',paidCents:900,dueCents:null,canApproveRemaining:true});
    expect(after.ledger.filter(row=>row.action==='record_payment')).toEqual(base.ledger.filter(row=>row.action==='record_payment'));
  });

  it.each(['withdraw','regroup'] as const)('applies %s only to rejected or changed B in a grouped replacement draft',async outcome=>{
    await acceptCustomerOrder();
    const original = await groupedOrder();
    await purchaseAction(original,{action:'record_payment',requestId:'old-grouped-900',reference:'TEST-ORIGINAL-GROUPED-DEPOSIT',amountCents:900,
      conditionReference:'TEST-ORIGINAL-GROUP-DEPOSIT'});
    const parts = [line(directLineId,1),line(relayLineId,2)];
    await report(original,'prepare-two-new-items','原供方两行无法按原约，客户书面接受两个拟用替代商品。',parts.map(row=>waiting(row.orderItemId,row.quantity)));
    const proposals = await purchaseAction(original,{action:'resolve_change',requestId:'actual-two-replacement-rows',outcome:'replacement',
      ...agreement('orig-disposed-but-paid'),refundFollowup:'核对原合同已付与退款，不动定金历史。',
      dispositions:parts.map(({orderItemId,quantity},index)=>({orderItemId,quantity,outcome:'replace',customerDocumentRow:index+1,replacement:{
        name:'合成替代-'+orderItemId,brand:'合成替代品牌',catalogNumber:'TEST-GROUPED-ALT-'+index,spec:'合成规格',unit:'件',
        terms:{...purchaseTerms(quantity,'TEST-SAME-ALTERNATE-PARTY'),sourceReference:'TEST-PROPOSAL-LINE-'+index,
          sourceSha256:pricingContentHash({index,quote:'original grouped alternate'})},
      }}))});
    const draft = proposals.orders.find(row=>row.lines.length===2 && row.lines.every(line=>line.fromPurchaseOrderId===original))!;
    const retained = draft.lines.find(row=>row.orderItemId===directLineId)!;
    const moved = draft.lines.find(row=>row.orderItemId===relayLineId)!;
    const originalB = await prisma.purchaseReplacementLine.findUniqueOrThrow({where:{id:moved.replacementId!}});
    const deposit = (await current(original)).ledger.find(row=>row.action==='record_payment');
    const onlyB = waiting(relayLineId,2);
    const pending = await report(draft.id,'only-draft-b-has-a-new-customer-decision','客户的新书面决定只涉及替代品 B，A 保留。',
      outcome==='regroup' ? [onlyB] : undefined);
    if (outcome==='withdraw') {
      await expect(purchaseAction(draft.id,{action:'resolve_change',outcome:'declined',requestId:'no-presumed-withdraw-of-a',
        ...agreement('paper-only-b-declined'),supplierSha256:undefined},operator)).rejects.toThrow(/原供货事项全部涉及/);
      await purchaseAction(draft.id,{action:'review_change_scope',requestId:'verify-rest-draft-stays',
        incidentId:pending.orders.find(po=>po.id===draft.id)!.openIncidentId!,affectedLines:[onlyB],
        reference:'TEST-CLIENT-ONLY-B-ORIGINAL-WRITING',description:'原客户书面回复只撤回 B 的草稿行。'},operator);
    }
    const revised = {...purchaseTerms(2,'TEST-NEW-SUPPLIER-B'),unitPriceCents:2750,linePayableCents:5500};
    const change = await purchaseAction(draft.id,{action:'resolve_change',outcome:outcome==='withdraw'?'declined':'revised_terms',
      requestId:'b-only-'+outcome,...agreement('buyer-only-b-'+outcome),
      ...(outcome==='withdraw'?{supplierSha256:undefined,coordinationLines:[onlyB]}:{revisedTerms:[{orderItemId:relayLineId,terms:revised}]})},operator);
    const after = change.orders.find(row=>row.id===draft.id)!;
    expect(after).toMatchObject({status:'draft',approvedHash:null,totalCents:2500,paidCents:0,lines:[retained],incidents:[]});
    expect(change.orders.find(row=>row.id===original)).toMatchObject({paidCents:900,totalCents:7500});
    expect(change.activities.find(row=>row.id===deposit?.id)).toEqual(deposit);
    const rowDb = await prisma.purchaseReplacementLine.findUniqueOrThrow({where:{id:moved.replacementId!}});
    expect(rowDb).toMatchObject({fromPurchaseOrderId:original,quantity:2,authorizationId:originalB.authorizationId});
    if (outcome==='withdraw') {
      expect(rowDb).toEqual(originalB);
      expect(change.orders.flatMap(po=>po.lines).filter(row=>row.replacementId===moved.replacementId)).toEqual([]);
      expect(change.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{withdrawnDraftLines:[{orderItemId:relayLineId,quantity:2,quotedCents:5000}],
        decisionDocuments:[{role:'customer',authority:{purpose:'decline_preparation'},allocations:[{orderItemId:relayLineId,quantity:2}]}]}});
    } else {
      const newGroup = change.orders.find(po=>po.id===rowDb.purchaseOrderId)!;
      expect(newGroup.id).not.toBe(draft.id);
      expect(newGroup).toMatchObject({status:'draft',approvedHash:null,totalCents:5500,paidCents:0,
        lines:[{orderItemId:relayLineId,terms:{supplier:'TEST-NEW-SUPPLIER-B'},fromPurchaseOrderId:original}]});
      expect(change.activities.at(-1)?.detail.draftTransfers).toEqual([{orderItemId:relayLineId,purchaseOrderId:newGroup.id}]);
      await purchaseAction(newGroup.id,{action:'approve',requestId:'new-group-independent-approval'});
      expect(await current(newGroup.id)).toMatchObject({status:'approved',paidCents:0});
      expect(await current(draft.id)).toMatchObject({status:'draft',approvedHash:null});
    }
    await purchaseAction(draft.id,{action:'approve',requestId:'approve-a-independently'});
    expect(await current(draft.id)).toMatchObject({status:'approved',totalCents:2500,paidCents:0});
  });

  it('records repeated and no-impact facts against the canonical issue during and after its only commercial decision',async()=>{
    await acceptCustomerOrder();
    const id = await groupedOrder();
    await report(id,'early-unstructured-copy','第一份通知暂未核清原件范围。');
    const b = waiting(relayLineId,1);
    await report(id,'actual-b-fact','原供方明确只有一件 B 延期。',[b]);
    const [early,origin] = (await current(id)).incidents;
    const facts = {action:'review_change_scope' as const,reviewResult:'duplicate' as const,reference:'TEST-SAME-B-ORIGINAL-EVIDENCE',
      description:'这份通知只是转述原件所列的一件 B。'};
    const merged = await purchaseAction(id,{...facts,requestId:'review-early-copy',incidentId:early.id,relatedIncidentId:origin.id});
    expect(merged.orders.find(po=>po.id===id)).toMatchObject({status:'on_hold',incidents:[{id:origin.id,outstanding:[b]}]});
    expect(merged.activities.at(-1)?.detail.snapshot).toMatchObject({operation:{incidentId:early.id,relatedIncidentId:origin.id,
      reportVersion:early.reportVersion,incrementalQuantity:0,relatedIncident:{reportVersion:origin.reportVersion}}});
    await expect(purchaseAction(id,{...facts,requestId:'no-link-back-through-alias',incidentId:origin.id,relatedIncidentId:early.id}))
      .rejects.toThrow(/不能关联本事项/);
    await purchaseAction(id,{action:'resolve_change',outcome:'original_terms',requestId:'once-b-commercial-continue',
      incidentId:origin.id,...agreement('only-one-b-consent')});
    await purchaseAction(id,{action:'report_change',requestId:'another-delivery-of-same-source',changeKind:'delay',
      reference:origin.reference,description:'同一档案的再次送达，确认无新约定。'},operator);
    const [late] = (await current(id)).incidents;
    await purchaseAction(id,{...facts,requestId:'link-to-canonical-settled-via-alias',incidentId:late.id,relatedIncidentId:early.id});
    await report(id,'no-extra-impact','另一通电话只核对地址，没有新供货变动。');
    const [nonissue] = (await current(id)).incidents;
    const end = await purchaseAction(id,{action:'review_change_scope',reviewResult:'no_impact',requestId:'zero-extra-impact',
      incidentId:nonissue.id,reference:'TEST-CONFIRMED-ONLY-ADDRESS',description:'与原供方按原稿核查，确无新增事实或条件。'});
    expect(end.orders.find(po=>po.id===id)).toMatchObject({status:'ordered',paidCents:0,dueCents:7500,incidents:[],incidentHistory:[
      {id:early.id,status:'duplicate',linkedTo:origin.id},{id:origin.id,status:'settled'},
      {id:late.id,status:'duplicate',linkedTo:origin.id},{id:nonissue.id,status:'no_impact',linkedTo:null},
    ]});
    expect(end.activities.filter(row=>row.action==='resolve_change')).toHaveLength(1);
  });

  it.each([false,true])('records the actual A dispatch on its original authorization while B payable is unresolved, free=%s',async free=>{
    await acceptCustomerOrder();
    const id=await groupedOrder();
    await purchaseAction(id,{action:'record_payment',requestId:'valid-original-900',reference:'TEST-DEPOSIT-900-PRIOR',
      conditionReference:'TEST-OLD-DEPOSIT-TERM',amountCents:900});
    let resendApprovalId: string | undefined;
    if (free) {
      const first = await dispatch(dispatchInput('a-original-lost','supplier_to_customer',[goods(id,directLineId)]));
      await event(first.id,{...eventInput('physical-a-loss','customer_delivery',[]),...agreement('verified-lost-a'),
        kind:'confirm_shortfall',lines:[{parcelLineId:first.lines[0].id,quantity:1,outcome:'loss'}]});
      const loss = (await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId))).fulfillment.shortfalls[0];
      await report(id,'separately-approved-free-a','A 确认短失，只同意免费补这一件。',[
        {...line(directLineId,1),source:{kind:'shortfall',id:loss.resolutionId}},
      ]);
      const approved = await purchaseAction(id,{action:'resolve_change',outcome:'shortfall',requestId:'permit-a-resend-before-b',
        ...agreement('free-a-existing-book'),dispositions:[{...line(directLineId,1),outcome:'cancel',shortfallId:loss.resolutionId,shortfallDecision:'free_resend'}]});
      resendApprovalId = approved.fulfillment.freeResends[0].approvalId;
    }
    const shipment = dispatchInput('actual-old-dispatch-evidence','supplier_to_customer',[{...goods(id,directLineId),resendApprovalId}]);
    const actual = shipment.occurredAt;
    nextOccurrence();
    await report(id,'b-change-after-real-a','此事只变更 B 供货数量。',[waiting(relayLineId,1)]);
    await purchaseAction(id,{action:'resolve_change',outcome:'declined',requestId:'b-reduced-with-cash-not-reconciled',
      ...agreement('actual-only-b-reduced'),dispositions:[{...line(relayLineId,1),outcome:'cancel'}],refundFollowup:'已付900分另做抵扣或退款核查。'});
    const before = await current(id);
    expect(before).toMatchObject({paidCents:900,dueCents:null,needsRemainingReview:true});
    if (free) expect((await workspace()).freeResends).toMatchObject([{approvalId:resendApprovalId,available:1}]);
    const then = await prisma.$transaction(tx=>fulfillmentWorkspace(tx,orderId,Date.parse(actual)));
    expect(then.purchases.find(row=>row.orderItemId===relayLineId)?.available).toBe(1);
    const history = await dispatch(shipment);
    expect(history.dispatchedAt.toISOString()).toBe(actual);
    const beforePayableApproval = dispatchInput('cannot-invent-additional-b-dispatch','supplier_to_customer',[goods(id,relayLineId)]);
    await expect(dispatch(beforePayableApproval)).rejects.toThrow(/发货数量/);
    const contradiction = {...dispatchInput('before-real-order-authority','supplier_to_customer',[goods(id,relayLineId)]),
      occurredAt:new Date(Date.parse(before.orderReceipt!.occurredAt!)-1000).toISOString()};
    await expect(dispatch(contradiction)).rejects.toThrow(/发货当时已经生效/);
    const updated = await current(id);
    expect(updated).toMatchObject({paidCents:900,dueCents:null,needsRemainingReview:true});
    expect(updated.ledger.filter(row=>row.action==='record_payment')).toEqual(before.ledger.filter(row=>row.action==='record_payment'));
    nextOccurrence();
    await purchaseAction(id,{action:'approve_remaining',requestId:'separately-verify-actual-retained-payable',
      reference:'TEST-ACTUAL-RETAINED-CHARGES',referenceSha256:pricingContentHash('retain one A and one B'),
      description:'以原书证核实 A 与剩余一件 B，以及已付900分的实际抵扣。',
      remainingLines:[{orderItemId:directLineId,payableCents:2500},{orderItemId:relayLineId,payableCents:2500}],appliedPaidCents:900});
    await expect(dispatch(beforePayableApproval)).rejects.toThrow(/发货数量/);
    expect((await current(id)).dueCents).toBe(4100);
  });

  it.each(['declined','revised_terms'] as const)('allocates one of two units in a replacement draft for %s with independently written amounts',async outcome=>{
    await acceptCustomerOrder();
    const {relay:id}=await orderFromSuppliers();
    await purchaseAction(id,{action:'record_payment',requestId:'old-cash-before-physical-loss',reference:'TEST-ORIGINAL-LOSS-DEPOSIT',
      conditionReference:'TEST-PREVIOUS-PAYMENT-ORIGINAL-TERM',amountCents:900});
    const sent=await dispatch(dispatchInput('two-originals-both-lost','supplier_to_customer',[goods(id,relayLineId,2)]));
    await event(sent.id,{...eventInput('two-units-confirmed-lost','customer_delivery',[]),...agreement('two-physical-units-confirmed-lost'),
      kind:'confirm_shortfall',lines:[{parcelLineId:sent.lines[0].id,quantity:2,outcome:'loss'}]});
    const loss=(await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId))).fulfillment.shortfalls[0];
    const fromLoss={...line(relayLineId,2),source:{kind:'shortfall' as const,id:loss.resolutionId}};
    await report(id,'original-loss-two-things','两个均有书证。保持原合同应付另采。',[fromLoss]);
    const alternativeSupplier='TEST-ORIGINAL-REPLACEMENT-PARTY';
    const prepared=await purchaseAction(id,{action:'resolve_change',outcome:'shortfall',requestId:'replace-two-from-one-real-loss-scope',
      ...agreement('both-after-original-loss'),dispositions:[{...line(relayLineId,2),outcome:'replace',shortfallId:loss.resolutionId,shortfallDecision:'new_purchase',
        replacement:{name:'合成替代份额',brand:'合成替代品牌',catalogNumber:'TEST-SHARED-ALT-SKU',unit:'件',spec:'合成规格',
          terms:purchaseTerms(2,alternativeSupplier)}}]});
    const draft=prepared.orders.find(po=>po.lines.some(row=>row.fromPurchaseOrderId===id))!;
    const originalRow=await prisma.purchaseReplacementLine.findUniqueOrThrow({where:{id:draft.lines[0].replacementId!}});
    const partial=waiting(relayLineId,1);
    await report(draft.id,'split-known-one-unit','客户只改变其中一件，另一件按书证新报价保留。',[partial]);
    const keep={...purchaseTerms(1,alternativeSupplier),unitPriceCents:2630,linePayableCents:2630};
    const moved={...purchaseTerms(1,'TEST-APPROVED-ALTERNATE-ONE-PIECE'),unitPriceCents:3140,linePayableCents:3140};
    const input={action:'resolve_change' as const,outcome,requestId:'changed-item-exactly-one',
      ...agreement('separate-one-piece-written-decision'),supplierSha256:undefined,coordinationLines:[partial],
      decisionDocumentLines:[{orderItemId:relayLineId,customerDocumentRow:4}],
      ...(outcome==='revised_terms'?{revisedTerms:[{orderItemId:relayLineId,terms:moved}]}:{})};
    await expect(purchaseAction(draft.id,input,operator)).rejects.toThrow(/留存份额/);
    await expect(purchaseAction(draft.id,{...input,retainedDraftTerms:[{orderItemId:relayLineId,terms:draft.lines[0].terms}]},operator))
      .rejects.toThrow(/报价|书证/);
    const adjusted=await purchaseAction(draft.id,{...input,retainedDraftTerms:[{orderItemId:relayLineId,terms:keep,customerDocumentRow:9}]},operator);
    const after=adjusted.orders.find(po=>po.id===draft.id)!;
    expect(after).toMatchObject({status:'draft',approvedHash:null,paidCents:0,totalCents:2630,remaining:[line(relayLineId,1)]});
    const retainDb=await prisma.purchaseReplacementLine.findUniqueOrThrow({where:{id:originalRow.id}});
    expect(retainDb).toMatchObject({quantity:1,authorizationId:originalRow.authorizationId,fromPurchaseOrderId:id});
    expect((await current(id))).toMatchObject({paidCents:900,dueCents:4100,totalCents:5000});
    const audit=adjusted.activities.at(-1)!;
    expect(audit.detail.snapshot).toMatchObject({operation:{draftAllocations:[{authorizationId:originalRow.authorizationId,
      originalQuotedCents:5000,originalQuantity:2,quantity:1,retained:{terms:{linePayableCents:2630}}}],decisionDocuments:[
      {role:'customer',row:4,allocations:[{orderItemId:relayLineId,quantity:1}]},
      {role:'customer',row:9,allocations:[{orderItemId:relayLineId,quantity:1}]},
    ]}});
    expect(adjusted.fulfillment.shortfalls.find(row=>row.resolutionId===loss.resolutionId)).toMatchObject({available:0,independentlyReplaced:2});
    const all = [draft.id];
    if (outcome==='revised_terms') {
      const peer=adjusted.orders.find(po=>po.id!==draft.id && po.lines.some(row=>row.authorizationId===audit.id))!;
      expect(peer).toMatchObject({status:'draft',approvedHash:null,paidCents:0,totalCents:3140,remaining:[line(relayLineId,1)]});
      all.push(peer.id);
    }
    for (const purchaseOrderId of all) {
      expect(adjusted.fulfillment.replacementsWithPriorHoldTransfer).toContainEqual({purchaseOrderId,orderItemId:relayLineId});
      await purchaseAction(purchaseOrderId,{action:'approve',requestId:'independent-split-approval-'+purchaseOrderId});
      await purchaseAction(purchaseOrderId,{action:'register_order',requestId:'actual-split-order-'+purchaseOrderId,
        reference:'TEST-ACTUAL-SPLIT-ORDER-'+purchaseOrderId,referenceSha256:pricingContentHash({purchaseOrderId,proof:'actual split order'}),
        occurredAt:nextOccurrence()},operator);
      await dispatch(dispatchInput('real-split-dispatched-'+purchaseOrderId,'supplier_to_customer',[goods(purchaseOrderId,relayLineId)]));
    }
    const reservation=await prisma.inventoryReservation.findUniqueOrThrow({where:{orderItemId:relayLineId}});
    expect(reservation.releasedQuantity).toBe(2);
  });

  it('can split an original three-unit substitute in two successive partial decisions without granting it twice',async()=>{
    await prisma.orderItem.update({where:{id:relayLineId},data:{quantity:3}});
    await prisma.order.update({where:{id:orderId},data:{subtotal:400,total:400}});
    await acceptCustomerOrder();
    const original=await groupedOrder(3);
    await report(original,'all-b-needs-the-same-alternative','三件 B 确定按各自供货证据替代。',[waiting(relayLineId,3)]);
    const prepared=await purchaseAction(original,{action:'resolve_change',outcome:'replacement',requestId:'authorize-only-one-three-unit-branch',
      ...agreement('three-allowed-once'),dispositions:[{...line(relayLineId,3),outcome:'replace',replacement:{
        name:'合成逐次拆量',brand:'合成品牌',catalogNumber:'TEST-ITERATED-DRAFT',spec:'合成规格',unit:'件',terms:purchaseTerms(3,'TEST-ITERATED-SUPPLIER'),
      }}]});
    const draft=prepared.orders.find(po=>po.lines.some(row=>row.fromPurchaseOrderId===original))!;
    const origin=draft.lines[0].authorizationId;
    await report(draft.id,'two-units-may-change','两件需要分别办理，第三件继续保留。',[waiting(relayLineId,2)]);
    const one=[waiting(relayLineId,1)];
    const first=await purchaseAction(draft.id,{action:'resolve_change',outcome:'revised_terms',requestId:'first-move-only-one',
      ...agreement('first-iterated-authority'),coordinationLines:one,
      revisedTerms:[{orderItemId:relayLineId,terms:purchaseTerms(1,'TEST-INDEPENDENT-PARTY-ONE')}],
      retainedDraftTerms:[{orderItemId:relayLineId,terms:purchaseTerms(2,'TEST-ITERATED-SUPPLIER')}]},operator);
    const branch=first.orders.find(po=>po.lines.some(row=>row.authorizationId===first.activities.at(-1)?.id))!;
    expect(first.orders.find(po=>po.id===draft.id)).toMatchObject({status:'on_hold',remaining:[line(relayLineId,2)],
      incidents:[{outstanding:one}],lines:[{authorizationId:origin}]});
    const retained=purchaseTerms(1,'TEST-ITERATED-SUPPLIER');
    const next={action:'resolve_change' as const,outcome:'declined' as const,requestId:'second-withdraw-one',
      ...agreement('second-iterated-authority'),supplierSha256:undefined,coordinationLines:one,
      retainedDraftTerms:[{orderItemId:relayLineId,terms:retained}],orderId,purchaseOrderId:draft.id,version:(await current(draft.id)).version};
    const preview=await prisma.$transaction(tx=>previewPurchaseAction(tx,next,operator));
    const confirm=()=>prisma.$transaction(tx=>applyPurchaseAction(tx,{...next,actionHash:preview.actionHash},operator));
    const finished=await confirm();
    expect((await confirm()).activities).toEqual(finished.activities);
    expect(finished.orders.find(po=>po.id===draft.id)).toMatchObject({status:'draft',remaining:[line(relayLineId,1)],incidents:[],lines:[{authorizationId:origin}]});
    expect(finished.orders.find(po=>po.id===branch.id)).toMatchObject({status:'draft',remaining:[line(relayLineId,1)],paidCents:0});
    expect(finished.fulfillment.replacementsWithUnverifiedStockSource).toEqual([]);
    expect(finished.activities.filter(row=>row.purchaseOrderId===original && row.action==='resolve_change')).toHaveLength(1);
  });

  it('links the early B notice without releasing it early, records the authorised A, and tracks a reviewed B dispatch to real arrival',async()=>{
    await acceptCustomerOrder();
    const id=await groupedOrder();
    await purchaseAction(id,{action:'record_payment',requestId:'original-deposit-for-timed-deviation',
      reference:'TEST-ORIGINAL-STANDING-DEPOSIT',conditionReference:'TEST-DEPOSIT-CLAUSES',amountCents:900});
    await report(id,'early-unknown-notice-about-b','原通知实际只涉及 B，第一份记录待核清。');
    const earlyA=dispatchInput('early-actually-unaffected-a','supplier_to_customer',[goods(id,directLineId)]);
    const earlyB=dispatchInput('early-b-physically-moved-without-release','supplier_to_customer',[goods(id,relayLineId)]);
    nextOccurrence();
    await report(id,'canonical-two-b-under-stop','双方当时仍限制 B 两件。',[waiting(relayLineId,2)]);
    const [early,original]=(await current(id)).incidents;
    await purchaseAction(id,{action:'review_change_scope',reviewResult:'duplicate',requestId:'old-unknown-is-only-b',
      incidentId:early.id,relatedIncidentId:original.id,reference:'TEST-VERIFIED-ORIGINAL-B-NOTICE',
      description:'这一转述与原 B 通知一致，A 并不在该通知里。'});
    nextOccurrence();
    await purchaseAction(id,{action:'resolve_change',outcome:'original_terms',requestId:'one-b-released-later',
      incidentId:original.id,coordinationLines:[waiting(relayLineId,1)],...agreement('release-only-b-one')});
    const later=dispatchInput('b-later-when-only-one-released','supplier_to_customer',[goods(id,relayLineId,2)]);
    const check=(input:object)=>prisma.$transaction(tx=>previewDispatchParcel(tx,orderId,input,operator));
    await expect(check(earlyB)).rejects.toThrow(/发货数量/);
    await expect(check(later)).rejects.toThrow(/发货数量/);
    expect((await prisma.$transaction(tx=>fulfillmentWorkspace(tx,orderId,Date.parse(later.occurredAt))))
      .purchases.find(row=>row.orderItemId===relayLineId)?.available).toBe(1);
    nextOccurrence();
    await purchaseAction(id,{action:'resolve_change',outcome:'original_terms',requestId:'last-b-resolved-even-later',
      incidentId:original.id,...agreement('actual-last-b-release')});
    await expect(check(earlyB)).rejects.toThrow(/发货数量/);
    const a=await dispatch(earlyA);
    expect(a.dispatchedAt.toISOString()).toBe(earlyA.occurredAt);
    const actual={...earlyB,holdReview:{supplierReference:'TEST-SUPPLIER-DISPATCH-WITHOUT-RELEASE',
      customerReference:'TEST-CUSTOMER-CONFIRMS-TRACKING-CONTINUES',responsibility:'合成采购经办人',
      description:'原运单确证暂停期已发，已分别与供方及客户核对继续跟踪到实收。',
      sha256:pricingContentHash('actual documented deviation proof')}};
    const reviewed=await check(actual);
    expect(reviewed.snapshot).toMatchObject({occurredAt:earlyB.occurredAt,actorId:operator.id,holdReview:actual.holdReview,
      lines:[{purchaseOrderId:id,orderItemId:relayLineId,quantity:1,unreleased:{quantity:1,incidentIds:[early.id]}}]});
    await expect(prisma.$transaction(tx=>dispatchParcel(tx,orderId,{...actual,holdReview:{...actual.holdReview,
      description:'修改预览后的核对结果'}},operator,reviewed.actionHash))).rejects.toThrow(/重新预览/);
    const persist=()=>prisma.$transaction(tx=>dispatchParcel(tx,orderId,actual,operator,reviewed.actionHash));
    const physical=await persist();
    expect((await persist()).id).toBe(physical.id);
    expect(physical.dispatchedAt.toISOString()).toBe(earlyB.occurredAt);
    const actualDelivery=eventInput('actual-b-arrival-after-hold-review','customer_delivery',[{parcelLineId:physical.lines[0].id,quantity:1}]);
    const delivered=await event(physical.id,actualDelivery);
    expect(delivered).toMatchObject({status:'delivered',lines:[{receivedQuantity:1}]});
    expect(await prisma.shipment.findUniqueOrThrow({where:{id:physical.shipmentId!}})).toMatchObject({
      shippedAt:new Date(earlyB.occurredAt),deliveredAt:new Date(actualDelivery.occurredAt),status:'delivered',
    });
    expect(JSON.parse(delivered.events.find(row=>row.kind==='dispatch')!.details)).toMatchObject({
      holdReview:actual.holdReview,lines:[{unreleased:{quantity:1,incidentIds:[early.id]}}],
    });
    expect(await current(id)).toMatchObject({paidCents:900,dueCents:6600,incidents:[]});
  });

  it('keeps distinct valid partial decisions at their dates when the unresolved remainder is linked',async()=>{
    await acceptCustomerOrder();
    const id=await groupedOrder();
    await report(id,'known-original-mixed','原 A 和两件 B 分别在等各自商业决议。',[waiting(directLineId,1),waiting(relayLineId,2)]);
    const [early]=(await current(id)).incidents;
    const beforeA=nextOccurrence();
    nextOccurrence();
    await purchaseAction(id,{action:'resolve_change',outcome:'original_terms',requestId:'actual-a-only-continues',
      incidentId:early.id,coordinationLines:[waiting(directLineId,1)],...agreement('a-agreement-before-b')});
    const between=nextOccurrence();
    nextOccurrence();
    await purchaseAction(id,{action:'resolve_change',outcome:'original_terms',requestId:'one-b-independently-released',
      incidentId:early.id,coordinationLines:[waiting(relayLineId,1)],...agreement('one-b-separate-decision')});
    const afterOneB=nextOccurrence();
    // Check the remaining one without double-counting the already linked source in the live hold.
    const original=await purchaseAction(id,{action:'report_change',changeKind:'delay',requestId:'matching-late-notice',
      reference:'TEST-MATCHING-LATE-B',description:'原未处理的一件 B 同一事项的后续通知。'},operator);
    const newNotice=original.orders.find(po=>po.id===id)!.incidents[1];
    await purchaseAction(id,{action:'review_change_scope',reviewResult:'duplicate',requestId:'link-late-b-to-original',
      incidentId:newNotice.id,relatedIncidentId:early.id,reference:'TEST-B-REMAINING-NOTICE-MATCH',description:'只补充原 B 尚待处理的一件。'});
    const capacity = async (at:string) => (await prisma.$transaction(tx=>fulfillmentWorkspace(tx,orderId,Date.parse(at))))
      .purchases.map(row=>[row.orderItemId,row.available]);
    expect(await capacity(beforeA)).toEqual([[directLineId,0],[relayLineId,0]]);
    expect(await capacity(between)).toEqual([[directLineId,1],[relayLineId,0]]);
    expect(await capacity(afterOneB)).toEqual([[directLineId,1],[relayLineId,1]]);
  });

  it('keeps a known historical hold before a later verification of no continuing impact',async()=>{
    await acceptCustomerOrder();
    const {relay:id}=await orderFromSuppliers();
    const held=await report(id,'known-two-stopped-then-no-further-change','已知两件在当期停发。',[waiting(relayLineId,2)]);
    const incident=held.orders.find(po=>po.id===id)!.incidents[0];
    const earlier=dispatchInput('while-the-old-stop-was-active','supplier_to_customer',[goods(id,relayLineId)]);
    nextOccurrence();
    await purchaseAction(id,{action:'review_change_scope',reviewResult:'no_impact',requestId:'fact-closed-after-the-pause',
      incidentId:incident.id,reference:'TEST-FACT-REVIEW-OF-NO-NEW-SUPPLY-CHANGE',
      description:'核对后此通知无需继续待办，原暂停期间留下审计。'});
    await expect(prisma.$transaction(tx=>previewDispatchParcel(tx,orderId,earlier,operator))).rejects.toThrow(/发货数量/);
    expect((await workspace()).purchases.find(row=>row.purchaseOrderId===id)?.available).toBe(2);
  });

  it('holds an overlapping unknown notice before creating a new payable draft and preserves the separable retained share once identified', async()=>{
    await acceptCustomerOrder();
    const id=await groupedOrder();
    await report(id,'original-two-proposal','原 B 两件按实物范围待替代。',[waiting(relayLineId,2)]);
    const prepared=await purchaseAction(id,{action:'resolve_change',outcome:'replacement',requestId:'replacement-two-before-facts',
      ...agreement('one-shared-proposal'),dispositions:[{...line(relayLineId,2),outcome:'replace',replacement:{
        name:'合成可分替代商品',brand:'合成品牌',catalogNumber:'TEST-CLEAR-SHARES',spec:'合成规格',unit:'件',terms:purchaseTerms(2,'TEST-OTHER-PARTY-WHO-KEEPS-ONE'),
      }}]});
    const draft=prepared.orders.find(po=>po.lines.some(row=>row.fromPurchaseOrderId===id))!;
    const one=waiting(relayLineId,1);
    await report(draft.id,'confirmed-one-owner-change','这一件已有明确客户决定。',[one]);
    await report(draft.id,'different-notice-no-range','第二份独立通知尚不清楚影响几件。');
    const before=await current(draft.id);
    const move={action:'resolve_change' as const,outcome:'revised_terms' as const,incidentId:before.incidents[0].id,
      requestId:'move-the-authorised-one-share',...agreement('first-independent-one'),
      coordinationLines:[one],revisedTerms:[{orderItemId:relayLineId,terms:purchaseTerms(1,'TEST-NEW-SUPPLIER-FOR-SHARE')}],
      retainedDraftTerms:[{orderItemId:relayLineId,terms:purchaseTerms(1,'TEST-OTHER-PARTY-WHO-KEEPS-ONE')}]};
    await expect(purchaseAction(draft.id,move,operator)).rejects.toThrow(/另有待核事项/);
    expect(await current(draft.id)).toMatchObject({remaining:[line(relayLineId,2)],version:before.version});
    const allBefore=await prisma.purchaseOrder.count({where:{orderId}});
    await purchaseAction(draft.id,{action:'review_change_scope',requestId:'identify-different-retained-share',
      incidentId:before.incidents[1].id,affectedLines:[one],reference:'TEST-SEPARATE-RETAINED-SHARE',
      description:'该供方凭据仅约束留在原付款组的一件，已书面同意改办的一件可单独采购。'},operator);
    const outcome=await purchaseAction(draft.id,move,operator);
    expect(await prisma.purchaseOrder.count({where:{orderId}})).toBe(allBefore+1);
    const after=outcome.orders.find(po=>po.id===draft.id)!;
    expect(after).toMatchObject({status:'on_hold',remaining:[line(relayLineId,1)],incidents:[{id:before.incidents[1].id,outstanding:[one]}]});
    const moved=outcome.orders.find(po=>po.lines.some(item=>item.authorizationId===outcome.activities.at(-1)?.id))!;
    await expect(purchaseAction(draft.id,{action:'approve',requestId:'cannot-use-pending-retained-shares'})).rejects.toThrow();
    const approved=await purchaseAction(moved.id,{action:'approve',requestId:'independently-approve-moved-clear-share'});
    expect(approved.orders.find(po=>po.id===moved.id)).toMatchObject({status:'approved',remaining:[line(relayLineId,1)],paidCents:0});
  });
  const previewDispatch = (input: unknown) => prisma.$transaction(tx=>previewDispatchParcel(tx,orderId,input,operator));
  const pendingDeviation = (tag: string) => ({status:'pending',supplierReference:'TEST-ACTUAL-WAYBILL-'+tag,
    responsibility:'合成在途货物责任人',description:'供方确认实际误发，客户尚未作出书面处理决定。',
    sha256:pricingContentHash({actualDispatchVerification:tag})});
  const continuation = (tag: string, parcelLineId: string, incidentId: string, quantity: number, receiptId?: string) => ({
    ...eventInput(tag,'warehouse_receipt',[]),...agreement(tag),kind:'review_dispatch_hold',
    holdResponsibility:'合成具名核对人',lines:[{parcelLineId,quantity,incidentId,receiptId,outcome:'continue'}],
  });

  it('records an actual transfer before quarantine and requires independent attribution for a transfer made during the hold', async () => {
    await acceptCustomerOrder();
    const { relay: purchaseOrderId } = await orderFromSuppliers();
    const beforeHold = nextOccurrence();
    nextOccurrence();
    const reported = await report(purchaseOrderId, 'original-office-hold', '原一件暂停等待书面澄清。', [waiting(relayLineId, 1)]);
    const incidentId = reported.orders.find(row => row.id === purchaseOrderId)!.incidents[0].id;
    const shipment = await dispatch({ ...dispatchInput('original-office-shipment-during-hold', 'supplier_to_libereal', [goods(purchaseOrderId, relayLineId)]),
      lines: [{ ...goods(purchaseOrderId, relayLineId), holdAssignments: [{ incidentId, quantity: 1 }] }],
      holdReview: pendingDeviation('actual-office-stock-quarantine') });
    const [parcelLine] = shipment.lines;
    const duringHold = nextOccurrence();
    const { lines } = await current(purchaseOrderId);
    const payee = lines[0].terms.payee;
    const before = await purchaseAction(purchaseOrderId, { action: 'record_payment', requestId: 'office-payment-before-hold',
      reference: 'OFFICE-PRIOR-BANK', amountCents: 100, conditionReference: '暂停前供方书面付款条件',
      ...supplierPaymentProof('OFFICE-PRIOR-BANK', payee, beforeHold) }, merchant);
    expect(before.orders.find(row => row.id === purchaseOrderId)).toMatchObject({ paidCents: 100, dueCents: 4900 });

    const transfer = { reference: 'OFFICE-BANK-DURING-HOLD', amountCents: 900, conditionReference: '实际供方回单',
      ...supplierPaymentProof('OFFICE-BANK-DURING-HOLD', payee, duringHold) };
    await expect(purchaseAction(purchaseOrderId, { ...transfer, action: 'record_payment', requestId: 'no-ordinary-payment-in-hold' }, merchant))
      .rejects.toThrow(/书面/);
    const recorded = await purchaseAction(purchaseOrderId, { ...transfer, action: 'record_payment_exception', requestId: 'office-preserve-paid-during-hold',
      description: '真实转账待核。原暂停期间没有本次付款放行。' }, merchant);
    const issue = recorded.orders.find(row => row.id === purchaseOrderId)!.paymentExceptions[0];
    expect(issue).toMatchObject({ pending: true, original: { amountCents: 900 } });
    const permission = { action: 'approve_payment_attribution' as const, paymentIssueId: issue.id, requestId: 'supplier-attribution-after-warehouse-clearance',
      reference: 'OFFICE-SIGNED-HOLD-DISPOSITION', referenceSha256: pricingContentHash('supplier approval and real warehouse release document'),
      description: '双方实际处理已完成，核准将同一原银行转账冲入原合同。' };
    await expect(purchaseAction(purchaseOrderId, permission, approver)).rejects.toThrow(/须先核清该笔暂停/);
    await event(shipment.id, eventInput('office-quarantine-count', 'warehouse_receipt', [{ parcelLineId: parcelLine.id, quantity: 1, batchNumber: receivedLotA }]));
    const lot = await receipt(parcelLine.id, receivedLotA);
    await event(shipment.id, continuation('office-qualified-warehouse-release', parcelLine.id, incidentId, 1, lot.id));
    const open = (await current(purchaseOrderId)).incidents[0];
    if (open) await purchaseAction(purchaseOrderId, { action: 'resolve_change', incidentId, outcome: 'original_terms',
      requestId: 'office-resolve-original-supplier-terms', ...agreement('actual-opt-in-to-original-contract'),
      coordinationLines: open.outstanding ?? undefined }, approver);
    const post = { action: 'record_payment' as const, paymentIssueId: issue.id, requestId: 'office-book-the-same-historical-cash',
      conditionReference: '现批准下同笔银行原款可归入合同' };
    await expect(purchaseAction(purchaseOrderId, post, merchant)).rejects.toThrow(/还不能归入/);
    await expect(purchaseAction(purchaseOrderId, permission, merchant)).rejects.toThrow(/另一位/);
    const approved = await purchaseAction(purchaseOrderId, permission, approver);
    const authority = approved.orders.find(row => row.id === purchaseOrderId)!.paymentExceptions[0].attributionApprovalId;
    expect(authority).toBeTruthy();
    await expect(purchaseAction(purchaseOrderId, post, approver)).rejects.toThrow(/还不能归入/);
    const posted = await purchaseAction(purchaseOrderId, post, merchant);
    expect(posted.orders.find(row => row.id === purchaseOrderId)).toMatchObject({ paidCents: 1000, dueCents: 4000,
      paymentExceptions: [{ id: issue.id, pending: false, attributionApprovalId: authority }] });
    expect(posted.activities.at(-1)?.detail).toMatchObject({ snapshot: { operation: {
      approvalId: null, attributionApprovalId: authority, paymentEvidence: { occurredAt: duringHold },
    } } });
    expect(await prisma.customerCashPosting.count({ where: { orderId } })).toBe(0);
  });

  it.each(['original','resend','receipt'] as const)('records the evidenced held unit and leaves the same source’s ordinary unit available (%s)',async kind=>{
    await acceptCustomerOrder();
    const {relay:id}=await orderFromSuppliers();
    let source: NonNullable<PurchaseAction['affectedLines']>[number]['source']={kind:'unshipped'};
    let selected=goods(id,relayLineId) as DispatchLine;
    let route:Route='supplier_to_customer';
    if (kind==='resend') {
      const lost=await dispatch(dispatchInput('both-original-units-really-left','supplier_to_customer',[goods(id,relayLineId,2)]));
      await event(lost.id,{...eventInput('both-original-units-verified-lost','customer_delivery',[]),...agreement('two-losses'),
        kind:'confirm_shortfall',lines:[{parcelLineId:lost.lines[0].id,quantity:2,outcome:'loss'}]});
      const loss=(await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId))).fulfillment.shortfalls[0];
      await report(id,'lost-two-before-free-resend','双方拟对这两件免费补发。',[{...line(relayLineId,2),source:{kind:'shortfall',id:loss.resolutionId}}]);
      const approved=await purchaseAction(id,{action:'resolve_change',outcome:'shortfall',requestId:'explicit-free-resend-two',
        ...agreement('approve-two-free'),dispositions:[{...line(relayLineId,2),outcome:'cancel',shortfallId:loss.resolutionId,shortfallDecision:'free_resend'}]});
      const resendApprovalId=approved.fulfillment.freeResends[0].approvalId;
      selected={...selected,resendApprovalId};
      source={kind:'resend',id:resendApprovalId};
    }
    if (kind==='receipt') {
      const intake=await dispatch(dispatchInput('ordinary-receipt-before-deviation','supplier_to_libereal',[goods(id,relayLineId,2)]));
      await event(intake.id,eventInput('same-lot-two-known-pieces','warehouse_receipt',[
        {parcelLineId:intake.lines[0].id,quantity:2,batchNumber:receivedLotA},
      ]));
      const {id:sourceReceiptId}=await receipt(intake.lines[0].id,receivedLotA);
      selected={...selected,sourceReceiptId};
      source={kind:'receipt',id:sourceReceiptId};
      route='libereal_to_customer';
    }
    const reported=await purchaseAction(id,{action:'report_change',changeKind:kind==='receipt'?'other':'delay',
      requestId:'pause-exactly-one',reference:'TEST-ONLY-ONE-ACTUAL-PIECE-PAUSED',
      description:'原件对应同一来源的两件货，只有标识明确的一件暂停。',affectedLines:[{...line(relayLineId,1),source}]},operator);
    const issue=reported.orders.find(row=>row.id===id)!.incidents[0];
    const ordinary=dispatchInput('independent-ordinary-piece-still-moves',route,[selected]);
    const assigned={incidentId:issue.id,quantity:1};
    const actual={...dispatchInput('mistaken-held-unit-actually-left',route,[selected]),
      lines:[{...selected,holdAssignments:[assigned]}],holdReview:pendingDeviation('named-actual-piece')};
    const options=await prisma.$transaction(tx=>fulfillmentWorkspace(tx,orderId,Date.parse(actual.occurredAt),true));
    const candidate=kind==='receipt' ? options.receipts[0] : kind==='resend' ? options.freeResends[0]
      : options.purchases.find(row=>row.orderItemId===relayLineId);
    expect(candidate?.holdAllowance).toMatchObject({ordinarilyAvailable:1,assignable:[assigned]});
    await expect(previewDispatch({...actual,lines:[{...selected,holdAssignments:[{...assigned,quantity:2}]}]})).rejects.toThrow(/暂停份额/);
    const proof=await previewDispatch(actual);
    const confirm=()=>prisma.$transaction(tx=>dispatchParcel(tx,orderId,actual,operator,proof.actionHash));
    const first=await confirm();
    expect((await confirm()).id).toBe(first.id);
    expect((await workspace()).parcels.find(row=>row.id===first.id)?.holdFacts).toMatchObject([
      {parcelLineId:first.lines[0].id,quantity:1,pending:1,assignments:[assigned]},
    ]);
    await expect(previewDispatch({...ordinary,lines:actual.lines,holdReview:actual.holdReview})).rejects.toThrow(/暂停份额/);
    const second=await dispatch(ordinary);
    expect(second.id).not.toBe(first.id);
    expect(second.dispatchedAt < first.dispatchedAt).toBe(true);
    expect((await workspace()).parcels.find(row=>row.id===second.id)?.holdFacts).toEqual([]);
    await expect(previewDispatch(dispatchInput('same-source-third-piece-does-not-exist',route,[selected])))
      .rejects.toThrow(/发货数量|采购行实际收到的批次|已经批准的本行免费重发数量/);
    expect(await prisma.orderItem.findUniqueOrThrow({where:{id:relayLineId}})).toMatchObject({shippedQty:2});
    expect(await prisma.accountReceivable.findUniqueOrThrow({where:{orderId}})).toMatchObject({status:'open',amount:300,paidAt:null});
  });

  it.each([false,true])('receives quarantined goods before the buyer replies and clears only the lot covered by the decision (mapped lots = %s)',async mapped=>{
    await acceptCustomerOrder();
    const {relay:id}=await orderFromSuppliers();
    await purchaseAction(id,{action:'record_payment',requestId:'deposit-before-quarantine',reference:'TEST-ACTUAL-900-DEPOSIT',
      conditionReference:'TEST-ORIGINAL-DEPOSIT-CLAUSE',amountCents:900});
    const ordered=await report(id,'two-misrouted','实际只有停发的两件在原件范围。',[waiting(relayLineId,2)]);
    const incidentId=ordered.orders.find(row=>row.id===id)!.incidents[0].id;
    const raw={...dispatchInput('supplier-missent-before-customer-answers','supplier_to_libereal',[goods(id,relayLineId,2)]),
      holdReview:pendingDeviation('real-unanswered-inbound')};
    const parcel=await dispatch(raw);
    expect(await prisma.shipment.count({where:{orderId}})).toBe(0);
    const parcelLineId=parcel.lines[0].id;
    await event(parcel.id,eventInput('warehouse-counts-and-quarantines-two-lots','warehouse_receipt',[
      {parcelLineId,quantity:1,batchNumber:receivedLotA},{parcelLineId,quantity:1,batchNumber:receivedLotB},
    ]));
    const a=await receipt(parcelLineId,receivedLotA), b=await receipt(parcelLineId,receivedLotB);
    expect(await batch(receivedLotA)).toMatchObject({quantity:1,reservedQuantity:1});
    expect(await batch(receivedLotB)).toMatchObject({quantity:1,reservedQuantity:1});
    if (mapped) {
      await purchaseAction(id,{action:'review_change_scope',incidentId,requestId:'verify-the-two-actual-quarantined-lots',
        reference:'TEST-ORIGINAL-QUARANTINE-LOT-RECORD',referenceSha256:pricingContentHash('original signed warehouse lot locations'),
        description:'具名仓单核明两件误发各自的实际批次，仍待客户决定。',
        affectedLines:[a,b].map(lot=>({...line(relayLineId,1),source:{kind:'receipt' as const,id:lot.id}}))});
    }
    expect((await workspace()).receipts).toEqual([]);
    await expect(purchaseAction(id,{action:'record_payment',requestId:'premature-finance-during-quarantine',reference:'TEST-NOT-A-PAID-BALANCE',
      conditionReference:'TEST-ORIGINAL-COMMERCIAL-CONDITION',amountCents:100})).rejects.toThrow(/书面/);
    const earlier=dispatchInput('attempted-transfer-before-written-consent','libereal_to_customer',[{...goods(id,relayLineId),sourceReceiptId:a.id}]);
    const agreeA=continuation('buyer-consent-only-actual-lot-a',parcelLineId,incidentId,1,a.id);
    await expect(event(parcel.id,{...agreeA,customerReference:undefined})).rejects.toThrow(/客户书面/);
    await event(parcel.id,agreeA);
    await event(parcel.id,agreeA);
    expect((await workspace()).receipts.map(row=>row.id)).toEqual([a.id]);
    expect((await workspace()).parcels[0].holdFacts[0]).toMatchObject({pending:1,pendingAssignments:[{incidentId,quantity:1}]});
    expect(await prisma.fulfillmentEvent.count({where:{parcelId:parcel.id,kind:'review_dispatch_hold'}})).toBe(1);
    await expect(previewDispatch(earlier)).rejects.toThrow(/实际收到的批次|发货数量/);
    await dispatch(dispatchInput('transfer-only-consented-lot','libereal_to_customer',[{...goods(id,relayLineId),sourceReceiptId:a.id}]));
    expect(await batch(receivedLotB)).toMatchObject({quantity:1,reservedQuantity:1});
    expect(await current(id)).toMatchObject({paidCents:900,dueCents:4100,incidents:[{id:incidentId}]});
    expect((await workspace()).receipts).toEqual([]);
    expect(await receipt(parcelLineId,receivedLotB)).toMatchObject({id:b.id,forwardedQuantity:0,releasedQuantity:0});
  });

  it('separates normal goods on the same waybill and requires the named decision for each affected quantity after closure',async()=>{
    await acceptCustomerOrder();
    const {relay:id}=await orderFromSuppliers();
    const first=await report(id,'hold-one-on-mixed-waybill','原件标明暂停件一件，另一件不受影响。',[waiting(relayLineId,1)]);
    const issue=first.orders.find(row=>row.id===id)!.incidents[0];
    const raw={...dispatchInput('same-waybill-with-an-ordinary-and-held-unit','supplier_to_libereal',[goods(id,relayLineId,2)]),
      lines:[{...goods(id,relayLineId,2),holdAssignments:[{incidentId:issue.id,quantity:1}]}],holdReview:pendingDeviation('mixed-two-pieces')};
    const parcel=await dispatch(raw);
    const held=(await workspace()).parcels[0].holdFacts[0].parcelLineId;
    const ordinary=parcel.lines.find(row=>row.id!==held)!.id;
    await event(parcel.id,eventInput('warehouse-identifies-mixed-dispatch-units','warehouse_receipt',[
      {parcelLineId:ordinary,quantity:1,batchNumber:receivedLotA},{parcelLineId:held,quantity:1,batchNumber:receivedLotB},
    ]));
    const normal=await receipt(ordinary,receivedLotA), restricted=await receipt(held,receivedLotB);
    expect((await workspace()).receipts.map(row=>row.id)).toEqual([normal.id]);
    // Closing the customer order is independent of the physical rights to the misrouted stock.
    const cancelled=await orderPATCH(new NextRequest('http://localhost/api/admin/orders/'+orderId,
      {method:'PATCH',body:JSON.stringify({status:'cancelled'})}),{params:Promise.resolve({id:orderId})});
    expect(cancelled.status,JSON.stringify(await cancelled.json())).toBe(200);
    const disposal={...eventInput('warehouse-after-order-closed','warehouse_receipt',[]),kind:'dispose_receipt',
      receiptId:normal.id,quantity:1,disposition:'released_to_stock'};
    await expect(event(parcel.id,{...disposal,receiptId:restricted.id})).rejects.toThrow(/误发实物仍待书面处理/);
    await event(parcel.id,disposal);
    const agreed=continuation('both-parties-agree-warehouse-may-keep-missent-goods',held,issue.id,1,restricted.id);
    await expect(event(parcel.id,agreed)).rejects.toThrow(/书面留仓决定或实际退回/);
    const release={...agreed,lines:[{...agreed.lines[0],outcome:'release_to_stock'}]};
    await expect(event(parcel.id,{...release,lines:[{...release.lines[0],incidentId:'other-incident'}]})).rejects.toThrow(/原暂停事项/);
    await event(parcel.id,release);
    await event(parcel.id,release);
    expect(await receipt(ordinary,receivedLotA)).toMatchObject({releasedQuantity:1,forwardedQuantity:0});
    expect(await receipt(held,receivedLotB)).toMatchObject({releasedQuantity:1,forwardedQuantity:0});
    expect((await workspace()).parcels[0].holdFacts[0].pending).toBe(0);
    expect(await prisma.shipment.count({where:{orderId}})).toBe(0);
    expect(await prisma.fulfillmentEvent.count({where:{parcelId:parcel.id,kind:'review_dispatch_hold'}})).toBe(1);
  });

  it('applies the actual return to its named issue while another share on the same waybill remains pending',async()=>{
    await acceptCustomerOrder();
    const {relay:id}=await orderFromSuppliers();
    await report(id,'separate-issue-a','原件 A 对应独立一件。',[waiting(relayLineId,1)]);
    await report(id,'separate-issue-b','原件 B 另对应独立一件。',[waiting(relayLineId,1)]);
    const [a,b]=(await current(id)).incidents;
    const raw={...dispatchInput('both-actual-paused-issues-are-in-one-waybill','supplier_to_libereal',[goods(id,relayLineId,2)]),
      lines:[{...goods(id,relayLineId,2),holdAssignments:[{incidentId:a.id,quantity:1},{incidentId:b.id,quantity:1}]}],
      holdReview:pendingDeviation('two-distinct-paused-shares')};
    const parcel=await dispatch(raw);
    const assigned=(await workspace()).parcels[0].holdFacts;
    const parcelLineId=(id:string)=>assigned.find(row=>row.assignments?.some(part=>part.incidentId===id))!.parcelLineId;
    const [aLine,bLine]=[parcelLineId(a.id),parcelLineId(b.id)];
    expect(aLine).not.toBe(bLine);
    await event(parcel.id,eventInput('joint-intake-with-separate-issue-identities','warehouse_receipt',[
      {parcelLineId:aLine,quantity:1,batchNumber:receivedLotA},{parcelLineId:bLine,quantity:1,batchNumber:receivedLotB},
    ]));
    const returned=await receipt(bLine,receivedLotB);
    const physical=await event(parcel.id,{...eventInput('physical-return-of-b-only','warehouse_receipt',[]),...agreement('physical-return-b'),
      kind:'confirm_shortfall',lines:[{parcelLineId:bLine,quantity:1,outcome:'return',receiptId:returned.id}]});
    const originalReturn=physical.lines.find(row=>row.id===bLine)!.resolutions[0];
    const decision={...continuation('named-return-of-b-only',bLine,b.id,1),
      lines:[{parcelLineId:bLine,incidentId:b.id,quantity:1,outcome:'return',resolutionId:originalReturn.id}]};
    await expect(event(parcel.id,{...decision,lines:[{...decision.lines[0],incidentId:a.id}]})).rejects.toThrow(/原暂停事项/);
    await event(parcel.id,decision);
    const facts=(await workspace()).parcels[0].holdFacts;
    expect(facts.find(row=>row.parcelLineId===aLine)).toMatchObject({pending:1,decisions:[]});
    expect(facts.find(row=>row.parcelLineId===bLine)).toMatchObject({pending:0,decisions:[{incidentId:b.id,outcome:'return',
      resolutionId:originalReturn.id,receiptId:returned.id}]});
    expect(await receipt(aLine,receivedLotA)).toMatchObject({releasedQuantity:0,forwardedQuantity:0});
    expect(await receipt(bLine,receivedLotB)).toMatchObject({releasedQuantity:1,forwardedQuantity:0});
    expect(await current(id)).toMatchObject({paidCents:0,incidents:[
      {id:a.id,outstanding:[{source:{kind:'parcel',id:aLine},quantity:1}]},
      {id:b.id,outstanding:[{source:{kind:'shortfall',id:originalReturn.id},quantity:1}]},
    ]});
  });

  const handOffShortfall = (tag:string, parcelLineId:string, incidentId:string, resolutionId:string, quantity=1) => ({
    ...eventInput(tag,'customer_delivery',[]),kind:'review_dispatch_hold',
    description:'原书证确认本次误发实物已经短失，由具名经办人继续核对原采购责任和应付。',
    holdResponsibility:'合成原合同责任经办人',lines:[{parcelLineId,incidentId,resolutionId,quantity,outcome:'shortfall'}],
  });

  it.each([
    ['supplier_to_customer','loss'],
    ['supplier_to_libereal','shortage'],
    ['libereal_to_customer','loss'],
  ] as const)('hands off the confirmed shortfall on its actual route (%s, %s) and leaves the original payable independent',async(route,actualOutcome)=>{
    await acceptCustomerOrder();
    const {relay:id,direct}=await orderFromSuppliers();
    await purchaseAction(id,{action:'record_payment',requestId:'original-deposit-before-real-shortfall',
      reference:'TEST-EXISTING-DEPOSIT-RECEIPT',conditionReference:'TEST-ORIGINAL-DEPOSIT-CLAUSE',amountCents:900});
    let sourceReceiptId:string|undefined;
    if (route==='libereal_to_customer') {
      const inbound=await dispatch(dispatchInput('original-carrier-arrived-at-libereal','supplier_to_libereal',[goods(id,relayLineId,2)]));
      await event(inbound.id,eventInput('actual-lot-before-forwarding','warehouse_receipt',[
        {parcelLineId:inbound.lines[0].id,quantity:2,batchNumber:receivedLotA},
      ]));
      sourceReceiptId=(await receipt(inbound.lines[0].id,receivedLotA)).id;
    }
    const source=sourceReceiptId ? {kind:'receipt' as const,id:sourceReceiptId} : {kind:'unshipped' as const};
    const reported=await purchaseAction(id,{action:'report_change',changeKind:sourceReceiptId?'other':'delay',requestId:'real-dispatch-stop',
      reference:'TEST-REAL-ONE-PIECE-STOP',description:'该实际来源的一件暂停。',affectedLines:[{...line(relayLineId,1),source}]},operator);
    const issue=reported.orders.find(row=>row.id===id)!.incidents[0];
    const parcel=await dispatch({...dispatchInput('held-piece-physically-entrusted-to-carrier',route,[goods(id,relayLineId)]),
      lines:[{...goods(id,relayLineId),sourceReceiptId,holdAssignments:[{incidentId:issue.id,quantity:1}]}],holdReview:pendingDeviation('carrier-actually-took-held-piece')});
    const parcelLineId=parcel.lines[0].id;
    const earlyClaim=nextOccurrence();
    const fact={...eventInput('actual-carrier-shortfall-precedes-handoff','customer_delivery',[]),...agreement('verified-shortfall-only'),
      kind:'confirm_shortfall',lines:[{parcelLineId,quantity:1,outcome:actualOutcome}]};
    const confirmed=await event(parcel.id,fact);
    const resolution=confirmed.lines[0].resolutions[0];
    if (route==='supplier_to_libereal') {
      await purchaseAction(id,{action:'review_change_scope',incidentId:issue.id,requestId:'procurement-already-knows-the-exact-loss',
        reference:'TEST-DOCUMENTED-EXACT-INBOUND-SHORTFALL',description:'采购事项已指向确实未到仓的那一件。',
        affectedLines:[{...line(relayLineId,1),source:{kind:'shortfall',id:resolution.id}}]});
    }
    const action=handOffShortfall('keep-proven-shortfall-with-named-owner',parcelLineId,issue.id,resolution.id);
    const before=await current(id);
    expect((await workspace()).parcels.find(row=>row.id===parcel.id)?.holdFacts[0].pending).toBe(1);
    await expect(event(parcel.id,{...action,occurredAt:earlyClaim})).rejects.toThrow(/已登记的实际短少或丢失/);
    await expect(event(parcel.id,{...action,lines:[{...action.lines[0],resolutionId:'other-package-resolution'}]}))
      .rejects.toThrow(/已登记的实际短少或丢失/);
    await expect(event(parcel.id,{...action,lines:[{...action.lines[0],outcome:'return'}],
      ...agreement('actually-lost-so-cannot-claim-a-return')})).rejects.toThrow(/实际退回/);
    const preview=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,action,operator));
    expect(preview.snapshot).toMatchObject({holdResponsibility:action.holdResponsibility,holdDecisions:[{
      incidentId:issue.id,parcelLineId,quantity:1,resolutionId:resolution.id,shortfallEvidence:{
        kind:actualOutcome,reference:fact.reference,sha256:fact.sha256,occurredAt:fact.occurredAt,
      },
    }]});
    await expect(prisma.$transaction(tx=>recordParcelEvent(tx,orderId,parcel.id,
      {...action,holdResponsibility:'预览后的不同经办人'},operator,preview.actionHash))).rejects.toThrow(/重新预览/);
    const apply=()=>prisma.$transaction(tx=>recordParcelEvent(tx,orderId,parcel.id,action,operator,preview.actionHash));
    await apply();
    await apply();
    await expect(event(parcel.id,{...action,requestId:'claim-the-same-physical-loss-twice',reference:'TEST-REPEATED-SHORTFALL',
      sha256:pricingContentHash('renamed second claimed same quantity')})).rejects.toThrow(/尚未办结/);
    const after=await current(id);
    expect(after).toMatchObject({paidCents:before.paidCents,dueCents:before.dueCents,totalCents:before.totalCents,
      incidents:[{id:issue.id,outstanding:[{...line(relayLineId,1),source:{kind:'shortfall',id:resolution.id}}],
        shortfallFollowups:[{responsibility:action.holdResponsibility,quantity:1,resolutionId:resolution.id,
          actorId:operator.id,reference:action.reference}]}]});
    const view=await workspace();
    expect(view.parcels.find(row=>row.id===parcel.id)).toMatchObject({status:'shortfall',holdFacts:[
      {pending:0,decisions:[{incidentId:issue.id,outcome:'shortfall',quantity:1}]},
    ]});
    expect(await prisma.fulfillmentEvent.count({where:{parcelId:parcel.id,kind:'review_dispatch_hold'}})).toBe(1);
    expect(await prisma.fulfillmentLineResolution.count({where:{parcelLineId}})).toBe(1);
    expect(await prisma.shipment.count({where:{orderId,deliveredAt:{not:null}}})).toBe(0);
    expect(await prisma.accountReceivable.findUniqueOrThrow({where:{orderId}})).toMatchObject({status:'open',amount:300,paidAt:null});
    const balance={action:'record_payment' as const,requestId:'actual-approved-tail-after-independent-contract-result',
      reference:'TEST-ACTUAL-CONTRACT-BALANCE-TRANSFER',conditionReference:'TEST-ORIGINAL-MATURE-BALANCE-TERM',amountCents:4100};
    await expect(purchaseAction(id,balance)).rejects.toThrow();
    await purchaseAction(direct,{...balance,requestId:'unrelated-purchase-may-record-its-real-payment',
      reference:'TEST-OTHER-PURCHASE-PAYMENT',amountCents:100});
    await purchaseAction(id,{action:'resolve_change',incidentId:issue.id,outcome:'original_terms',requestId:'both-parties-confirm-original-contract-payable',
      ...agreement('independent-original-payable-confirmed'),coordinationLines:[{...line(relayLineId,1),source:{kind:'shortfall',id:resolution.id}}]});
    expect(await current(id)).toMatchObject({status:'ordered',paidCents:900,dueCents:4100,incidents:[]});
    await purchaseAction(id,balance);
    expect(await current(id)).toMatchObject({paidCents:5000,dueCents:0});
    const facts=await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    expect(facts.orders).toHaveLength(2);
    expect(facts.fulfillment.freeResends).toEqual([]);
    expect(facts.fulfillment.shortfalls.find(row=>row.resolutionId===resolution.id)).toMatchObject({quantity:1,available:1});
  });

  it('clears only the lost share on a partly signed line and completes only after the independently approved unit is received',async()=>{
    await acceptCustomerOrder();
    const {relay:id,direct}=await orderFromSuppliers();
    const a=await dispatch(dispatchInput('unchanged-direct-a','supplier_to_customer',[goods(direct,directLineId)]));
    await event(a.id,eventInput('the-other-order-line-is-genuinely-signed','customer_delivery',[{parcelLineId:a.lines[0].id,quantity:1}]));
    const stopped=await report(id,'two-b-were-actually-paused','停发两件，实际都误交承运人。',[waiting(relayLineId,2)]);
    const issue=stopped.orders.find(row=>row.id===id)!.incidents[0];
    const b=await dispatch({...dispatchInput('both-held-b-units-physically-left','supplier_to_customer',[goods(id,relayLineId,2)]),
      holdReview:pendingDeviation('two-real-unreleased-units')});
    const parcelLineId=b.lines[0].id;
    const actualSignature=eventInput('real-signature-for-only-one-b','customer_delivery',[{parcelLineId,quantity:1}]);
    await event(b.id,actualSignature);
    const missing=await event(b.id,{...eventInput('other-b-confirmed-lost-with-evidence','customer_delivery',[]),
      ...agreement('the-customer-only-confirms-the-physical-loss'),kind:'confirm_shortfall',lines:[{parcelLineId,quantity:1,outcome:'loss'}]});
    const loss=missing.lines[0].resolutions[0];
    const action=handOffShortfall('named-handoff-for-one-piece-only',parcelLineId,issue.id,loss.id);
    await expect(event(b.id,{...action,lines:[{...action.lines[0],quantity:2}]})).rejects.toThrow(/实际短少或丢失与未核对数量/);
    await event(b.id,action);
    await expect(event(b.id,{...action,requestId:'a-different-document-cannot-count-that-same-unit',sha256:pricingContentHash('different followup paper')}))
      .rejects.toThrow(/未核对数量/);
    expect((await workspace()).parcels.find(row=>row.id===b.id)?.holdFacts[0]).toMatchObject({pending:1});
    expect((await current(id)).incidents[0].outstanding).toEqual(expect.arrayContaining([
      {...line(relayLineId,1),source:{kind:'parcel',id:parcelLineId}},
      {...line(relayLineId,1),source:{kind:'shortfall',id:loss.id}},
    ]));
    expect(await prisma.order.findUniqueOrThrow({where:{id:orderId}})).toMatchObject({status:'partially_shipped',paidAt:null});
    expect(await prisma.shipment.findUniqueOrThrow({where:{id:b.shipmentId!}})).toMatchObject({status:'delivered',
      deliveredAt:new Date(actualSignature.occurredAt)});
    await event(b.id,continuation('buyer-real-consent-for-the-part-already-received',parcelLineId,issue.id,1));
    const separate=await purchaseAction(id,{action:'resolve_change',incidentId:issue.id,outcome:'shortfall',requestId:'new-independent-supplier-free-resend-approval',
      ...agreement('parties-independently-agree-to-free-resend-the-missing-unit'),
      dispositions:[{...line(relayLineId,1),outcome:'cancel',shortfallDecision:'free_resend',shortfallId:loss.id}]});
    const {approvalId:resendApprovalId}=separate.fulfillment.freeResends[0];
    const replacement=await dispatch(dispatchInput('only-actual-independent-replacement-is-shipped','supplier_to_customer',[
      {...goods(id,relayLineId),resendApprovalId},
    ]));
    expect(await prisma.order.findUniqueOrThrow({where:{id:orderId}})).toMatchObject({status:'shipped',paidAt:null});
    const lastSignature=eventInput('real-signature-for-the-independent-replacement','customer_delivery',[{parcelLineId:replacement.lines[0].id,quantity:1}]);
    await event(replacement.id,lastSignature);
    expect(await prisma.order.findUniqueOrThrow({where:{id:orderId}})).toMatchObject({status:'completed',paidAt:null});
    expect(await prisma.shipment.findUniqueOrThrow({where:{id:b.shipmentId!}})).toMatchObject({deliveredAt:new Date(actualSignature.occurredAt)});
    expect(await prisma.accountReceivable.findUniqueOrThrow({where:{orderId}})).toMatchObject({status:'open',amount:300,paidAt:null});
  });

  async function shortfallAfterClosingEarlierNotice(quantity=1) {
    if (quantity>2) {
      await prisma.orderItem.update({where:{id:relayLineId},data:{quantity}});
      await prisma.order.update({where:{id:orderId},data:{subtotal:100*(quantity+1),total:100*(quantity+1)}});
    }
    await acceptCustomerOrder();
    const {relay:id,direct}=await orderFromSuppliers(Math.max(2,quantity));
    await purchaseAction(id,{action:'record_payment',requestId:'actual-original-deposit-before-late-shortfall',
      reference:'TEST-ORIGINAL-900-DEPOSIT',conditionReference:'TEST-ACTUAL-DEPOSIT-TERM',amountCents:900});
    const reported=await report(id,'later-closed-original-notice','原供应通知包含后知误发的实际份额。',[waiting(relayLineId,quantity)]);
    const issue=reported.orders.find(row=>row.id===id)!.incidents[0];
    const actual=dispatchInput('late-evidenced-shipment-at-its-original-time','supplier_to_customer',[
      {...goods(id,relayLineId,quantity),holdAssignments:[{incidentId:issue.id,quantity}]},
    ]);
    nextOccurrence();
    await purchaseAction(id,{action:'review_change_scope',incidentId:issue.id,reviewResult:'no_impact',
      requestId:'the-original-notice-was-justifiably-closed-then',reference:'TEST-THEN-NO-NEW-IMPACT',
      description:'据当时已查书证，原通知无新增影响。'});
    const parcel=await dispatch({...actual,holdReview:pendingDeviation('the-real-dispatch-came-to-light-later')});
    const parcelLineId=parcel.lines[0].id;
    const confirmed=await event(parcel.id,{...eventInput('actual-later-loss-not-an-old-commercial-decision','customer_delivery',[]),
      ...agreement('actual-physical-later-loss'),kind:'confirm_shortfall',lines:[{parcelLineId,quantity,outcome:'loss'}]});
    const resolutionId=confirmed.lines[0].resolutions[0].id;
    const target={...line(relayLineId,quantity),source:{kind:'shortfall' as const,id:resolutionId}};
    return {id,direct,issue,parcel,parcelLineId,resolutionId,target,quantity};
  }

  it('opens a named procurement follow-up when the original notice was legitimately closed before the real loss',async()=>{
    const {id,direct,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice();
    const old=await current(id);
    expect(old).toMatchObject({status:'ordered',incidents:[],paidCents:900,dueCents:4100});
    const action=handOffShortfall('late-loss-still-needs-procurement-owner',parcelLineId,issue.id,resolutionId);
    const check=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,action,operator));
    expect(check.snapshot).toMatchObject({holdDecisions:[{purchaseFollowup:{reportQuantity:1,decisionLinks:[],transfers:[]}}]});
    const apply=()=>prisma.$transaction(tx=>recordParcelEvent(tx,orderId,parcel.id,action,operator,check.actionHash));
    await apply();
    await apply();
    const po=await current(id);
    expect(po).toMatchObject({status:'on_hold',paidCents:900,dueCents:4100,incidents:[
      {outstanding:[target],shortfallOrigin:{incidentId:issue.id,parcelId:parcel.id,parcelLineId,resolutionId},
        responsibility:action.holdResponsibility},
    ]});
    expect(po.incidentHistory.find(row=>row.id===issue.id)).toEqual(old.incidentHistory.find(row=>row.id===issue.id));
    expect(po.ledger.filter(row=>row.action==='report_change')).toHaveLength(2);
    const tail={action:'record_payment' as const,requestId:'actual-part-of-tail-after-review',reference:'TEST-TAIL-1850',
      conditionReference:'TEST-PROVED-ORIGINAL-TAIL-TERM',amountCents:1850};
    await expect(purchaseAction(id,tail)).rejects.toThrow();
    await purchaseAction(direct,{...tail,requestId:'independent-po-payment-remains-possible',reference:'TEST-SEPARATE-PAID'});
    await purchaseAction(id,{action:'resolve_change',incidentId:po.incidents[0].id,outcome:'original_terms',
      requestId:'proper-written-contract-settlement-later',...agreement('later-actual-original-payable'),coordinationLines:[target]});
    await purchaseAction(id,tail);
    expect(await current(id)).toMatchObject({paidCents:2750,dueCents:2250,incidents:[]});
  });

  it.each([1,2])('links exactly one independently settled quantity and only reports any remaining shares (loss = %d)',async quantity=>{
    const {id,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice(quantity);
    const known={...target,quantity:1};
    const reviewed=await purchaseAction(id,{action:'report_change',changeKind:'other',requestId:'separate-exact-contract-review-of-one',
      affectedLines:[known],reference:'TEST-CONTRACT-EXACT-ONE-SHORTFALL',description:'同一短失原件，已查确切一件。'});
    const priorIssue=reviewed.orders.find(row=>row.id===id)!.incidents[0];
    const settled=await purchaseAction(id,{action:'resolve_change',incidentId:priorIssue.id,outcome:'original_terms',coordinationLines:[known],
      requestId:'pre-existing-documented-exact-loss-liability',...agreement('already-confirmed-payable-for-exact-one-shortfall')});
    const past=settled.orders.find(row=>row.id===id)!.ledger.findLast(row=>row.action==='resolve_change')!;
    const action=handOffShortfall('subsequent-recognition-of-the-real-physical-shortfall',parcelLineId,issue.id,resolutionId,quantity);
    const check=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,action,operator));
    expect(check.snapshot).toMatchObject({holdDecisions:[{purchaseFollowup:{
      reportQuantity:quantity-1,decisionLinks:[{activityId:past.id,quantity:1}],
    }}]});
    await event(parcel.id,action);
    const po=await current(id);
    expect(po.incidents.map(row=>row.outstanding)).toEqual(quantity===2 ? [[known]] : []);
    expect(po.ledger.findLast(row=>row.action===(quantity===2 ? 'report_change' : 'link_dispatch_shortfall'))?.detail).toMatchObject({
      snapshot:{operation:{shortfallHandoff:{resolutionId,parcelLineId,incidentId:issue.id,decisionLinks:[{activityId:past.id,quantity:1}]}}},
    });
    expect(po).toMatchObject({status:quantity===2?'on_hold':'ordered',paidCents:900,dueCents:4100});
  });

  it('tracks a first handed-off unit separately from a later, explicitly settled unit of the same resolution',async()=>{
    const {id,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice(2);
    const one={...target,quantity:1};
    await event(parcel.id,handOffShortfall('first-lost-piece-still-pending',parcelLineId,issue.id,resolutionId));
    const [first]=(await current(id)).incidents;
    const prepared=await purchaseAction(id,{action:'report_change',changeKind:'other',requestId:'independent-exact-other-piece',
      reference:'TEST-OTHER-ONE-PIECE-CONTRACT-REVIEW',description:'独立核对尚未接续的另一件，原一件仍由原责任人办理。',affectedLines:[one]});
    const other=prepared.orders.find(row=>row.id===id)!.incidents.find(row=>row.id!==first.id)!;
    const settled=await purchaseAction(id,{action:'resolve_change',incidentId:other.id,outcome:'original_terms',coordinationLines:[one],
      requestId:'authorize-only-the-other-one',...agreement('both-parties-verified-original-obligation-of-other-piece')});
    const prior=settled.orders.find(row=>row.id===id)!.ledger.findLast(row=>row.action==='resolve_change')!;
    const action=handOffShortfall('second-piece-has-its-own-exact-decision',parcelLineId,issue.id,resolutionId);
    const check=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,action,operator));
    expect(check.snapshot).toMatchObject({holdDecisions:[{purchaseFollowup:{
      reportQuantity:0,decisionLinks:[{activityId:prior.id,quantity:1}],
    }}]});
    await event(parcel.id,action);
    expect((await current(id)).incidents).toMatchObject([{id:first.id,outstanding:[one]}]);
    expect((await current(id)).incidents).toHaveLength(1);
  });

  it('retains both original and linked notices when a later loss needs its own procurement follow-up',async()=>{
    await acceptCustomerOrder();
    const {relay:id}=await orderFromSuppliers();
    const initial=await report(id,'earlier-notice-later-linked','当时暂停一件真实物品。',[waiting(relayLineId,1)]);
    const original=initial.orders.find(row=>row.id===id)!.incidents[0];
    const prepared=dispatchInput('mistaken-departure-before-the-duplicate-link','supplier_to_customer',[goods(id,relayLineId)]);
    nextOccurrence();
    const second=await report(id,'other-copy-of-the-same-event','原文件后来到达，核实与先前通知是同一件。',[waiting(relayLineId,1)]);
    const matched=second.orders.find(row=>row.id===id)!.incidents.find(row=>row.id!==original.id)!;
    await purchaseAction(id,{action:'review_change_scope',incidentId:original.id,reviewResult:'duplicate',
      relatedIncidentId:matched.id,requestId:'same-notice-written-evidence',reference:'TEST-WRITTEN-LINK',
      description:'原文件书证核实确实是同一份货物。'});
    await purchaseAction(id,{action:'review_change_scope',incidentId:matched.id,reviewResult:'no_impact',
      requestId:'no-impact-before-later-departure-discovered',reference:'TEST-FACTS-AT-THAT-POINT',
      description:'按此刻资料确实无新增影响，晚报的运单此时未知。'});
    const currentAt=await prisma.$transaction(tx=>fulfillmentWorkspace(tx,orderId,Date.parse(prepared.occurredAt),true));
    const candidate=currentAt.purchases.find(row=>row.purchaseOrderId===id && row.orderItemId===relayLineId)!.holdAllowance!.assignable[0];
    const departed=await dispatch({...prepared,lines:[{...prepared.lines[0],holdAssignments:[{incidentId:candidate.incidentId,quantity:1}]}],
      holdReview:pendingDeviation('lost-despite-old-notices-having-been-reconciled')});
    const parcelLineId=departed.lines[0].id;
    const lost=await event(departed.id,{...eventInput('actual-loss-proven-after-both-reviews','customer_delivery',[]),
      ...agreement('carrier-and-buyer-verify-real-loss-later'),kind:'confirm_shortfall',lines:[{parcelLineId,quantity:1,outcome:'loss'}]});
    const resolutionId=lost.lines[0].resolutions[0].id;
    await event(departed.id,handOffShortfall('named-followup-after-an-archived-merge',parcelLineId,candidate.incidentId,resolutionId));
    const po=await current(id);
    expect(po.incidents).toMatchObject([{shortfallOrigin:{incidentId:original.id,parcelId:departed.id,parcelLineId,resolutionId}}]);
    expect(po.incidentHistory.find(row=>row.id===original.id)).toMatchObject({status:'duplicate',linkedTo:matched.id});
    expect(po.incidentHistory.find(row=>row.id===matched.id)).toMatchObject({status:'no_impact'});
  });

  it('joins an existing open procurement case that already scopes the exact loss after the old notice closes',async()=>{
    const {id,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice();
    const already=await purchaseAction(id,{action:'report_change',changeKind:'other',requestId:'later-open-case-on-the-real-shortfall',
      reference:'TEST-ALREADY-BEING-HANDLED-ON-THE-SAME-PO',description:'已有采购经办范围涵盖该实际货件。',affectedLines:[target]});
    const active=already.orders.find(row=>row.id===id)!.incidents[0];
    const action=handOffShortfall('same-shortfall-with-existing-scope',parcelLineId,issue.id,resolutionId);
    const check=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,action,operator));
    expect(check.snapshot).toMatchObject({holdDecisions:[{purchaseFollowup:{
      reportQuantity:0,transfers:[{incidentId:active.id,from:target}],
    }}]});
    await event(parcel.id,action);
    expect(await current(id)).toMatchObject({incidents:[{id:active.id,outstanding:[target],shortfallFollowups:[
      {quantity:1,resolutionId,responsibility:action.holdResponsibility},
    ]}]});
    expect((await current(id)).ledger.filter(row=>row.action==='report_change')).toHaveLength(2);
  });

  it('repairs an old fact-only closure through the original procurement entry without repeating the physical event',async()=>{
    const {id,direct,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice();
    const oldPurchase=await current(id);
    await event(parcel.id,handOffShortfall('old-shape-previously-lacked-procurement',parcelLineId,issue.id,resolutionId));
    // Restore the procurement side to the released 6ae07c0 shape while keeping its real physical shortfall and applied review.
    const added=(await current(id)).ledger.find(entry=>!oldPurchase.ledger.some(row=>row.id===entry.id))!;
    await prisma.$executeRaw`DELETE FROM PurchaseActivity WHERE id=${added.id}`;
    await prisma.$executeRaw`UPDATE PurchaseOrder SET status=${oldPurchase.status},revision=${oldPurchase.revision} WHERE id=${id}`;
    const readOrder=()=>prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    const old=(await readOrder()).fulfillment.unlinkedDispatchShortfalls[0];
    expect(old).toMatchObject({purchaseOrderId:id,parcelLineId,resolutionId,quantity:1,incidentId:issue.id});
    const count=()=>prisma.fulfillmentEvent.count({where:{parcelId:parcel.id}});
    const recorded=await count();
    await expect(purchaseAction(id,{action:'record_payment',requestId:'not-before-recovery',reference:'TEST-NOT-PAID',
      conditionReference:'TEST-REAL-TERM',amountCents:1850})).rejects.toThrow(/仍待采购接续/);
    const whenUnlinked = nextOccurrence();
    nextOccurrence();
    const recover={action:'report_change' as const,requestId:'recover-one-historical-part',
      shortfallHandoffKey:old.key,reference:'TEST-ORIGINAL-FILE-WITH-NAMED-HANDOFF',description:'补接旧版已核实短失。',
      responsibility:'合成原采购续办人'};
    await expect(purchaseAction(direct,recover)).rejects.toThrow(/请选择本采购单/);
    const input={...recover,orderId,purchaseOrderId:id,version:(await current(id)).version};
    const res=await prisma.$transaction(tx=>previewPurchaseAction(tx,input,operator));
    expect(res.snapshot.operation).toMatchObject({shortfallRecovery:{key:old.key,purchaseFollowup:{reportQuantity:1,target:{purchaseOrderId:id,parcelLineId,resolutionId,quantity:1,incidentId:issue.id}}}});
    const confirm=()=>prisma.$transaction(tx=>applyPurchaseAction(tx,{...input,actionHash:res.actionHash},operator));
    await confirm();
    await confirm();
    expect(await count()).toBe(recorded);
    expect((await readOrder()).fulfillment.unlinkedDispatchShortfalls).toEqual([]);
    expect(await current(id)).toMatchObject({paidCents:900,dueCents:4100,incidents:[
      {outstanding:[target],shortfallOrigin:{incidentId:issue.id,parcelId:parcel.id,parcelLineId,resolutionId},responsibility:recover.responsibility},
    ]});
    const [open] = (await current(id)).incidents;
    await purchaseAction(id,{action:'resolve_change',incidentId:open.id,outcome:'original_terms',requestId:'resolve-the-recovered-contract-scope',
      coordinationLines:[target],...agreement('actual-resolution-of-recovered-shortfall')});
    const payee = (await current(id)).lines[0].terms.payee;
    const dated = { amountCents: 1850, reference:'OLDER-BANK-TRANSFER-BETWEEN-REVIEWS', conditionReference:'原合同付款条件',
      ...supplierPaymentProof('OLDER-BANK-TRANSFER-BETWEEN-REVIEWS',payee,whenUnlinked) };
    await expect(purchaseAction(id,{...dated,action:'record_payment',requestId:'no-retrospective-release-during-gap'}))
      .rejects.toThrow(/仍待采购接续/);
    const retained = await purchaseAction(id,{...dated,action:'record_payment_exception',requestId:'named-actual-transfer-during-historical-gap',
      description:'按原日期保留银行转账，历史待接续的时段须核实归属。'},merchant);
    expect(retained.orders.find(row=>row.id===id)).toMatchObject({paidCents:900,dueCents:4100,
      paymentExceptions:[{pending:true,ownerId:merchant.id,original:{amountCents:1850}}]});
  });

  const reportExactLoss = (id:string, target:NonNullable<PurchaseAction['affectedLines']>[number], tag:string) =>
    purchaseAction(id,{action:'report_change',changeKind:'other',requestId:'report-exact-loss-'+tag,affectedLines:[target],
      reference:'TEST-EXACT-LOSS-'+tag,description:'按同一物流短失记录和货件数量登记实际范围。'});
  const approveOriginalShare = (id:string, incidentId:string, part:NonNullable<PurchaseAction['affectedLines']>[number], tag:string) =>
    purchaseAction(id,{action:'resolve_change',incidentId,outcome:'original_terms',coordinationLines:[part],
      requestId:'original-terms-'+tag,...agreement(tag)});
  const approveFreeShare = (id:string, incidentId:string, lossId:string, tag:string) =>
    purchaseAction(id,{action:'resolve_change',incidentId,outcome:'shortfall',requestId:'free-resend-'+tag,
      ...agreement(tag),dispositions:[{...line(relayLineId,1),outcome:'cancel',shortfallId:lossId,shortfallDecision:'free_resend'}]});

  it.each([
    ['original_first','all_at_once'],
    ['resend_first','all_at_once'],
    ['original_first','split'],
    ['resend_first','split'],
  ] as const)('counts disjoint signed decisions from the same scope in either order (%s, %s)',async(first,handoff)=>{
    const {id,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice(2);
    const original=await reportExactLoss(id,target,'two-pieces-known-from-original-carrier-evidence');
    const caseId=original.orders.find(row=>row.id===id)!.incidents[0].id;
    const one={...target,quantity:1};
    const keep=()=>approveOriginalShare(id,caseId,one,'original-terms-for-one-physical-piece');
    const resend=()=>approveFreeShare(id,caseId,resolutionId,'free-resend-for-the-separate-other-piece');
    if (first==='original_first') {await keep();await resend();} else {await resend();await keep();}
    const po=await current(id);
    const signed=po.ledger.filter(row=>row.action==='resolve_change');
    const requests=handoff==='all_at_once' ? [2] : [1,1];
    const links=[];
    for (const [index,quantity] of requests.entries()) {
      const body=handOffShortfall('reconcile-exact-signed-share-'+index,parcelLineId,issue.id,resolutionId,quantity);
      const result=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,body,operator));
      const inspected=(result.snapshot as unknown as {holdDecisions:Array<{purchaseFollowup:{
        decisionLinks:Array<{activityId:string;quantity:number}>;reportQuantity:number
      }}>}).holdDecisions[0].purchaseFollowup;
      expect(inspected.reportQuantity).toBe(0);
      links.push(...inspected.decisionLinks);
      await prisma.$transaction(tx=>recordParcelEvent(tx,orderId,parcel.id,body,operator,result.actionHash));
    }
    expect(links).toEqual(signed.map(row=>({activityId:row.id,quantity:1})));
    const used=await current(id);
    expect(used).toMatchObject({status:'ordered',paidCents:900,dueCents:4100,incidents:[]});
    expect(used.ledger.filter(row=>row.action==='report_change')).toHaveLength(2);
    const payment=await prisma.$transaction(tx=>previewPurchaseAction(tx,{orderId,purchaseOrderId:id,version:used.version,
      action:'record_payment',requestId:'existing-payable-terms-preview-only',reference:'TEST-OUTSTANDING-TAIL-PREVIEW',
      ...supplierPaymentProof('TEST-OUTSTANDING-TAIL-PREVIEW', used.lines[0].terms.payee),
      conditionReference:'TEST-ORIGINAL-APPROVED-AND-MATURED-TERM',amountCents:1850},approver));
    expect(payment.snapshot.operation).toMatchObject({action:'record_payment',amountCents:1850});
    expect((await current(id)).paidCents).toBe(900);
    expect((await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId))).fulfillment.freeResends).toMatchObject([
      {shortfallId:resolutionId,quantity:1,dispatched:0},
    ]);
  });

  it.each(['open','settled_before_merge','settled_after_merge','chained_merge'] as const)
    ('preserves a previous assignment when the same proven shortfall share is merged (%s)',async timing=>{
    const {id,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice(2);
    const one={...target,quantity:1};
    await event(parcel.id,handOffShortfall('first-unit-assigned-to-the-earlier-case',parcelLineId,issue.id,resolutionId));
    const [original]=(await current(id)).incidents;
    let left=original.id;
    let right=original.id;
    for (const hop of timing==='chained_merge' ? [1,2] : [1]) {
      const concurrent=await reportExactLoss(id,one,'subsequent-original-for-same-unit-'+hop);
      right=concurrent.orders.find(row=>row.id===id)!.incidents.find(row=>row.id!==left)!.id;
      if (timing==='settled_before_merge') await approveOriginalShare(id,right,one,'the-paired-exact-share-was-resolved-first');
      await purchaseAction(id,{action:'review_change_scope',incidentId:left,relatedIncidentId:right,reviewResult:'duplicate',
        requestId:'both-notices-locate-the-identical-goods-'+hop,reference:'TEST-SAME-PHYSICAL-LOSS-'+hop,
        description:'核对原件，同一物流记录中的同一件已移交货物没有新增。'});
      left=right;
    }
    if (timing==='settled_after_merge' || timing==='chained_merge') await approveOriginalShare(id,right,one,'the-merged-first-unit-settled');
    const second=handOffShortfall('independent-second-actual-unit-only',parcelLineId,issue.id,resolutionId);
    const preview=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,second,operator));
    expect(preview.snapshot).toMatchObject({holdDecisions:[{purchaseFollowup:{
      reportQuantity:1,decisionLinks:[],transfers:[],
    }}]});
    await event(parcel.id,second);
    await event(parcel.id,second);
    const po=await current(id);
    const followup=po.incidents.find(row=>row.id!==right)!;
    expect(followup).toMatchObject({outstanding:[one],shortfallOrigin:{incidentId:issue.id,resolutionId,parcelLineId}});
    expect(po.incidentHistory.find(row=>row.id===original.id)).toMatchObject({status:'duplicate',linkedTo:right});
    expect(po).toMatchObject({paidCents:900,dueCents:4100,status:'on_hold'});
  });

  it('uses the remaining bounded scope across a proven merge without counting earlier unrelated reuse',async()=>{
    const {id,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice(2);
    const two=await reportExactLoss(id,target,'whole-two-source-for-subsequent-merge');
    const old=two.orders.find(row=>row.id===id)!.incidents[0].id;
    const one={...target,quantity:1};
    await approveOriginalShare(id,old,one,'the-first-piece-written-agreement');
    const second=await reportExactLoss(id,one,'letter-confirming-the-same-unresolved-second-share');
    const next=second.orders.find(row=>row.id===id)!.incidents.find(row=>row.id!==old)!.id;
    await purchaseAction(id,{action:'review_change_scope',incidentId:old,relatedIncidentId:next,reviewResult:'duplicate',
      requestId:'target-covers-entire-outstanding-one-piece',reference:'TEST-DIRECT-EXACT-REMAINDER-COMMON-SCOPE',
      description:'只关联原事项剩余的一件，原已决定的一件另有原书证。'});
    await approveFreeShare(id,next,resolutionId,'the-authorized-second-piece-only');
    const both=handOffShortfall('reconcile-two-disjoint-pieces-after-scope-merge',parcelLineId,issue.id,resolutionId,2);
    const po=await current(id);
    const decisions=po.ledger.filter(row=>row.action==='resolve_change').map(row=>({activityId:row.id,quantity:1}));
    const result=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,both,operator));
    expect(result.snapshot).toMatchObject({holdDecisions:[{purchaseFollowup:{reportQuantity:0,decisionLinks:decisions}}]});
    await event(parcel.id,both);
    expect(await current(id)).toMatchObject({status:'ordered',paidCents:900,dueCents:4100,incidents:[]});
  });

  it('keeps the unproven remainder open when separate decisions might cover the same physical piece',async()=>{
    const {id,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice(2);
    const one={...target,quantity:1};
    const first=await reportExactLoss(id,one,'letter-applies-to-one-but-does-not-distinguish-unit');
    await approveOriginalShare(id,first.orders.find(row=>row.id===id)!.incidents[0].id,one,'contract-terms-for-one');
    const next=await reportExactLoss(id,one,'other-letter-also-applies-to-one');
    await approveFreeShare(id,next.orders.find(row=>row.id===id)!.incidents[0].id,resolutionId,'free-resend-might-cover-the-same-one');
    const both=handOffShortfall('ambiguous-overlap-is-left-for-procurement',parcelLineId,issue.id,resolutionId,2);
    const result=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,both,operator));
    expect(result.snapshot).toMatchObject({holdDecisions:[{purchaseFollowup:{reportQuantity:1,decisionLinks:[{quantity:1}]}}]});
    await event(parcel.id,both);
    expect(await current(id)).toMatchObject({status:'on_hold',paidCents:900,dueCents:4100,incidents:[{outstanding:[one]}]});
  });

  async function previewOriginalTail(id:string, tag:string) {
    const po=await current(id);
    return prisma.$transaction(tx=>previewPurchaseAction(tx,{orderId,purchaseOrderId:id,version:po.version,
      action:'record_payment',requestId:tag,reference:'TEST-TAIL-PREVIEW-ONLY',
      ...supplierPaymentProof('TEST-TAIL-PREVIEW-ONLY', po.lines[0].terms.payee),
      conditionReference:'TEST-ORIGINAL-SIGNED-PAYABLE-CONDITION',amountCents:1850},approver));
  }

  it.each([{quantities:[2]},{quantities:[1,1]}])('keeps the same unresolved quantity whether the same two ambiguous letters are submitted as $quantities',async({quantities})=>{
    const {id,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice(2);
    const one={...target,quantity:1};
    for (const tag of ['earlier-one','later-one']) {
      const recorded=await reportExactLoss(id,one,tag);
      const subject=recorded.orders.find(row=>row.id===id)!.incidents[0];
      await approveOriginalShare(id,subject.id,one,'could-be-the-same-physical-piece-'+tag);
    }
    const readPlans: Array<{reportQuantity:number;decisionLinks:Array<{activityId:string;quantity:number}>}>=[];
    for (const [index,quantity] of quantities.entries()) {
      const body=handOffShortfall('same-evidence-for-either-size-'+index,parcelLineId,issue.id,resolutionId,quantity);
      const {snapshot,actionHash}=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,body,operator));
      const plans=snapshot as {holdDecisions:Array<{purchaseFollowup:typeof readPlans[number]}>};
      readPlans.push(plans.holdDecisions[0].purchaseFollowup);
      const apply=()=>prisma.$transaction(tx=>recordParcelEvent(tx,orderId,parcel.id,body,operator,actionHash));
      await apply();
      await apply();
      await prisma.$disconnect();
    }
    expect(readPlans.reduce((sum,plan)=>sum+plan.reportQuantity,0)).toBe(1);
    expect(readPlans.flatMap(plan=>plan.decisionLinks)).toMatchObject([{quantity:1}]);
    const pending=await current(id);
    expect(pending).toMatchObject({status:'on_hold',paidCents:900,dueCents:4100,incidents:[
      {outstanding:[one],responsibility:'合成原合同责任经办人'},
    ]});
    expect(pending.incidents).toHaveLength(1);
    await expect(previewOriginalTail(id,'tail-is-not-yet-cleared')).rejects.toThrow();
    await approveOriginalShare(id,pending.incidents[0].id,one,'new-written-evidence-distinguishes-the-other-piece');
    await expect(previewOriginalTail(id,'tail-preview-only-after-separate-approval'))
      .resolves.toMatchObject({snapshot:{operation:{action:'record_payment',amountCents:1850,authorizedDueCents:4100}}});
    expect((await current(id)).paidCents).toBe(900);
  });

  it.each(['merge_before_second','merge_after_second','settle_merged_pair_first'] as const)
    ('keeps two distinct handoffs booked in the same case after a merge (%s)',async timing=>{
    const {id,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice(3);
    const one={...target,quantity:1};
    const two={...target,quantity:2};
    await event(parcel.id,handOffShortfall('one-handed-to-the-first-case',parcelLineId,issue.id,resolutionId));
    const [a]=(await current(id)).incidents;
    const recorded=await reportExactLoss(id,two,'actual-coverage-two-in-the-related-case');
    const c=recorded.orders.find(row=>row.id===id)!.incidents.find(row=>row.id!==a.id)!;
    const earlier=timing!=='merge_before_second';
    if (earlier) {
      const second=handOffShortfall('second-another-piece-handed-to-c',parcelLineId,issue.id,resolutionId);
      const result=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,second,operator));
      expect(result.snapshot).toMatchObject({holdDecisions:[{purchaseFollowup:{
        reportQuantity:0,transfers:[{incidentId:c.id,from:one}],
      }}]});
      await event(parcel.id,second);
    }
    await purchaseAction(id,{action:'review_change_scope',incidentId:a.id,relatedIncidentId:c.id,reviewResult:'duplicate',
      requestId:'merge-records-without-merging-physical-assignments',reference:'TEST-PROVEN-A-IS-WITHIN-C-TWO',
      description:'已核对是同一事项，保留实际已经各自接办的数量。'});
    if (timing==='settle_merged_pair_first') await approveOriginalShare(id,c.id,two,'independently-approved-for-the-pair-only');
    await prisma.$disconnect();
    const remaining=handOffShortfall('remaining-physical-quantity',parcelLineId,issue.id,resolutionId,earlier?1:2);
    const check=await prisma.$transaction(tx=>previewParcelEvent(tx,orderId,parcel.id,remaining,operator));
    expect(check.snapshot).toMatchObject({holdDecisions:[{purchaseFollowup:{
      reportQuantity:1,decisionLinks:[],transfers:earlier ? [] : [{incidentId:c.id,from:one}],
    }}]});
    await event(parcel.id,remaining);
    await event(parcel.id,remaining);
    if (timing!=='settle_merged_pair_first') await approveOriginalShare(id,c.id,two,'confirmed-original-condition-for-only-the-merged-pair');
    const afterPair=await current(id);
    expect(afterPair).toMatchObject({status:'on_hold',paidCents:900,dueCents:6600,
      incidents:[{outstanding:[one],responsibility:'合成原合同责任经办人'}]});
    expect(afterPair.incidents).toHaveLength(1);
    await expect(previewOriginalTail(id,'uncovered-third-still-needs-review')).rejects.toThrow();
    await approveOriginalShare(id,afterPair.incidents[0].id,one,'written-different-decision-for-third-only');
    await expect(previewOriginalTail(id,'no-payment-posted-after-third-review'))
      .resolves.toMatchObject({snapshot:{operation:{action:'record_payment',amountCents:1850,authorizedDueCents:6600}}});
    expect((await current(id)).paidCents).toBe(900);
  });

  it('keeps both named cases open when the proposed merge covers less than the shares each already took on',async()=>{
    const {id,issue,parcel,parcelLineId,resolutionId,target}=await shortfallAfterClosingEarlierNotice(2);
    const one={...target,quantity:1};
    await event(parcel.id,handOffShortfall('first-piece-now-owned-by-a',parcelLineId,issue.id,resolutionId));
    const [a]=(await current(id)).incidents;
    const after=await reportExactLoss(id,one,'one-in-the-other-case');
    const c=after.orders.find(row=>row.id===id)!.incidents.find(row=>row.id!==a.id)!;
    await event(parcel.id,handOffShortfall('second-piece-now-owned-by-c',parcelLineId,issue.id,resolutionId));
    await expect(purchaseAction(id,{action:'review_change_scope',incidentId:a.id,relatedIncidentId:c.id,reviewResult:'duplicate',
      requestId:'cannot-erase-one-existing-assignment',reference:'TEST-ONLY-ONE-ACTUAL-SHARE-IN-THE-RELATED-SCOPE',
      description:'没有经核实的证据证明另一方可接手两件。'})).rejects.toThrow(/已经分别接办的短失数量/);
    expect((await current(id)).incidents.map(row=>row.id)).toEqual([a.id,c.id]);
    await approveOriginalShare(id,c.id,one,'written-proof-for-c');
    await expect(previewOriginalTail(id,'a-is-still-unresolved')).rejects.toThrow();
    await approveOriginalShare(id,a.id,one,'independent-written-proof-for-a');
    await expect(previewOriginalTail(id,'both-written-decisions-present')).resolves.toMatchObject({snapshot:{paidCents:900}});
  });

  it('records actual direct signature before any buyer decision without closing the customer order or collecting money',async()=>{
    await acceptCustomerOrder();
    const {direct,relay:id}=await orderFromSuppliers();
    const a=await dispatch(dispatchInput('normal-a-for-direct-completion','supplier_to_customer',[goods(direct,directLineId)]));
    await event(a.id,eventInput('a-independent-actually-signed','customer_delivery',[{parcelLineId:a.lines[0].id,quantity:1}]));
    const reportB=await report(id,'b-paused-before-actual-direct-departure','两件直发误发，客户待回复。',[waiting(relayLineId,2)]);
    const incidentId=reportB.orders.find(row=>row.id===id)!.incidents[0].id;
    const b=await dispatch({...dispatchInput('buyer-still-has-not-agreed-to-direct-delivery','supplier_to_customer',[goods(id,relayLineId,2)]),
      holdReview:pendingDeviation('uncleared-direct-but-physically-gone')});
    const parcelLineId=b.lines[0].id;
    const actual=eventInput('physically-signed-for-b','customer_delivery',[{parcelLineId,quantity:2}]);
    await event(b.id,actual);
    expect(await prisma.shipment.findUniqueOrThrow({where:{id:b.shipmentId!}})).toMatchObject({status:'delivered',deliveredAt:new Date(actual.occurredAt)});
    expect(await prisma.order.findUniqueOrThrow({where:{id:orderId}})).toMatchObject({status:'shipped',paidAt:null});
    await event(b.id,continuation('customer-separately-accepts-the-b-quantity',parcelLineId,incidentId,2));
    expect(await prisma.order.findUniqueOrThrow({where:{id:orderId}})).toMatchObject({status:'completed',paidAt:null});
    expect(await prisma.shipment.findUniqueOrThrow({where:{id:b.shipmentId!}})).toMatchObject({deliveredAt:new Date(actual.occurredAt)});
    expect(await prisma.accountReceivable.findUniqueOrThrow({where:{orderId}})).toMatchObject({status:'open',amount:300,paidAt:null});
  });

  it('uses the verified physical identity of a held intake lot without backdating a release for it',async()=>{
    await acceptCustomerOrder();
    const {relay:id}=await orderFromSuppliers();
    const intake=await dispatch(dispatchInput('two-intake-pieces-one-original-line','supplier_to_libereal',[goods(id,relayLineId,2)]));
    const origin=intake.lines[0].id;
    const restricted=await report(id,'one-of-this-intake-shares-is-held','原件涉及该在途包裹内的一件，随后需按仓单定位批号。',
      [{...line(relayLineId,1),source:{kind:'parcel',id:origin}}]);
    const issue=restricted.orders.find(row=>row.id===id)!.incidents[0];
    await event(intake.id,eventInput('record-two-distinct-actual-receipts','warehouse_receipt',[
      {parcelLineId:origin,quantity:1,batchNumber:receivedLotA},{parcelLineId:origin,quantity:1,batchNumber:receivedLotB},
    ]));
    const a=await receipt(origin,receivedLotA), b=await receipt(origin,receivedLotB);
    const oldA=dispatchInput('prior-clearly-held-first-lot','libereal_to_customer',[{...goods(id,relayLineId),sourceReceiptId:a.id}]);
    const oldB=dispatchInput('prior-unaffected-second-lot','libereal_to_customer',[{...goods(id,relayLineId),sourceReceiptId:b.id}]);
    await expect(previewDispatch(oldB)).rejects.toThrow(/实际收到的批次|发货数量/);
    const fact={action:'review_change_scope' as const,incidentId:issue.id,requestId:'named-warehouse-attribution',
      reference:'TEST-SIGNED-ORIGINAL-LOT-ATTRIBUTION',description:'原仓单和实物标识合证：暂停份额对应甲批，乙批一直未受影响。',
      affectedLines:[{...line(relayLineId,1),source:{kind:'receipt' as const,id:a.id}}]};
    nextOccurrence();
    await expect(purchaseAction(id,fact)).rejects.toThrow(/书证摘要/);
    await purchaseAction(id,{...fact,referenceSha256:pricingContentHash('tested warehouse positioning evidence')});
    const recorded=await dispatch(oldB);
    expect(recorded.dispatchedAt.toISOString()).toBe(oldB.occurredAt);
    await expect(previewDispatch(oldA)).rejects.toThrow(/实际收到的批次|发货数量/);
    expect(await current(id)).toMatchObject({incidents:[{id:issue.id,outstanding:fact.affectedLines}]});
    expect(await receipt(origin,receivedLotA)).toMatchObject({forwardedQuantity:0});
  });

  it('requires a named attribution for the prior dispatch format before assigning another unit',async()=>{
    await acceptCustomerOrder();
    const {relay:id}=await orderFromSuppliers();
    await report(id,'old-pre-split-notice','旧版记录包含同一来源的两件停发。',[waiting(relayLineId,2)]);
    const incidentId=(await current(id)).incidents[0].id;
    const original={...pendingDeviation('actual-both-parties-from-old-workspace'),status:undefined,customerReference:'TEST-PRIOR-WRITTEN-CUSTOMER-REPLY'};
    const oldParcel=await dispatch({...dispatchInput('one-pre-split-deviation-already-recorded','supplier_to_customer',[goods(id,relayLineId)]),holdReview:original});
    const dispatchLog=oldParcel.events.find(row=>row.kind==='dispatch')!;
    const recorded=JSON.parse(dispatchLog.details);
    const oldLine=recorded.lines[0];
    // Recreate the previous dispatch event shape. The original request, proof, shipment and quantities stay in place.
    delete oldLine.holdAssignments;
    delete oldLine.holdSource;
    await prisma.fulfillmentEvent.update({where:{id:dispatchLog.id},data:{details:JSON.stringify(recorded)}});
    await prisma.$executeRaw`DELETE FROM PurchaseActivity WHERE purchaseOrderId=${id} AND action='locate_held_dispatch'`;
    const later={...dispatchInput('another-actual-held-unit-under-the-same-source','supplier_to_customer',[goods(id,relayLineId)]),
      holdReview:pendingDeviation('another-real-held-piece')};
    await expect(previewDispatch(later)).rejects.toThrow(/指定实际发出的暂停份额/);
    const key=oldParcel.lines[0].id;
    const review={...eventInput('verified-legacy-attribution-with-real-original-document','customer_delivery',[]),kind:'review_dispatch_hold',
      holdResponsibility:'合成旧档核对人',lines:[{parcelLineId:key,outcome:'identify',quantity:1,holdAssignments:[{incidentId,quantity:1}]}]};
    await expect(event(oldParcel.id,{...review,lines:[{...review.lines[0],holdAssignments:[{incidentId:'not-the-original-report',quantity:1}]}]}))
      .rejects.toThrow(/所选原事项/);
    await event(oldParcel.id,review);
    const latest=await dispatch(later);
    const before=(await workspace()).parcels.find(row=>row.id===oldParcel.id)!;
    expect(before.holdFacts).toMatchObject([{quantity:1,pending:0,assignments:[{incidentId,quantity:1}]}]);
    expect(latest.id).not.toBe(oldParcel.id);
    expect(await prisma.fulfillmentParcel.count({where:{orderId}})).toBe(2);
    expect(await prisma.orderItem.findUniqueOrThrow({where:{id:relayLineId}})).toMatchObject({shippedQty:2});
  });

  it('preserves earlier restrictions and independent release dates across two verified notice associations',async()=>{
    await acceptCustomerOrder();
    const id=await groupedOrder();
    await report(id,'e-earliest-reported-notice','先到的转述尚缺准确货物范围。');
    const earlyA=dispatchInput('a-during-original-notice','supplier_to_customer',[goods(id,directLineId)]);
    nextOccurrence();
    await report(id,'c-independent-b-record','另一份书证只覆盖一件 B。',[waiting(relayLineId,1)]);
    const by=async(tag:string)=>(await current(id)).incidentHistory.find(row=>row.reference.endsWith(tag))!;
    const e=await by('e-earliest-reported-notice'), c=await by('c-independent-b-record');
    await purchaseAction(id,{action:'resolve_change',outcome:'original_terms',requestId:'scoped-c-one-b-released',
      incidentId:c.id,...agreement('c-one-b-in-own-time')});
    const bAfterC=dispatchInput('b-after-own-valid-c-release','supplier_to_customer',[goods(id,relayLineId,2)]);
    await report(id,'m-primary-a-and-b-two-lines','原件明确 A 和一件 B。',[waiting(directLineId,1),waiting(relayLineId,1)]);
    const m=await by('m-primary-a-and-b-two-lines');
    await purchaseAction(id,{action:'review_change_scope',reviewResult:'duplicate',requestId:'associate-original-e-and-m',
      incidentId:e.id,relatedIncidentId:m.id,reference:'TEST-E-REPEATS-M-SCOPE',description:'手续核明 E 源自 M 的 A 和一件 B。'});
    const whileAStillHeld=dispatchInput('a-between-fact-link-and-commercial-decision','supplier_to_customer',[goods(id,directLineId)]);
    nextOccurrence();
    await purchaseAction(id,{action:'resolve_change',outcome:'original_terms',requestId:'m-continuation-for-a-only',
      incidentId:m.id,coordinationLines:[waiting(directLineId,1)],...agreement('later-approval-for-a')});
    const aAfterAgreement=dispatchInput('a-after-its-own-later-approval','supplier_to_customer',[goods(id,directLineId)]);
    await purchaseAction(id,{action:'review_change_scope',reviewResult:'duplicate',requestId:'only-m-outstanding-b-matches-c',
      incidentId:m.id,relatedIncidentId:c.id,reference:'TEST-RESIDUAL-M-B-MATCHES-C',description:'A 已单独结论，本次只把 M 剩下的一件 B 核为 C 的事实。'});
    expect(await by('e-earliest-reported-notice')).toMatchObject({linkedTo:c.id});
    await expect(previewDispatch(earlyA)).rejects.toThrow(/发货数量/);
    await expect(previewDispatch(whileAStillHeld)).rejects.toThrow(/发货数量/);
    await expect(previewDispatch(aAfterAgreement)).resolves.toMatchObject({snapshot:{occurredAt:aAfterAgreement.occurredAt}});
    await expect(previewDispatch(bAfterC)).resolves.toMatchObject({snapshot:{occurredAt:bAfterC.occurredAt,lines:[{quantity:2}]}});
  });

});
