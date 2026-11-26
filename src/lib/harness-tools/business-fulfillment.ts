import type { Prisma } from '@prisma/client';
import { previewReceiptScope, receiptKnownInventoryAccount } from '@/lib/fulfillment-events';
import { fulfillmentWorkspace, previewDispatchScope } from '@/lib/fulfillment-parcels';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';
import { assertBusinessVersion, businessObjectId, invalidBusinessInput, strictFields } from './business-route';
import { HarnessServiceError } from './inquiry-tools-service';

const routes = ['supplier_to_customer', 'supplier_to_libereal', 'libereal_to_customer'] as const;
type Route = (typeof routes)[number];
type Fields = Record<string, unknown>;

const dispatchValidationCodes = new Set([
  'SHIPMENT_ITEMS_REQUIRED', 'INVALID_SHIPMENT_QUANTITY', 'ORDER_ITEM_NOT_FOUND', 'SHIPMENT_QUANTITY_EXCEEDED',
]);

async function readFulfillment(tx: Prisma.TransactionClient, orderId: string) {
  const archivedAt = (await tx.order.findUnique({ where: { id: orderId }, select: { archivedAt: true } }))?.archivedAt;
  if (archivedAt === undefined) {
    throw new HarnessServiceError(404, 'not_found', 'OBJECT_NOT_FOUND', '未找到指定业务单据');
  }
  const now = new Date();
  const view = await fulfillmentWorkspace(tx, orderId, now.getTime());
  const data = {
    orderId, orderStatus: view.order.status, archived: Boolean(archivedAt),
    carrierFeedConfigured: view.feedSource !== null,
    orderLines: view.order.orderItems.map(line => ({ orderItemId: line.id, quantity: line.quantity, shippedQuantity: line.shippedQty })),
    purchases: view.purchases.map(line => ({
      purchaseOrderId: line.purchaseOrderId, orderItemId: line.orderItemId, availableQuantity: line.available,
    })),
    forwardableReceipts: view.receipts.map(line => ({
      receiptId: line.id, purchaseOrderId: line.purchaseOrderId, orderItemId: line.orderItemId, availableQuantity: line.available,
    })),
    parcels: view.parcels.map(parcel => ({
      parcelId: parcel.id, route: parcel.route, status: parcel.status, hasWaybill: Boolean(parcel.trackingNumber),
      dispatchedAt: parcel.dispatchedAt.toISOString(),
      lines: parcel.lines.map(line => ({
        parcelLineId: line.id, purchaseOrderId: line.purchaseOrderId, orderItemId: line.orderItemId,
        sourceReceiptId: line.sourceReceiptId, ...line.balance,
        receipts: line.receipts.map(receipt => ({
          receiptId: receipt.id, eventId: receipt.eventId, quantity: receipt.quantity,
          forwardedQuantity: receipt.forwardedQuantity, releasedQuantity: receipt.releasedQuantity,
        })),
      })),
      events: parcel.events.map(event => ({
        eventId: event.id, kind: event.kind, status: event.status, occurredAt: event.occurredAt.toISOString(),
        carrierReported: event.source.startsWith('carrier/'),
        physicalReceipt: event.status === 'applied' && (event.kind === 'warehouse_receipt' || event.kind === 'customer_delivery'),
      })),
    })),
    carrierNoticeNeedsHumanMatching: view.unmatched.length > 0,
  };
  const objectVersion = pricingContentHash({
    data, archivedAt, receipts: view.receipts, purchases: view.purchases,
    unverifiedStockLines: view.unverifiedStockLines,
    inventory: view.inventoryChoices.map(({ parcelLineId, version }) => ({ parcelLineId, version })),
    parcels: view.parcels.map(parcel => ({
      id: parcel.id, carrier: parcel.carrier, trackingNumber: parcel.trackingNumber, holdFacts: parcel.holdFacts,
      lines: parcel.lines.map(line => ({ resolutions: line.resolutions, afterSaleApprovalId: line.afterSaleApprovalId })),
    })),
  });
  return { view, data, objectVersion, now };
}

export function getFulfillmentState(orderId: string) {
  return prisma.$transaction(async tx => {
    const { objectVersion, data } = await readFulfillment(tx, orderId);
    return { objectVersion, data };
  });
}

function readLines(input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 30) invalidBusinessInput();
  return input as unknown[];
}

function trackingText(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()
    || value.length > 100 || /\p{Cc}/u.test(value)) invalidBusinessInput();
  return value;
}

function parseIntent(input: unknown) {
  if (!input || typeof input !== 'object') invalidBusinessInput();
  const { action } = input as Fields;
  if (action === 'dispatch') {
    const { route, carrier, trackingNumber, lines } = strictFields(input, ['action', 'route', 'carrier', 'trackingNumber', 'lines']);
    if (!routes.includes(route as Route)) invalidBusinessInput();
    const routeType = route as Route;
    const carrierName = trackingText(carrier);
    const waybill = trackingText(trackingNumber);
    if (Boolean(carrierName) !== Boolean(waybill)) invalidBusinessInput();
    const parsed = readLines(lines).map(value => {
      const row = strictFields(value, ['purchaseOrderId', 'orderItemId', 'quantity', 'sourceReceiptId']);
      if (!positiveCents(row.quantity)) invalidBusinessInput();
      const sourceReceiptId = row.sourceReceiptId === null ? null : businessObjectId(row.sourceReceiptId);
      if ((routeType === 'libereal_to_customer') !== Boolean(sourceReceiptId)) invalidBusinessInput();
      return { purchaseOrderId: businessObjectId(row.purchaseOrderId), orderItemId: businessObjectId(row.orderItemId),
        quantity: row.quantity, sourceReceiptId };
    });
    if (new Set(parsed.map(row => JSON.stringify([row.purchaseOrderId, row.orderItemId, row.sourceReceiptId]))).size !== parsed.length) {
      invalidBusinessInput();
    }
    return { action, route: routeType, carrier: carrierName, trackingNumber: waybill, lines: parsed } as const;
  }
  if (action !== 'warehouse_receipt' && action !== 'customer_delivery') invalidBusinessInput();
  const { parcelId, lines } = strictFields(input, ['action', 'parcelId', 'lines']);
  const parsed = readLines(lines).map(value => {
    const row = strictFields(value, ['parcelLineId', 'quantity']);
    if (!positiveCents(row.quantity)) invalidBusinessInput();
    return { parcelLineId: businessObjectId(row.parcelLineId), quantity: row.quantity };
  });
  if (new Set(parsed.map(row => row.parcelLineId)).size !== parsed.length) invalidBusinessInput();
  return { action, parcelId: businessObjectId(parcelId), lines: parsed } as const;
}

function assertReceiptInventoryScope(
  view: Awaited<ReturnType<typeof fulfillmentWorkspace>>, parcel: Awaited<ReturnType<typeof fulfillmentWorkspace>>['parcels'][number],
  requested: Array<{ parcelLineId: string }>,
) {
  for (const { parcelLineId } of requested) {
    const options = view.inventoryChoices.find(row => row.parcelLineId === parcelLineId);
    const line = parcel.lines.find(item => item.id === parcelLineId);
    if (!line || view.unverifiedStockLines.includes(parcelLineId)) throw new PurchaseError('库存来源待核对');
    const account = receiptKnownInventoryAccount(line);
    if (!options?.candidates.some(candidate => !account || candidate.inventoryAccountId === account)) {
      throw new PurchaseError('没有可核对的原库存账户');
    }
  }
}

export function previewFulfillmentEvent(orderId: string, _context: unknown, input: Fields, expectedVersion: string) {
  const intent = parseIntent(input.intent);
  return prisma.$transaction(async tx => {
    const { view, objectVersion, data, now } = await readFulfillment(tx, orderId);
    assertBusinessVersion(objectVersion, expectedVersion);
    const blockers = data.archived ? ['ORDER_ARCHIVED'] : [];
    let lines: unknown[] = [];
    if (!blockers.length) {
      try {
        if (intent.action === 'dispatch') {
          const plan = await previewDispatchScope(tx, orderId, view, intent, now);
          lines = plan.lines.map(({ purchaseOrderId, orderItemId, quantity, sourceReceiptId }) => ({
            purchaseOrderId, orderItemId, quantity, sourceReceiptId,
          }));
        } else {
          const parcel = view.parcels.find(item => item.id === intent.parcelId);
          if (!parcel) blockers.push('PARCEL_OUTSIDE_ORDER');
          else {
            const plan = previewReceiptScope(parcel, intent.action, intent.lines);
            if (intent.action === 'warehouse_receipt') assertReceiptInventoryScope(view, parcel, intent.lines);
            lines = plan;
          }
        }
      } catch (error) {
        if (!(error instanceof PurchaseError)
          && !(error instanceof Error && dispatchValidationCodes.has(error.message))) throw error;
        blockers.push(intent.action === 'dispatch' ? 'DISPATCH_SCOPE_REJECTED' : 'PHYSICAL_RECEIPT_SCOPE_REJECTED');
      }
    }
    return { objectVersion, data: {
      orderId, action: intent.action, ...(intent.action === 'dispatch' ? { route: intent.route } : { parcelId: intent.parcelId }),
      lines, allowed: !blockers.length, blockers, humanActionRequired: true,
      physicalEvidenceRequired: true, carrierNoticeProvesReceipt: false,
    } };
  });
}
