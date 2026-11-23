import { type Prisma } from '@prisma/client';
import { customerLineReceipts } from '@/lib/fulfillment-accounting';
import { parcelInclude, type FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { purchaseObject, readPurchaseActivities } from '@/lib/purchase-activity';
import { readPurchaseAcceptance } from '@/lib/purchase-acceptance';
import { purchaseShortfalls } from '@/lib/purchase-shortfalls';
import { loadPurchaseOrderSource } from '@/lib/purchase-source';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';

export const afterSaleCaseInclude = { events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } satisfies Prisma.AfterSaleCaseInclude;
export type SaleCase = Prisma.AfterSaleCaseGetPayload<{ include: typeof afterSaleCaseInclude }>;
export const saleOperation = (event: SaleCase['events'][number]) => purchaseObject(jsonObject(event.detail).operation);
export const caseEvents = (row: SaleCase, action: string) => row.events.filter(event => event.action === action);
export const lastCaseEvent = (row: SaleCase, action: string) => caseEvents(row, action).at(-1);

type Parcel = Prisma.FulfillmentParcelGetPayload<{ include: typeof parcelInclude }>;

function deliveryFacts(parcels: Parcel[]) {
  const roots = new Map<string, string>();
  const approvalByLine = new Map<string, string>();
  for (const parcel of parcels) {
    const dispatch = parcel.events.find(event => event.kind === 'dispatch' && event.status === 'applied');
    const operations = dispatch && jsonObject(dispatch.details).lines;
    for (const line of parcel.lines) {
      const source = line.sourceReceiptId;
      if (source) roots.set(line.id, source);
      if (!Array.isArray(operations)) continue;
      const exact = operations.filter(item => item?.parcelLineId === line.id && item.orderItemId === line.orderItemId
        && item.purchaseOrderId === line.purchaseOrderId);
      if (exact.length === 1 && typeof exact[0].resendApprovalId === 'string') approvalByLine.set(line.id, exact[0].resendApprovalId);
    }
  }
  const parentByReceipt = new Map(parcels.flatMap(parcel => parcel.lines.flatMap(line => line.receipts.map(receipt => [receipt.id, line.id] as const))));
  return parcels.flatMap(parcel => parcel.lines.map(line => {
    const sourceLine = roots.get(line.id);
    const parent = sourceLine && parentByReceipt.get(sourceLine);
    const approvalId = approvalByLine.get(line.id) ?? (parent && approvalByLine.get(parent)) ?? null;
    return {
      id: line.id, orderItemId: line.orderItemId, purchaseOrderId: line.purchaseOrderId, parcelId: parcel.id, route: parcel.route,
      reference: parcel.trackingNumber ?? parcel.reference, quantity: line.quantity, dispatchedAt: parcel.dispatchedAt.toISOString(),
      approvalId, receipts: parcel.route === 'supplier_to_libereal' ? [] : customerLineReceipts(parcel, line),
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
  const [acceptance, supply] = await Promise.all([readPurchaseAcceptance(tx, order, activities), purchaseShortfalls(tx, orderId, activities)]);
  const deliveries = deliveryFacts(parcels);
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
        const same = supply.freeResends.filter(other => other.approvalId === item.approvalId && other.purchaseOrderId === item.purchaseOrderId
          && other.orderItemId === item.orderItemId);
        const ambiguous = new Set(same.map(other => other.shortfallId)).size > 1;
        const linked = ambiguous ? [] : deliveries.filter(delivery => delivery.approvalId === item.approvalId
          && delivery.orderItemId === item.orderItemId && delivery.purchaseOrderId === item.purchaseOrderId);
        return { id: item.approvalId, quantity: item.quantity, available: item.available, dispatched: item.dispatched, ambiguous,
          customerReceived: linked.reduce((sum, delivery) => sum + delivery.receipts.reduce((total, receipt) => total + receipt.quantity, 0), 0),
          parcelLineIds: linked.map(delivery => delivery.id) };
      }),
    };
  });
  return { order: { id: order.id, status: order.status, total: order.total, email: order.email, customerId: order.customerId, organizationId: order.organizationId,
    ownerScope: order.ownerScope, acceptance: acceptance.proof, termsVersion: pricingContentHash({ lines, terms: order.total,
      points: order.pointsDiscount, adjustments: order.adjustmentTotal, acceptance: acceptance.proof }), pointsRefundedCash: order.pointsRefundedCash },
    lines, cases, shortfalls, deliveries };
}
export type AfterSaleWorkspace = Awaited<ReturnType<typeof afterSaleWorkspace>>;

export function afterSaleAdminView(view: AfterSaleWorkspace, permissions: readonly string[]) {
  const finance = permissions.includes('finance.read');
  const procurement = permissions.includes('purchases.read');
  return { order: { id: view.order.id, status: view.order.status, acceptedAt: view.order.acceptance?.at ?? null },
    lines: view.lines, deliveries: view.deliveries, shortfalls: view.shortfalls,
    cases: view.cases.map(row => ({
      id: row.id, orderItemId: row.orderItemId, quantity: row.quantity, relatedCents: row.relatedCents == null ? null : Number(row.relatedCents),
      issue: row.issue, channel: row.channel, report: row.report, reportedAt: row.reportedAt.toISOString(), reference: row.sourceReference,
      shortfallId: row.shortfallId, ownerId: row.ownerId, customerState: row.customerState, supplierState: row.supplierState, revision: row.revision,
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
