import { readsSaleFinance, readsSalePurchasing, saleOperationFor } from '@/lib/after-sale-visibility';
import { type Prisma } from '@prisma/client';
import { customerLineReceipts } from '@/lib/fulfillment-accounting';
import { parcelInclude, type FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { purchaseObject, purchaseOperation, readPurchaseActivities } from '@/lib/purchase-activity';
import { readPurchaseAcceptance } from '@/lib/purchase-acceptance';
import { purchaseShortfalls } from '@/lib/purchase-shortfalls';
import { positiveCents } from '@/lib/purchase-terms';
import { loadPurchaseOrderSource } from '@/lib/purchase-source';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';

export const afterSaleCaseInclude = { events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } satisfies Prisma.AfterSaleCaseInclude;
export type SaleCase = Prisma.AfterSaleCaseGetPayload<{ include: typeof afterSaleCaseInclude }>;
export const saleOperation = (event: SaleCase['events'][number]) => purchaseObject(jsonObject(event.detail).operation);
export const caseEvents = (row: SaleCase, action: string) => row.events.filter(event => event.action === action);
export const lastCaseEvent = (row: SaleCase, action: string) => caseEvents(row, action).at(-1);
export function currentSaleAgreement(row: SaleCase) {
  return caseEvents(row, 'agreement').filter(event => !saleOperation(event).historical)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()).at(-1);
}
export function originalSaleParcel(row: SaleCase) {
  const original = lastCaseEvent(row, 'open');
  const pinned = original && saleOperation(original).originalParcelLineId;
  if (typeof pinned === 'string') return pinned;
  const written = caseEvents(row,'agreement').map(event=>({at:event.occurredAt,operation:saleOperation(event)}))
    .filter(({operation})=>!operation.historical && typeof operation.originalParcelLineId==='string')
    .sort((a,b)=>a.at.getTime()-b.at.getTime()).at(-1)?.operation.originalParcelLineId;
  return typeof written === 'string' ? written : null;
}

export function originalSaleParcelShares(row: SaleCase): { parcelLineId: string; quantity: number; evidenceEventId: string | null }[] {
  const pinned = originalSaleParcel(row);
  const confirmed = caseEvents(row, 'bind_original_parcel').flatMap(event => {
    const op = saleOperation(event);
    return typeof op.parcelLineId === 'string' && positiveCents(op.quantity)
      ? [{ parcelLineId: op.parcelLineId, quantity: op.quantity, evidenceEventId: event.id }] : [];
  });
  if (!pinned) return confirmed;
  const shares: ReturnType<typeof originalSaleParcelShares> = confirmed.filter(share => share.parcelLineId === pinned);
  const unverified = row.quantity - shares.reduce((sum, share) => sum + share.quantity, 0);
  if (unverified > 0) shares.push({ parcelLineId: pinned, quantity: unverified, evidenceEventId: null });
  return shares;
}

type SupplierParcel = { id: string; purchaseOrderId: string | null; reference: string };
type SupplierResult = { purchaseOrderId: string; outcome: string; ownerId: string; supplier: string | null; quantity: number;
  originalParcelLineId: string | null; reference: string | null; occurredAt: string };
const supplierPartKey = (purchaseOrderId: string, parcelLineId: string | null) => JSON.stringify([purchaseOrderId,parcelLineId]);

export function supplierProgress(row: SaleCase, parcels: readonly SupplierParcel[], loss?: { purchaseOrderId: string; reference: string },
  next?: SupplierResult, addedShare?: { parcelLineId: string; quantity: number }) {
  const sources = new Map<string,{purchaseOrderId:string;parcelLineId:string|null;quantity:number;reference:string|null}>();
  if (loss) {
    sources.set(supplierPartKey(loss.purchaseOrderId,null), {
      purchaseOrderId:loss.purchaseOrderId,parcelLineId:null,quantity:row.quantity,reference:loss.reference });
  } else for (const share of [...originalSaleParcelShares(row), ...(addedShare ? [addedShare] : [])]) {
    const parcel = parcels.find(item=>item.id===share.parcelLineId);
    if (!parcel?.purchaseOrderId) continue;
    const key = supplierPartKey(parcel.purchaseOrderId,parcel.id);
    const previouslyAssigned = sources.get(key)?.quantity ?? 0;
    sources.set(key,{purchaseOrderId:parcel.purchaseOrderId,parcelLineId:parcel.id,quantity:previouslyAssigned+share.quantity,reference:parcel.reference});
  }
  const history: SupplierResult[] = caseEvents(row,'supplier').flatMap(event => {
    const op = saleOperation(event);
    if (typeof op.purchaseOrderId !== 'string' || typeof op.outcome !== 'string') return [];
    return [{ purchaseOrderId:op.purchaseOrderId,outcome:op.outcome,ownerId:event.actorId,
      supplier:typeof op.supplier==='string'?op.supplier:null,quantity:positiveCents(op.quantity)?op.quantity:row.quantity,
      originalParcelLineId:typeof op.originalParcelLineId==='string'?op.originalParcelLineId:null,reference:event.reference,occurredAt:event.occurredAt.toISOString() }];
  });
  if (next) history.push(next);
  const records = new Map<string,SupplierResult>();
  history.sort((a,b)=>a.occurredAt.localeCompare(b.occurredAt));
  for (const record of history) {
    const matching = [...sources.values()].filter(part=>part.purchaseOrderId===record.purchaseOrderId);
    // Earlier decisions with a single identifiable parcel continue to apply to it.
    const parcelId = record.originalParcelLineId ?? (matching.length===1 ? matching[0].parcelLineId : null);
    const key = supplierPartKey(record.purchaseOrderId,parcelId);
    if (!sources.has(key) && !matching.length) {
      sources.set(key,{purchaseOrderId:record.purchaseOrderId,parcelLineId:parcelId,quantity:record.quantity,reference:null});
    }
    records.set(key,record);
  }
  const scopes = [...sources].map(([key,scope]) => {
    const record = records.get(key);
    const state = record?.outcome==='financial_result' ? 'resolved' : record?.outcome??'unreviewed';
    const supplier = record?.supplier ?? history.findLast(item=>item.purchaseOrderId===scope.purchaseOrderId)?.supplier ?? null;
    return { key, ...scope, state, ownerId:record?.ownerId??null, supplier, lastReference:record?.reference??null };
  });
  if (!scopes.length) return { state:row.supplierState, scopes };
  const ended = scopes.every(part=>part.state==='resolved'||part.state==='no_claim');
  const state = ended ? (scopes.some(part=>part.state==='resolved')?'resolved':'no_claim')
    : scopes.some(part=>part.state!=='unreviewed')?'following':'unreviewed';
  return { state, scopes };
}

type Parcel = Prisma.FulfillmentParcelGetPayload<{ include: typeof parcelInclude }>;

type ResendShipments = Awaited<ReturnType<typeof purchaseShortfalls>>['fulfillment']['resendShipments'];

function deliveryFacts(parcels: Parcel[], shipments: ResendShipments) {
  const parentByReceipt = new Map(parcels.flatMap(parcel => parcel.lines.flatMap(line => line.receipts.map(receipt => [receipt.id, line.id] as const))));
  const resends = new Map(shipments.map(shipment => [shipment.parcelLineId,shipment]));
  return parcels.flatMap(parcel => parcel.lines.map(line => {
    const sourceParcelLineId = (line.sourceReceiptId && parentByReceipt.get(line.sourceReceiptId)) || line.id;
    const source = resends.get(sourceParcelLineId);
    const assignments = source?.ambiguous ? source.allocations.filter(allocation => allocation.parcelLineId === line.id)
      : source?.allocations.map(allocation => ({ ...allocation, parcelLineId: line.id, quantity: line.quantity })) ?? [];
    const approvalId = source?.approvalId ?? null;
    return {
      id: line.id, orderItemId: line.orderItemId, purchaseOrderId: line.purchaseOrderId, parcelId: parcel.id, route: parcel.route,
      reference: parcel.trackingNumber ?? parcel.reference, quantity: line.quantity, dispatchedAt: parcel.dispatchedAt.toISOString(),
      approvalId, sourceParcelLineId, resendAttributions: assignments, attributionRequired: source?.ambiguous ?? false,
      afterSaleApprovalId: line.afterSaleApprovalId, receipts: parcel.route === 'supplier_to_libereal' ? [] : customerLineReceipts(parcel, line),
      returns: line.resolutions.filter(item => item.kind === 'return').flatMap(item => {
        const event = parcel.events.find(record => record.id === item.eventId && record.status === 'applied');
        return event ? [{ id: item.id, quantity: item.quantity, occurredAt: event.occurredAt.toISOString(), sha256: event.evidenceSha256 }] : [];
      }),
    };
  }));
}

export async function afterSaleWorkspace(tx: Db, orderId: string) {
  const order = await loadPurchaseOrderSource(tx, orderId);
  const [activities, cases, parcels] = await Promise.all([
    readPurchaseActivities(tx, orderId),
    tx.afterSaleCase.findMany({ where: { orderId }, include: afterSaleCaseInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    tx.fulfillmentParcel.findMany({ where: { orderId }, include: parcelInclude, orderBy: [{ dispatchedAt: 'asc' }, { id: 'asc' }] }),
  ]);
  const [acceptance, { fulfillment: supply, replacementLineage }] = await Promise.all([readPurchaseAcceptance(tx, order, activities), purchaseShortfalls(tx, orderId, activities)]);
  const deliveries = deliveryFacts(parcels, supply.resendShipments);
  const replacements = replacementLineage.flatMap(line => {
    const commitment = activities.find(item => item.purchaseOrderId === line.purchaseOrderId && item.action === 'register_order');
    const op = commitment && purchaseOperation(commitment.detail);
    const execution = purchaseObject(op?.execution);
    const approved = activities.find(event => event.id === execution.approvalId && event.purchaseOrderId === line.purchaseOrderId);
    const ordered = Array.isArray(execution.lines) ? execution.lines.map(purchaseObject).find(item => item.orderItemId === line.orderItemId) : null;
    const supplier = purchaseObject(ordered?.terms).supplier;
    const payableCents = ordered?.payableCents;
    if (!commitment || !approved || !ordered || !positiveCents(ordered.quantity) || ordered.quantity > line.quantity
      || typeof op?.occurredAt !== 'string' || typeof supplier !== 'string' || typeof payableCents !== 'number') return [];
    return [{ ...line, quantity: ordered.quantity, approvalId: approved.id, commitmentId:commitment.id,
      orderedAt: op.occurredAt, supplier, payableCents }];
  });
  const supplierParties = new Map(activities.flatMap(event=>{
    if (event.action!=='register_order'||!event.purchaseOrderId) return [];
    const execution=purchaseObject(purchaseOperation(event.detail).execution);
    const parties=Array.isArray(execution.lines)?execution.lines.map(line=>purchaseObject(purchaseObject(line).terms).supplier):[];
    const name=parties[0];
    return typeof name==='string'&&parties.every(party=>party===name)?[[event.purchaseOrderId,name] as const]:[];
  }));
  const lines = order.orderItems.map(line => ({ id: line.id, name: line.name, brand: line.brand, catalogNumber: line.catalogNumber,
    quantity: line.quantity, unitPrice: line.unitPrice }));
  const shortfalls = supply.shortfalls.map(loss => {
    const resolution = parcels.flatMap(parcel => parcel.lines).flatMap(line => line.resolutions).find(row => row.id === loss.resolutionId);
    const source = resolution && parcels.flatMap(parcel => parcel.events).find(event => event.id === resolution.eventId && event.status === 'applied');
    const approved = supply.freeResends.filter(item => item.orderItemId === loss.orderItemId
      && item.purchaseOrderId === loss.purchaseOrderId && item.shortfallId === loss.resolutionId);
    return { ...loss, kind: resolution?.kind, sha256: source?.evidenceSha256, documentRow: source?.evidenceRow,
      claimed: cases.filter(row => row.shortfallId === loss.resolutionId).reduce((sum,row) => sum + row.quantity, 0),
      approved: approved.map(item => {
        const linked = deliveries.filter(delivery => delivery.orderItemId === item.orderItemId && delivery.purchaseOrderId === item.purchaseOrderId
          && delivery.resendAttributions?.some(part => part.approvalId === item.approvalId && part.shortfallId === loss.resolutionId));
        return { id: item.approvalId, quantity: item.quantity, available: item.available, dispatched: item.dispatched,
          ambiguous: item.pendingAttribution, customerReceived: linked.reduce((sum, delivery) => {
            const quantity = delivery.resendAttributions?.filter(part => part.approvalId === item.approvalId && part.shortfallId === loss.resolutionId)
              .reduce((total, part) => total + part.quantity, 0) ?? 0;
            return sum + Math.min(quantity, delivery.receipts.reduce((total, receipt) => total + receipt.quantity, 0));
          }, 0), parcelLineIds: linked.map(delivery => delivery.id) };
      }),
    };
  });
  return { order: { id: order.id, status: order.status, total: order.total, email: order.email, customerId: order.customerId, organizationId: order.organizationId,
    ownerScope: order.ownerScope, acceptance: acceptance.proof, termsVersion: pricingContentHash({ lines, terms: order.total,
      points: order.pointsDiscount, adjustments: order.adjustmentTotal, acceptance: acceptance.proof }), pointsRefundedCash: order.pointsRefundedCash },
    lines, cases, shortfalls, deliveries, replacements, supplierParties, resendShipments: supply.resendShipments };
}
export type AfterSaleWorkspace = Awaited<ReturnType<typeof afterSaleWorkspace>>;

export function afterSaleAdminView(view: AfterSaleWorkspace, permissions: readonly string[]) {
  const finance = readsSaleFinance(permissions);
  const purchasing = readsSalePurchasing(permissions);
  return { order: { id:view.order.id, status:view.order.status, acceptedAt:view.order.acceptance?.at??null },
    lines:view.lines, deliveries:view.deliveries,
    shortfalls:view.shortfalls.map(({resolutionId,orderItemId,purchaseOrderId,reference,occurredAt,quantity,kind,sha256,documentRow,claimed,approved})=>({
      resolutionId,orderItemId,purchaseOrderId,reference,occurredAt,quantity,kind,sha256,documentRow,claimed,approved,
    })),
    replacements:view.replacements.map(({ id,purchaseOrderId,orderItemId,shortfallId,quantity,supplier,payableCents }) => ({
      id,purchaseOrderId,orderItemId,shortfallId,quantity,supplier:purchasing?supplier:null,payableCents:purchasing?payableCents:null,
    })),
    cases:view.cases.map(row => {
      const supply=supplierProgress(row,view.deliveries,view.shortfalls.find(loss=>loss.resolutionId===row.shortfallId));
      return { id:row.id, orderItemId:row.orderItemId, quantity:row.quantity, relatedCents:finance && row.relatedCents!=null?Number(row.relatedCents):null,
        issue:row.issue, channel:row.channel, report:row.report, reportedAt:row.reportedAt.toISOString(), reference:row.sourceReference,
        shortfallId:row.shortfallId, originalParcelLineId:originalSaleParcel(row), originalParcelShares:originalSaleParcelShares(row),
        agreementId:currentSaleAgreement(row)?.id??null, ownerId:row.ownerId, customerState:row.customerState, supplierState:supply.state, revision:row.revision,
        supplierScopes:supply.scopes.map(scope=>({ ...scope, supplier:purchasing?(scope.supplier??view.supplierParties.get(scope.purchaseOrderId)??null):null })),
        events:row.events.map(event => {
          const operation = saleOperationFor(event.action,saleOperation(event),permissions);
          return { id:event.id, action:event.action, actorId:event.actorId, occurredAt:event.occurredAt.toISOString(),
            reference:operation?event.reference:null, operation };
        }),
      };
    }) };
}

export async function afterSaleQueue(tx: Db, search: string | undefined, pending: boolean) {
  const result = [];
  let cursor: { id: string } | undefined;
  do {
    const rows = await tx.afterSaleCase.findMany({ where: {
      AND: [
        ...(search ? [{ OR: [{ id:{contains:search} }, { orderId:{contains:search} }, { item:{name:{contains:search}} }] }] : []),
        ...(pending ? [{ OR: [{ NOT:{ customerState:'closed', supplierState:{in:['resolved','no_claim']} } },
          { events:{some:{action:'bind_original_parcel'}} }] }] : []),
      ],
    }, include: { ...afterSaleCaseInclude, item: { select: { name:true } } },
      orderBy: [{createdAt:'desc'},{id:'desc'}], cursor, skip:cursor?1:0, take:100 });
    const ids = [...new Set(rows.flatMap(row => originalSaleParcelShares(row).map(part=>part.parcelLineId)))];
    const lines = ids.length ? await tx.fulfillmentParcelLine.findMany({where:{id:{in:ids}},select:{id:true,purchaseOrderId:true,
      parcel:{select:{trackingNumber:true,reference:true}}}}) : [];
    const parcels = lines.map(line=>({id:line.id,purchaseOrderId:line.purchaseOrderId,reference:line.parcel.trackingNumber??line.parcel.reference}));
    const shortfallIds = [...new Set(rows.flatMap(row=>row.shortfallId?[row.shortfallId]:[]))];
    const resolvedLines = shortfallIds.length ? await tx.fulfillmentLineResolution.findMany({where:{id:{in:shortfallIds}},
      select:{id:true,parcelLine:{select:{purchaseOrderId:true}},event:{select:{reference:true}}}}) : [];
    const losses = new Map(resolvedLines.flatMap(record=>record.parcelLine.purchaseOrderId
      ? [[record.id,{purchaseOrderId:record.parcelLine.purchaseOrderId,reference:record.event.reference}] as const] : []));
    for (const row of rows) {
      const supply = supplierProgress(row,parcels,row.shortfallId ? losses.get(row.shortfallId) : undefined);
      if (pending && row.customerState==='closed' && ['resolved','no_claim'].includes(supply.state)) continue;
      result.push({id:row.id,orderId:row.orderId,quantity:row.quantity,issue:row.issue,ownerId:row.ownerId,customerState:row.customerState,
        supplierState:supply.state,item:row.item});
      if (result.length === 100) return result;
    }
    cursor = rows.length === 100 ? {id:rows[99].id} : undefined;
  } while (cursor);
  return result;
}

export async function afterSaleCustomerView(tx: Db, orderId: string) {
  return tx.afterSaleCase.findMany({ where: {orderId}, select: { id: true, orderItemId: true, quantity: true, issue: true, customerState: true,
    reportedAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}
