import { receiveProcurementBatch } from '@/lib/inventory';
import { purchaseWorkspace } from '@/lib/purchase-orders';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';
import { confirmPreview, inputObject, optionalText, parcelInclude, parcelKeys, positiveQuantity, shipmentEvidence,
  verifyRepeat, type FulfillmentActor, type FulfillmentDb as Db } from '@/lib/fulfillment-records';

const kinds = ['warehouse_receipt','customer_delivery','tracking','exception','resolve_exception'] as const;
type EventKind = typeof kinds[number];

function eventInput(raw: unknown) {
  const input = inputObject(raw);
  if (!kinds.includes(input.kind as EventKind)) throw new PurchaseError('请选择物流办理事项', 400);
  const kind = input.kind as EventKind;
  const receive = kind === 'warehouse_receipt' || kind === 'customer_delivery';
  const requested = input.lines ?? [];
  if (!Array.isArray(requested) || receive !== Boolean(requested.length)) throw new PurchaseError('签收时须逐行确认本次实际数量', 400);
  const lines = requested.map(value => {
    const row = inputObject(value);
    return { parcelLineId: requiredText(row.parcelLineId, '包裹行'), quantity: positiveQuantity(row.quantity, '实收数量'),
      batchNumber: optionalText(row.batchNumber,'实收批号'), productId: optionalText(row.productId,'实收商品'), variantId: optionalText(row.variantId,'实收规格') };
  }).sort((a,b) => a.parcelLineId.localeCompare(b.parcelLineId) || (a.batchNumber ?? '').localeCompare(b.batchNumber ?? ''));
  if (new Set(lines.map(row => JSON.stringify([row.parcelLineId, row.batchNumber]))).size !== lines.length) throw new PurchaseError('同一包裹行及批次只需填写一次',400);
  return { requestId: requiredText(input.requestId, '操作编号'), kind, lines, description: requiredText(input.description, '经办结果'),
    exceptionId: optionalText(input.exceptionId, '待处理异常'), ...shipmentEvidence(input) };
}

async function inventoryIdentity(tx: Db, line: { orderItemId: string; purchaseOrderId: string | null; productId: string | null; variantId: string | null; catalogNumber: string | null },
  selected: { productId: string | null; variantId: string | null }, orderId: string) {
  const productId = selected.productId ?? line.productId;
  const variantId = selected.variantId ?? line.variantId;
  if (!productId || (line.productId && productId !== line.productId) || (line.productId && variantId !== line.variantId)) {
    throw new PurchaseError('请核实采购所列的实际商品和规格后再入库');
  }
  const product = await tx.product.findUnique({ where: { id: productId }, select: { id: true, brand: true, catalogNumber: true } });
  const variant = variantId ? await tx.productVariant.findUnique({ where: { id: variantId }, select: { productId: true, catalogNumber: true } }) : null;
  if (!product || (variantId && variant?.productId !== product.id)) throw new PurchaseError('实收商品或规格与目录不符');
  if (!line.productId) {
    const current = await purchaseWorkspace(tx, orderId);
    const source = current.orders.find(po => po.id === line.purchaseOrderId)?.lines.find(item => item.orderItemId === line.orderItemId)?.source;
    if (!source?.catalogNumber || source.catalogNumber !== (variant?.catalogNumber ?? product.catalogNumber) || (source.brand && source.brand !== product.brand)) {
      throw new PurchaseError('替代品须对应原批准的品牌、货号和实际目录商品');
    }
  }
  return { productId, variantId };
}

async function eventPlan(tx: Db, orderId: string, parcelId: string, raw: unknown, actor: FulfillmentActor) {
  const { requestId, ...input } = eventInput(raw);
  const keys = parcelKeys('parcel_event', orderId, requestId, { kind: input.kind, sha: input.sha256, row: input.documentRow }, { orderId, parcelId, ...input });
  const prior = verifyRepeat(await tx.fulfillmentEvent.findMany({ where: { OR: [{ requestKey: keys.requestKey }, { businessKey: keys.businessKey }] } }), keys);
  const parcel = await tx.fulfillmentParcel.findFirst({ where: { id: parcelId, orderId }, include: parcelInclude });
  if (!parcel) throw new PurchaseError('此订单没有该包裹', 404);
  if (prior) return { prior, parcel, snapshot: { orderId, parcelId, requestId, actorId: actor.id, ...input, priorEvent: prior.id } } as const;
  if (parcel.dispatchedAt.getTime() > Date.parse(input.occurredAt)) throw new PurchaseError('物流结果的发生时间早于实际发货');
  const inbound = parcel.route === 'supplier_to_libereal';
  if ((input.kind === 'warehouse_receipt' && !inbound) || (input.kind === 'customer_delivery' && inbound)) {
    throw new PurchaseError('收货对象与这个包裹的运输路线不同');
  }
  if (parcel.status === 'exception' && !['tracking','resolve_exception'].includes(input.kind)) throw new PurchaseError('请先核对并处理包裹的待办异常');
  const open = parcel.events.find(e => e.id === input.exceptionId && (
    e.kind === 'exception' && e.status === 'applied' || e.kind === 'carrier_exception' && e.status === 'awaiting_resolution'));
  if (input.kind === 'resolve_exception' && (parcel.status !== 'exception' || !open || input.exceptionId !== open.id || open.occurredAt.getTime() > Date.parse(input.occurredAt))) {
    throw new PurchaseError('请核对本包裹当前的异常和处理时间');
  }
  const remaining = new Map(parcel.lines.map(line => [line.id, line.quantity - line.receivedQuantity]));
  const lines = [];
  for (const row of input.lines) {
    const line = parcel.lines.find(r => r.id === row.parcelLineId);
    if (!line || row.quantity > (remaining.get(line.id) ?? 0)) throw new PurchaseError('实际签收数量超过该包裹行尚未签收的数量');
    remaining.set(line.id, remaining.get(line.id)! - row.quantity);
    const goods = inbound ? await inventoryIdentity(tx, line, row, orderId) : { productId: null, variantId: null };
    if (inbound && !row.batchNumber) throw new PurchaseError('请填写仓库实际接收的批次标识', 400);
    if (!inbound && (row.batchNumber || row.productId || row.variantId)) throw new PurchaseError('客户签收不办理本仓入库',400);
    lines.push({ ...row, ...goods, orderItemId: line.orderItemId, purchaseOrderId: line.purchaseOrderId, catalogNumber: line.catalogNumber, priorReceived: line.receivedQuantity });
  }
  const snapshot = { orderId, parcelId, route: parcel.route, priorStatus: parcel.status, actorId: actor.id, requestId, ...input, lines };
  return { prior: null, parcel, input, lines, keys, snapshot } as const;
}

export async function previewParcelEvent(tx: Db, orderId: string, parcelId: string, input: unknown, actor: FulfillmentActor) {
  return confirmPreview(undefined, (await eventPlan(tx, orderId, parcelId, input, actor)).snapshot);
}

export async function confirmedCustomerDelivery(tx: Db, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, quantity: true } });
  if (!items.length) return false;
  const actual = await tx.shipmentItem.findMany({ where: { shipment: { orderId, status: { in: ['shipped','delivered','completed'] } } },
    select: { orderItemId: true, quantity: true, shipment: { select: { shippedAt: true, deliveredAt: true, status: true } } } });
  const delivered = new Map<string, number>();
  const now = Date.now();
  for (const { orderItemId, quantity, shipment } of actual) {
    if (!items.some(item => item.id === orderItemId) || quantity <= 0 || shipment.status === 'shipped'
      || !shipment.shippedAt || !shipment.deliveredAt || shipment.deliveredAt < shipment.shippedAt || shipment.deliveredAt.getTime() > now) return false;
    delivered.set(orderItemId, (delivered.get(orderItemId) ?? 0) + quantity);
  }
  return items.every(item => delivered.get(item.id) === item.quantity);
}

export async function recordParcelEvent(tx: Db, orderId: string, parcelId: string, raw: unknown, actor: FulfillmentActor, expectedHash?: string) {
  const plan = await eventPlan(tx, orderId, parcelId, raw, actor);
  if (plan.prior) return plan.parcel;
  confirmPreview(expectedHash, plan.snapshot);
  const { parcel, input, keys, lines } = plan;
  const occurredAt = new Date(input.occurredAt);
  const event = await tx.fulfillmentEvent.create({ data: { parcelId, ...keys, kind: input.kind, source: 'staff', status: 'applied',
    occurredAt, reference: input.reference, evidenceSha256: input.sha256, evidenceRow: input.documentRow, actorId: actor.id,
    details: JSON.stringify({ description: input.description, exceptionId: input.exceptionId, lines }) } });
  for (const row of lines) {
    const changed = await tx.fulfillmentParcelLine.updateMany({ where: { id: row.parcelLineId, parcelId,
      receivedQuantity: { lte: parcel.lines.find(line => line.id === row.parcelLineId)!.quantity - row.quantity } },
      data: { receivedQuantity: { increment: row.quantity } } });
    if (changed.count !== 1) throw new PurchaseError('包裹实收数量已发生变化');
    if (input.kind === 'warehouse_receipt') {
      const batchId = await receiveProcurementBatch(tx, { orderId, orderItemId: row.orderItemId, productId: row.productId!,
        variantId: row.variantId, batchNumber: row.batchNumber!, quantity: row.quantity, actorId: actor.id });
      await tx.fulfillmentReceipt.create({ data: { eventId: event.id, parcelLineId: row.parcelLineId, inventoryBatchId: batchId, quantity: row.quantity } });
    }
  }
  const amounts = await tx.fulfillmentParcelLine.findMany({ where: { parcelId }, select: { quantity: true, receivedQuantity: true } });
  const complete = amounts.length > 0 && amounts.every(row => row.receivedQuantity === row.quantity);
  let status = parcel.status;
  if (input.kind === 'exception') status = 'exception';
  else if (input.kind === 'resolve_exception' || input.kind === 'warehouse_receipt' || input.kind === 'customer_delivery') {
    status = complete ? 'delivered' : amounts.some(row => row.receivedQuantity) ? 'partially_received' : 'in_transit';
  } else if (input.kind === 'tracking' && status === 'dispatched') status = 'in_transit';
  if (input.kind === 'resolve_exception') {
    const resolved = await tx.fulfillmentEvent.updateMany({ where: { id: input.exceptionId!, parcelId,
      OR: [{ kind: 'exception', status: 'applied' }, { kind: 'carrier_exception', status: 'awaiting_resolution' }] }, data: { status: 'resolved' } });
    if (resolved.count !== 1) throw new PurchaseError('该异常已经被处理，请刷新');
    const remaining = await tx.fulfillmentEvent.count({ where: { parcelId,
      OR: [{ kind: 'exception', status: 'applied' }, { kind: 'carrier_exception', status: 'awaiting_resolution' }] } });
    if (remaining) status = 'exception';
  }
  if (parcel.shipmentId && complete && input.kind === 'customer_delivery') {
    const deliveryEvents = await tx.fulfillmentEvent.aggregate({ where: { parcelId, kind: 'customer_delivery', status: 'applied' }, _max: { occurredAt: true } });
    await tx.shipment.update({ where: { id: parcel.shipmentId }, data: { status: 'delivered', deliveredAt: deliveryEvents._max.occurredAt ?? occurredAt } });
    if (await confirmedCustomerDelivery(tx, orderId)) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
      if (order.status === 'shipped') await tx.order.update({ where: { id: orderId }, data: { status: 'completed',
        statusHistory: { create: { fromStatus: 'shipped', toStatus: 'completed', actorId: actor.id, actorEmail: actor.email, reason: 'customer_delivery_confirmed' } },
        events: { create: { type: 'customer_delivery_confirmed', message: '订单商品均已按实收凭据确认交付', actorId: actor.id, actorEmail: actor.email,
          metadata: JSON.stringify({ shipmentId: parcel.shipmentId }) } } } });
    }
  }
  return tx.fulfillmentParcel.update({ where: { id: parcelId }, data: { status }, include: parcelInclude });
}
