import { customerLineReturnableAt, syncCustomerParcelDelivery } from '@/lib/fulfillment-accounting';
import { disposeProcurementBatch, receiveProcurementBatch } from '@/lib/inventory';
import { fulfillmentStatus, isInactiveOrderStatus } from '@/lib/order-domain';
import { purchaseWorkspace } from '@/lib/purchase-orders';
import { documentSha256, PurchaseError, requiredText } from '@/lib/purchase-terms';
import { availableReceipt, confirmPreview, inputObject, optionalText, parcelInclude, parcelKeys, parcelLineBalance, parcelProgress,
  positiveQuantity, shipmentEvidence, verifyRepeat, type FulfillmentActor, type FulfillmentDb as Db, type FulfillmentParcelRecord } from '@/lib/fulfillment-records';
import { receiptInventoryOptions, selectReceiptInventory } from '@/lib/fulfillment-stock';

const kinds = ['warehouse_receipt','customer_delivery','tracking','exception','resolve_exception','confirm_shortfall','dispose_receipt'] as const;
type EventKind = typeof kinds[number];

function eventInput(raw: unknown) {
  const input = inputObject(raw);
  if (!kinds.includes(input.kind as EventKind)) throw new PurchaseError('请选择物流办理事项', 400);
  const kind = input.kind as EventKind;
  const hasLines = kind === 'warehouse_receipt' || kind === 'customer_delivery' || kind === 'confirm_shortfall';
  const requested = input.lines ?? [];
  if (!Array.isArray(requested) || hasLines !== Boolean(requested.length)) throw new PurchaseError('请逐行确认本次实际数量', 400);
  const lines = requested.map(value => {
    const row = inputObject(value);
    const base = { parcelLineId: requiredText(row.parcelLineId, '包裹行'), quantity: positiveQuantity(row.quantity, '实际数量'),
      batchNumber: optionalText(row.batchNumber,'实收批号'), productId: optionalText(row.productId,'实收商品'), variantId: optionalText(row.variantId,'实收规格') };
    return { ...base, inventoryAccountId: optionalText(row.inventoryAccountId, '实际库存账户') ?? undefined,
      identityReference: row.identityReference || undefined, identitySha256: row.identitySha256 || undefined,
      identityDocumentRow: row.identityDocumentRow,
      outcome: kind === 'confirm_shortfall' ? requiredText(row.outcome, '实际短少、丢失或退回的结果') : undefined,
      receiptId: kind === 'confirm_shortfall' ? optionalText(row.receiptId, '原实收批次') : undefined };
  }).sort((a,b) => a.parcelLineId.localeCompare(b.parcelLineId) || (a.batchNumber ?? '').localeCompare(b.batchNumber ?? ''));
  if (new Set(lines.map(row => JSON.stringify([row.parcelLineId, row.batchNumber]))).size !== lines.length) throw new PurchaseError('同一包裹行及批次只需填写一次',400);
  const disposition = kind === 'dispose_receipt' ? {
    receiptId: requiredText(input.receiptId, '待处置的原实收记录'),
    quantity: positiveQuantity(input.quantity, '实际处置数量'),
    outcome: requiredText(input.disposition, '实物处置结果'),
  } : undefined;
  const decisions = kind === 'confirm_shortfall' ? {
    supplier: { reference: requiredText(input.supplierReference, '供应商或责任方书面确认的出处'),
      sha256: documentSha256(input.supplierSha256, '供应商或责任方书证摘要') },
    customer: { reference: requiredText(input.customerReference, '客户书面处理决定的出处'),
      sha256: documentSha256(input.customerSha256, '客户书证摘要') },
  } : undefined;
  return { requestId: requiredText(input.requestId, '操作编号'), kind, lines, disposition, decisions,
    description: requiredText(input.description, '经办结果'), exceptionId: optionalText(input.exceptionId, '待处理异常'), ...shipmentEvidence(input) };
}

function pendingException(parcel: FulfillmentParcelRecord, exceptionId: string | null, occurredAt: number) {
  const open = parcel.events.find(e => e.id === exceptionId && (
    (e.kind === 'exception' && e.status === 'applied') || (e.kind === 'carrier_exception' && e.status === 'awaiting_resolution')));
  if (!open || open.occurredAt.getTime() > occurredAt) throw new PurchaseError('请核对本包裹当前的异常和处理时间');
  return open;
}

function receiptFor(parcel: FulfillmentParcelRecord, receiptId: string, quantity: number, occurredAt: number) {
  const line = parcel.lines.find(row => row.receipts.some(receipt => receipt.id === receiptId));
  const receipt = line?.receipts.find(row => row.id === receiptId);
  const recorded = parcel.events.find(row => row.id === receipt?.eventId);
  if (!line || !receipt || !recorded || recorded.occurredAt.getTime() > occurredAt || quantity > availableReceipt(receipt)) {
    throw new PurchaseError('实收批次仅可处理本订单中尚未转发或处置的数量');
  }
  return { line, receipt, receivedAt: recorded.occurredAt.toISOString() };
}

async function eventPlan(tx: Db, orderId: string, parcelId: string, raw: unknown, actor: FulfillmentActor) {
  const { requestId, ...input } = eventInput(raw);
  const keys = parcelKeys('parcel_event', orderId, requestId, { kind: input.kind, sha: input.sha256, row: input.documentRow }, { orderId, parcelId, ...input });
  const prior = verifyRepeat(await tx.fulfillmentEvent.findMany({ where: { OR: [{ requestKey: keys.requestKey }, { businessKey: keys.businessKey }] } }), keys);
  const parcel = await tx.fulfillmentParcel.findFirst({ where: { id: parcelId, orderId }, include: parcelInclude });
  if (!parcel) throw new PurchaseError('此订单没有该包裹', 404);
  if (prior) return { prior, parcel, snapshot: { orderId, parcelId, requestId, actorId: actor.id, ...input, priorEvent: prior.id } } as const;
  const occurred = Date.parse(input.occurredAt);
  if (parcel.dispatchedAt.getTime() > occurred) throw new PurchaseError('物流结果的发生时间早于实际发货');
  const inbound = parcel.route === 'supplier_to_libereal';
  if ((input.kind === 'warehouse_receipt' && !inbound) || (input.kind === 'customer_delivery' && inbound)) {
    throw new PurchaseError('收货对象与这个包裹的运输路线不同');
  }
  if (parcel.status === 'exception' && ['warehouse_receipt','customer_delivery','exception'].includes(input.kind)) {
    throw new PurchaseError('请先核对并处理包裹的待办异常');
  }
  if (input.kind === 'resolve_exception' || input.kind === 'confirm_shortfall' && input.exceptionId) pendingException(parcel, input.exceptionId, occurred);
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
  let disposal;
  if (input.disposition) {
    const { outcome, receiptId, quantity } = input.disposition;
    if (!inbound || !isInactiveOrderStatus(order.status) || (outcome !== 'released_to_stock' && outcome !== 'returned_to_supplier')) {
      throw new PurchaseError('请选择已取消或关闭订单的实际入仓批次及其处置结果');
    }
    const { receipt, receivedAt } = receiptFor(parcel, receiptId, quantity, occurred);
    disposal = { receiptId, quantity, outcome, available: availableReceipt(receipt), batch: receipt.inventoryBatch, receivedAt } as const;
  }
  const purchasing = input.kind === 'warehouse_receipt' ? await purchaseWorkspace(tx, orderId) : null;
  const remaining = new Map(parcel.lines.map(line => [line.id, parcelLineBalance(line).pending]));
  const selectedIdentities = new Map<string, Awaited<ReturnType<typeof receiptInventoryOptions>>>();
  const resolved = new Set<string>();
  const resolutions = [];
  const lines = [];
  for (const row of input.lines) {
    const line = parcel.lines.find(r => r.id === row.parcelLineId);
    if (!line) throw new PurchaseError('请重新核对本包裹的商品行');
    const balance = parcelLineBalance(line);
    if (input.kind === 'confirm_shortfall') {
      const kind = row.outcome;
      if (resolved.has(line.id) || (kind !== 'shortage' && kind !== 'loss' && kind !== 'return')) throw new PurchaseError('每个包裹行请核对一种实际短失或退回结果');
      resolved.add(line.id);
      if (row.quantity > (kind === 'return' ? balance.received : balance.pending)) throw new PurchaseError('处理数量超过该行实收可退或尚未签收的数量');
      let receipt = null;
      if (inbound && kind === 'return') {
        const chosen = receiptFor(parcel, requiredText(row.receiptId,'实际退回的入仓批次'), row.quantity, occurred);
        if (chosen.line.id !== line.id) throw new PurchaseError('退回批次须对应原包裹行');
        receipt = { id: chosen.receipt.id, batch: chosen.receipt.inventoryBatch, available: availableReceipt(chosen.receipt), receivedAt: chosen.receivedAt };
      } else if (row.receiptId) throw new PurchaseError('只有仓库实际退回时才指定原入仓批次');
      const returnableAt = kind === 'return' && !inbound ? customerLineReturnableAt(parcel,line,occurred) : undefined;
      if (returnableAt !== undefined && row.quantity > returnableAt) throw new PurchaseError('该商品行在实际退回时没有足够的有效签收数量');
      resolutions.push({ parcelLineId: line.id, orderItemId: line.orderItemId, purchaseOrderId: line.purchaseOrderId, kind, quantity: row.quantity,
        previousShipped: balance.shipped, previousReceived: balance.received, returnableAt, receipt });
      continue;
    }
    if (row.quantity > (remaining.get(line.id) ?? 0)) throw new PurchaseError('实际签收数量超过该包裹行尚未签收的数量');
    remaining.set(line.id, remaining.get(line.id)! - row.quantity);
    let identity = null;
    if (inbound) {
      if (!row.batchNumber) throw new PurchaseError('请填写仓库实际接收的批次标识', 400);
      const purchase = purchasing?.orders.find(po => po.id === line.purchaseOrderId);
      const source = purchase?.lines.find(item => item.orderItemId === line.orderItemId)?.source;
      if (!purchase || !source) throw new PurchaseError('请核对原批准的采购商品');
      let options = selectedIdentities.get(line.id);
      if (!options) {
        options = await receiptInventoryOptions(tx, source, purchase.version);
        selectedIdentities.set(line.id, options);
      }
      const knownAccounts = new Set(line.receipts.map(receipt => receipt.inventoryBatch.inventoryAccountId));
      if (knownAccounts.size > 1) throw new PurchaseError('同一包裹行有不同库存归属，请凭原始记录核对');
      identity = selectReceiptInventory(options, { ...row, inventoryAccountId: row.inventoryAccountId ?? null }, [...knownAccounts][0]);
      const first = lines.find(saved => saved.parcelLineId === line.id)?.inventory;
      if (first && (first.productId !== identity.productId || first.variantId !== identity.variantId || first.inventoryAccountId !== identity.inventoryAccountId)) {
        throw new PurchaseError('同一包裹行的多个批号须对应相同的具体库存账户');
      }
    } else if (row.batchNumber || row.productId || row.variantId || row.inventoryAccountId) {
      throw new PurchaseError('客户签收不办理本仓入库',400);
    }
    lines.push({ parcelLineId: line.id, quantity: row.quantity, batchNumber: row.batchNumber, inventory: identity, orderItemId: line.orderItemId,
      productId: identity?.productId ?? null, variantId: identity?.variantId ?? null, purchaseOrderId: line.purchaseOrderId,
      originalHoldAlreadyMoved: purchasing?.fulfillment.parcelLinesWithPriorHoldTransfer.includes(line.id) ?? false,
      catalogNumber: line.catalogNumber, priorReceived: line.receivedQuantity });
  }
  const snapshot = { orderId, orderStatus: order.status, parcelId, route: parcel.route, priorStatus: parcel.status,
    actorId: actor.id, requestId, ...input, disposition: disposal, lines, resolutions };
  return { prior: null, parcel, input, lines, resolutions, disposal, order, keys, snapshot } as const;
}

export async function previewParcelEvent(tx: Db, orderId: string, parcelId: string, input: unknown, actor: FulfillmentActor) {
  return confirmPreview(undefined, (await eventPlan(tx, orderId, parcelId, input, actor)).snapshot);
}

async function reduceCustomerShipment(tx: Db, orderId: string, from: string, changes: { orderItemId: string; quantity: number }[], actor: FulfillmentActor, eventId: string) {
  for (const row of changes) {
    const item = await tx.orderItem.findFirstOrThrow({ where: { id: row.orderItemId, orderId } });
    const remaining = item.shippedQty - row.quantity;
    if (remaining < 0) throw new PurchaseError('确认的短失超出了该行已登记发货数量');
    await tx.orderItem.update({ where: { id: item.id }, data: { shippedQty: remaining, status: remaining > 0 ? 'partially_shipped' : 'confirmed' } });
  }
  if (!['confirmed','partially_shipped','shipped','completed'].includes(from)) return;
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { quantity: true, shippedQty: true } });
  const status = fulfillmentStatus(items);
  await tx.order.update({ where: { id: orderId }, data: {
    ...(from !== status ? { status, statusHistory: { create: { fromStatus: from, toStatus: status, reason: 'shipment_shortfall_confirmed',
      actorId: actor.id, actorEmail: actor.email } } } : {}),
    events: { create: { type: 'shipment_shortfall_confirmed', message: '核实包裹短少或退回，按实际数量继续履约',
      actorId: actor.id, actorEmail: actor.email, metadata: JSON.stringify({ eventId }) } },
  } });
}

export async function recordParcelEvent(tx: Db, orderId: string, parcelId: string, raw: unknown, actor: FulfillmentActor, expectedHash?: string) {
  const plan = await eventPlan(tx, orderId, parcelId, raw, actor);
  if (plan.prior) return plan.parcel;
  confirmPreview(expectedHash, plan.snapshot);
  const { parcel, input, keys, lines, resolutions, disposal } = plan;
  const occurredAt = new Date(input.occurredAt);
  const event = await tx.fulfillmentEvent.create({ data: { parcelId, ...keys, kind: input.kind, source: 'staff', status: 'applied',
    occurredAt, reference: input.reference, evidenceSha256: input.sha256, evidenceRow: input.documentRow, actorId: actor.id,
    details: JSON.stringify({ description: input.description, exceptionId: input.exceptionId, lines, resolutions, disposal,
      decisions: input.decisions, actionHash: expectedHash }) } });
  if (disposal) {
    await disposeProcurementBatch(tx, { receiptId: disposal.receiptId, orderId, quantity: disposal.quantity, disposition: disposal.outcome, actorId: actor.id });
  }
  for (const row of resolutions) {
    await tx.fulfillmentLineResolution.create({ data: { eventId: event.id, parcelLineId: row.parcelLineId, kind: row.kind, quantity: row.quantity } });
    if (row.receipt) await disposeProcurementBatch(tx, { receiptId: row.receipt.id, orderId, quantity: row.quantity, disposition: 'returned_to_supplier', actorId: actor.id });
  }
  if (resolutions.length && parcel.shipmentId) await reduceCustomerShipment(tx, orderId, plan.order.status, resolutions, actor, event.id);
  for (const row of lines) {
    const changed = await tx.fulfillmentParcelLine.updateMany({ where: { id: row.parcelLineId, parcelId,
      receivedQuantity: { lte: parcel.lines.find(line => line.id === row.parcelLineId)!.quantity - row.quantity } },
      data: { receivedQuantity: { increment: row.quantity } } });
    if (changed.count !== 1) throw new PurchaseError('包裹实收数量已发生变化');
    if (row.inventory) {
      const batchId = await receiveProcurementBatch(tx, { orderId, orderItemId: row.orderItemId, productId: row.inventory.productId,
        variantId: row.inventory.variantId, inventoryAccountId: row.inventory.inventoryAccountId,
        batchNumber: row.batchNumber!, quantity: row.quantity, originalHoldAlreadyMoved: row.originalHoldAlreadyMoved, actorId: actor.id });
      await tx.fulfillmentReceipt.create({ data: { eventId: event.id, parcelLineId: row.parcelLineId, inventoryBatchId: batchId, quantity: row.quantity } });
    }
  }
  if ((input.kind === 'resolve_exception' || input.kind === 'confirm_shortfall') && input.exceptionId) {
    const resolved = await tx.fulfillmentEvent.updateMany({ where: { id: input.exceptionId, parcelId,
      OR: [{ kind: 'exception', status: 'applied' }, { kind: 'carrier_exception', status: 'awaiting_resolution' }] }, data: { status: 'resolved' } });
    if (resolved.count !== 1) throw new PurchaseError('该异常已经被处理，请刷新');
  }
  const updated = await tx.fulfillmentParcel.findUniqueOrThrow({ where: { id: parcelId }, include: parcelInclude });
  const status = parcelProgress(updated);
  if (['customer_delivery','confirm_shortfall','resolve_exception'].includes(input.kind)) {
    await syncCustomerParcelDelivery(tx, updated, status, actor);
  }
  return tx.fulfillmentParcel.update({ where: { id: parcelId }, data: { status }, include: parcelInclude });
}
