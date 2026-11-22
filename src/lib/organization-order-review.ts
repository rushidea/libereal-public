import type { Prisma } from '@prisma/client';
import { ORDER_APPROVAL_TERMS_INCLUDE, orderApprovalTerms } from '@/lib/order-approval';
import { assertOrderPricingResolved, orderRepricingTermsFingerprint } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';

export const ORGANIZATION_ORDER_APPROVAL = 'organization_order_approved';

export const ORGANIZATION_ORDER_REVIEW_INCLUDE = {
  ...ORDER_APPROVAL_TERMS_INCLUDE,
  statusHistory: {
    where: {
      fromStatus: null,
      toStatus: { in: ['pending', 'unpaid'] },
      reason: { in: ['order_created', 'inquiry_items_confirmed', 'admin_order_created'] },
    },
    select: { actorId: true },
  },
  events: {
    where: { type: { in: ['order_created', ORGANIZATION_ORDER_APPROVAL] } },
    select: { id: true, type: true, actorId: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  },
} satisfies Prisma.OrderInclude;

type ReviewOrder = Prisma.OrderGetPayload<{ include: typeof ORGANIZATION_ORDER_REVIEW_INCLUDE }>;
type Reviewer = { id: string; email: string };
type Db = Prisma.TransactionClient;

export function organizationOrderCreator(order: ReviewOrder): string | null {
  const [created, ...otherCreations] = order.events.filter((event) => event.type === 'order_created');
  const [initial, ...otherInitialStates] = order.statusHistory;
  if (!created?.actorId || otherCreations.length || !initial?.actorId || otherInitialStates.length
    || created.actorId !== initial.actorId
    || (order.createdByAdminId && order.createdByAdminId !== created.actorId)) return null;
  return created.actorId;
}

export function isOrganizationOrderCustomer(order: Pick<ReviewOrder, 'customerId' | 'email'>, actor: Reviewer) {
  return order.customerId === actor.id || (!order.customerId && order.email.toLowerCase() === actor.email.toLowerCase());
}

function organizationReviewVersion(order: ReviewOrder, creatorId: string, snapshot = orderApprovalTerms(order)) {
  return pricingContentHash({
    action: ORGANIZATION_ORDER_APPROVAL, schema: 2, creatorId, snapshot,
    terms: orderRepricingTermsFingerprint(order), orderUpdatedAt: order.updatedAt,
  });
}

function reviewEventId(version: string) {
  return ORGANIZATION_ORDER_APPROVAL + ':' + version;
}

export function organizationReviewState(order: ReviewOrder, creatorId: string | null) {
  const history = order.events.filter((event) => event.type === ORGANIZATION_ORDER_APPROVAL);
  if (!history.length) return null;
  if (creatorId && history.some((event) => event.id === reviewEventId(organizationReviewVersion(order, creatorId)))) return 'current';
  return 'historical';
}

/** Called after verifying the signed-in member's organization.orders.review grant. */
export async function organizationOrderReview(db: Db, organizationId: string, orderId: string, actor: Reviewer) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: ORGANIZATION_ORDER_REVIEW_INCLUDE });
  if (!order || order.ownerScope !== 'organization' || order.organizationId !== organizationId) {
    throw new Error('ORG_ORDER_NOT_FOUND');
  }
  const creatorId = organizationOrderCreator(order);
  if (creatorId === actor.id || isOrganizationOrderCustomer(order, actor)) throw new Error('ORG_ORDER_SELF_REVIEW');
  if (order.archivedAt || order.status !== 'pending') throw new Error('ORG_ORDER_REVIEW_CLOSED');
  if (!creatorId) throw new Error('ORG_ORDER_CREATOR_UNVERIFIED');
  await assertOrderPricingResolved(db, order.id);

  const snapshot = orderApprovalTerms(order);
  const version = organizationReviewVersion(order, creatorId, snapshot);
  const eventId = reviewEventId(version);
  const preview = { ...snapshot, version, reviewed: order.events.some((event) => event.id === eventId) };
  return { eventId, creatorId, preview, snapshot };
}

export type OrganizationOrderReviewPreview = Awaited<ReturnType<typeof organizationOrderReview>>['preview'];

/** Re-read the displayed version and retain one customer-side review per order version. */
export async function submitOrganizationOrderReview(
  tx: Db, organizationId: string, orderId: string, actor: Reviewer, version: unknown,
) {
  const { eventId, creatorId, preview, snapshot } = await organizationOrderReview(tx, organizationId, orderId, actor);
  if (typeof version !== 'string' || version !== preview.version) throw new Error('ORG_ORDER_REVIEW_CHANGED');
  if (!preview.reviewed) {
    await tx.orderEvent.upsert({ where: { id: eventId }, update: {}, create: {
      id: eventId, orderId, type: ORGANIZATION_ORDER_APPROVAL,
      actorId: actor.id, actorEmail: actor.email, message: '客户单位已通过内部审核。',
      metadata: JSON.stringify({ schema: 2, organizationId, version, creatorId, snapshot }),
    } });
  }
  return { orderId, status: 'pending', organizationReviewed: true, version };
}
