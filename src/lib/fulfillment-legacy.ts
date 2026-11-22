import type { Prisma } from '@prisma/client';
import { orderItemView } from '@/lib/commerce-records';
import { fulfillmentStatus } from '@/lib/order-domain';
import { confirmedCustomerDelivery, customerShipmentRows } from '@/lib/fulfillment-accounting';
import { purchaseOperation, readPurchaseActivities } from '@/lib/purchase-activity';
import { purchaseWorkspace } from '@/lib/purchase-orders';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';
import { confirmPreview, inputObject, optionalText, parcelKeys, positiveQuantity, shipmentEvidence, verifyRepeat,
  type FulfillmentActor, type FulfillmentDb as Db } from '@/lib/fulfillment-records';

export const customerShipmentFields = {
  id: true, method: true, status: true, carrier: true, trackingNumber: true, pickupPoint: true, contactName: true,
  contactPhone: true, shippedAt: true, deliveredAt: true, fulfillmentParcel: { select: { status: true } }, items: { select: { orderItemId: true, quantity: true } },
} satisfies Prisma.ShipmentSelect;

export async function requirePhysicalStatus(tx: Db, orderId: string, from: string, to: unknown) {
  if (from === to || !['shipped','partially_shipped','completed'].includes(String(to))) return;
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, quantity: true, shippedQty: true } });
  const shipments = await customerShipmentRows(tx, orderId);
  if (!items.length || items.some(item => shipments.filter(row => row.orderItemId === item.id)
    .reduce((sum, row) => sum + row.effectiveQuantity, 0) !== item.shippedQty)) {
    throw new Error('FULFILLMENT_RECORDS_REQUIRED');
  }
  if (to === 'completed') {
    if (fulfillmentStatus(items) !== 'shipped' || !await confirmedCustomerDelivery(tx, orderId)) throw new Error('FULFILLMENT_RECORDS_REQUIRED');
  } else if (fulfillmentStatus(items) !== to) throw new Error('FULFILLMENT_RECORDS_REQUIRED');
}

export async function ensureLocalStockShipment(tx: Db, orderId: string, requested: { orderItemId: string; quantity: number }[]) {
  if (!await tx.purchaseOrder.count({ where: { orderId } })) return;
  const view = await purchaseWorkspace(tx, orderId);
  for (const row of requested) {
    const open = view.orders.reduce((sum, purchase) => {
      if (purchase.status === 'superseded' || purchase.commitmentState === 'supplier_cancelled' || (!purchase.approvedHash && !purchase.orderReceipt)) return sum;
      const ordered = purchase.remaining.find(line => line.orderItemId === row.orderItemId)?.quantity ?? 0;
      const sent = view.fulfillment.delivered.filter(line => line.purchaseOrderId === purchase.id && line.orderItemId === row.orderItemId)
        .reduce((count, line) => count + line.quantity, 0);
      const outboundLoss = view.fulfillment.forwardingShortfalls.filter(line => line.purchaseOrderId === purchase.id && line.orderItemId === row.orderItemId)
        .reduce((count, line) => count + line.quantity, 0);
      return sum + Math.max(0, ordered - sent - outboundLoss);
    }, 0);
    const item = await tx.orderItem.findFirstOrThrow({ where: { orderId, id: row.orderItemId }, select: { quantity: true, shippedQty: true } });
    if (open + row.quantity > item.quantity - item.shippedQty) throw new Error('PROCUREMENT_FULFILLMENT_REQUIRED');
  }
}

export async function historicalShipmentWorkspace(tx: Db, orderId: string) {
  const history = await tx.orderStatusHistory.findMany({ where: { orderId, toStatus: { in: ['partially_shipped','shipped','completed'] },
    reason: { notIn: ['shipment_created','customer_delivery_confirmed','shipment_shortfall_confirmed'] } },
    select: { id: true, createdAt: true, fromStatus: true, toStatus: true, actorId: true }, orderBy: { createdAt: 'asc' } });
  const entries = history.filter(row => row.actorId && row.fromStatus && row.fromStatus !== row.toStatus);
  if (!entries.length) return { history: [], lines: [] };
  const shipments = await customerShipmentRows(tx, orderId);
  const items = await tx.orderItem.findMany({ where: { orderId }, orderBy: { position: 'asc' } });
  const lines = items.flatMap(item => {
    const recorded = shipments.filter(row => row.orderItemId === item.id).reduce((sum, row) => sum + row.effectiveQuantity, 0);
    return recorded < item.quantity ? [{ orderItemId: item.id, name: item.name, catalogNumber: item.catalogNumber,
      shippedQty: item.shippedQty, recorded, available: item.quantity - recorded,
      productId: item.productId, variantId: orderItemView(item).variantId }] : [];
  });
  return { history: entries, lines };
}

async function backfillLegacyShipment(tx: Db, orderId: string, input: Record<string, unknown>, actor: FulfillmentActor, approved?: string) {
  const requestId = requiredText(input.requestId, '操作编号');
  const historyId = requiredText(input.historyId, '原订单发货状态记录');
  const evidence = shipmentEvidence(input);
  const description = requiredText(input.description, '历史运单和实际发货明细的核对结果');
  const carrier = optionalText(input.carrier, '实际承运方');
  const trackingNumber = optionalText(input.trackingNumber, '原运单号');
  if (Boolean(carrier) !== Boolean(trackingNumber)) throw new PurchaseError('承运方和运单号须一起填写');
  if (!Array.isArray(input.lines) || !input.lines.length) throw new PurchaseError('须逐行核对原运单实际发货数量');
  const requested = input.lines.map(value => {
    const line = inputObject(value);
    return { orderItemId: requiredText(line.orderItemId, '原订单商品行'), quantity: positiveQuantity(line.quantity, '历史实际发货数量') };
  }).sort((a,b) => a.orderItemId.localeCompare(b.orderItemId));
  if (new Set(requested.map(row => row.orderItemId)).size !== requested.length) throw new PurchaseError('同一原订单行请合并填写');
  const keys = parcelKeys('legacy_backfill', orderId, requestId, { sha: evidence.sha256, row: evidence.documentRow },
    { orderId, historyId, ...evidence, description, carrier, trackingNumber, requested });
  const prior = verifyRepeat(await tx.fulfillmentParcel.findMany({ where: { OR: [{ requestKey: keys.requestKey }, { businessKey: keys.businessKey }] } }), keys);
  if (prior) return confirmPreview(undefined, { orderId, requestId, historyId, priorParcel: prior.id, ...evidence });
  if (trackingNumber && await tx.shipment.count({ where: { orderId, carrier, trackingNumber } })) {
    throw new PurchaseError('这笔历史运单已存在，请接续原运单');
  }
  const workspace = await historicalShipmentWorkspace(tx, orderId);
  const history = workspace.history.find(row => row.id === historyId);
  if (!history || Date.parse(evidence.occurredAt) > history.createdAt.getTime()) {
    throw new PurchaseError('实际发货须有此前原单和对应运单书证，请核对原发货记录与时间');
  }
  const ledger = await readPurchaseActivities(tx, orderId);
  const shipments = await customerShipmentRows(tx, orderId);
  const historic = ledger.flatMap(row => {
    if (row.action !== 'attribute_purchase_shipment' || shipments.some(shipment => shipment.historicalAttributionId === row.id)) return [];
    const operation = purchaseOperation(row.detail);
    const target = operation.target as { shipmentId?: string | null; orderItemId?: string; quantity?: number } | undefined;
    return target?.shipmentId === null && typeof target.quantity === 'number' ? [{ id: row.id, operation, target, quantity: target.quantity }] : [];
  });
  const lines = requested.map(row => {
    const line = workspace.lines.find(item => item.orderItemId === row.orderItemId);
    if (!line || row.quantity > line.available) throw new PurchaseError('历史运单数量超过原订单尚无凭据的数量');
    const evidenceMatches = historic.filter(entry => entry.target.orderItemId === row.orderItemId && entry.quantity === row.quantity
      && entry.operation.sha256 === evidence.sha256 && entry.operation.documentRow === evidence.documentRow && entry.operation.occurredAt === evidence.occurredAt);
    const historicalAttributionId = evidenceMatches.length === 1 ? evidenceMatches[0].id : undefined;
    const remainingAttributed = historic.filter(entry => entry.target.orderItemId === row.orderItemId && entry.id !== historicalAttributionId)
      .reduce((sum, entry) => sum + entry.quantity, 0);
    const shippedQty = Math.max(line.shippedQty, line.recorded + row.quantity);
    if (remainingAttributed > shippedQty - line.recorded - row.quantity) throw new PurchaseError('已有具名发货归属，请用与原归属一致的凭据和数量接续');
    return { ...line, quantity: row.quantity, priorShippedQty: line.shippedQty, shippedQty, historicalAttributionId };
  });
  const snapshot = { orderId, actorId: actor.id, requestId, history, description, ...evidence, carrier, trackingNumber, lines };
  const preview = confirmPreview(approved, snapshot);
  if (approved === undefined) return preview;
  const shippedAt = new Date(evidence.occurredAt);
  const shipment = await tx.shipment.create({ data: { orderId, carrier, trackingNumber, shippedAt, status: 'shipped',
    method: trackingNumber ? 'logistics' : 'dedicated_delivery', createdBy: actor.id,
    items: { create: lines.map(row => ({ orderItemId: row.orderItemId, quantity: row.quantity })) } } });
  for (const line of lines) {
    const changed = await tx.orderItem.updateMany({ where: { id: line.orderItemId, orderId, shippedQty: line.priorShippedQty },
      data: { shippedQty: line.shippedQty, status: line.shippedQty === line.available + line.recorded ? 'shipped' : 'partially_shipped' } });
    if (changed.count !== 1) throw new PurchaseError('原订单实际发货数量已变化');
  }
  await tx.fulfillmentParcel.create({ data: { orderId, shipmentId: shipment.id, route: 'legacy_customer', status: 'dispatched', dispatchedAt: shippedAt,
    carrier, trackingNumber, reference: evidence.reference, evidenceSha256: evidence.sha256, evidenceRow: evidence.documentRow,
    ...keys, actorId: actor.id, lines: { create: lines.map(line => ({ orderItemId: line.orderItemId, quantity: line.quantity,
      catalogNumber: line.catalogNumber, productId: line.productId, variantId: line.variantId })) },
    events: { create: { ...parcelKeys('legacy_backfill_evidence', orderId, requestId, { parcel: keys.businessKey }, snapshot),
      kind: 'backfill_legacy', source: 'staff', status: 'applied', occurredAt: shippedAt,
      reference: evidence.reference, evidenceSha256: evidence.sha256, evidenceRow: evidence.documentRow, actorId: actor.id,
      details: JSON.stringify({ ...snapshot, actionHash: approved }) } } } });
  return preview;
}

export async function linkLegacyShipment(tx: Db, orderId: string, raw: unknown, actor: FulfillmentActor, approved?: string) {
  const input = inputObject(raw);
  if (!input.shipmentId) return backfillLegacyShipment(tx, orderId, input, actor, approved);
  const shipmentId = requiredText(input.shipmentId, '原发货单');
  const evidence = shipmentEvidence(input);
  const source = await tx.shipment.findFirst({ where: { id: shipmentId, orderId }, include: { items: { include: {
    orderItem: true }, orderBy: { id: 'asc' } } } });
  if (!source?.shippedAt || !source.items.length || !['shipped','delivered','completed'].includes(source.status) ||
    source.items.some(row => row.orderItem.orderId !== orderId || row.quantity <= 0) || source.shippedAt.getTime() > Date.parse(evidence.occurredAt)) {
    throw new PurchaseError('原发货单没有可核对的本单出库时间和商品明细');
  }
  const description = requiredText(input.description,'核对结果');
  const requestId = requiredText(input.requestId,'操作编号');
  const keys = parcelKeys('legacy_shipment',orderId,requestId,{ shipmentId },{ orderId, shipmentId, ...evidence, description });
  const prior = verifyRepeat(await tx.fulfillmentParcel.findMany({ where: { OR: [{ requestKey: keys.requestKey }, { businessKey: keys.businessKey }] } }),keys);
  if (!prior && Boolean(source.deliveredAt) !== ['completed','delivered'].includes(source.status)) throw new PurchaseError('原运单签收状态和时间不一致，请先核对原始凭据');
  const lines = source.items.map(row => ({ orderItemId: row.orderItemId, quantity: row.quantity, name: row.orderItem.name,
    catalogNumber: row.orderItem.catalogNumber, productId: row.orderItem.productId, variantId: orderItemView(row.orderItem).variantId }));
  const snapshot = { orderId, shipmentId, actorId: actor.id, requestId, description, ...evidence, dispatchedAt: source.shippedAt.toISOString(),
    deliveredAt: source.deliveredAt?.toISOString() ?? null, carrier: source.carrier, trackingNumber: source.trackingNumber, lines };
  if (prior) return confirmPreview(undefined,snapshot);
  const preview = confirmPreview(approved,snapshot);
  if (approved === undefined) return preview;
  await tx.fulfillmentParcel.create({ data: { ...keys, orderId, shipmentId, route: 'legacy_customer', status: source.deliveredAt ? 'delivered' : 'dispatched',
    dispatchedAt: source.shippedAt, carrier: source.carrier, trackingNumber: source.trackingNumber, reference: evidence.reference,
    evidenceSha256: evidence.sha256, evidenceRow: evidence.documentRow, actorId: actor.id, lines: { create: lines.map(line => ({
      orderItemId: line.orderItemId, quantity: line.quantity, catalogNumber: line.catalogNumber, productId: line.productId, variantId: line.variantId,
      receivedQuantity: source.deliveredAt ? line.quantity : 0 })) },
    events: { create: { ...parcelKeys('legacy_link',orderId,requestId,{ shipmentId },snapshot), kind: 'link_legacy', source: 'staff',
      status: 'applied', occurredAt: new Date(evidence.occurredAt), reference: evidence.reference, evidenceSha256: evidence.sha256,
      evidenceRow: evidence.documentRow, actorId: actor.id, details: JSON.stringify({ description, shipmentId, oldDelivery: snapshot.deliveredAt }) } } } });
  return preview;
}
