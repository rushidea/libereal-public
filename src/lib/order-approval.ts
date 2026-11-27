import type { Prisma } from '@prisma/client';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { orderItemView } from '@/lib/commerce-records';
import { evaluatePostDeliveryCredit } from '@/lib/customer-credit';
import { jsonObject, orderRepricingFingerprint, REPRICING_ORDER_INCLUDE } from '@/lib/order-catalog-repricing';
import { canEnterOrderQuoteFlow } from '@/lib/order-domain';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';

export const ORDER_APPROVAL_TERMS_INCLUDE = {
  orderItems: REPRICING_ORDER_INCLUDE.orderItems,
  adjustments: REPRICING_ORDER_INCLUDE.adjustments,
  addressSnapshot: true,
  inquiry: { select: { ownerScope: true, organizationId: true, name: true, institution: true, phone: true, address: true } },
} satisfies Prisma.OrderInclude;

export const ORDER_APPROVAL_INCLUDE = {
  ...ORDER_APPROVAL_TERMS_INCLUDE,
  paymentAttempts: REPRICING_ORDER_INCLUDE.paymentAttempts,
  receivable: { select: { id: true, userId: true, amount: true, status: true, paymentTermDaysSnapshot: true } },
} satisfies Prisma.OrderInclude;

type OrderTerms = Prisma.OrderGetPayload<{ include: typeof ORDER_APPROVAL_TERMS_INCLUDE }>;
type ApprovalOrder = Prisma.OrderGetPayload<{ include: typeof ORDER_APPROVAL_INCLUDE }>;
type Db = Prisma.TransactionClient;
type CreditEvaluation = Awaited<ReturnType<typeof evaluatePostDeliveryCredit>>;

export type MerchantOrderAction = 'accept_order' | 'send_quote';

/** Project only the commercial terms shown to the customer. */
export function orderApprovalTerms(order: OrderTerms) {
  const inquiry = order.inquiry?.ownerScope === order.ownerScope
    && order.inquiry.organizationId === order.organizationId ? order.inquiry : null;
  const recipient = order.addressSnapshot ?? inquiry;
  return {
    orderId: order.id,
    inquiryId: order.inquiryId,
    organizationId: order.organizationId,
    ownerScope: order.ownerScope,
    customerId: order.customerId,
    customerEmail: order.email,
    payee: 'Libereal',
    total: order.total,
    subtotal: order.subtotal,
    pointsDiscount: order.pointsDiscount,
    adjustmentTotal: order.adjustmentTotal,
    paymentMethod: order.paymentMethod,
    recipient: recipient && {
      name: recipient.name, phone: recipient.phone, address: recipient.address, institution: recipient.institution,
    },
    adjustments: order.adjustments.map(({ id, label, amount }) => ({ id, label, amount })),
    lines: order.orderItems.map((line) => {
      const item = orderItemView(line);
      return {
        id: line.id, productId: line.productId, variantId: item.variantId,
        name: line.name, brand: line.brand, catalogNumber: line.catalogNumber, spec: item.spec, unit: item.unit,
        quantity: line.quantity, unitPrice: line.unitPrice, leadTime: line.leadTime, conditions: item.customerSupplyConditions,
      };
    }),
  };
}

export function getLatestAlipayAttempt(attempts: ApprovalOrder['paymentAttempts']) {
  return attempts.filter(({ provider }) => provider === 'alipay')
    .reduce<ApprovalOrder['paymentAttempts'][number] | undefined>((latest, attempt) =>
      !latest || attempt.createdAt >= latest.createdAt ? attempt : latest, undefined);
}

export function merchantOrderQuoteAction(order: Pick<ApprovalOrder, 'paymentMethod' | 'paidAt'>): MerchantOrderAction {
  return isPostDeliveryPaymentMethod(order.paymentMethod)
    || (normalizeOrderPaymentMethod(order.paymentMethod) === 'alipay' && Boolean(order.paidAt))
    ? 'accept_order' : 'send_quote';
}

export async function merchantOrderApprovalPreview(db: Db, order: ApprovalOrder, evaluatedCredit?: CreditEvaluation) {
  if (order.archivedAt || !canEnterOrderQuoteFlow(order.status)) return null;
  const action = merchantOrderQuoteAction(order);
  if (action === 'accept_order' && order.status !== 'pending') return null;

  const credit = evaluatedCredit ?? await evaluatePostDeliveryCredit(db, {
    userId: order.customerId, email: order.email, total: order.total, paymentMethod: order.paymentMethod,
  });
  const receivable = order.receivable;
  const attempt = getLatestAlipayAttempt(order.paymentAttempts);
  const snapshot = {
    ...orderApprovalTerms(order),
    status: order.status,
    paidAt: order.paidAt?.toISOString() ?? null,
    alipay: normalizeOrderPaymentMethod(order.paymentMethod) === 'alipay' && attempt
      ? { amount: attempt.amount, outTradeNo: attempt.outTradeNo, tradeNo: attempt.tradeNo } : null,
    credit: receivable || credit.applicable ? {
      debtorId: receivable?.userId ?? (credit.applicable ? credit.userId : null),
      paymentTermDays: receivable?.paymentTermDaysSnapshot ?? (credit.applicable ? credit.summary.paymentTermDays : null),
      effectiveLimit: credit.applicable ? credit.summary.effectiveLimit : null,
      availableAmount: credit.applicable ? credit.summary.availableAmount : null,
      status: credit.applicable ? credit.summary.status : null,
      receivable,
    } : null,
  };
  const version = pricingContentHash({
    action, snapshot, order: orderRepricingFingerprint(order), updatedAt: order.updatedAt,
    quoteSent: order.quoteSent, quoteSentAt: order.quoteSentAt,
  });
  return { version, action, snapshot };
}

export type MerchantOrderApprovalPreview = NonNullable<Awaited<ReturnType<typeof merchantOrderApprovalPreview>>>;

export async function verifyMerchantOrderApproval(
  tx: Db, order: ApprovalOrder, action: MerchantOrderAction, submittedVersion: unknown,
) {
  if (typeof submittedVersion !== 'string' || !/^[a-f0-9]{64}$/.test(submittedVersion)) {
    throw new Error('ORDER_APPROVAL_PREVIEW_REQUIRED');
  }
  const preview = await merchantOrderApprovalPreview(tx, order);
  if (!preview || preview.action !== action || preview.version !== submittedVersion) {
    throw new Error('ORDER_APPROVAL_CHANGED');
  }
  return preview;
}

export async function verifyMerchantOrderAcceptance(tx: Db, orderId: string, submittedVersion: unknown) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: ORDER_APPROVAL_INCLUDE });
  if (!order) throw new Error('ORDER_APPROVAL_CHANGED');
  const preview = await verifyMerchantOrderApproval(tx, order, 'accept_order', submittedVersion);
  return { order, metadata: merchantAcceptanceMetadata(preview) };
}

export function merchantAcceptanceMetadata({ version, snapshot }: MerchantOrderApprovalPreview) {
  return JSON.stringify({ action: 'accept_order', actorType: 'libereal_admin', version: 2, orderVersion: version, snapshot });
}

/** The merchant keeps its internal credit snapshot in the admin history. */
export function customerOrderStatusMetadata(metadata: string | null) {
  const details = jsonObject(metadata);
  if (details.action !== 'accept_order' || details.version !== 2) return metadata;
  return JSON.stringify({ action: details.action, actorType: details.actorType, version: details.version, orderVersion: details.orderVersion });
}

export function orderApprovalConflict(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'ORDER_APPROVAL_PREVIEW_REQUIRED') return { code, error: '请先查看本次订单明细，再确认操作。' };
  if (code === 'ORDER_APPROVAL_CHANGED' || (error as { code?: string })?.code === 'P2034') {
    return { code: 'ORDER_APPROVAL_CHANGED', error: '订单或结算条件已变化，请重新查看明细后确认。' };
  }
  if (code === 'ORDER_APPROVAL_SAVE_CHANGES_FIRST') return { code, error: '请先保存订单修改，再核对新明细并确认接单。' };
  return null;
}
