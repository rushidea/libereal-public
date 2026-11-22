import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as orderGET, PATCH as orderPATCH } from '@/app/api/admin/orders/[id]/route';
import { dispatchParcel, fulfillmentWorkspace, recordParcelEvent } from '@/lib/fulfillment-parcels';
import { receiveInventoryBatch } from '@/lib/inventory';
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
type DispatchLine = { purchaseOrderId: string; orderItemId: string; quantity: number; sourceReceiptId?: string };
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

async function purchaseAction(purchaseOrderId: string, action: PurchaseAction) {
  return prisma.$transaction(async tx => {
    const current = (await purchaseWorkspace(tx, orderId)).orders.find(purchase => purchase.id === purchaseOrderId);
    if (!current) throw new Error('Missing synthetic purchase order');
    const input = { ...action, orderId, purchaseOrderId, version: current.version };
    const preview = await previewPurchaseAction(tx, input, approver);
    return applyPurchaseAction(tx, { ...input, actionHash: preview.actionHash }, approver);
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

function event(parcelId: string, input: ReturnType<typeof eventInput>) {
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
