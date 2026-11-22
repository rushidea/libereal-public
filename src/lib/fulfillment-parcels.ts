import { configuredCarrier, pendingForWaybill, reconcilePendingForParcel } from '@/lib/fulfillment-carrier';
import { fulfillmentStatus, validateShipmentItems } from '@/lib/order-domain';
import { releaseProcurementInventoryHold, shipProcurementBatch } from '@/lib/inventory';
import { purchaseWorkspace } from '@/lib/purchase-orders';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';
import { confirmPreview, inputObject, optionalText, parcelInclude, parcelKeys, positiveQuantity,
  shipmentEvidence, verifyRepeat, type FulfillmentActor, type FulfillmentDb as Db } from '@/lib/fulfillment-records';

export { previewParcelEvent, recordParcelEvent } from '@/lib/fulfillment-events';

const routes = ['supplier_to_customer', 'supplier_to_libereal', 'libereal_to_customer'] as const;
type Route = typeof routes[number];
type Goods = { purchaseOrderId: string; orderItemId: string; quantity: number; sourceReceiptId: string | null };
const lineKey = (row: Pick<Goods, 'purchaseOrderId' | 'orderItemId'>) => JSON.stringify([row.purchaseOrderId, row.orderItemId]);

function dispatchInput(raw: unknown) {
  const input = inputObject(raw);
  if (!routes.includes(input.route as Route)) throw new PurchaseError('请选择包裹的实际发出地和目的地', 400);
  const route = input.route as Route;
  if (!Array.isArray(input.lines) || !input.lines.length) throw new PurchaseError('至少选择一条实际发货明细', 400);
  const lines = input.lines.map(entry => {
    const row = inputObject(entry);
    const sourceReceiptId = optionalText(row.sourceReceiptId, '采购实收批次');
    if ((route === 'libereal_to_customer') !== Boolean(sourceReceiptId)) throw new PurchaseError('本仓转发须选用实际收到的批次', 400);
    return { purchaseOrderId: requiredText(row.purchaseOrderId, '采购单'), orderItemId: requiredText(row.orderItemId, '订单行'),
      quantity: positiveQuantity(row.quantity, '发货数量'), sourceReceiptId };
  }).sort((a,b) => lineKey(a).localeCompare(lineKey(b)) || (a.sourceReceiptId ?? '').localeCompare(b.sourceReceiptId ?? ''));
  if (new Set(lines.map(row => JSON.stringify([lineKey(row), row.sourceReceiptId]))).size !== lines.length) {
    throw new PurchaseError('请合并同一采购行、同一来源批次的数量', 400);
  }
  const carrier = optionalText(input.carrier, '承运方');
  const trackingNumber = optionalText(input.trackingNumber, '运单号');
  if (Boolean(carrier) !== Boolean(trackingNumber)) throw new PurchaseError('承运方和运单号须一起填写；当面交接请记录实际签单', 400);
  const feedSource = optionalText(input.feedSource, '物流信息来源');
  if (feedSource && (!trackingNumber || feedSource !== configuredCarrier()?.source)) {
    throw new PurchaseError('该物流信息来源尚未配置或缺少运单号', 400);
  }
  return { requestId: requiredText(input.requestId, '操作编号'), route, lines, carrier, trackingNumber, feedSource, ...shipmentEvidence(input) };
}

export async function fulfillmentWorkspace(tx: Db, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, email: true,
    addressSnapshot: { select: { name: true, address: true, phone: true, institution: true } },
    orderItems: { select: { id: true, name: true, quantity: true, shippedQty: true }, orderBy: { position: 'asc' } } } });
  if (!order) throw new PurchaseError('未找到原客户订单', 404);
  const purchasing = await purchaseWorkspace(tx, orderId);
  const parcels = await tx.fulfillmentParcel.findMany({ where: { orderId }, include: parcelInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const dispatched = new Map<string, number>();
  const add = (row: { purchaseOrderId: string; orderItemId: string; quantity: number }) => {
    const key = lineKey(row); dispatched.set(key, (dispatched.get(key) ?? 0) + row.quantity);
  };
  for (const row of purchasing.fulfillment.historicalDelivered) add(row);
  for (const parcel of parcels) if (parcel.route.startsWith('supplier_to_')) {
    for (const line of parcel.lines) if (line.purchaseOrderId) add({ ...line, purchaseOrderId: line.purchaseOrderId });
  }
  const purchases = purchasing.orders.flatMap(po => {
    const receipt = po.orderReceipt;
    if (!receipt?.occurredAt || po.openIncidentId || po.status === 'on_hold' || po.commitmentState === 'supplier_cancelled') return [];
    return receipt.lines.flatMap(ordered => {
      const line = po.lines.find(row => row.orderItemId === ordered.orderItemId);
      if (!line) return [];
      const remaining = po.remaining.find(row => row.orderItemId === line.orderItemId)?.quantity ?? 0;
      const available = Math.max(0, Math.min(ordered.quantity, remaining) - (dispatched.get(lineKey({ purchaseOrderId: po.id, orderItemId: line.orderItemId })) ?? 0));
      return [{ purchaseOrderId: po.id, orderItemId: line.orderItemId, name: line.source.name, supplier: line.terms.supplier ?? '',
        catalogNumber: line.source.catalogNumber, productId: line.source.productId, variantId: line.source.variantId,
        orderedAt: receipt.occurredAt!, available, contractVersion: po.version }];
    });
  });
  const receipts = parcels.flatMap(parcel => parcel.route !== 'supplier_to_libereal' || parcel.status === 'exception' ? [] : parcel.lines.flatMap(line =>
    line.receipts.filter(r => r.forwardedQuantity < r.quantity).map(r => ({ id: r.id, purchaseOrderId: line.purchaseOrderId,
      orderItemId: line.orderItemId, batchNumber: r.inventoryBatch.batchNumber, available: r.quantity - r.forwardedQuantity,
      receivedAt: parcel.events.find(event => event.id === r.eventId)?.occurredAt.toISOString() ?? null }))));
  const legacyShipments = await tx.shipment.findMany({ where: { orderId, fulfillmentParcel: null, shippedAt: { not: null } },
    select: { id: true, shippedAt: true, status: true, carrier: true, trackingNumber: true, deliveredAt: true, items: { select: { id: true, orderItemId: true, quantity: true } } },
    orderBy: { shippedAt: 'asc' } });
  const unmatched = [];
  const waybills = new Set<string>();
  for (const parcel of parcels) {
    if (!parcel.feedSource || !parcel.carrier || !parcel.trackingNumber) continue;
    const key = JSON.stringify([parcel.feedSource, parcel.carrier, parcel.trackingNumber]);
    if (waybills.has(key)) continue;
    waybills.add(key);
    const notices = await pendingForWaybill(tx, parcel.feedSource, parcel.carrier, parcel.trackingNumber);
    for (const notice of notices) unmatched.push({ id: notice.id, source: notice.source, kind: notice.kind, occurredAt: notice.occurredAt,
      carrier: parcel.carrier, trackingNumber: parcel.trackingNumber, reference: notice.reference });
  }
  return { order, purchases, parcels, receipts, legacyShipments, unmatched, feedSource: configuredCarrier()?.source ?? null };
}

async function dispatchPlan(tx: Db, orderId: string, raw: unknown, actor: FulfillmentActor) {
  const { requestId, ...input } = dispatchInput(raw);
  const keys = parcelKeys('dispatch_parcel', orderId, requestId, { sha256: input.sha256, row: input.documentRow }, { orderId, ...input });
  const previous = verifyRepeat(await tx.fulfillmentParcel.findMany({ where: { OR: [{ requestKey: keys.requestKey }, { businessKey: keys.businessKey }] }, include: parcelInclude }), keys);
  if (previous) return { previous, snapshot: { orderId, actorId: actor.id, requestId, ...input, priorParcel: previous.id } } as const;
  if (input.trackingNumber && await tx.fulfillmentParcel.count({ where: { orderId, route: input.route, carrier: input.carrier, trackingNumber: input.trackingNumber } })) {
    throw new PurchaseError('本单同一运输路线已经登记该运单，请核对原包裹');
  }
  const view = await fulfillmentWorkspace(tx, orderId);
  if (!['confirmed','partially_shipped'].includes(view.order.status)) throw new PurchaseError('当前订单不能登记新的发货，请核对原接单和履约状态');
  const lines = input.lines.map(row => {
    const purchased = view.purchases.find(line => line.purchaseOrderId === row.purchaseOrderId && line.orderItemId === row.orderItemId);
    if (!purchased || purchased.orderedAt > input.occurredAt) throw new PurchaseError('请核对该订单行在发货当时已经生效的供应商订购');
    const receipt = row.sourceReceiptId ? view.receipts.find(r => r.id === row.sourceReceiptId && r.purchaseOrderId === row.purchaseOrderId && r.orderItemId === row.orderItemId) : null;
    if (row.sourceReceiptId && (!receipt?.receivedAt || receipt.receivedAt > input.occurredAt)) throw new PurchaseError('须先核实本单此采购行实际收到的批次和时间');
    if (row.quantity > (receipt?.available ?? purchased.available)) throw new PurchaseError('发货数量超过该采购行或实收批次可用数量');
    return { ...row, catalogNumber: purchased.catalogNumber, productId: purchased.productId, variantId: purchased.variantId,
      supplier: purchased.supplier, name: purchased.name, contractVersion: purchased.contractVersion, batchNumber: receipt?.batchNumber ?? null };
  });
  if (input.route !== 'libereal_to_customer' && new Set(lines.map(line => line.supplier)).size !== 1) {
    throw new PurchaseError('不同供应商实际发出的货物须分别登记包裹');
  }
  const unforwarded = new Map<string, number>();
  if (input.route !== 'libereal_to_customer') {
    for (const parcel of view.parcels) {
      if (parcel.route !== 'supplier_to_libereal') continue;
      for (const row of parcel.lines) {
        const forwarded = row.receipts.reduce((sum, receipt) => sum + receipt.forwardedQuantity, 0);
        unforwarded.set(row.orderItemId, (unforwarded.get(row.orderItemId) ?? 0) + row.quantity - forwarded);
      }
    }
  }
  const byCustomerLine = validateShipmentItems(view.order.orderItems.map(item => ({
    ...item, shippedQty: item.shippedQty + (unforwarded.get(item.id) ?? 0),
  })), lines);
  const recipient = input.route === 'supplier_to_libereal' ? { party: 'Libereal' }
    : { party: 'customer', email: view.order.email, deliveryAddress: view.order.addressSnapshot };
  const snapshot = { orderId, actorId: actor.id, requestId, ...input, recipient, lines };
  return { previous: null, snapshot, input, keys, lines, order: view.order, byCustomerLine } as const;
}

export async function previewDispatchParcel(tx: Db, orderId: string, input: unknown, actor: FulfillmentActor) {
  const plan = await dispatchPlan(tx, orderId, input, actor);
  return confirmPreview(undefined, plan.snapshot);
}

export async function dispatchParcel(tx: Db, orderId: string, raw: unknown, actor: FulfillmentActor, expectedHash?: string) {
  const plan = await dispatchPlan(tx, orderId, raw, actor);
  if (plan.previous) return plan.previous;
  confirmPreview(expectedHash, plan.snapshot);
  const { input, lines, order, keys, byCustomerLine } = plan;
  const occurred = new Date(input.occurredAt);
  let shipmentId: string | null = null;
  if (input.route !== 'supplier_to_libereal') {
    const shipment = await tx.shipment.create({ data: { orderId, status: 'shipped', method: input.trackingNumber ? 'logistics' : 'dedicated_delivery',
      carrier: input.carrier, trackingNumber: input.trackingNumber, shippedAt: occurred, createdBy: actor.id, items: { create: byCustomerLine } } });
    shipmentId = shipment.id;
    for (const line of lines) {
      if (line.sourceReceiptId) await shipProcurementBatch(tx, line.sourceReceiptId, orderId, line.quantity, actor.id);
      else await releaseProcurementInventoryHold(tx, orderId, line.orderItemId, line.quantity, actor.id);
    }
    for (const row of byCustomerLine) {
      const item = order.orderItems.find(x => x.id === row.orderItemId)!;
      const shippedQty = item.shippedQty + row.quantity;
      const changed = await tx.orderItem.updateMany({ where: { id: item.id, orderId, shippedQty: item.shippedQty },
        data: { shippedQty, status: shippedQty === item.quantity ? 'shipped' : 'partially_shipped' } });
      if (changed.count !== 1) throw new PurchaseError('该行已由其他人员更新，请刷新');
    }
    const newItems = await tx.orderItem.findMany({ where: { orderId }, select: { quantity: true, shippedQty: true } });
    const status = fulfillmentStatus(newItems);
    const updated = await tx.order.update({ where: { id: orderId }, data: { status,
      ...(status !== order.status ? { statusHistory: { create: { fromStatus: order.status, toStatus: status, actorId: actor.id, actorEmail: actor.email, reason: 'shipment_created' } } } : {}),
      events: { create: { type: 'shipment_created', actorId: actor.id, actorEmail: actor.email, message: '已登记实际发往客户的包裹',
        metadata: JSON.stringify({ shipmentId, route: input.route, items: byCustomerLine }) } } }, select: { email: true } });
    await tx.notification.create({ data: { role: 'customer', email: updated.email, type: 'shipping_notification', title: '订单已发货',
      content: input.trackingNumber ? [input.carrier, input.trackingNumber].join(' · ') : '商品已交付运送', linkUrl: '/account/orders/'+orderId,
      metadata: JSON.stringify({ orderId, shipmentId }) } });
  }
  const parcel = await tx.fulfillmentParcel.create({ data: { orderId, shipmentId, route: input.route, carrier: input.carrier, trackingNumber: input.trackingNumber,
    feedSource: input.feedSource, status: 'dispatched', dispatchedAt: occurred, reference: input.reference, evidenceSha256: input.sha256,
    evidenceRow: input.documentRow, ...keys, actorId: actor.id,
    events: { create: { ...parcelKeys('dispatch_evidence', orderId, plan.snapshot.requestId, { parcel: keys.businessKey }, plan.snapshot),
      source: 'staff', kind: 'dispatch', status: 'applied', occurredAt: occurred, reference: input.reference,
      evidenceSha256: input.sha256, evidenceRow: input.documentRow, actorId: actor.id, details: JSON.stringify(plan.snapshot) } }, lines: { create: lines.map(r => ({ purchaseOrderId: r.purchaseOrderId,
      orderItemId: r.orderItemId, quantity: r.quantity, sourceReceiptId: r.sourceReceiptId, productId: r.productId,
      variantId: r.variantId, catalogNumber: r.catalogNumber })) } }, include: parcelInclude });
  await reconcilePendingForParcel(tx, parcel);
  return tx.fulfillmentParcel.findUniqueOrThrow({ where: { id: parcel.id }, include: parcelInclude });
}
