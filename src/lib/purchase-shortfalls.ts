import { purchaseOperation, type PurchaseActivity } from '@/lib/purchase-activity';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { availableReceipt, parcelLineBalance, type FulfillmentDb as Db } from '@/lib/fulfillment-records';
import type { IncidentCandidate } from '@/lib/purchase-incident-scope';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';

export type ShortfallDecision = 'free_resend' | 'change_contract' | 'new_purchase';
type DecisionRow = {
  orderItemId: string; quantity: number; outcome?: 'cancel' | 'replace' | 'resend';
  shortfallId?: string; shortfallDecision?: ShortfallDecision; forwardingLossId?: string; revisesResendApprovalId?: string;
};
type SourceQuantity = { purchaseOrderId: string; orderItemId: string; quantity: number };
const sourceKey = (purchaseOrderId: string, orderItemId: string) => JSON.stringify([purchaseOrderId,orderItemId]);

type StockSource = { purchaseLine: string; shortfallId?: never } | { purchaseLine?: never; shortfallId: string };
export type ContractDispatchSource = { purchaseOrderId: string; orderItemId: string; parcelLineId: string; reference: string };

export async function purchaseShortfalls(tx: Db, orderId: string, activities: PurchaseActivity[]) {
  const dispositions = activities.flatMap(row => {
    if (!row.purchaseOrderId || row.action !== 'resolve_change') return [];
    const operation = purchaseOperation(row.detail);
    if (!Array.isArray(operation.dispositions)) return [];
    return (operation.dispositions as DecisionRow[]).filter(line => positiveCents(line.quantity)).map(line => ({
      ...line, approvalId: row.id, purchaseOrderId: row.purchaseOrderId!, authorizedAt: row.createdAt,
      shortfallId: line.shortfallId ?? line.forwardingLossId,
      kind: line.shortfallDecision ?? (line.forwardingLossId ? 'new_purchase' as const : undefined),
    }));
  });
  const decisions = dispositions.flatMap(row => row.shortfallId && row.kind ? [{ ...row, shortfallId: row.shortfallId, kind: row.kind }] : []);
  const parcels = await tx.fulfillmentParcel.findMany({ where: { orderId, route: {
    in: ['supplier_to_customer','supplier_to_libereal','libereal_to_customer'],
  } }, include: {
    lines: { include: { receipts: { select: { id:true,quantity:true,forwardedQuantity:true,releasedQuantity:true,
      inventoryBatch:{select:{batchNumber:true}} } }, sourceReceipt: { select: { parcelLineId: true } }, resolutions: { include: {
      event: { select: { occurredAt: true, reference: true } },
    } } } },
    events: { where: { kind: 'dispatch', status: 'applied' }, select: { details: true } },
  }, orderBy: [{ dispatchedAt: 'asc' }, { id: 'asc' }] });
  const replacements = await tx.purchaseReplacementLine.findMany({ where: { orderId },
    select: { purchaseOrderId: true, orderItemId: true, fromPurchaseOrderId: true, authorizationId: true, quantity: true } });
  const authorized = new Map(dispositions.map(row => [sourceKey(row.approvalId,row.orderItemId),row]));
  const authorizedShortfalls = new Map(decisions.map(row => [sourceKey(row.approvalId,row.orderItemId),row]));
  const replacementOrigins = new Map<string,StockSource | null>();
  for (const row of replacements) {
    const decision = authorized.get(sourceKey(row.authorizationId,row.orderItemId));
    const proved = decision?.purchaseOrderId === row.fromPurchaseOrderId && decision.outcome === 'replace' && decision.quantity === row.quantity;
    replacementOrigins.set(sourceKey(row.purchaseOrderId,row.orderItemId), !proved ? null
      : decision.shortfallId ? { shortfallId: decision.shortfallId } : { purchaseLine: sourceKey(row.fromPurchaseOrderId,row.orderItemId) });
  }
  const companyParcels = parcels.flatMap(parcel => parcel.lines.flatMap(line => line.purchaseOrderId
    ? [{ parcel, line, purchaseOrderId: line.purchaseOrderId }] : []));
  const parcelLines = new Map(companyParcels.map(record => [record.line.id,record]));
  const resolutions = new Map(companyParcels.flatMap(record => record.line.resolutions.map(resolution => [
    resolution.id, { ...record, resolution },
  ] as const)));
  const freeDispatches = new Map<string,(typeof decisions)[number]>();
  const contractedDispatches = new Map<string,SourceQuantity>();
  const resendDispatches = new Map<string,number>();
  const diverted = new Map<string,number>();
  for (const {parcel,line,purchaseOrderId} of companyParcels) {
    if (parcel.route === 'libereal_to_customer') continue;
    const { lines } = jsonObject(parcel.events[0]?.details);
    const dispatch = Array.isArray(lines) ? lines.find(row => row?.purchaseOrderId === purchaseOrderId && row.orderItemId === line.orderItemId
      && (!row.parcelLineId || row.parcelLineId === line.id)) : undefined;
    if (dispatch?.resendApprovalId) {
      const key = sourceKey(dispatch.resendApprovalId,line.orderItemId);
      const approval = authorizedShortfalls.get(key);
      if (approval?.kind !== 'free_resend' || approval.purchaseOrderId !== purchaseOrderId) throw new PurchaseError('补发包裹缺少对应的采购批准');
      resendDispatches.set(key,(resendDispatches.get(key) ?? 0) + line.quantity);
      freeDispatches.set(line.id,approval);
    } else {
      contractedDispatches.set(line.id,{purchaseOrderId,orderItemId:line.orderItemId,quantity:line.quantity});
    }
  }
  for (const decision of decisions) {
    if (!decision.revisesResendApprovalId) continue;
    const key = sourceKey(decision.revisesResendApprovalId,decision.orderItemId);
    const previous = authorized.get(key);
    if (decision.kind === 'free_resend' || previous?.kind !== 'free_resend' || previous.purchaseOrderId !== decision.purchaseOrderId
      || previous.shortfallId !== decision.shortfallId) throw new PurchaseError('改办记录缺少对应的原免费重发批准');
    diverted.set(key,(diverted.get(key) ?? 0) + decision.quantity);
  }

  function dispatchStockSource(record: typeof companyParcels[number]): StockSource {
    const free = freeDispatches.get(record.line.id);
    return free ? { shortfallId: free.shortfallId } : { purchaseLine: sourceKey(record.purchaseOrderId,record.line.orderItemId) };
  }

  // A replacement can change who supplies and is paid while retaining the original stock reservation.
  // Only a customer leg or an actual warehouse receipt moves that reservation.
  function originalHoldAlreadyMoved(source: StockSource): boolean | null {
    const seen = new Set<string>();
    let current: StockSource | null | undefined = source;
    while (current) {
      const key = current.shortfallId ? 'shortfall:'+current.shortfallId : current.purchaseLine!;
      if (seen.has(key)) return null;
      seen.add(key);
      if (current.shortfallId) {
        const origin = resolutions.get(current.shortfallId);
        if (!origin) return null;
        if (origin.parcel.route !== 'supplier_to_libereal' || origin.resolution.kind === 'return') return true;
        current = dispatchStockSource(origin);
      } else {
        current = replacementOrigins.get(current.purchaseLine!);
      }
    }
    return current === null ? null : false;
  }

  // A free resend or a warehouse forward is another physical leg of the same paid-for share.
  // A separately contracted substitute starts its own payable and its own dispatch evidence.
  function contractDispatch(record: typeof companyParcels[number]): ContractDispatchSource | null {
    const { purchaseOrderId, line } = record;
    const seen = new Set<string>();
    let current: typeof record | undefined = record;
    while (current && current.purchaseOrderId === purchaseOrderId && current.line.orderItemId === line.orderItemId) {
      const parcelLineId = current.line.id;
      if (seen.has(parcelLineId)) return null;
      seen.add(parcelLineId);
      if (contractedDispatches.has(parcelLineId)) return { purchaseOrderId, orderItemId: line.orderItemId, parcelLineId, reference: current.parcel.reference };
      if (current.line.sourceReceipt) {
        current = parcelLines.get(current.line.sourceReceipt.parcelLineId);
      } else {
        const free = freeDispatches.get(parcelLineId);
        current = free && resolutions.get(free.shortfallId);
      }
    }
    return null;
  }

  const parcelLinesWithPriorHoldTransfer: string[] = [];
  const parcelLinesWithUnverifiedStockSource: string[] = [];
  for (const record of companyParcels) {
    if (record.parcel.route !== 'supplier_to_libereal') continue;
    const moved = originalHoldAlreadyMoved(dispatchStockSource(record));
    if (moved === true) parcelLinesWithPriorHoldTransfer.push(record.line.id);
    if (moved === null) parcelLinesWithUnverifiedStockSource.push(record.line.id);
  }
  const replacementsWithPriorHoldTransfer: Array<Pick<SourceQuantity,'purchaseOrderId' | 'orderItemId'>> = [];
  const replacementsWithUnverifiedStockSource: typeof replacementsWithPriorHoldTransfer = [];
  for (const {purchaseOrderId,orderItemId} of replacements) {
    const moved = originalHoldAlreadyMoved({ purchaseLine: sourceKey(purchaseOrderId,orderItemId) });
    if (moved === true) replacementsWithPriorHoldTransfer.push({purchaseOrderId,orderItemId});
    if (moved === null) replacementsWithUnverifiedStockSource.push({purchaseOrderId,orderItemId});
  }

  const shortened = new Map<string,number>();
  const shortfalls = [...resolutions.values()].map(record => {
    const { parcel,line,purchaseOrderId,resolution } = record;
    const tied = decisions.filter(row => row.shortfallId === resolution.id && row.purchaseOrderId === purchaseOrderId && row.orderItemId === line.orderItemId);
    const contractSource = contractDispatch(record);
    const amended = tied.filter(row => row.kind === 'change_contract').reduce((sum,row) => sum+row.quantity,0);
    if (amended) {
      if (!contractSource) throw new PurchaseError('合同变更缺少原采购发货行的书证');
      const id = contractSource.parcelLineId;
      const total = (shortened.get(id) ?? 0) + amended;
      if (total > contractedDispatches.get(id)!.quantity) throw new PurchaseError('合同变更数量超出原采购书证');
      shortened.set(id,total);
    }
    const claimed = tied.reduce((sum,row) => sum + (row.revisesResendApprovalId ? 0 : row.quantity),0);
    return { resolutionId: resolution.id, orderItemId: line.orderItemId, purchaseOrderId, route: parcel.route, contractSource,
      originalContract: Boolean(contractSource), quantity: resolution.quantity, reference: resolution.event.reference, occurredAt: resolution.event.occurredAt.toISOString(),
      available: Math.max(0,resolution.quantity - claimed),
      independentlyReplaced: tied.filter(row => row.kind === 'new_purchase').reduce((sum,row) => sum+row.quantity,0) };
  });
  const supplierDispatched = new Map<string,SourceQuantity>();
  for (const [parcelLineId,source] of contractedDispatches) {
    const { purchaseOrderId,orderItemId } = source;
    const key = sourceKey(purchaseOrderId,orderItemId);
    const quantity = (supplierDispatched.get(key)?.quantity ?? 0) + source.quantity - (shortened.get(parcelLineId) ?? 0);
    supplierDispatched.set(key,{purchaseOrderId,orderItemId,quantity});
  }
  const freeResends = decisions.filter(row => row.kind === 'free_resend').map(row => {
    const key = sourceKey(row.approvalId,row.orderItemId);
    const dispatched = resendDispatches.get(key) ?? 0;
    const redirected = diverted.get(key) ?? 0;
    const available = row.quantity - dispatched - redirected;
    if (available < 0) throw new PurchaseError('已登记的免费重发或改办超过书面核准数量');
    return { ...row, dispatched, redirected, available, originalHoldAlreadyMoved: originalHoldAlreadyMoved({ shortfallId: row.shortfallId }) };
  });
  const supplierReceived: SourceQuantity[] = [];
  const warehouseReceived: SourceQuantity[] = [];
  const warehouseTransit: SourceQuantity[] = [];
  for (const {parcel,line,purchaseOrderId} of companyParcels) {
    if (parcel.route === 'libereal_to_customer') continue;
    const {received,pending} = parcelLineBalance(line);
    const source = {purchaseOrderId,orderItemId:line.orderItemId};
    if (received > 0) supplierReceived.push({...source,quantity:received});
    if (parcel.route === 'supplier_to_libereal') {
      if (received > 0) warehouseReceived.push({...source,quantity:received});
      if (pending > 0) warehouseTransit.push({...source,quantity:pending});
    }
  }
  const incidentSources: Array<IncidentCandidate & { purchaseOrderId: string }> = [];
  for (const {parcel,line,purchaseOrderId} of companyParcels) {
    const target = {purchaseOrderId,orderItemId:line.orderItemId};
    const {pending} = parcelLineBalance(line);
    if (pending) incidentSources.push({...target,quantity:pending,source:{kind:'parcel',id:line.id},reference:parcel.trackingNumber ?? parcel.reference});
    for (const receipt of line.receipts) {
      const quantity = availableReceipt(receipt);
      if (quantity) incidentSources.push({...target,quantity,source:{kind:'receipt',id:receipt.id},reference:receipt.inventoryBatch.batchNumber,parcelLineId:line.id});
    }
  }
  for (const loss of shortfalls) if (loss.available > 0) incidentSources.push({purchaseOrderId:loss.purchaseOrderId,orderItemId:loss.orderItemId,
    quantity:loss.available,source:{kind:'shortfall',id:loss.resolutionId},reference:loss.reference});
  for (const resend of freeResends) if (resend.available > 0) incidentSources.push({purchaseOrderId:resend.purchaseOrderId,orderItemId:resend.orderItemId,
    quantity:resend.available,source:{kind:'resend',id:resend.approvalId},reference:resend.approvalId});
  return { supplierDispatched: [...supplierDispatched.values()], supplierReceived, warehouseReceived, warehouseTransit, shortfalls, freeResends, incidentSources,
    parcelLinesWithPriorHoldTransfer, replacementsWithPriorHoldTransfer, parcelLinesWithUnverifiedStockSource, replacementsWithUnverifiedStockSource };
}
