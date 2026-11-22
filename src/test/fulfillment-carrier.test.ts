import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as carrierPOST } from '@/app/api/integrations/fulfillment/events/route';
import { reserveOrderCredit } from '@/lib/customer-credit';
import { reviewCarrierMatch } from '@/lib/fulfillment-carrier';
import { dispatchParcel, fulfillmentWorkspace, recordParcelEvent } from '@/lib/fulfillment-parcels';
import { merchantAcceptanceMetadata, merchantOrderApprovalPreview, ORDER_APPROVAL_INCLUDE } from '@/lib/order-approval';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { applyPurchaseAction, prepareOrderPurchases, previewPurchaseAction, purchaseWorkspace, savePurchaseLine } from '@/lib/purchase-orders';
import type { PurchaseTerms } from '@/lib/purchase-terms';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

const source = 'synthetic-carrier-feed';
const secret = 'synthetic-carrier-test-secret-never-used-externally';
const carrier = '合成承运方';
const buyer = { id: 'test-carrier-buyer', email: 'buyer@example.test' };
const merchant = { id: 'test-carrier-merchant', email: 'merchant@example.test' };
const operator = { id: 'test-carrier-operator', email: 'operator@example.test' };
const approver = { id: 'test-carrier-approver', email: 'approver@example.test' };
const productId = 'test-carrier-product';
const catalogNumber = 'TEST-CARRIER-SKU';

function nextOccurrence() {
  vi.setSystemTime(Date.now() + 1000);
  return new Date().toISOString();
}

function evidence(requestId: string) {
  return {
    occurredAt: nextOccurrence(),
    reference: `TEST-CARRIER-PROOF-${requestId}`,
    sha256: pricingContentHash({ evidence: requestId }),
    documentRow: 1,
  };
}

type CarrierKind = 'in_transit' | 'carrier_delivered' | 'exception';

function notice(eventId: string, trackingNumber: string, kind: CarrierKind) {
  return { eventId, kind, carrier, trackingNumber, description: '合成运输报告', ...evidence(eventId) };
}

function signedRequest(payload: object, signingSecret = secret) {
  const body = JSON.stringify(payload);
  return new NextRequest('http://localhost/api/integrations/fulfillment/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-libereal-signature': `sha256=${createHmac('sha256', signingSecret).update(body).digest('hex')}`,
    },
    body,
  });
}

async function send(payload: ReturnType<typeof notice> & { source?: string }) {
  const response = await carrierPOST(signedRequest(payload));
  const result = await response.json();
  expect(response.status, JSON.stringify(result)).toBe(200);
  return result as { id: string; status: string };
}

function findEvent(id: string) {
  return prisma.fulfillmentEvent.findUniqueOrThrow({ where: { id } });
}

async function orderedPurchase(orderId: string, quantity = 1) {
  const orderItemId = `${orderId}-line`;
  await prisma.$transaction(async tx => {
    const order = await tx.order.create({
      data: {
        id: orderId, email: buyer.email, customerId: buyer.id, status: 'pending',
        paymentMethod: 'bank_transfer', subtotal: 100 * quantity, total: 100 * quantity,
        orderItems: { create: { id: orderItemId, position: 0, productId, catalogNumber, name: '合成商品', unitPrice: 100, quantity } },
      },
      include: ORDER_APPROVAL_INCLUDE,
    });
    const approval = await merchantOrderApprovalPreview(tx, order);
    if (!approval || approval.action !== 'accept_order') throw new Error('Missing synthetic order approval');
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'confirmed', statusHistory: { create: {
        fromStatus: 'pending', toStatus: 'confirmed', actorId: merchant.id, actorEmail: merchant.email,
        metadata: merchantAcceptanceMetadata(approval),
      } } },
    });
    await reserveOrderCredit(tx, orderId, merchant.id);
    await prepareOrderPurchases(tx, orderId, merchant);
  });

  const terms: PurchaseTerms = {
    supplier: '合成供应商', writtenSupplier: '合成供应商', payee: '合成收款方', paymentTerms: '订购后按书面条款结算',
    unitPriceCents: 2500, linePayableCents: 2500 * quantity, currency: 'CNY', taxBasis: 'included',
    freightTerms: '含运费', supplierConditions: '按合成逐单供货条款供货', leadTime: '3 个工作日',
    validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
    sourceReference: `${orderId}-quote`, sourceSha256: pricingContentHash({ orderId, proof: 'quote' }),
    settlementReference: `${orderId}-settlement`, settlementSha256: pricingContentHash({ orderId, proof: 'settlement' }),
    coordinationReference: `${orderId}-coordination`, leadTimeAssessment: 'within_agreement',
  };
  await prisma.$transaction(async tx => {
    const { lines: [line] } = await purchaseWorkspace(tx, orderId);
    await savePurchaseLine(tx, { orderId, orderItemId, revision: line.revision, terms, checkedEvidence: true }, operator);
  });

  const purchaseOrderId = await prisma.$transaction(async tx => {
    const { orders: [purchase] } = await purchaseWorkspace(tx, orderId);
    const input = { orderId, purchaseOrderId: purchase.id, version: purchase.version, action: 'approve' as const, requestId: `approve-${orderId}` };
    const preview = await previewPurchaseAction(tx, input, approver);
    await applyPurchaseAction(tx, { ...input, actionHash: preview.actionHash }, approver);
    return purchase.id;
  });
  await prisma.$transaction(async tx => {
    const { orders: [purchase] } = await purchaseWorkspace(tx, orderId);
    const input = {
      orderId, purchaseOrderId, version: purchase.version, action: 'register_order' as const, requestId: `register-${orderId}`,
      occurredAt: nextOccurrence(), reference: `${orderId}-supplier-order`,
      referenceSha256: pricingContentHash({ orderId, proof: 'supplier-order' }),
    };
    const preview = await previewPurchaseAction(tx, input, approver);
    await applyPurchaseAction(tx, { ...input, actionHash: preview.actionHash }, approver);
  });
  return { orderId, orderItemId, purchaseOrderId };
}

function dispatch(
  purchase: Awaited<ReturnType<typeof orderedPurchase>>,
  trackingNumber: string,
  route: 'supplier_to_customer' | 'supplier_to_libereal' = 'supplier_to_customer',
  proof = evidence(`dispatch-${purchase.orderId}`),
  quantity = 1,
) {
  const { orderId, orderItemId, purchaseOrderId } = purchase;
  const input = {
    requestId: `dispatch-${orderId}`, route, carrier, trackingNumber, feedSource: source,
    lines: [{ purchaseOrderId, orderItemId, quantity }], ...proof,
  };
  return prisma.$transaction(tx => dispatchParcel(tx, orderId, input, operator));
}

beforeAll(() => { getTestDb(); });
afterAll(() => { closeTestDb(); });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date());
  vi.stubEnv('FULFILLMENT_CARRIER_SOURCE', source);
  vi.stubEnv('FULFILLMENT_CARRIER_SECRET', secret);
  const db = getTestDb();
  clearAllTables(db);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function seedParticipants() {
  const db = getTestDb();
  seedUser(db, buyer);
  for (const staff of [merchant, operator, approver]) seedAdmin(db, staff.id, staff.email);
  await prisma.creditAccount.create({ data: { userId: buyer.id, baseLimit: 5000, paymentTermDays: 30 } });
  await prisma.product.create({ data: { id: productId, name: '合成商品', catalogNumber, brand: '合成品牌', price: 100, stockQuantity: -1 } });
}

describe('authenticated carrier notices', () => {
  it('rejects an unconfigured feed or wrong signature before writing and attributes accepted reports to the configured source', async () => {
    const report = notice('test-auth', 'TEST-WAYBILL-AUTH', 'in_transit');
    vi.stubEnv('FULFILLMENT_CARRIER_SOURCE', undefined);
    vi.stubEnv('FULFILLMENT_CARRIER_SECRET', undefined);
    expect((await carrierPOST(signedRequest(report))).status).toBe(503);

    vi.stubEnv('FULFILLMENT_CARRIER_SOURCE', source);
    vi.stubEnv('FULFILLMENT_CARRIER_SECRET', 'too-short');
    expect((await carrierPOST(signedRequest(report))).status).toBe(503);

    vi.stubEnv('FULFILLMENT_CARRIER_SECRET', secret);
    expect((await carrierPOST(signedRequest(report, 'wrong-test-key'))).status).toBe(401);
    expect(await prisma.fulfillmentEvent.count()).toBe(0);

    const result = await send({ ...report, source: 'spoofed-payload-source' });
    expect(result.status).toBe('pending');
    expect(await findEvent(result.id)).toMatchObject({ source: `carrier/${source}`, parcelId: null });
  });

  it('links an early report when its actual dispatch is recorded and deduplicates retries without recording customer delivery', async () => {
    await seedParticipants();
    const purchase = await orderedPurchase('test-carrier-direct');
    const trackingNumber = 'TEST-WAYBILL-DIRECT';
    const beforeDispatch = await send(notice('before-actual-dispatch', trackingNumber, 'in_transit'));
    const dispatchProof = evidence('dispatch-direct');
    const report = notice('test-direct-delivery', trackingNumber, 'carrier_delivered');
    const received = await send(report);
    expect(received.status).toBe('pending');
    expect(await send(report)).toEqual(received);
    expect(await send({ ...report, eventId: 'another-upstream-id-for-the-same-report' })).toEqual(received);
    expect((await carrierPOST(signedRequest({ ...report, description: '已更改原报告' }))).status).toBe(409);
    expect(await prisma.fulfillmentParcel.count()).toBe(0);

    const parcel = await dispatch(purchase, trackingNumber, 'supplier_to_customer', dispatchProof);
    expect(parcel).toMatchObject({ status: 'in_transit', lines: [{ receivedQuantity: 0 }] });
    expect(await findEvent(beforeDispatch.id)).toMatchObject({ status: 'pending', parcelId: null });
    expect(await send(report)).toEqual({ id: received.id, status: 'linked' });
    expect(await findEvent(received.id)).toMatchObject({ status: 'linked', parcelId: parcel.id, kind: 'carrier_delivered' });
    expect(await prisma.fulfillmentEvent.count({ where: { parcelId: parcel.id, source: `carrier/${source}` } })).toBe(1);
    expect(await prisma.shipment.findUniqueOrThrow({ where: { id: parcel.shipmentId! } })).toMatchObject({
      status: 'shipped', deliveredAt: null,
    });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: purchase.orderId } })).toMatchObject({ status: 'shipped', paidAt: null });
    expect(await prisma.accountReceivable.findUniqueOrThrow({ where: { orderId: purchase.orderId } })).toMatchObject({ status: 'open', paidAt: null });
  });

  it('holds an ambiguous report until staff verifies the original waybill and confirms the exact evidence', async () => {
    await seedParticipants();
    const first = await orderedPurchase('test-carrier-first');
    const second = await orderedPurchase('test-carrier-second');
    const trackingNumber = 'TEST-SHARED-WAYBILL';
    const [firstParcel, secondParcel] = [await dispatch(first, trackingNumber), await dispatch(second, trackingNumber)];
    const report = notice('test-ambiguous', trackingNumber, 'in_transit');
    const result = await send(report);
    expect(result.status).toBe('pending');
    expect(await findEvent(result.id)).toMatchObject({ parcelId: null });
    const view = await prisma.$transaction(tx => fulfillmentWorkspace(tx, second.orderId));
    expect(view.unmatched).toEqual([expect.objectContaining({ id: result.id })]);

    const input = {
      parcelId: secondParcel.id, eventId: result.id, requestId: 'test-manual-match',
      description: '已核对合成运单的订单栏和对应包裹标记', ...evidence('manual-match'),
    };
    const review = (action = input, acceptedHash?: string) =>
      prisma.$transaction(tx => reviewCarrierMatch(tx, second.orderId, action, operator, acceptedHash));
    await expect(review({ ...input, parcelId: firstParcel.id })).rejects.toThrow(/通知的来源不符/);
    const preview = await review();
    expect(preview.snapshot).toMatchObject({
      orderId: second.orderId, parcelId: secondParcel.id, eventId: result.id, actorId: operator.id,
      reference: input.reference, sha256: input.sha256,
    });
    expect(await findEvent(result.id)).toMatchObject({ status: 'pending', parcelId: null });
    await expect(review({ ...input, reference: 'changed-after-preview' }, preview.actionHash)).rejects.toThrow(/重新预览/);

    await review(input, preview.actionHash);
    await review(input, preview.actionHash);
    expect(await send(report)).toEqual({ id: result.id, status: 'linked' });
    expect(await findEvent(result.id)).toMatchObject({ parcelId: secondParcel.id });
    expect(await prisma.fulfillmentParcel.findUniqueOrThrow({ where: { id: firstParcel.id } })).toMatchObject({ status: 'dispatched' });
    const matches = await prisma.fulfillmentEvent.findMany({ where: { kind: 'match_carrier' } });
    expect(matches).toMatchObject([{
      source: 'staff', status: 'applied', actorId: operator.id, parcelId: secondParcel.id, reference: input.reference,
    }]);
  });

  it('observes a true partial receipt when the last carrier exception is withdrawn', async () => {
    await seedParticipants();
    const first=await orderedPurchase('test-carrier-final-first',2);
    const second=await orderedPurchase('test-carrier-final-second');
    const tracking='TEST-PARTIAL-RECEIPT-ONE-WAYBILL';
    const a=await dispatch(first,tracking,'supplier_to_customer',evidence('original-first-dispatch'),2);
    const secondDispatch=evidence('second-actually-departed-earlier');
    const event=(input:object)=>prisma.$transaction(tx=>recordParcelEvent(tx,first.orderId,a.id,input,operator));
    const signed={ requestId:'one-original-true-receipt',kind:'customer_delivery',...evidence('original-signature'),
      description:'合成实际签收一件',lines:[{parcelLineId:a.lines[0].id,quantity:1}] };
    await event(signed);
    const held=await event({requestId:'staff-inquiry',kind:'exception',...evidence('staff-open'),description:'合成实际待核短少'});
    const own=held.events.find(row=>row.kind==='exception')!;
    const report=notice('one-verified-provisional-carrier-exception',tracking,'exception');
    const provisional=await send(report);
    const raw=await findEvent(provisional.id);
    expect(raw).toMatchObject({parcelId:a.id,status:'awaiting_resolution'});
    await event({requestId:'staff-one-lost',kind:'confirm_shortfall',...evidence('confirmed-loss'),exceptionId:own.id,
      description:'双方确认原运单另一件实际丢失',supplierReference:'TEST-SELLER-LOSS',supplierSha256:'a'.repeat(64),
      customerReference:'TEST-BUYER-LOSS',customerSha256:'b'.repeat(64),
      lines:[{parcelLineId:a.lines[0].id,quantity:1,outcome:'loss'}]});
    const before=await prisma.shipment.findUniqueOrThrow({where:{id:a.shipmentId!}});
    expect(before).toMatchObject({status:'shipped',deliveredAt:null});
    const receivables=await prisma.accountReceivable.findMany({orderBy:{orderId:'asc'}});
    const b=await dispatch(second,tracking,'supplier_to_customer',secondDispatch);
    const state=await prisma.fulfillmentParcel.findUniqueOrThrow({where:{id:a.id}});
    expect(state.status).toBe('shortfall');
    const original=await findEvent(provisional.id);
    expect(original).toMatchObject({parcelId:null,status:'pending',details:raw.details,contentHash:raw.contentHash});
    const result=await prisma.shipment.findUniqueOrThrow({where:{id:a.shipmentId!}});
    expect(result).toMatchObject({status:'delivered',deliveredAt:new Date(signed.occurredAt)});
    expect(await prisma.shipment.findUnique({where:{id:b.shipmentId!}})).toMatchObject({status:'shipped',deliveredAt:null});
    expect(await prisma.order.findUnique({where:{id:first.orderId}})).toMatchObject({status:'partially_shipped'});
    expect(await prisma.accountReceivable.findMany({orderBy:{orderId:'asc'}})).toEqual(receivables);
    await send(report);
    expect(await prisma.fulfillmentEvent.count({where:{parcelId:a.id,kind:'carrier_match_withdrawn'}})).toBe(1);
  });

  it('withdraws an earlier provisional match when a second matching parcel is recorded late', async () => {
    await seedParticipants();
    const first = await orderedPurchase('test-carrier-late-first');
    const second = await orderedPurchase('test-carrier-late-second');
    const tracking = 'TEST-SAME-CARRIER-LATE-WAYBILL';
    const a = await dispatch(first,tracking);
    const secondDispatch = evidence('actual-second-dispatch-before-report');
    const report = notice('test-original-carrier-exception',tracking,'exception');
    const original = await send(report);
    const signed = await findEvent(original.id);
    expect(signed).toMatchObject({parcelId:a.id,status:'awaiting_resolution'});
    expect(await prisma.fulfillmentParcel.findUnique({where:{id:a.id}})).toMatchObject({status:'exception'});
    const b = await dispatch(second,tracking,'supplier_to_customer',secondDispatch);
    expect(await findEvent(original.id)).toMatchObject({parcelId:null,status:'pending',details:signed.details,
      reference:signed.reference,evidenceSha256:signed.evidenceSha256,contentHash:signed.contentHash});
    expect(await prisma.shipment.findUnique({where:{id:a.shipmentId!}})).toMatchObject({status:'shipped',deliveredAt:null});
    const firstView = await prisma.$transaction(tx=>fulfillmentWorkspace(tx,first.orderId));
    expect(firstView.parcels[0]).toMatchObject({id:a.id,status:'dispatched',events:[
      expect.objectContaining({kind:'dispatch'}),expect.objectContaining({kind:'carrier_auto_match'}),expect.objectContaining({kind:'carrier_match_withdrawn'}),
    ]});
    expect(JSON.stringify(firstView)).not.toContain(second.orderId);
    expect(JSON.stringify(firstView)).not.toContain(report.reference);
    const input = { parcelId:b.id,eventId:original.id,requestId:'verify-correct-waybill',
      description:'按原件核实通知属于第二个包裹',...evidence('late-matching-original-proof') };
    const preview = await prisma.$transaction(tx=>reviewCarrierMatch(tx,second.orderId,input,operator));
    await prisma.$transaction(tx=>reviewCarrierMatch(tx,second.orderId,input,operator,preview.actionHash));
    expect(await send(report)).toEqual({id:original.id,status:'awaiting_resolution'});
    expect(await prisma.fulfillmentParcel.findUnique({where:{id:a.id}})).toMatchObject({status:'dispatched'});
    expect(await prisma.fulfillmentParcel.findUnique({where:{id:b.id}})).toMatchObject({status:'exception'});
    expect(await prisma.shipment.findUnique({where:{id:b.shipmentId!}})).toMatchObject({status:'shipped',deliveredAt:null});
  });

  it('keeps carrier exceptions open until each is resolved and leaves warehouse receipt to staff', async () => {
    await seedParticipants();
    const purchase = await orderedPurchase('test-carrier-inbound');
    const trackingNumber = 'TEST-WAYBILL-INBOUND';
    const parcel = await dispatch(purchase, trackingNumber, 'supplier_to_libereal');
    const first = await send(notice('test-exception-first', trackingNumber, 'exception'));
    const secondReport = notice('test-exception-second', trackingNumber, 'exception');
    const second = await send(secondReport);
    expect(first.status).toBe('awaiting_resolution');
    expect(second.status).toBe('awaiting_resolution');
    expect(await send(secondReport)).toEqual(second);
    expect((await send(notice('test-inbound-delivery', trackingNumber, 'carrier_delivered'))).status).toBe('linked');
    expect(await prisma.fulfillmentParcel.findUniqueOrThrow({ where: { id: parcel.id } })).toMatchObject({ status: 'exception' });

    const lineId = parcel.lines[0].id;
    const receipt = {
      requestId: 'test-actual-receipt', kind: 'warehouse_receipt', description: '仓库清点后凭合成收货单入库',
      lines: [{ parcelLineId: lineId, quantity: 1, productId, batchNumber: 'TEST-INBOUND-BATCH' }],
      ...evidence('warehouse-receipt'),
    };
    const record = (input: object) => prisma.$transaction(tx => recordParcelEvent(tx, purchase.orderId, parcel.id, input, operator));
    await expect(record(receipt)).rejects.toThrow(/待办异常/);
    expect(await prisma.fulfillmentParcelLine.findUniqueOrThrow({ where: { id: lineId } })).toMatchObject({ receivedQuantity: 0 });
    expect(await prisma.fulfillmentReceipt.count()).toBe(0);
    expect(await prisma.inventoryBatch.count({ where: { account: { productId } } })).toBe(0);
    expect(await prisma.inventoryAccount.count({ where: { productId } })).toBe(0);

    const resolve = (exceptionId: string) => record({
      requestId: `resolve-${exceptionId}`, kind: 'resolve_exception', exceptionId,
      description: '已与承运方核实合成异常处理结果', ...evidence(`resolve-${exceptionId}`),
    });
    expect(await resolve(first.id)).toMatchObject({ status: 'exception' });
    expect((await findEvent(first.id)).status).toBe('resolved');
    expect((await findEvent(second.id)).status).toBe('awaiting_resolution');
    expect(await resolve(second.id)).toMatchObject({ status: 'in_transit' });
    expect((await findEvent(second.id)).status).toBe('resolved');
    expect(await send(secondReport)).toEqual({ id: second.id, status: 'resolved' });

    expect(await record({ ...receipt, ...evidence('actual-warehouse-receipt-after-resolution') })).toMatchObject({
      status: 'delivered', lines: [{ receivedQuantity: 1 }],
    });
    expect(await prisma.fulfillmentReceipt.findFirstOrThrow({ where: { parcelLineId: lineId } })).toMatchObject({ quantity: 1 });
    expect(await prisma.inventoryAccount.findFirstOrThrow({ where: { productId } })).toMatchObject({ actualQuantity: 1 });
    expect(await prisma.shipment.count({ where: { orderId: purchase.orderId } })).toBe(0);
    expect(await prisma.accountReceivable.findUniqueOrThrow({ where: { orderId: purchase.orderId } })).toMatchObject({ status: 'open', paidAt: null });
  });
});
