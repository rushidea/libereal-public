import type { Prisma } from '@prisma/client';
import { previewAfterSalePhysical } from '@/lib/after-sale-actions';
import { activeRefundSourceReview, actualRefunded, previewApprovedRefund, refundPosition } from '@/lib/after-sale-refunds';
import { afterSaleWorkspace, caseEvents, currentSaleAgreement, originalSaleParcelShares, saleOperation, supplierProgress, unambiguousOriginalSaleDelivery } from '@/lib/after-sale-workspace';
import { prisma } from '@/lib/prisma';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { purchaseObject } from '@/lib/purchase-activity';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';
import { assertBusinessVersion, businessObjectId, invalidBusinessInput, strictFields } from './business-route';
import { HarnessServiceError } from './inquiry-tools-service';

function missingCase(): never {
  throw new HarnessServiceError(404, 'not_found', 'OBJECT_NOT_FOUND', '未找到指定售后案');
}

async function readAfterSale(tx: Prisma.TransactionClient, caseId: string) {
  const link = await tx.afterSaleCase.findUnique({
    where: { id: caseId }, select: { orderId: true, order: { select: { archivedAt: true } } },
  });
  if (!link) missingCase();
  const view = await afterSaleWorkspace(tx, link.orderId);
  const row = view.cases.find(item => item.id === caseId);
  if (!row) missingCase();
  const now = Date.now();
  const agreement = currentSaleAgreement(row);
  const operation = purchaseObject(agreement && saleOperation(agreement));
  const loss = view.shortfalls.find(item => item.resolutionId === row.shortfallId);
  const progress = supplierProgress(row, view.deliveries, loss);
  const shares = originalSaleParcelShares(row);
  const approvals = caseEvents(row, 'approve_exchange').filter(event => saleOperation(event).agreementId === agreement?.id);
  const replacementPurchases = (Array.isArray(operation.replacements) ? operation.replacements : [operation.replacement])
    .map(purchaseObject).map(item => item.purchaseOrderId).filter((id): id is string => typeof id === 'string');
  const approvedResends = new Set(loss?.approved.map(item => item.id));
  const deliveries = view.deliveries.filter(item => item.orderItemId === row.orderItemId && item.route !== 'supplier_to_libereal');
  const originalId = !shares.length ? unambiguousOriginalSaleDelivery(view, row.orderItemId)?.id : undefined;
  const originals = deliveries.filter(item => shares.length ? shares.some(share => share.parcelLineId === item.id) : item.id === originalId);
  const replacements = deliveries.filter(item => approvals.some(approval => approval.id === item.afterSaleApprovalId)
    || Boolean(item.purchaseOrderId && replacementPurchases.includes(item.purchaseOrderId))
    || item.resendAttributions?.some(part => part.shortfallId === row.shortfallId && approvedResends.has(part.approvalId)));
  const projectDelivery = (item: (typeof deliveries)[number]) => ({
    parcelLineId: item.id, parcelId: item.parcelId, route: item.route, purchaseOrderId: item.purchaseOrderId,
    orderItemId: item.orderItemId, quantity: item.quantity, exchangeApprovalId: item.afterSaleApprovalId,
    shortfallResendApprovalIds: item.resendAttributions?.filter(part => part.shortfallId === row.shortfallId
      && approvedResends.has(part.approvalId)).map(part => part.approvalId) ?? [],
    physicalReceipts: item.receipts.filter(receipt => receipt.at <= now).map(({ eventId, quantity }) => ({ eventId, quantity })),
    returns: item.returns.filter(receipt => Date.parse(receipt.occurredAt) <= now).map(({ id, quantity }) => ({ resolutionId: id, quantity })),
  });

  let position: Awaited<ReturnType<typeof refundPosition>> | null = null;
  try {
    position = await refundPosition(tx, view, row);
  } catch (error) {
    if (!(error instanceof PurchaseError)) throw error;
  }
  const data = {
    caseId, orderId: link.orderId, orderItemId: row.orderItemId, archived: Boolean(link.order.archivedAt),
    customerState: row.customerState, supplierState: progress.state, claimedByStaff: Boolean(row.ownerId),
    caseQuantity: row.quantity, agreementId: agreement?.id ?? null, remedy: operation.remedy ?? (loss?.approved.length ? 'resend' : null),
    originalParcelShares: shares, originalParcels: originals.map(projectDelivery), replacementParcels: replacements.map(projectDelivery),
    supplierFollowup: progress.scopes.map(({ purchaseOrderId, parcelLineId, quantity, state }) => ({ purchaseOrderId, parcelLineId, quantity, state })),
    shortfallId: loss?.resolutionId ?? null,
    originalPayment: {
      verifiedPaidCents: position?.paidCents ?? null, refundedCents: actualRefunded(row),
      sourceReviewed: Boolean(activeRefundSourceReview(row)), originalCashPostingIds: position?.originalCash.map(([id]) => id) ?? [],
    },
    refundResults: caseEvents(row, 'refund_result').map(event => {
      const result = saleOperation(event);
      return { eventId: event.id, outcome: result.result, amountCents: result.amountCents, approvalId: result.approvalId };
    }),
  };
  const objectVersion = pricingContentHash({
    data, order: view.order, cases: view.cases.map(({ id, revision, events, ownerId, customerState }) =>
      ({ id, revision, events, ownerId, customerState })),
    deliveries, loss, replacements: view.replacements.filter(item => item.orderItemId === row.orderItemId), position,
  });
  return { view, row, data, objectVersion, position, now };
}

export function getAfterSaleCase(caseId: string) {
  return prisma.$transaction(async tx => {
    const { data, objectVersion } = await readAfterSale(tx, caseId);
    return { data, objectVersion };
  });
}

function parseIntent(value: unknown) {
  if (!value || typeof value !== 'object') invalidBusinessInput();
  const { action } = value as Record<string, unknown>;
  if (action === 'refund') {
    const { amountCents } = strictFields(value, ['action', 'amountCents']);
    if (!positiveCents(amountCents)) invalidBusinessInput();
    return { action, amountCents } as const;
  }
  if (action !== 'return' && action !== 'exchange' && action !== 'resend') invalidBusinessInput();
  const raw = strictFields(value, ['action', 'result', 'parcelLineId', 'quantity', 'resolutionId', 'resendApprovalId']);
  if ((raw.result !== 'return' && raw.result !== 'delivery') || !positiveCents(raw.quantity)) invalidBusinessInput();
  const resolutionId = raw.resolutionId === null ? null : businessObjectId(raw.resolutionId);
  const resendApprovalId = raw.resendApprovalId === null ? null : businessObjectId(raw.resendApprovalId);
  if ((raw.result === 'return') !== Boolean(resolutionId) || (action !== 'resend' && resendApprovalId)) invalidBusinessInput();
  if ((action === 'return' && raw.result !== 'return') || (action === 'resend' && raw.result !== 'delivery')) invalidBusinessInput();
  return { action, result: raw.result, parcelLineId: businessObjectId(raw.parcelLineId),
    quantity: raw.quantity, resolutionId, resendApprovalId } as const;
}

export function previewAfterSaleActionForHarness(caseId: string, _context: unknown, input: Record<string, unknown>, expectedVersion: string) {
  const intent = parseIntent(input.intent);
  return prisma.$transaction(async tx => {
    const { view, row, objectVersion, position, data, now } = await readAfterSale(tx, caseId);
    assertBusinessVersion(objectVersion, expectedVersion);
    const blockers = data.archived ? ['ORDER_ARCHIVED'] : [];
    let projection: Record<string, unknown> | null = null;
    if (!blockers.length && intent.action === 'refund') {
      const refund = previewApprovedRefund(row, position, intent.amountCents);
      blockers.push(...refund.blockers);
      projection = { approvalId: refund.approvalId, approvalRemainingCents: refund.approvalRemainingCents,
        verifiedPaidCents: position?.paidCents ?? null, refundedCents: data.originalPayment.refundedCents };
    } else if (!blockers.length && intent.action !== 'refund') {
      if (data.remedy !== intent.action) blockers.push('AFTER_SALE_REMEDY_MISMATCH');
      else {
        try {
          const line = view.deliveries.find(item => item.id === intent.parcelLineId);
          if (intent.resendApprovalId) {
            const agreement = currentSaleAgreement(row);
            const fixed = agreement && saleOperation(agreement).resendApprovalId;
            if ((fixed && fixed !== intent.resendApprovalId)
              || !line?.resendAttributions.some(part => part.shortfallId === row.shortfallId && part.approvalId === intent.resendApprovalId)) {
              throw new PurchaseError('重发批准不属于本案短失和包裹行');
            }
          }
          const plan = previewAfterSalePhysical(view, row, intent, now);
          projection = {
            nextCustomerState: plan.customerState, orderItemId: row.orderItemId,
            parcelId: line?.parcelId, resolutionId: plan.operation.resolutionId,
            receiptEventIds: intent.result === 'delivery' ? [...new Set(line?.receipts.filter(receipt => receipt.at <= now).map(receipt => receipt.eventId))] : [],
          };
        } catch (error) {
          if (!(error instanceof PurchaseError)) throw error;
          blockers.push('PHYSICAL_EVIDENCE_OUTSIDE_CASE_OR_INSUFFICIENT');
        }
      }
    }
    return { objectVersion, data: {
      caseId, orderId: data.orderId, orderItemId: row.orderItemId, ...intent, projection,
      allowed: !blockers.length, blockers, humanActionRequired: true, changesSupplierPayable: false,
    } };
  });
}
