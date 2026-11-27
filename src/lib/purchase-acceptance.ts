import type { Prisma } from '@prisma/client';
import { isPostDeliveryPaymentMethod } from '@/data/payment-methods';
import { orderApprovalTerms } from '@/lib/order-approval';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { purchaseObject, purchaseOperation, type PurchaseActivity } from '@/lib/purchase-activity';
import type { SourceOrder } from '@/lib/purchase-source';

type Db = Prisma.TransactionClient;

export function isActivePurchaseOrder(order: Pick<SourceOrder, 'status' | 'archivedAt'>) {
  return !order.archivedAt && ['confirmed', 'partially_shipped', 'shipped', 'completed'].includes(order.status);
}

export async function readPurchaseAcceptance(tx: Db, order: SourceOrder, activities: PurchaseActivity[]) {
  const terms = orderApprovalTerms(order);
  const termsVersion = pricingContentHash(terms);
  const recorded = order.statusHistory.filter(entry => entry.toStatus === 'confirmed' && entry.fromStatus === 'pending' && entry.actorId);
  const platformSnapshots = recorded.filter(entry => {
    const meta = jsonObject(entry.metadata);
    return meta.action === 'accept_order' && meta.actorType === 'libereal_admin' && meta.version === 2;
  });
  if (platformSnapshots.length) {
    if (platformSnapshots.length !== 1 || recorded.length !== 1) return { proof: null, manual: false };
    const history = platformSnapshots[0];
    const meta = jsonObject(history.metadata);
    const snapshot = purchaseObject(meta.snapshot);
    // A reserve may resolve an email-only customer's id inside the original acceptance transaction.
    const debtor = purchaseObject(snapshot.credit).debtorId;
    const expected = { ...terms, customerId: snapshot.customerId === null && debtor === order.customerId ? null : terms.customerId };
    const acceptedTerms = Object.fromEntries(Object.keys(expected).map(key => [key, snapshot[key]]));
    const valid = typeof meta.orderVersion === 'string' && /^[a-f0-9]{64}$/.test(meta.orderVersion)
      && pricingContentHash(acceptedTerms) === pricingContentHash(expected);
    return { proof: valid ? { id: history.id, actor: history.actorId!, at: history.createdAt.toISOString(), origin: 'merchant_history' } : null, manual: false };
  }

  const reviewed = activities.findLast(row => row.purchaseOrderId === null && row.action === 'verify_acceptance');
  const legacy = reviewed && purchaseOperation(reviewed.detail);
  if (reviewed && legacy?.termsVersion === termsVersion && typeof legacy.originalActor === 'string' && typeof legacy.occurredAt === 'string') {
    return { proof: { id: reviewed.id, actor: legacy.originalActor, at: legacy.occurredAt, origin: 'reviewed_archive' }, manual: false };
  }

  if (recorded.length === 1) {
    const [history] = recorded;
    const makeProof = (origin: string, evidenceId: string) => ({
      proof: { id: history.id, actor: history.actorId!, at: history.createdAt.toISOString(), origin, evidenceId }, manual: false,
    });
    const auditRows = await tx.auditLog.findMany({ where: {
      action: 'order.status_changed', resource: 'orders', targetType: 'Order', targetId: order.id,
      actorId: history.actorId,
    } });
    const audits = auditRows.filter(row => row.actorEmail === history.actorEmail
      && jsonObject(row.beforeData).status === 'pending' && jsonObject(row.afterData).status === 'confirmed');
    // This audit action is written by the admin-only PATCH; organization decisions never publish it.
    if (audits.length === 1 && history.actorEmail) return makeProof('legacy_admin_patch', audits[0].id);

    if (order.ownerScope === 'personal' && history.actorEmail && history.actorId !== order.customerId) {
      const statusEvents = await tx.orderEvent.findMany({ where: { orderId: order.id, type: 'status_changed', actorId: history.actorId } });
      const matches = statusEvents.filter(row => {
        const meta = jsonObject(row.metadata);
        return row.actorEmail === history.actorEmail && meta.fromStatus === 'pending' && meta.toStatus === 'confirmed'
          && (meta.reason ?? null) === (history.reason ?? null);
      });
      // Only platform staff could confirm a personal order on the shared PATCH.
      if (matches.length === 1) return makeProof('legacy_personal_patch', matches[0].id);
    }

    if (history.reason === 'quote_sent' && order.quoteSent && order.quoteSentAt && order.quoteSentAt <= history.createdAt
      && history.actorId !== order.customerId && isPostDeliveryPaymentMethod(order.paymentMethod)
      && order.creditTransactions.some(row => row.type === 'reserve' && row.actorId === history.actorId
        && row.userId === order.customerId && Math.round(row.amount * 100) === Math.round(order.total * 100))) {
      const job = await tx.backgroundTask.findUnique({ where: { dedupeKey: `order-confirmation-email:${order.id}` } });
      const payload = jsonObject(job?.payload);
      if (job?.type === 'email.send' && payload.kind === 'quote' && payload.subject === 'LIBEREAL · 订单确认' && payload.to === order.email) {
        return makeProof('legacy_merchant_quote', job.id);
      }
    }
  }
  return { proof: null, manual: true };
}
