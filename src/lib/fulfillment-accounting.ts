import { parcelLineBalance, type FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { PurchaseError } from '@/lib/purchase-terms';

export async function customerShipmentRows(tx: Db, orderId: string) {
  const rows = await tx.shipmentItem.findMany({
    where: { shipment: { orderId, shippedAt: { not: null }, status: { in: ['shipped','delivered','completed'] } } },
    include: { shipment: { include: { fulfillmentParcel: { select: { route: true,
      events: { where: { kind: 'backfill_legacy' }, select: { details: true } }, lines: { select: {
      id: true, orderItemId: true, purchaseOrderId: true, quantity: true, receivedQuantity: true, resolutions: true,
    } } } } } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(row => {
    const parcel = row.shipment.fulfillmentParcel;
    if (!parcel) return { ...row, effectiveQuantity: row.quantity, received: row.shipment.deliveredAt ? row.quantity : 0,
      sources: [], historicalAttributionId: null };
    const lines = parcel.lines.filter(line => line.orderItemId === row.orderItemId);
    if (lines.reduce((sum, line) => sum + line.quantity, 0) !== row.quantity) {
      throw new PurchaseError('采购包裹与客户发货行数量不一致，请核对原记录');
    }
    const sources = lines.map(line => ({ ...line, balance: parcelLineBalance(line) }));
    const history = parcel.events[0] ? JSON.parse(parcel.events[0].details) as { lines?: { orderItemId: string; historicalAttributionId?: string }[] } : null;
    return { ...row, effectiveQuantity: sources.reduce((sum, source) => sum + source.balance.shipped, 0),
      received: sources.reduce((sum, source) => sum + source.balance.received, 0), sources,
      historicalAttributionId: history?.lines?.find(line => line.orderItemId === row.orderItemId)?.historicalAttributionId ?? null };
  });
}

export async function confirmedCustomerDelivery(tx: Db, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, quantity: true } });
  if (!items.length) return false;
  const actual = await customerShipmentRows(tx, orderId);
  const quantities = new Map<string, number>();
  for (const row of actual) {
    if (!items.some(item => item.id === row.orderItemId) || row.quantity <= 0) return false;
    if (!row.effectiveQuantity) continue;
    const { shipment } = row;
    if (row.received !== row.effectiveQuantity || shipment.status === 'shipped' || !shipment.shippedAt || !shipment.deliveredAt
      || shipment.deliveredAt < shipment.shippedAt || shipment.deliveredAt.getTime() > Date.now()) return false;
    quantities.set(row.orderItemId, (quantities.get(row.orderItemId) ?? 0) + row.received);
  }
  return items.every(item => quantities.get(item.id) === item.quantity);
}
