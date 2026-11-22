import type { Prisma } from '@prisma/client';
import { orderItemView } from '@/lib/commerce-records';
import { assertOrderPricingResolved, orderRepricingTermsFingerprint, REPRICING_ORDER_INCLUDE } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';

export const ORGANIZATION_ORDER_APPROVAL = 'organization_order_approved';

type Reviewer = { id: string; email: string };
type Db = Prisma.TransactionClient;

/** Called after verifying the signed-in member's organization.orders.review grant. */
export async function organizationOrderReview(db: Db, organizationId: string, orderId: string, actor: Reviewer) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: REPRICING_ORDER_INCLUDE });
  if (!order || order.ownerScope !== 'organization' || order.organizationId !== organizationId) {
    throw new Error('ORG_ORDER_NOT_FOUND');
  }
  if (order.customerId === actor.id || (!order.customerId && order.email.toLowerCase() === actor.email.toLowerCase())) {
    throw new Error('ORG_ORDER_SELF_REVIEW');
  }
  if (order.archivedAt || order.status !== 'pending') throw new Error('ORG_ORDER_REVIEW_CLOSED');
  await assertOrderPricingResolved(db, order.id);

  const version = pricingContentHash({
    action: ORGANIZATION_ORDER_APPROVAL, terms: orderRepricingTermsFingerprint(order), orderUpdatedAt: order.updatedAt,
  });
  const eventId = ORGANIZATION_ORDER_APPROVAL + ':' + version;
  const previous = await db.orderEvent.findUnique({ where: { id: eventId }, select: { id: true } });
  const preview = {
    orderId: order.id, organizationId, version, reviewed: Boolean(previous),
    total: order.total, subtotal: order.subtotal, pointsDiscount: order.pointsDiscount,
    paymentMethod: order.paymentMethod, recipient: order.addressSnapshot && {
      name: order.addressSnapshot.name, phone: order.addressSnapshot.phone, address: order.addressSnapshot.address,
      institution: order.addressSnapshot.institution,
    },
    adjustments: order.adjustments.map(({ id, label, amount }) => ({ id, label, amount })),
    lines: order.orderItems.map((line) => {
      const item = orderItemView(line);
      return { id: line.id, name: line.name, brand: line.brand, catalogNumber: line.catalogNumber,
        quantity: line.quantity, unitPrice: line.unitPrice, spec: item.spec, unit: item.unit,
        leadTime: line.leadTime, conditions: item.customerSupplyConditions };
    }),
  };
  return { eventId, preview };
}

export type OrganizationOrderReviewPreview = Awaited<ReturnType<typeof organizationOrderReview>>['preview'];

/** Re-read the displayed version and retain one customer-side review per order version. */
export async function submitOrganizationOrderReview(
  tx: Db, organizationId: string, orderId: string, actor: Reviewer, version: unknown,
) {
  const { eventId, preview } = await organizationOrderReview(tx, organizationId, orderId, actor);
  if (typeof version !== 'string' || version !== preview.version) throw new Error('ORG_ORDER_REVIEW_CHANGED');
  if (!preview.reviewed) {
    await tx.orderEvent.upsert({ where: { id: eventId }, update: {}, create: {
      id: eventId, orderId, type: ORGANIZATION_ORDER_APPROVAL,
      actorId: actor.id, actorEmail: actor.email, message: '客户单位已通过内部审核，等待 Libereal 接单。',
      metadata: JSON.stringify({ organizationId, version, total: preview.total }),
    } });
  }
  return { orderId, status: 'pending', organizationReviewed: true, version };
}
