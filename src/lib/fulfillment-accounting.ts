import { dispatchHoldFacts } from '@/lib/fulfillment-holds';
import { parcelLineBalance, parcelProgress, type FulfillmentActor, type FulfillmentDb as Db, type FulfillmentParcelRecord } from '@/lib/fulfillment-records';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { PurchaseError } from '@/lib/purchase-terms';

export function customerLineReceipts(parcel: FulfillmentParcelRecord, line: FulfillmentParcelRecord['lines'][number]) {
  return parcel.events.flatMap(event => {
    if (event.status !== 'applied') return [];
    const detail = jsonObject(event.details);
    if (event.kind === 'link_legacy' && parcel.route === 'legacy_customer' && typeof detail.oldDelivery === 'string') {
      const at = Date.parse(detail.oldDelivery);
      return at >= parcel.dispatchedAt.getTime() && at <= Date.now() ? [{ at, quantity: line.quantity }] : [];
    }
    if (event.kind !== 'customer_delivery' || !Array.isArray(detail.lines) || event.occurredAt < parcel.dispatchedAt) return [];
    return detail.lines.flatMap(row => row?.parcelLineId === line.id && Number.isSafeInteger(row.quantity) && row.quantity > 0
      ? [{ at: event.occurredAt.getTime(), quantity: row.quantity as number }] : []);
  });
}

export function customerLineReturnableAt(parcel: FulfillmentParcelRecord, line: FulfillmentParcelRecord['lines'][number], at: number) {
  const changes = new Map<number,number>();
  for (const receipt of customerLineReceipts(parcel,line)) {
    changes.set(receipt.at,(changes.get(receipt.at) ?? 0)+receipt.quantity);
  }
  for (const resolution of line.resolutions) {
    if (resolution.kind !== 'return') continue;
    const event = parcel.events.find(row => row.id === resolution.eventId && row.status === 'applied');
    if (!event) throw new PurchaseError('退回记录缺少原实际处理凭据');
    const time = event.occurredAt.getTime();
    changes.set(time,(changes.get(time) ?? 0)-resolution.quantity);
  }
  const entries = [...changes].sort(([left],[right]) => left-right);
  let balance = entries.filter(([time]) => time <= at).reduce((sum,[,quantity]) => sum+quantity,0);
  let available = balance;
  for (const [time,quantity] of entries) {
    if (time <= at) continue;
    balance += quantity;
    available = Math.min(available,balance);
  }
  return Math.max(0,available);
}

export async function customerShipmentRows(tx: Db, orderId: string) {
  const rows = await tx.shipmentItem.findMany({
    where: { shipment: { orderId, shippedAt: { not: null }, status: { in: ['shipped','delivered','completed'] } } },
    include: { shipment: { include: { fulfillmentParcel: { select: { route: true,
      events: { where: { kind: {in:['backfill_legacy','dispatch','review_dispatch_hold']} }, select: {kind:true,status:true,details:true,createdAt:true} }, lines: { select: {
      id: true, orderItemId: true, purchaseOrderId: true, quantity: true, receivedQuantity: true, resolutions: true, afterSaleApprovalId: true,
    } } } } } } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  return rows.map(row => {
    const parcel = row.shipment.fulfillmentParcel;
    if (!parcel) return { ...row, effectiveQuantity: row.quantity, received: row.shipment.deliveredAt ? row.quantity : 0,
      sources: [], commercialPending:false, historicalAttributionId: null };
    const lines = parcel.lines.filter(line => !line.afterSaleApprovalId && line.orderItemId === row.orderItemId);
    if (lines.reduce((sum, line) => sum + line.quantity, 0) !== row.quantity) {
      throw new PurchaseError('采购包裹与客户发货行数量不一致，请核对原记录');
    }
    const sources = lines.map(line => ({ ...line, balance: parcelLineBalance(line) }));
    const original=parcel.events.find(row=>row.kind==='backfill_legacy');
    const history = original ? JSON.parse(original.details) as { lines?: { orderItemId: string; historicalAttributionId?: string }[] } : null;
    return { ...row, effectiveQuantity: sources.reduce((sum, source) => sum + source.balance.shipped, 0),
      received: sources.reduce((sum, source) => sum + source.balance.received, 0), sources,
      commercialPending:dispatchHoldFacts(parcel.events).some(hold=>hold.pending>0 && lines.some(line=>line.id===hold.parcelLineId)),
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
    if (row.commercialPending || row.received !== row.effectiveQuantity || shipment.status === 'shipped' || !shipment.shippedAt || !shipment.deliveredAt
      || shipment.deliveredAt < shipment.shippedAt || shipment.deliveredAt.getTime() > Date.now()) return false;
    quantities.set(row.orderItemId, (quantities.get(row.orderItemId) ?? 0) + row.received);
  }
  return items.every(item => quantities.get(item.id) === item.quantity);
}

export async function syncCustomerParcelDelivery(tx: Db, parcel: FulfillmentParcelRecord, status: string, actor?: FulfillmentActor) {
  const { shipmentId, orderId } = parcel;
  if (!shipmentId) return;
  const original = parcel.lines.filter(line => !line.afterSaleApprovalId);
  const mixed = original.length > 0 && original.length < parcel.lines.length;
  const lines = mixed ? original : parcel.lines;
  const progress = mixed ? parcelProgress({ lines, events: parcel.events }) : status;
  if (progress !== 'delivered' && progress !== 'shortfall') return;
  const receipts = lines.map(line => ({ line, evidence: customerLineReceipts(parcel,line) }));
  const lastReceipt = receipts.reduce((last,{evidence}) => evidence.reduce((max,row) => Math.max(max,row.at),last),0);
  const verified = receipts.every(({line,evidence}) => evidence.reduce((sum,row) => sum+row.quantity,0) === line.receivedQuantity);
  if (lastReceipt && verified && lines.some(line => parcelLineBalance(line).received > 0)) {
    await tx.shipment.updateMany({ where: { id: shipmentId, status: 'shipped' },
      data: { status: 'delivered', deliveredAt: new Date(lastReceipt) } });
  }
  if (!(await confirmedCustomerDelivery(tx, orderId))) return;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
  if (order.status === 'shipped') await tx.order.update({ where: { id: orderId }, data: { status: 'completed',
    statusHistory: { create: { fromStatus: 'shipped', toStatus: 'completed', actorId: actor?.id, actorEmail: actor?.email,
      reason: 'customer_delivery_confirmed' } },
    events: { create: { type: 'customer_delivery_confirmed', message: '订单商品均已按实收凭据确认交付',
      actorId: actor?.id, actorEmail: actor?.email, metadata: JSON.stringify({ shipmentId }) } },
  } });
}
