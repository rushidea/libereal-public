import { releaseProcurementInventoryHold, shipOrderInventory } from '@/lib/inventory';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';
import { confirmPreview, inputObject, optionalText, parcelInclude, parcelKeys, positiveQuantity, shipmentEvidence, verifyRepeat,
  type FulfillmentActor, type FulfillmentDb as Db, type FulfillmentParcelRecord } from '@/lib/fulfillment-records';

export async function pendingLegacyInventory(tx: Db, orderId: string, parcels: FulfillmentParcelRecord[]) {
  const historical = parcels.filter(parcel => parcel.route === 'legacy_customer'
    && parcel.events.some(event => event.kind === 'backfill_legacy'));
  if (!historical.length) return [];
  const holds = await tx.inventoryReservation.findMany({ where: { orderId, status: 'active' }, include: {
    batchAllocations: { include: { batch: { select: { batchNumber: true } } } },
  } });
  const confirmed = historical.flatMap(parcel => parcel.events.filter(event => event.kind === 'reconcile_legacy_inventory' && event.status === 'applied')
    .map(event => JSON.parse(event.details) as { parcelLineId: string; quantity: number; hold: { reservationId: string } }));
  return historical.flatMap(parcel => parcel.lines.flatMap(line => {
    const hold = holds.find(row => row.orderItemId === line.orderItemId);
    if (!hold) return [];
    const processed = confirmed.filter(row => row.parcelLineId === line.id)
      .reduce((sum, row) => sum + row.quantity, 0);
    const remaining = hold.quantity - hold.fulfilledQuantity - hold.releasedQuantity;
    const recordedOutsideReview = Math.max(0, hold.fulfilledQuantity + hold.releasedQuantity - confirmed
      .filter(row => row.hold.reservationId === hold.id).reduce((sum, row) => sum + row.quantity, 0));
    const awaitingReview = Math.min(remaining, line.quantity - processed);
    if (awaitingReview <= 0) return [];
    const available = Math.max(0, Math.min(awaitingReview, line.quantity - processed - recordedOutsideReview));
    const lots = hold.batchAllocations.map(row => ({ batchId: row.batchId, batchNumber: row.batch.batchNumber,
      quantity: row.quantity - row.fulfilledQuantity - row.releasedQuantity })).filter(row => row.quantity > 0);
    const noBatch = Math.max(0, remaining - lots.reduce((sum, row) => sum + row.quantity, 0));
    return [{ parcelId: parcel.id, parcelLineId: line.id, orderItemId: line.orderItemId, reservationId: hold.id,
      accountId: hold.inventoryAccountId, held: hold.quantity, fulfilled: hold.fulfilledQuantity, released: hold.releasedQuantity,
      available, awaitingReview, recordedOutsideReview, lots, noBatch }];
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
  if (outcome !== 'warehouse_stock_shipped' && outcome !== 'external_supply_release') throw new PurchaseError('请选择经书证核实的实际发货来源');
  if (outcome === 'external_supply_release' && batchId) throw new PurchaseError('外部供货只核对原订单预留');
  const evidence = shipmentEvidence(input);
  const content = { orderId, parcelId, parcelLineId, quantity, outcome, batchId, description, ...evidence };
  const keys = parcelKeys('legacy_inventory_review', orderId, requestId, { sha: evidence.sha256, row: evidence.documentRow }, content);
  const prior = verifyRepeat(await tx.fulfillmentEvent.findMany({ where: { OR: [{ requestKey: keys.requestKey }, { businessKey: keys.businessKey }] } }), keys);
  if (prior) return confirmPreview(undefined, { ...content, priorEvent: prior.id });
  const parcels = await tx.fulfillmentParcel.findMany({ where: { orderId, route: 'legacy_customer' }, include: parcelInclude });
  const parcel = parcels.find(row => row.id === parcelId);
  if (!parcel || Date.parse(evidence.occurredAt) < parcel.dispatchedAt.getTime()) throw new PurchaseError('请核对原运单及原预占的实际凭据');
  const hold = (await pendingLegacyInventory(tx, orderId, parcels)).find(row => row.parcelLineId === parcelLineId && row.parcelId === parcel.id);
  if (!hold || quantity > hold.available) throw new PurchaseError('处理数量超过该行尚未核对的原库存预留');
  const availableStock = batchId ? hold.lots.find(lot => lot.batchId === batchId)?.quantity ?? 0 : hold.noBatch;
  if (outcome === 'warehouse_stock_shipped' && quantity > availableStock) throw new PurchaseError('实际出库须对应该订单原预占的具体库存批次及数量');
  const recorded = await tx.inventoryTransaction.findMany({ where: { orderId, reservationId: hold.reservationId },
    select: { id: true, type: true, quantity: true, batchId: true, createdAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const snapshot = { ...content, requestId, actorId: actor.id, hold, shipmentId: parcel.shipmentId, recorded };
  const preview = confirmPreview(approved, snapshot);
  if (approved === undefined) return preview;
  if (outcome === 'warehouse_stock_shipped') {
    await shipOrderInventory(tx, orderId, hold.orderItemId, quantity, actor.id, { batchId, reason: '凭历史发货和库存书证核实出库' });
  } else {
    await releaseProcurementInventoryHold(tx, orderId, hold.orderItemId, quantity, actor.id);
  }
  await tx.fulfillmentEvent.create({ data: { ...keys, parcelId, kind: 'reconcile_legacy_inventory', status: 'applied', source: 'staff',
    actorId: actor.id, occurredAt: new Date(evidence.occurredAt), reference: evidence.reference, evidenceSha256: evidence.sha256,
    evidenceRow: evidence.documentRow, details: JSON.stringify({ ...snapshot, actionHash: approved }) } });
  return preview;
}
