import { type Prisma } from '@prisma/client';
import { customerLineReceipts } from '@/lib/fulfillment-accounting';
import { parcelInclude, type FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { purchaseObject, purchaseOperation, readPurchaseActivities } from '@/lib/purchase-activity';
import { readPurchaseAcceptance } from '@/lib/purchase-acceptance';
import { purchaseShortfalls } from '@/lib/purchase-shortfalls';
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
  const agreement = currentSaleAgreement(row);
  const covered = agreement && saleOperation(agreement).originalParcelLineId;
  return typeof pinned === 'string' ? pinned : typeof covered === 'string' ? covered : null;
}

type Parcel = Prisma.FulfillmentParcelGetPayload<{ include: typeof parcelInclude }>;

type ResendShipments = Awaited<ReturnType<typeof purchaseShortfalls>>['resendShipments'];

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
  const [activities, cases, parcels, replacementLines] = await Promise.all([
    readPurchaseActivities(tx, orderId),
    tx.afterSaleCase.findMany({ where: { orderId }, include: afterSaleCaseInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    tx.fulfillmentParcel.findMany({ where: { orderId }, include: parcelInclude, orderBy: [{ dispatchedAt: 'asc' }, { id: 'asc' }] }),
    tx.purchaseReplacementLine.findMany({ where: { orderId }, select: { id:true, purchaseOrderId:true, orderItemId:true,
      fromPurchaseOrderId:true, authorizationId:true, quantity:true } }),
  ]);
  const [acceptance, supply] = await Promise.all([readPurchaseAcceptance(tx, order, activities), purchaseShortfalls(tx, orderId, activities)]);
  const deliveries = deliveryFacts(parcels, supply.resendShipments);
  const replacements = replacementLines.flatMap(line => {
    const authorization = activities.find(item => item.id === line.authorizationId && item.action === 'resolve_change');
    const commitment = activities.find(item => item.purchaseOrderId === line.purchaseOrderId && item.action === 'register_order');
    const resolution = authorization && purchaseOperation(authorization.detail);
    const disposition = Array.isArray(resolution?.dispositions) && resolution.dispositions.find(item => item.orderItemId === line.orderItemId
      && item.outcome === 'replace' && item.quantity >= line.quantity);
    if (!authorization || authorization.purchaseOrderId !== line.fromPurchaseOrderId || !commitment || !disposition) return [];
    return [{ ...line, commitmentId:commitment.id, shortfallId: disposition.shortfallId ?? disposition.forwardingLossId ?? null }];
  });
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
    lines, cases, shortfalls, deliveries, replacements, resendShipments: supply.resendShipments };
}
export type AfterSaleWorkspace = Awaited<ReturnType<typeof afterSaleWorkspace>>;

export function afterSaleAdminView(view: AfterSaleWorkspace, permissions: readonly string[]) {
  const finance = permissions.includes('finance.read');
  const procurement = permissions.includes('purchases.read');
  return { order: { id: view.order.id, status: view.order.status, acceptedAt: view.order.acceptance?.at ?? null },
    lines: view.lines, deliveries: view.deliveries, shortfalls: view.shortfalls, replacements: view.replacements,
    cases: view.cases.map(row => ({
      id: row.id, orderItemId: row.orderItemId, quantity: row.quantity, relatedCents: row.relatedCents == null ? null : Number(row.relatedCents),
      issue: row.issue, channel: row.channel, report: row.report, reportedAt: row.reportedAt.toISOString(), reference: row.sourceReference,
      shortfallId: row.shortfallId, originalParcelLineId: originalSaleParcel(row), agreementId: currentSaleAgreement(row)?.id ?? null, ownerId: row.ownerId, customerState: row.customerState, supplierState: row.supplierState, revision: row.revision,
      events: row.events.map(event => {
        const hidden = ((event.action.includes('refund') || (event.action === 'agreement' && saleOperation(event).remedy === 'refund')) && !finance) || (event.action === 'supplier' && !procurement && !finance);
        return { id: event.id, action: event.action, actorId: event.actorId, occurredAt: event.occurredAt.toISOString(),
          reference: hidden ? null : event.reference, operation: hidden ? null : saleOperation(event) };
      }),
    })) };
}

export async function afterSaleCustomerView(tx: Db, orderId: string) {
  return tx.afterSaleCase.findMany({ where: {orderId}, select: { id: true, orderItemId: true, quantity: true, issue: true, customerState: true,
    reportedAt: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
}
