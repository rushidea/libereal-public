import type { Prisma } from '@prisma/client';
import { orderItemView } from '@/lib/commerce-records';
import { fulfillmentStatus } from '@/lib/order-domain';
import { confirmedCustomerDelivery } from '@/lib/fulfillment-events';
import { purchaseWorkspace } from '@/lib/purchase-orders';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';
import { confirmPreview, inputObject, parcelKeys, shipmentEvidence, verifyRepeat, type FulfillmentActor, type FulfillmentDb as Db } from '@/lib/fulfillment-records';

export const customerShipmentFields = {
  id: true, method: true, status: true, carrier: true, trackingNumber: true, pickupPoint: true, contactName: true,
  contactPhone: true, shippedAt: true, deliveredAt: true, fulfillmentParcel: { select: { status: true } }, items: { select: { orderItemId: true, quantity: true } },
} satisfies Prisma.ShipmentSelect;

export async function requirePhysicalStatus(tx: Db, orderId: string, from: string, to: unknown) {
  if (from === to || !['shipped','partially_shipped','completed'].includes(String(to))) return;
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, quantity: true, shippedQty: true } });
  const grouped = await tx.shipmentItem.groupBy({ by: ['orderItemId'], where: { shipment: { orderId, shippedAt: { not: null },
    status: { in: ['shipped','delivered','completed'] } } }, _sum: { quantity: true } });
  if (!items.length || items.some(item => (grouped.find(group => group.orderItemId === item.id)?._sum.quantity ?? 0) !== item.shippedQty)) {
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
      return sum + Math.max(0, ordered - sent);
    }, 0);
    const item = await tx.orderItem.findFirstOrThrow({ where: { orderId, id: row.orderItemId }, select: { quantity: true, shippedQty: true } });
    if (open + row.quantity > item.quantity - item.shippedQty) throw new Error('PROCUREMENT_FULFILLMENT_REQUIRED');
  }
}

export async function linkLegacyShipment(tx: Db, orderId: string, raw: unknown, actor: FulfillmentActor, approved?: string) {
  const input = inputObject(raw);
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
