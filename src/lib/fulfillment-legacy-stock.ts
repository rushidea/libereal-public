import { releaseProcurementInventoryHold, shipOrderInventory } from '@/lib/inventory';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';
import { confirmPreview, inputObject, optionalText, parcelInclude, parcelKeys, positiveQuantity, shipmentEvidence, verifyRepeat,
  type FulfillmentActor, type FulfillmentDb as Db, type FulfillmentParcelRecord } from '@/lib/fulfillment-records';

type StockAllocation = { transactionId: string; shipmentItemId: string; quantity: number };

async function originalStockEvidence(tx: Db, orderId: string, archived: FulfillmentParcelRecord[]) {
  const transactions = await tx.inventoryTransaction.findMany({ where: { orderId, type: 'ship',
    reason: { not: '凭历史发货和库存书证核实出库' }, quantity: { lt: 0 } },
    select: { id: true, reservationId: true, inventoryAccountId: true, batchId: true, quantity: true, actorId: true, type: true, reason: true, createdAt: true } });
  const shipments = await tx.shipmentItem.findMany({ where: { shipment: { orderId, shippedAt: { not: null } } },
    select: { id: true, orderItemId: true, quantity: true, shipment: { select: {
      id: true, shippedAt: true, createdBy: true, method: true, trackingNumber: true, status: true,
    } } } });
  const events = await tx.orderEvent.findMany({ where: { orderId, type: 'shipment_created' },
    select: { id: true, metadata: true, actorId: true, createdAt: true } });
  const reviewed = archived.flatMap(parcel => parcel.events.filter(event => event.kind === 'reconcile_legacy_inventory' && event.status === 'applied')
    .map(event => JSON.parse(event.details) as { parcelLineId: string; quantity: number; hold: { reservationId: string }; allocation?: StockAllocation }));
  const allocations = reviewed.flatMap(row => row.allocation ? [row.allocation] : []);
  const candidates = shipments.flatMap(row => {
    const { shipment } = row;
    if (archived.some(parcel => parcel.shipmentId === shipment.id) || !shipment.createdBy || !shipment.shippedAt) return [];
    const native = events.filter(event => {
      const detail = jsonObject(event.metadata);
      return detail.shipmentId === shipment.id && detail.method === shipment.method && !detail.route && event.actorId === shipment.createdBy
        && Array.isArray(detail.items) && detail.items.some(item => item?.orderItemId === row.orderItemId && item.quantity === row.quantity);
    });
    return native.length === 1 ? [{ row, event: native[0] }] : [];
  });
  return { transactions, shipments, reviewed, allocations, candidates };
}

export async function pendingLegacyInventory(tx: Db, orderId: string, parcels: FulfillmentParcelRecord[]) {
  const historical = parcels.filter(parcel => parcel.route === 'legacy_customer'
    && parcel.events.some(event => event.kind === 'backfill_legacy'));
  if (!historical.length) return [];
  const holds = await tx.inventoryReservation.findMany({ where: { orderId, status: 'active' }, include: {
    batchAllocations: { include: { batch: { select: { batchNumber: true } } } },
  } });
  if (!holds.length) return [];
  const evidence = await originalStockEvidence(tx, orderId, historical);
  const allocations = [...evidence.allocations];
  const assigned = (id: string, key: 'transactionId' | 'shipmentItemId') =>
    allocations.filter(row => row[key] === id).reduce((sum,row) => sum+row.quantity,0);
  const nativeMatches = evidence.candidates.flatMap(({row,event}) => {
    const hold = holds.find(reservation => reservation.orderItemId === row.orderItemId);
    if (!hold || assigned(row.id,'shipmentItemId')) return [];
    return evidence.transactions.filter(movement => movement.reservationId === hold.id && movement.inventoryAccountId === hold.inventoryAccountId
      && movement.reason === '订单发货扣减库存'
      && movement.actorId === event.actorId && !assigned(movement.id,'transactionId') && -movement.quantity === row.quantity
      && movement.createdAt >= row.shipment.shippedAt! && movement.createdAt <= event.createdAt)
      .map(movement => ({ transactionId: movement.id, shipmentItemId: row.id, quantity: row.quantity, eventId: event.id }));
  });
  const recognized = nativeMatches.filter(match => nativeMatches.filter(row => row.transactionId === match.transactionId).length === 1
    && nativeMatches.filter(row => row.shipmentItemId === match.shipmentItemId).length === 1);
  allocations.push(...recognized);

  return historical.flatMap(parcel => parcel.lines.flatMap(line => {
    const hold = holds.find(row => row.orderItemId === line.orderItemId);
    if (!hold) return [];
    const movementIds = new Set(evidence.transactions.filter(row => row.reservationId === hold.id && row.inventoryAccountId === hold.inventoryAccountId).map(row => row.id));
    const accounted = allocations.filter(row => movementIds.has(row.transactionId));
    const processedHere = evidence.reviewed.filter(row => !row.allocation && row.parcelLineId === line.id)
      .reduce((sum,row) => sum+row.quantity,0);
    const matchingShipment = evidence.shipments.find(row => row.shipment.id === parcel.shipmentId && row.orderItemId === line.orderItemId);
    const alreadyCounted = matchingShipment ? assigned(matchingShipment.id,'shipmentItemId') : 0;
    const processed = evidence.reviewed.filter(row => !row.allocation && row.hold.reservationId === hold.id)
      .reduce((sum,row) => sum+row.quantity,0);
    const remaining = hold.quantity - hold.fulfilledQuantity - hold.releasedQuantity;
    const recordedOutsideReview = Math.max(0, hold.fulfilledQuantity + hold.releasedQuantity - processed
      - accounted.reduce((sum,row) => sum+row.quantity,0));
    const awaitingReview = Math.min(remaining, line.quantity - processedHere - alreadyCounted);
    if (awaitingReview <= 0) return [];
    const available = Math.max(0, Math.min(awaitingReview, line.quantity - processedHere - alreadyCounted - recordedOutsideReview));
    const lots = hold.batchAllocations.map(row => ({ batchId: row.batchId, batchNumber: row.batch.batchNumber,
      quantity: row.quantity - row.fulfilledQuantity - row.releasedQuantity })).filter(row => row.quantity > 0);
    const noBatch = Math.max(0, remaining - lots.reduce((sum, row) => sum + row.quantity, 0));
    const oldMovements = evidence.transactions.filter(row => movementIds.has(row.id)).map(row => ({
      ...row, available: -row.quantity - assigned(row.id,'transactionId'),
    })).filter(row => row.available > 0);
    const shipmentItems = evidence.shipments.filter(row => row.orderItemId === line.orderItemId && ['shipped','delivered','completed'].includes(row.shipment.status))
      .map(row => ({
        id: row.id, shipmentId: row.shipment.id, trackingNumber: row.shipment.trackingNumber, shippedAt: row.shipment.shippedAt,
        available: row.quantity - assigned(row.id,'shipmentItemId') - evidence.reviewed.filter(event => !event.allocation && historical
          .some(p => p.shipmentId === row.shipment.id && p.lines.some(item => item.id === event.parcelLineId && item.orderItemId === row.orderItemId)))
          .reduce((sum,event) => sum+event.quantity,0),
      })).filter(row => row.available > 0);
    return [{ parcelId: parcel.id, parcelLineId: line.id, orderItemId: line.orderItemId, reservationId: hold.id,
      accountId: hold.inventoryAccountId, held: hold.quantity, fulfilled: hold.fulfilledQuantity, released: hold.releasedQuantity,
      available, awaitingReview, recordedOutsideReview, lots, noBatch, oldMovements, shipmentItems,
      recognized: recognized.filter(row => movementIds.has(row.transactionId)) }];
  }));
}

export async function reviewLegacyInventory(tx: Db, orderId: string, raw: unknown, actor: FulfillmentActor, approved?: string) {
  const input = inputObject(raw);
  const parcelId = requiredText(input.parcelId, '旧运单关联包裹');
  const parcelLineId = requiredText(input.parcelLineId, '原包裹商品行');
  const requestId = requiredText(input.requestId, '操作编号');
  const quantity = positiveQuantity(input.quantity, '核对数量');
  const description = requiredText(input.description, '原库存凭据与实际发货来源的核对结果');
  const outcome = input.outcome;
  const batchId = optionalText(input.batchId, '实际库存批次');
  if (outcome !== 'warehouse_stock_shipped' && outcome !== 'external_supply_release' && outcome !== 'allocate_recorded_movement') {
    throw new PurchaseError('请选择经书证核实的实际发货来源');
  }
  if (outcome !== 'warehouse_stock_shipped' && batchId) throw new PurchaseError('仅实际本仓出库核对库存批次');
  const allocation = outcome === 'allocate_recorded_movement' ? {
    transactionId: requiredText(input.inventoryTransactionId,'原库存出库流水'),
    shipmentItemId: requiredText(input.shipmentItemId,'原运单商品行'), quantity,
  } : undefined;
  const evidence = shipmentEvidence(input);
  const content = { orderId, parcelId, parcelLineId, quantity, outcome, batchId, description, allocation, ...evidence };
  const keys = parcelKeys('legacy_inventory_review', orderId, requestId, { sha: evidence.sha256, row: evidence.documentRow }, content);
  const prior = verifyRepeat(await tx.fulfillmentEvent.findMany({ where: { OR: [{ requestKey: keys.requestKey }, { businessKey: keys.businessKey }] } }), keys);
  if (prior) return confirmPreview(undefined, { ...content, priorEvent: prior.id });
  const parcels = await tx.fulfillmentParcel.findMany({ where: { orderId, route: 'legacy_customer' }, include: parcelInclude });
  const parcel = parcels.find(row => row.id === parcelId);
  if (!parcel || Date.parse(evidence.occurredAt) < parcel.dispatchedAt.getTime()) throw new PurchaseError('请核对原运单及原预占的实际凭据');
  const hold = (await pendingLegacyInventory(tx, orderId, parcels)).find(row => row.parcelLineId === parcelLineId && row.parcelId === parcel.id);
  if (!hold) throw new PurchaseError('处理数量超过该行尚未核对的原库存预留');
  if (allocation) {
    const movement = hold.oldMovements.find(row => row.id === allocation.transactionId);
    const shipment = hold.shipmentItems.find(row => row.id === allocation.shipmentItemId);
    if (!movement || !shipment || quantity > Math.min(movement.available, shipment.available, hold.recordedOutsideReview)) {
      throw new PurchaseError('同一库存流水和原运单行不得重复归属或超过原数量');
    }
    if (Date.parse(evidence.occurredAt) < Math.max(movement.createdAt.getTime(), shipment.shippedAt?.getTime() ?? Infinity)) {
      throw new PurchaseError('归属书证时间须晚于原出库及原发货');
    }
  } else if (quantity > hold.available) throw new PurchaseError('处理数量超过该行尚未核对的原库存预留');
  const availableStock = batchId ? hold.lots.find(lot => lot.batchId === batchId)?.quantity ?? 0 : hold.noBatch;
  if (outcome === 'warehouse_stock_shipped' && quantity > availableStock) throw new PurchaseError('实际出库须对应该订单原预占的具体库存批次及数量');
  const recorded = await tx.inventoryTransaction.findMany({ where: { orderId, reservationId: hold.reservationId },
    select: { id: true, type: true, quantity: true, batchId: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const snapshot = { ...content, requestId, actorId: actor.id, hold, shipmentId: parcel.shipmentId, recorded };
  const preview = confirmPreview(approved, snapshot);
  if (approved === undefined) return preview;
  if (outcome === 'warehouse_stock_shipped') {
    await shipOrderInventory(tx, orderId, hold.orderItemId, quantity, actor.id, { batchId, reason: '凭历史发货和库存书证核实出库' });
  } else if (outcome === 'external_supply_release') {
    await releaseProcurementInventoryHold(tx, orderId, hold.orderItemId, quantity, actor.id);
  }
  await tx.fulfillmentEvent.create({ data: { ...keys, parcelId, kind: 'reconcile_legacy_inventory', status: 'applied', source: 'staff',
    actorId: actor.id, occurredAt: new Date(evidence.occurredAt), reference: evidence.reference, evidenceSha256: evidence.sha256,
    evidenceRow: evidence.documentRow, details: JSON.stringify({ ...snapshot, actionHash: approved }) } });
  return preview;
}
