import { randomUUID } from 'node:crypto';
import { afterSaleExchangeApprovals } from '@/lib/after-sale-exchanges';
import { configuredCarrier, pendingForWaybill, reconcilePendingForParcel } from '@/lib/fulfillment-carrier';
import { fulfillmentStatus, isInactiveOrderStatus, validateShipmentItems } from '@/lib/order-domain';
import { releaseProcurementInventoryHold, shipProcurementBatch } from '@/lib/inventory';
import { dispatchHoldFacts, forwardableHeldReceipt, readHoldAssignments, type HoldAssignment } from '@/lib/fulfillment-holds';
import { locateHeldDispatch } from '@/lib/fulfillment-hold-locations';
import { incidentQuantityKey, type IncidentSource } from '@/lib/purchase-incident-scope';
import { purchaseWorkspace } from '@/lib/purchase-orders';
import { heldIncidentQuantity, supplyIncidentsForDispatchAt } from '@/lib/purchase-incidents';
import { documentSha256, PurchaseError, requiredText } from '@/lib/purchase-terms';
import { availableReceipt, confirmPreview, inputObject, optionalText, parcelInclude, parcelKeys, parcelLineBalance, positiveQuantity,
  shipmentEvidence, verifyRepeat, type FulfillmentActor, type FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { receiptInventoryOptions } from '@/lib/fulfillment-stock';
import { historicalShipmentWorkspace } from '@/lib/fulfillment-legacy';
import { pendingLegacyInventory } from '@/lib/fulfillment-legacy-stock';

export { previewParcelEvent, recordParcelEvent } from '@/lib/fulfillment-events';

const routes = ['supplier_to_customer', 'supplier_to_libereal', 'libereal_to_customer'] as const;
type Route = typeof routes[number];
type Goods = { purchaseOrderId: string; orderItemId: string; quantity: number; sourceReceiptId: string | null; resendApprovalId?: string; resendShortfallId?: string; afterSaleApprovalId?: string; holdAssignments?: HoldAssignment[] };
const lineKey = (row: Pick<Goods, 'purchaseOrderId' | 'orderItemId'>) => JSON.stringify([row.purchaseOrderId, row.orderItemId]);
const dispatchSourceKey = (row: Goods) => JSON.stringify([lineKey(row),row.sourceReceiptId,row.resendApprovalId,row.resendShortfallId,row.afterSaleApprovalId]);

function reviewLateDispatch(raw: unknown) {
  if (raw===undefined) return undefined;
  const data = inputObject(raw);
  if (data.status!==undefined && data.status!=='pending' && data.status!=='confirmed') {
    throw new PurchaseError('请选择发运偏差的核对状态',400);
  }
  if (data.status==='pending' && data.customerReference) throw new PurchaseError('商业处理待回复时请记录实际发运核对');
  return {status:data.status as 'pending'|'confirmed'|undefined,
    supplierReference:requiredText(data.supplierReference,'供方对实际发运的书面确认'),
    customerReference:data.status==='pending'?undefined:requiredText(data.customerReference,'客户对接续履约的书面回复'),
    responsibility:requiredText(data.responsibility,'发运偏差的责任人'),
    description:requiredText(data.description,'实际发运核对情况与后续处理'),
    sha256:documentSha256(data.sha256,'发运偏差核对书证摘要')};
}

function dispatchInput(raw: unknown) {
  const input = inputObject(raw);
  if (!routes.includes(input.route as Route)) throw new PurchaseError('请选择包裹的实际发出地和目的地', 400);
  const route = input.route as Route;
  if (!Array.isArray(input.lines) || !input.lines.length) throw new PurchaseError('至少选择一条实际发货明细', 400);
  const lines = input.lines.map(entry => {
    const row = inputObject(entry);
    const sourceReceiptId = optionalText(row.sourceReceiptId, '采购实收批次');
    const resendApprovalId = optionalText(row.resendApprovalId, '免费重发的采购批准') ?? undefined;
    const resendShortfallId = optionalText(row.resendShortfallId, '原短失记录') ?? undefined;
    const afterSaleApprovalId = optionalText(row.afterSaleApprovalId, '售后换货批准') ?? undefined;
    if ((resendShortfallId && !resendApprovalId) || (afterSaleApprovalId && resendApprovalId)) {
      throw new PurchaseError('请选择这批货真正使用的一份补件批准及其具体来源', 400);
    }
    if ((route === 'libereal_to_customer') !== Boolean(sourceReceiptId)) throw new PurchaseError('本仓转发须选用实际收到的批次', 400);
    if (sourceReceiptId && resendApprovalId) throw new PurchaseError('转发按实收批次办理，免费重发批准须用于供方实际发货');
    return { purchaseOrderId: requiredText(row.purchaseOrderId, '采购单'), orderItemId: requiredText(row.orderItemId, '订单行'),
      quantity: positiveQuantity(row.quantity, '发货数量'), sourceReceiptId, resendApprovalId, resendShortfallId, afterSaleApprovalId, holdAssignments:readHoldAssignments(row.holdAssignments) };
  }).sort((a,b) => lineKey(a).localeCompare(lineKey(b)) || (a.sourceReceiptId ?? '').localeCompare(b.sourceReceiptId ?? '')
    || (a.resendApprovalId ?? '').localeCompare(b.resendApprovalId ?? '') || (a.resendShortfallId ?? '').localeCompare(b.resendShortfallId ?? '')
    || (a.afterSaleApprovalId ?? '').localeCompare(b.afterSaleApprovalId ?? ''));
  if (new Set(lines.map(dispatchSourceKey)).size !== lines.length) {
    throw new PurchaseError('请合并同一采购行、来源批次或重发批准的同一项数量', 400);
  }
  const carrier = optionalText(input.carrier, '承运方');
  const trackingNumber = optionalText(input.trackingNumber, '运单号');
  if (Boolean(carrier) !== Boolean(trackingNumber)) throw new PurchaseError('承运方和运单号须一起填写；当面交接请记录实际签单', 400);
  const feedSource = optionalText(input.feedSource, '物流信息来源');
  if (feedSource && (!trackingNumber || feedSource !== configuredCarrier()?.source)) {
    throw new PurchaseError('该物流信息来源尚未配置或缺少运单号', 400);
  }
  return { requestId: requiredText(input.requestId, '操作编号'), route, lines, carrier, trackingNumber, feedSource,
    holdReview:reviewLateDispatch(input.holdReview), ...shipmentEvidence(input) };
}

export async function fulfillmentWorkspace(tx: Db, orderId: string, dispatchedAt?: number, reviewHold = false) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, email: true,
    addressSnapshot: { select: { name: true, address: true, phone: true, institution: true } },
    orderItems: { select: { id: true, name: true, quantity: true, shippedQty: true }, orderBy: { position: 'asc' } } } });
  if (!order) throw new PurchaseError('未找到原客户订单', 404);
  const [purchasing, parcels, approvedExchanges] = await Promise.all([
    purchaseWorkspace(tx, orderId),
    tx.fulfillmentParcel.findMany({ where: { orderId }, include: parcelInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    afterSaleExchangeApprovals(tx, orderId),
  ]);
  const exchangeApprovals = approvedExchanges.filter(row=>dispatchedAt===undefined || Date.parse(row.authorizedAt)<=dispatchedAt);
  const dispatched = new Map<string, number>();
  const add = (row: { purchaseOrderId: string; orderItemId: string; quantity: number }) => {
    const key = lineKey(row); dispatched.set(key, (dispatched.get(key) ?? 0) + row.quantity);
  };
  for (const row of purchasing.fulfillment.supplierDispatched) add(row);
  type HoldAllowance = { ordinarilyAvailable: number; historicalHoldIds: string[]; assignable: Array<HoldAssignment & { reference: string; originalIncidentId: string }> };
  type Allowance = { available: number; holdAllowance?: HoldAllowance };
  const forwardLimits = new Map<string,Allowance>();
  const freeResends: Array<(typeof purchasing.fulfillment.freeResends)[number] & { holdAllowance?: HoldAllowance; requiresShortfall: boolean }> = [];
  const purchases = purchasing.orders.flatMap(po => {
    const receipt = po.orderReceipt;
    const incidents = dispatchedAt === undefined ? po.incidents : supplyIncidentsForDispatchAt(po.ledger,dispatchedAt);
    const unknownHold = incidents.some(row=>!row.outstanding);
    if (!receipt?.occurredAt || (dispatchedAt!==undefined && Date.parse(receipt.occurredAt)>dispatchedAt) || po.commitmentState === 'supplier_cancelled' || po.commitmentState === 'pending'
      || (!reviewHold && unknownHold)
      || ((po.status === 'on_hold' || po.incidents.length) && po.needsLegacyReview)
      || (po.status === 'on_hold' && !po.incidents.length && !po.needsRemainingReview)) return [];
    return receipt.lines.flatMap(ordered => {
      const line = po.lines.find(row => row.orderItemId === ordered.orderItemId);
      if (!line) return [];
      const remaining = po.remaining.find(row => row.orderItemId === line.orderItemId)?.quantity ?? 0;
      const supplied = dispatched.get(lineKey({ purchaseOrderId: po.id, orderItemId: line.orderItemId })) ?? 0;
      const purchaseOrderId = po.id;
      const orderItemId = line.orderItemId;
      const allowance = (quantity: number, source: IncidentSource, parcelLineId?: string, clearedOnLot: string[] = []): Allowance => {
        const isUpstreamHold = (issue: typeof incidents[number]) => parcelLineId && !clearedOnLot.includes(issue.id)
          && issue.outstanding?.some(row=>row.source?.kind==='parcel' && row.source.id===parcelLineId);
        const relevant = incidents.filter(issue=>!issue.outstanding || heldIncidentQuantity([issue],orderItemId,source)>0 || isUpstreamHold(issue));
        const parcelHeld = relevant.some(isUpstreamHold);
        const unallocated=purchasing.fulfillment.dispatchHolds.some(row=>!row.assignments && row.purchaseOrderId===po.id && row.orderItemId===orderItemId
          && row.incidentIds.some(id=>relevant.some(issue=>issue.id===id || issue.dispatchScopeId===id || issue.id===po.incidentHistory.find(row=>row.id===id)?.linkedTo))
          && (source.kind==='receipt' ? row.sourceReceiptId===source.id : source.kind==='resend' ? row.resendApprovalId===source.id
            : source.kind==='unshipped' && !row.resendApprovalId && !row.sourceReceiptId));
        const ordinary = unknownHold || parcelHeld || unallocated ? 0 : Math.max(0,quantity-heldIncidentQuantity(relevant,orderItemId,source));
        const key=incidentQuantityKey({orderItemId,quantity:0,source});
        const assignable=unallocated ? [] : relevant.flatMap(issue=>{
          const amount=(issue.outstanding ?? []).filter(part=>incidentQuantityKey(part)===key).reduce((sum,part)=>sum+part.quantity,0);
          return amount>0 && quantity>0 ? [{
            incidentId:issue.dispatchScopeId ?? issue.id,originalIncidentId:issue.id,quantity:Math.min(amount,quantity),reference:issue.reference,
          }] : [];
        });
        return reviewHold ? {available:quantity,holdAllowance:{ordinarilyAvailable:ordinary,historicalHoldIds:relevant.map(row=>row.id),assignable}}
          : {available:ordinary};
      };
      const payableNotProved = po.payableReviewWindows.some(row=>row.orderItemId===orderItemId
        && (dispatchedAt===undefined ? !row.reviewedAt
          : Date.parse(row.changedAt)<=dispatchedAt && (!row.reviewedAt || Date.parse(row.reviewedAt)>dispatchedAt)));
      const ordinary = allowance(payableNotProved?0:Math.max(0,Math.min(ordered.quantity,remaining)-supplied),{kind:'unshipped'});
      let canForward = false;
      if (remaining > 0) for (const source of po.incidentSources) {
        if (source.orderItemId !== orderItemId || source.source.kind !== 'receipt') continue;
        const physical=parcels.find(parcel=>parcel.lines.some(row=>row.id===source.parcelLineId));
        const receiptId=source.source.id;
        const landed=physical?.lines.find(row=>row.id===source.parcelLineId)?.receipts.find(row=>row.id===receiptId);
        const hold=purchasing.fulfillment.dispatchHolds.find(row=>row.parcelLineId===source.parcelLineId);
        const eligible=landed ? forwardableHeldReceipt(hold,landed,dispatchedAt) : 0;
        const clearedOnLot=hold?.decisions.filter(row=>row.outcome==='continue' && row.receiptId===receiptId && row.incidentId
          && (dispatchedAt===undefined || row.recordedAt.getTime()<=dispatchedAt)).flatMap(row=>{
            const id=row.incidentId!;
            const linked=po.incidentHistory.find(issue=>issue.id===id)?.linkedTo;
            return linked ? [id,linked] : [id];
          }) ?? [];
        const permitted=allowance(eligible,source.source,source.parcelLineId,clearedOnLot);
        if (permitted.available<=0) continue;
        forwardLimits.set(source.source.id,permitted);
        canForward = true;
      }
      let canResend = false;
      for (const resend of purchasing.fulfillment.freeResends) {
        if (resend.purchaseOrderId !== purchaseOrderId || resend.orderItemId !== orderItemId) continue;
        if (dispatchedAt!==undefined && Date.parse(resend.authorizedAt)>dispatchedAt) continue;
        const permitted = allowance(resend.available,{kind:'resend',id:resend.approvalId});
        if (permitted.available<=0) continue;
        const requiresShortfall = purchasing.fulfillment.freeResends.filter(row => row.approvalId === resend.approvalId
          && row.orderItemId === resend.orderItemId && row.purchaseOrderId === resend.purchaseOrderId).length > 1;
        freeResends.push({...resend,...permitted,requiresShortfall});
        canResend = true;
      }
      if (dispatchedAt===undefined && po.needsRemainingReview && !canForward && !canResend && ordinary.available<=0) return [];
      return [{ purchaseOrderId, orderItemId, name: line.source.name, supplier: line.terms.supplier ?? '',
        catalogNumber: line.source.catalogNumber, productId: line.source.productId, variantId: line.source.variantId,
        orderedAt: receipt.occurredAt!, ...ordinary, contractVersion: po.version,
        originalHoldAlreadyMoved: purchasing.fulfillment.replacementsWithPriorHoldTransfer.some(row =>
          row.purchaseOrderId === po.id && row.orderItemId === line.orderItemId),
        stockSourceUnverified: purchasing.fulfillment.replacementsWithUnverifiedStockSource.some(row =>
          row.purchaseOrderId === po.id && row.orderItemId === line.orderItemId) }];
    });
  });
  const receipts = isInactiveOrderStatus(order.status) ? [] : parcels.flatMap(parcel =>
    parcel.route !== 'supplier_to_libereal' || parcel.status === 'exception' ? [] : parcel.lines.flatMap(line =>
      line.receipts.flatMap(row => {
        const allowance = line.afterSaleApprovalId
          ? (exchangeApprovals.some(item => item.id === line.afterSaleApprovalId) ? { available: availableReceipt(row), holdAllowance: undefined } : null)
          : forwardLimits.get(row.id);
        const receivedAt = parcel.events.find(event=>event.id===row.eventId)?.occurredAt.toISOString() ?? null;
        if (!allowance || allowance.available <= 0 || (dispatchedAt!==undefined && (!receivedAt || Date.parse(receivedAt)>dispatchedAt))) return [];
        return [{id:row.id,purchaseOrderId:line.purchaseOrderId,orderItemId:line.orderItemId,afterSaleApprovalId:line.afterSaleApprovalId,batchNumber:row.inventoryBatch.batchNumber,
          ...allowance,inventoryAccountId:row.inventoryBatch.inventoryAccountId,...row.inventoryBatch.account,receivedAt}];
      })));
  const inventoryChoices = [];
  for (const parcel of parcels) {
    if (parcel.route !== 'supplier_to_libereal') continue;
    for (const line of parcel.lines) {
      if (!parcelLineBalance(line).pending) continue;
      const purchase = purchasing.orders.find(po => po.id === line.purchaseOrderId);
      const source = purchase?.lines.find(row => row.orderItemId === line.orderItemId)?.source;
      if (purchase && source) inventoryChoices.push({ parcelLineId: line.id, ...(await receiptInventoryOptions(tx, source, purchase.version)) });
    }
  }
  const legacyBackfill = await historicalShipmentWorkspace(tx, orderId);
  const legacyInventory = await pendingLegacyInventory(tx, orderId, parcels);
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
    for (const notice of notices) if (parcels.some(candidate => candidate.feedSource === parcel.feedSource
      && candidate.carrier === parcel.carrier && candidate.trackingNumber === parcel.trackingNumber && candidate.dispatchedAt <= notice.occurredAt)) {
      unmatched.push({ id: notice.id, source: notice.source, kind: notice.kind, occurredAt: notice.occurredAt,
        carrier: parcel.carrier, trackingNumber: parcel.trackingNumber });
    }
  }
  const workspaceParcels=parcels.map(parcel=>{
    const holdFacts=dispatchHoldFacts(parcel.events);
    return {...parcel,holdFacts,lines:parcel.lines.map(line=>({...line,balance:parcelLineBalance(line),
      receipts:line.receipts.map(receipt=>({...receipt,remaining:availableReceipt(receipt),
        disposable:forwardableHeldReceipt(holdFacts.find(hold=>hold.parcelLineId===line.id),receipt)})),
    }))};
  });
  return { order, purchases, parcels: workspaceParcels, receipts, legacyShipments, legacyBackfill, legacyInventory, inventoryChoices, unmatched,
    freeResends, exchangeApprovals, unverifiedStockLines: purchasing.fulfillment.parcelLinesWithUnverifiedStockSource, feedSource: configuredCarrier()?.source ?? null };
}

type DispatchScope = Pick<ReturnType<typeof dispatchInput>, 'route' | 'lines' | 'occurredAt' | 'holdReview'>;

function validateDispatchScope(view: Awaited<ReturnType<typeof fulfillmentWorkspace>>, input: DispatchScope) {
  if (isInactiveOrderStatus(view.order.status)) throw new PurchaseError('当前订单不能登记新的发货，请核对原接单和履约状态');
  const lines = input.lines.map(row => {
    const receipt = row.sourceReceiptId ? view.receipts.find(r => r.id === row.sourceReceiptId && r.purchaseOrderId === row.purchaseOrderId && r.orderItemId === row.orderItemId) : null;
    if (row.sourceReceiptId && (!receipt?.receivedAt || receipt.receivedAt > input.occurredAt)) throw new PurchaseError('须先核实本单此采购行实际收到的批次和时间');
    const exchangeId = row.afterSaleApprovalId ?? receipt?.afterSaleApprovalId;
    if (exchangeId) {
      const exchange = view.exchangeApprovals.find(item => item.id === exchangeId && item.purchaseOrderId === row.purchaseOrderId && item.orderItemId === row.orderItemId);
      if (!exchange || exchange.authorizedAt > input.occurredAt || (receipt && receipt.afterSaleApprovalId !== exchange.id)
        || row.quantity > (receipt?.available ?? exchange.available) || input.holdReview || row.holdAssignments) {
        throw new PurchaseError('须按当时已有的售后换货批准或实际到仓批次核实货物与数量');
      }
      return { ...row, afterSaleApprovalId:exchange.id, originalHoldAlreadyMoved:true, catalogNumber:exchange.catalogNumber,
        productId:receipt ? receipt.productId : exchange.productId, variantId:receipt ? receipt.variantId : exchange.variantId,
        inventoryAccountId:receipt?.inventoryAccountId, supplier:exchange.supplier, name:exchange.name, contractVersion:exchange.version,
        batchNumber:receipt?.batchNumber ?? null, holdAssignments:undefined, holdSource:undefined, unreleased:undefined };
    }
    const purchased = view.purchases.find(line => line.purchaseOrderId === row.purchaseOrderId && line.orderItemId === row.orderItemId);
    if (!purchased || purchased.orderedAt > input.occurredAt) throw new PurchaseError('请核对该订单行在发货当时已经生效的供应商订购');
    const candidates = row.resendApprovalId ? view.freeResends.filter(item => item.approvalId === row.resendApprovalId
      && item.purchaseOrderId === row.purchaseOrderId && item.orderItemId === row.orderItemId
      && (!row.resendShortfallId || item.shortfallId === row.resendShortfallId)) : [];
    const resend = candidates.length===1 && (!candidates[0].requiresShortfall || row.resendShortfallId) ? candidates[0] : null;
    if (row.resendApprovalId && (!resend || resend.authorizedAt > input.occurredAt)) throw new PurchaseError('发货须对应实际短失与当时已经批准的本行免费重发数量');
    if (resend?.originalHoldAlreadyMoved === null || (!resend && !receipt && purchased.stockSourceUnverified)) {
      throw new PurchaseError('该补货行的原库存归属待核，请由采购审批人员核对原行及书证');
    }
    const capacity = receipt ?? resend ?? purchased;
    if (row.quantity>capacity.available) {
      throw new PurchaseError(resend ? '发货数量超过本行免费重发核准数量' : '发货数量超过该采购行或实收批次可用数量。若原运单证明确已发出，请核对实际发运偏差');
    }
    const priorHold = capacity.holdAllowance;
    if (row.holdAssignments && !priorHold) throw new PurchaseError('请使用实际发运偏差的核对入口');
    const automatic = priorHold && priorHold.ordinarilyAvailable===0 && priorHold.assignable.length===1
      && row.quantity<=priorHold.assignable[0].quantity ? [{incidentId:priorHold.assignable[0].incidentId,quantity:row.quantity}] : undefined;
    const holdAssignments=row.holdAssignments ?? automatic;
    const allocated=holdAssignments?.reduce((total,part)=>total+part.quantity,0) ?? 0;
    if (allocated>row.quantity || holdAssignments?.some(part=>!priorHold?.assignable.some(allowed=>
      allowed.incidentId===part.incidentId && allowed.quantity>=part.quantity))) throw new PurchaseError('指定的暂停份额超过原事项可核对数量');
    if (priorHold && row.quantity-allocated>priorHold.ordinarilyAvailable) throw new PurchaseError('请凭原件核清并指定实际发出的暂停份额');
    const assignedShares=holdAssignments?.map(part=>({...part,
      originalIncidentId:priorHold!.assignable.find(item=>item.incidentId===part.incidentId)!.originalIncidentId,
    }));
    const unreleased=assignedShares ? {quantity:allocated,incidentIds:assignedShares.map(part=>part.originalIncidentId)} : undefined;
    const source: IncidentSource=receipt ? {kind:'receipt',id:receipt.id} : resend ? {kind:'resend',id:resend.approvalId} : {kind:'unshipped'};
    return { ...row,resendShortfallId:resend?.shortfallId,holdAssignments:assignedShares,unreleased,holdSource:unreleased?source:undefined, catalogNumber: purchased.catalogNumber, productId: receipt ? receipt.productId : purchased.productId,
      variantId: receipt ? receipt.variantId : purchased.variantId, inventoryAccountId: receipt?.inventoryAccountId, resend: resend ?? undefined,
      originalHoldAlreadyMoved: resend?.originalHoldAlreadyMoved ?? purchased.originalHoldAlreadyMoved,
      supplier: purchased.supplier, name: purchased.name, contractVersion: purchased.contractVersion, batchNumber: receipt?.batchNumber ?? null };
  });
  if (new Set(lines.map(dispatchSourceKey)).size !== lines.length) throw new PurchaseError('同一件数不得用不同写法重复消耗同一发运来源',400);
  const originalLines = lines.filter(line => !line.afterSaleApprovalId);
  const exchange = !originalLines.length;
  if (!(exchange ? ['confirmed','partially_shipped','shipped','completed'] : ['confirmed','partially_shipped']).includes(view.order.status)) {
    throw new PurchaseError('当前订单不能登记新的发货，请核对原接单和履约状态');
  }
  if (input.holdReview && lines.every(line=>!line.unreleased)) throw new PurchaseError('该批货在实际发运时有放行依据，请使用普通补录');
  if (input.route !== 'libereal_to_customer' && new Set(lines.map(line => line.supplier)).size !== 1) {
    throw new PurchaseError('不同供应商实际发出的货物须分别登记包裹');
  }
  const unforwarded = new Map<string, number>();
  if (input.route !== 'libereal_to_customer') {
    for (const parcel of view.parcels) {
      if (parcel.route !== 'supplier_to_libereal') continue;
      for (const row of parcel.lines) {
        if (row.afterSaleApprovalId) continue;
        const held = row.receipts.reduce((sum, receipt) => sum + receipt.remaining, 0);
        unforwarded.set(row.orderItemId, (unforwarded.get(row.orderItemId) ?? 0) + row.balance.pending + held);
      }
    }
  }
  const byCustomerLine = exchange ? [] : validateShipmentItems(view.order.orderItems.map(item => ({
    ...item, shippedQty: item.shippedQty + (unforwarded.get(item.id) ?? 0),
  })), originalLines);
  return { lines, byCustomerLine, exchange };
}

export async function previewDispatchScope(
  tx: Db, orderId: string, view: Awaited<ReturnType<typeof fulfillmentWorkspace>>,
  scope: {
    route: Route; carrier: string | null; trackingNumber: string | null;
    lines: Array<{ purchaseOrderId: string; orderItemId: string; quantity: number; sourceReceiptId: string | null }>;
  },
  now: Date,
) {
  if (scope.trackingNumber && await tx.fulfillmentParcel.count({ where: {
    carrier: scope.carrier, trackingNumber: scope.trackingNumber,
    OR: [{ orderId: { not: orderId } }, { orderId, route: scope.route }],
  } })) throw new PurchaseError('运单归属或路线待核对');
  return validateDispatchScope(view, {
    ...scope, occurredAt: now.toISOString(), holdReview: undefined,
    lines: scope.lines.map(line => ({
      ...line, resendApprovalId: undefined, resendShortfallId: undefined,
      afterSaleApprovalId: undefined, holdAssignments: undefined,
    })),
  });
}

async function dispatchPlan(tx: Db, orderId: string, raw: unknown, actor: FulfillmentActor) {
  const { requestId, ...input } = dispatchInput(raw);
  const keys = parcelKeys('dispatch_parcel', orderId, requestId, { sha256: input.sha256, row: input.documentRow }, { orderId, ...input });
  const previous = verifyRepeat(await tx.fulfillmentParcel.findMany({ where: { OR: [{ requestKey: keys.requestKey }, { businessKey: keys.businessKey }] }, include: parcelInclude }), keys);
  if (previous) return { previous, snapshot: { orderId, actorId: actor.id, requestId, ...input, priorParcel: previous.id } } as const;
  if (input.trackingNumber && await tx.fulfillmentParcel.count({ where: { orderId, route: input.route, carrier: input.carrier, trackingNumber: input.trackingNumber } })) {
    throw new PurchaseError('本单同一运输路线已经登记该运单，请核对原包裹');
  }
  const view = await fulfillmentWorkspace(tx,orderId,Date.parse(input.occurredAt),Boolean(input.holdReview));
  const { lines, byCustomerLine, exchange } = validateDispatchScope(view, input);
  const recipient = input.route === 'supplier_to_libereal' ? { party: 'Libereal' }
    : { party: 'customer', email: view.order.email, deliveryAddress: view.order.addressSnapshot };
  const snapshot = { orderId, actorId: actor.id, requestId, ...input, recipient, lines };
  return { previous: null, snapshot, input, keys, lines, order: view.order, byCustomerLine, exchange } as const;
}

export async function previewDispatchParcel(tx: Db, orderId: string, input: unknown, actor: FulfillmentActor) {
  const plan = await dispatchPlan(tx, orderId, input, actor);
  return confirmPreview(undefined, plan.snapshot);
}

export async function dispatchParcel(tx: Db, orderId: string, raw: unknown, actor: FulfillmentActor, expectedHash?: string) {
  const plan = await dispatchPlan(tx, orderId, raw, actor);
  if (plan.previous) return plan.previous;
  confirmPreview(expectedHash, plan.snapshot);
  const { input, lines, order, keys, byCustomerLine, exchange } = plan;
  const occurred = new Date(input.occurredAt);
  let shipmentId: string | null = null;
  if (input.route !== 'supplier_to_libereal') {
    const shipment = await tx.shipment.create({ data: { orderId, status: 'shipped', method: input.trackingNumber ? 'logistics' : 'dedicated_delivery',
      carrier: input.carrier, trackingNumber: input.trackingNumber, shippedAt: occurred, createdBy: actor.id,
      ...(exchange ? {} : { items: { create: byCustomerLine } }) } });
    shipmentId = shipment.id;
    for (const line of lines) {
      if (line.sourceReceiptId) await shipProcurementBatch(tx, line.sourceReceiptId, orderId, line.quantity, actor.id);
      else if (!line.originalHoldAlreadyMoved) await releaseProcurementInventoryHold(tx, orderId, line.orderItemId, line.quantity, actor.id);
    }
    if (!exchange) {
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
  }
  const recordedLines = lines.flatMap(line=>{
    const actual=(line.holdAssignments ?? []).map(part=>({...line,quantity:part.quantity,holdAssignments:[part],
      unreleased:{quantity:part.quantity,incidentIds:[part.originalIncidentId]},parcelLineId:randomUUID()}));
    const ordinary=line.quantity-(line.unreleased?.quantity ?? 0);
    return ordinary>0 ? [{...line,quantity:ordinary,holdAssignments:undefined,holdSource:undefined,unreleased:undefined,parcelLineId:randomUUID()},...actual] : actual;
  });
  const parcel = await tx.fulfillmentParcel.create({ data: { orderId, shipmentId, route: input.route, carrier: input.carrier, trackingNumber: input.trackingNumber,
    feedSource: input.feedSource, status: 'dispatched', dispatchedAt: occurred, reference: input.reference, evidenceSha256: input.sha256,
    evidenceRow: input.documentRow, ...keys, actorId: actor.id,
    events: { create: { ...parcelKeys('dispatch_evidence', orderId, plan.snapshot.requestId, { parcel: keys.businessKey }, plan.snapshot),
      source: 'staff', kind: 'dispatch', status: 'applied', occurredAt: occurred, reference: input.reference,
      evidenceSha256: input.sha256, evidenceRow: input.documentRow, actorId: actor.id, details: JSON.stringify({ ...plan.snapshot, lines: recordedLines }) } },
    lines: { create: recordedLines.map(r => ({ id: r.parcelLineId, purchaseOrderId: r.purchaseOrderId,
      orderItemId: r.orderItemId, quantity: r.quantity, sourceReceiptId: r.sourceReceiptId, afterSaleApprovalId:r.afterSaleApprovalId ?? null, productId: r.productId,
      variantId: r.variantId, catalogNumber: r.catalogNumber })) } }, include: parcelInclude });
  await locateHeldDispatch(tx,orderId,recordedLines.flatMap(row=>row.holdSource && row.holdAssignments ? [{
    purchaseOrderId:row.purchaseOrderId,orderItemId:row.orderItemId,parcelLineId:row.parcelLineId,
    source:row.holdSource,assignments:row.holdAssignments,
  }] : []),input,actor);
  await reconcilePendingForParcel(tx, parcel);
  return tx.fulfillmentParcel.findUniqueOrThrow({ where: { id: parcel.id }, include: parcelInclude });
}
