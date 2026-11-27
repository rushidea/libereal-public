import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import {
  previewPurchaseDraftRequirements, previewSupplierPaymentPreparation, previewSupplyChangeScope,
  purchaseWorkspace, readSupplierPaymentPreparationSource, type PurchaseActionInput,
} from '@/lib/purchase-orders';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';
import { assertBusinessVersion, businessObjectId, invalidBusinessInput, strictFields } from './business-route';
import { HarnessServiceError } from './inquiry-tools-service';

type IdContext = { pilotOrderIds: readonly string[] };
type Fields = Record<string, unknown>;
type Workspace = Awaited<ReturnType<typeof purchaseWorkspace>>;
type Purchase = Workspace['orders'][number];

function facts(blockers: string[]) {
  return { allowed: blockers.length === 0, blockers, humanActionRequired: true };
}

function missingPurchase(): never {
  throw new HarnessServiceError(404, 'not_found', 'OBJECT_NOT_FOUND', '未找到指定的业务单据');
}

async function readWorkspace(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { archivedAt: true, updatedAt: true } });
  if (!order) missingPurchase();
  const view = await purchaseWorkspace(tx, orderId);
  const archived = Boolean(order.archivedAt);
  const paymentSource = await readSupplierPaymentPreparationSource(tx, view);
  const purchases = view.orders.map(purchase => ({
    purchaseOrderId: purchase.id, status: purchase.status,
    version: pricingContentHash({
      archived, updatedAt: order.updatedAt, startVersion: view.startReview.version, purchase,
      fulfillment: view.fulfillment, remaining: view.customerRemaining,
      ...(purchase.orderedBefore || !paymentSource ? {} : { paymentLines: paymentSource.lines }),
    }),
    ordered: purchase.orderedBefore, onHold: purchase.status === 'on_hold',
    totalCents: purchase.totalCents, paidCents: purchase.paidCents, dueCents: purchase.dueCents,
    lines: purchase.lines.map(line => ({ orderItemId: line.orderItemId, quantity: line.source.quantity })),
    remaining: purchase.remaining,
    canRegisterOrder: purchase.canRegisterOrder,
    needsFundingReapproval: purchase.needsFundingReapproval,
    incidents: purchase.incidents.map(incident => ({
      incidentId: incident.id, changeKind: incident.changeKind, status: incident.status,
      outstanding: incident.outstanding?.map(({ orderItemId, quantity }) => ({ orderItemId, quantity })) ?? null,
    })),
  }));
  const data = {
    orderId, orderStatus: view.orderStatus, archived, eligible: view.eligibility.eligible,
    canPrepare: view.canPrepare && !archived, purchases,
    lines: view.lines.map(line => ({ orderItemId: line.orderItemId,
      availableQuantity: line.availableQuantity, purchaseOrderId: line.purchaseOrderId,
      revision: line.revision, missingTerms: line.missing,
    })),
  };
  const candidates = data.canPrepare ? await previewPurchaseDraftRequirements(tx, view) : [];
  return {
    view, data, candidates, paymentSource, objectVersion: pricingContentHash({
      data, candidates, updatedAt: order.updatedAt, startVersion: view.startReview.version, remaining: view.customerRemaining,
    }),
  };
}

function selectedPurchase(result: Awaited<ReturnType<typeof readWorkspace>>, purchaseOrderId: string, expectedVersion: string): Purchase {
  const index = result.data.purchases.findIndex(purchase => purchase.purchaseOrderId === purchaseOrderId);
  if (index === -1) missingPurchase();
  assertBusinessVersion(result.data.purchases[index].version, expectedVersion);
  return result.view.orders[index];
}

export function getPurchaseWorkspaceForHarness(orderId: string) {
  return prisma.$transaction(async tx => {
    const { objectVersion, data } = await readWorkspace(tx, orderId);
    return { objectVersion, data };
  });
}

export function previewPurchasePreparationForHarness(orderId: string, _context: IdContext, _input: Fields, expectedVersion: string) {
  return prisma.$transaction(async tx => {
    const { objectVersion, data, candidates } = await readWorkspace(tx, orderId);
    assertBusinessVersion(objectVersion, expectedVersion);
    const blockers = candidates.length ? [] : ['NO_UNPREPARED_PURCHASE_DEMAND'];
    if (!data.eligible || data.archived) blockers.unshift('PURCHASE_NOT_ELIGIBLE');
    return { objectVersion, data: { ...facts(blockers), orderId, candidates, preparedLineCount: data.lines.length } };
  });
}

export function previewSupplierPaymentForHarness(orderId: string, _context: IdContext, input: Fields, expectedVersion: string) {
  const purchaseOrderId = businessObjectId(input.purchaseOrderId);
  const { amountCents } = input;
  if (!positiveCents(amountCents)) invalidBusinessInput();
  return prisma.$transaction(async tx => {
    const result = await readWorkspace(tx, orderId);
    const purchase = selectedPurchase(result, purchaseOrderId, expectedVersion);
    const { blockers, dueCents } = result.data.archived || purchase.status === 'superseded'
      ? { blockers: ['PURCHASE_INACTIVE'], dueCents: purchase.dueCents }
      : previewSupplierPaymentPreparation(result.view, purchase, amountCents, result.paymentSource);
    return { objectVersion: expectedVersion, data: {
      ...facts(blockers), orderId, purchaseOrderId, amountCents, dueCents, paidCents: purchase.paidCents,
    } };
  });
}

function changeKind(value: unknown): NonNullable<PurchaseActionInput['changeKind']> {
  if (value !== 'delay' && value !== 'unavailable' && value !== 'price' && value !== 'other') invalidBusinessInput();
  return value;
}

export function previewSupplyChangeForHarness(orderId: string, _context: IdContext, input: Fields, expectedVersion: string) {
  const purchaseOrderId = businessObjectId(input.purchaseOrderId);
  const kind = changeKind(input.changeKind);
  if (!Array.isArray(input.affectedLines) || !input.affectedLines.length || input.affectedLines.length > 100) invalidBusinessInput();
  const affectedLines = input.affectedLines.map(line => {
    const { orderItemId, quantity } = strictFields(line, ['orderItemId', 'quantity']);
    if (!positiveCents(quantity)) invalidBusinessInput();
    return { orderItemId: businessObjectId(orderItemId), quantity };
  });
  if (new Set(affectedLines.map(line => line.orderItemId)).size !== affectedLines.length) invalidBusinessInput();
  return prisma.$transaction(async tx => {
    const result = await readWorkspace(tx, orderId);
    const purchase = selectedPurchase(result, purchaseOrderId, expectedVersion);
    const blockers = [];
    let scope = null;
    if (result.data.archived || purchase.status === 'superseded') blockers.push('PURCHASE_INACTIVE');
    else {
      try {
        scope = previewSupplyChangeScope(result.view, purchase, kind, affectedLines);
        if (!scope) blockers.push('SUPPLY_CHANGE_SCOPE_NOT_AVAILABLE');
      } catch (error) {
        if (!(error instanceof PurchaseError)) throw error;
        blockers.push('SUPPLY_CHANGE_SCOPE_NOT_AVAILABLE');
      }
    }
    return { objectVersion: expectedVersion, data: {
      ...facts(blockers), orderId, purchaseOrderId, changeKind: kind,
      affectedLines: scope ?? [], currentStatus: purchase.status,
    } };
  });
}
