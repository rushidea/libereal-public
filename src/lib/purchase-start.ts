import type { Prisma } from '@prisma/client';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { customerCashProjection, postVerifiedCustomerCash } from '@/lib/customer-cash';
import { creditLimitForAccount, orderCreditHeldCents } from '@/lib/customer-credit';
import { orderApprovalTerms } from '@/lib/order-approval';
import { isActivePurchaseOrder, readPurchaseAcceptance } from '@/lib/purchase-acceptance';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { addPurchaseActivity, findPurchaseActivityByRequest, readPurchaseActivities, type PurchaseActivity, type PurchaseActor, type PurchaseAuthorization } from '@/lib/purchase-activity';
import { loadPurchaseOrderSource, type SourceOrder } from '@/lib/purchase-source';
import { orderReceiptEvidence, previewBankAllocation, previewBankReceipt } from '@/lib/purchase-receipts';
import { creditLimitTerms, type PurchaseCreditEvidence } from '@/lib/purchase-credit-history';
import { documentSha256, positiveCents, PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
type PlanMode = 'prepay' | 'credit' | 'partial_prepay';
export type PaymentPlan = { mode: PlanMode; requiredPrepayCents: number; balanceTerms: string | null; evidenceId: string | null };
type StartAction = 'verify_acceptance' | 'review_customer_terms' | 'verify_bank_receipt' | 'record_customer_receipt' | 'approve_credit_exception';
export type PurchaseStartInput = {
  action: StartAction; orderId: string; version: string; requestId: string; actionHash?: string;
  reference?: unknown; sha256?: unknown; description?: unknown; historyId?: unknown; originalActor?: unknown; authorityReference?: unknown;
  occurredAt?: unknown; paymentMode?: unknown; requiredPrepayCents?: unknown; balanceTerms?: unknown;
  transactionReference?: unknown; allocationReference?: unknown; receiptKind?: unknown; receiptTotalCents?: unknown; amountCents?: unknown;
  bankTrace?: unknown; receivingAccount?: unknown; payer?: unknown; documentKind?: unknown; statementRow?: unknown;
  bankReceiptId?: unknown; legacyAllocationId?: unknown;
};

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function operation(activity: PurchaseActivity) {
  return object(object(activity.detail.snapshot).operation);
}

function lastActivity(activities: PurchaseActivity[], action: StartAction) {
  return activities.findLast(row => row.purchaseOrderId === null && row.action === action);
}

function cents(value: number) {
  return Math.round(value * 100);
}

export function paymentPlanAt(order: Pick<SourceOrder, 'paymentMethod' | 'total'>, activities: PurchaseActivity[], termsVersion: string, at = Date.now()): PaymentPlan | null {
  const review = activities.findLast(row => row.action === 'review_customer_terms' && row.purchaseOrderId === null && Date.parse(row.createdAt) <= at);
  return paymentPlanFromReview(order, termsVersion, review);
}

export function paymentPlanFromReview(order: Pick<SourceOrder, 'paymentMethod' | 'total'>, termsVersion: string, review?: PurchaseActivity): PaymentPlan | null {
  if (review) {
    const stored = operation(review);
    if (stored.termsVersion !== termsVersion) return null;
    if (stored.mode === 'prepay' || stored.mode === 'credit' || stored.mode === 'partial_prepay') {
      return { mode: stored.mode, requiredPrepayCents: Number(stored.requiredPrepayCents),
        balanceTerms: typeof stored.balanceTerms === 'string' ? stored.balanceTerms : null, evidenceId: review.id };
    }
    return null;
  }
  if (isPostDeliveryPaymentMethod(order.paymentMethod)) return { mode: 'credit', requiredPrepayCents: 0, balanceTerms: null, evidenceId: null };
  if (normalizeOrderPaymentMethod(order.paymentMethod) === 'alipay') {
    return { mode: 'prepay', requiredPrepayCents: cents(order.total), balanceTerms: null, evidenceId: null };
  }
  return null;
}

export function paymentPlanContent(plan: PaymentPlan | null) {
  return plan && { mode: plan.mode, requiredPrepayCents: plan.requiredPrepayCents,
    balanceTerms: plan.balanceTerms?.trim().replace(/\s+/g, ' ') ?? null };
}

async function creditEvidence(tx: Db, order: SourceOrder, outstandingCents: number) {
  const ar = order.receivable;
  const reserves = order.creditTransactions.filter(row => row.type === 'reserve' && row.userId === order.customerId);
  if (!order.customerId || !ar || ar.userId !== order.customerId || ar.status !== 'open' || reserves.length !== 1) return null;
  const held = await orderCreditHeldCents(tx, order);
  if (held === null || held < outstandingCents) return null;
  const originalHeld = held - order.creditTransactions.filter(row => row.type === 'release')
    .reduce((sum, row) => sum + cents(row.amount), 0);
  if (originalHeld !== cents(order.total) && held !== outstandingCents) return null;
  if (Math.round(ar.amount * 100) < outstandingCents) return null;
  const account = await tx.creditAccount.findUnique({ where: { userId: ar.userId } });
  if (!account || !['active', 'credit_limited'].includes(account.status) || cents(account.usedAmount) < outstandingCents) return null;
  const credit: PurchaseCreditEvidence = { receivableId: ar.id, reserveId: reserves[0].id, accountId: account.id, userId: ar.userId,
    owedCents: outstandingCents, occupiedCents: cents(account.usedAmount), limitCents: cents(creditLimitForAccount(account)),
    paymentTermDays: ar.paymentTermDaysSnapshot, dueAt: ar.dueAt?.toISOString() ?? null };
  return { credit, terms: creditLimitTerms(account) };
}

export function purchaseCreditVersion(orderId: string, termsVersion: string, accepted: unknown, plan: PaymentPlan | null,
  payment: { receiptIds: string[]; receivedCents: number }, credit: PurchaseCreditEvidence) {
  return pricingContentHash({ orderId, termsVersion, accepted, plan: paymentPlanContent(plan), payment, credit });
}

export function creditExceptionMatches(exception: PurchaseActivity | undefined, creditVersion: string | null) {
  if (!exception || !creditVersion) return false;
  const approved = operation(exception).creditVersion;
  if (approved === creditVersion) return true;
  const historical = object(object(exception.detail.snapshot).review);
  if (historical.creditVersion !== approved || typeof approved !== 'string') return false;
  const payment = object(historical.payment);
  const receipts = Array.isArray(payment.receipts) ? payment.receipts : [];
  const normalized = { orderId: object(historical.orderTerms).orderId, termsVersion: historical.termsVersion,
    accepted: historical.acceptance, plan: paymentPlanContent(historical.plan as PaymentPlan | null),
    payment: { receiptIds: receipts.filter(row => row?.counted !== false).map(row => row?.id), receivedCents: payment.receivedCents },
    credit: historical.credit };
  return pricingContentHash(normalized) === creditVersion;
}

export async function purchaseStartReview(tx: Db, order: SourceOrder, activities: PurchaseActivity[]) {
  const orderTerms = orderApprovalTerms(order);
  const termsVersion = pricingContentHash(orderTerms);
  const active = isActivePurchaseOrder(order);
  const accepted = await readPurchaseAcceptance(tx, order, activities);
  const principal = cents(order.total);
  const plan = paymentPlanAt(order, activities, termsVersion);
  const { payment, bankReceipts } = await orderReceiptEvidence(tx, order, activities, principal);
  const outstandingCents = Math.max(0, principal - payment.receivedCents);
  const creditState = outstandingCents > 0 && plan?.mode !== 'prepay' ? await creditEvidence(tx, order, outstandingCents) : null;
  const credit = creditState?.credit ?? null;
  const creditVersion = credit && purchaseCreditVersion(order.id, termsVersion, accepted.proof, plan,
    { receiptIds: payment.receipts.filter(row => row.counted).map(row => row.id), receivedCents: payment.receivedCents }, credit);
  const exception = lastActivity(activities, 'approve_credit_exception');
  const overCredit = Boolean(credit && credit.occupiedCents > credit.limitCents);
  const start = !active ? '原客户订单尚未由 Libereal 接受，或已关闭'
    : !accepted.proof ? '平台接单依据或已接受的订单内容需要人工核对'
    : (!Number.isSafeInteger(principal) || principal < 0) || !plan ? '需核实本单约定的付款条件'
    : payment.receivedCents < plan.requiredPrepayCents ? '需核实本单约定的付款条件与实际收款记录'
    : outstandingCents > 0 && !credit ? '需核实本单应收、授信占用及余额'
    : overCredit && !creditExceptionMatches(exception, creditVersion) ? '本单超过授信，需要财务另行批准'
    : null;
  const eligible = start === null;
  const eligibility = { eligible, reason: start, basis: eligible && accepted.proof && plan ? {
    acceptanceId: accepted.proof.id, amount: order.total, mode: plan.mode, payment, planEvidenceId: plan.evidenceId,
    ...(payment.paymentAttemptId ? { paymentAttemptId: payment.paymentAttemptId } : {}),
    ...(credit ? { receivableId: credit.receivableId, reserveId: credit.reserveId, credit, creditTerms: creditState?.terms } : {}),
    ...(overCredit ? { exceptionId: exception?.id } : {}),
  } : null };
  const review = {
    orderTerms, orderCreatedAt: order.createdAt.toISOString(), termsVersion, acceptance: accepted.proof, canVerifyAcceptance: active && accepted.manual,
    history: order.statusHistory.filter(row => row.toStatus === 'confirmed' && row.fromStatus === 'pending').map(row => ({
      id: row.id, actorId: row.actorId, actorEmail: row.actorEmail, recordedAt: row.createdAt.toISOString(),
    })),
    active, principal, plan, payment, bankReceipts, outstandingCents, credit, creditVersion, overCredit,
    creditExceptionRequired: active && accepted.proof !== null && overCredit && !eligible
      && plan !== null && payment.receivedCents >= plan.requiredPrepayCents,
  };
  return { eligibility, review: { ...review, version: pricingContentHash(review) } };
}

async function previewOperation(tx: Db, order: SourceOrder, activities: PurchaseActivity[], input: PurchaseStartInput,
  state: Awaited<ReturnType<typeof purchaseStartReview>>['review']) {
  if (!state.active) throw new PurchaseError('原客户订单当前不能启动采购');
  const reference = requiredText(input.reference, '书面依据编号');
  const sha256 = documentSha256(input.sha256, '书面依据摘要');
  const description = requiredText(input.description, '核对结果');
  const evidence = { reference, sha256, description };
  if (input.action === 'verify_acceptance') {
    if (!state.canVerifyAcceptance) throw new PurchaseError('本单已有平台接单证据，或须重新确认订单内容');
    const originalActor = requiredText(input.originalActor, '原平台接单人的姓名或标识');
    const authorityReference = requiredText(input.authorityReference, '原接单人的平台授权依据');
    const occurredAt = purchaseTimestamp(input.occurredAt, '原平台接单时间');
    const historyId = input.historyId ? requiredText(input.historyId, '原平台接单历史编号') : null;
    const row = state.history.find(item => item.id === historyId);
    if (Date.parse(occurredAt) > Date.now() || occurredAt < state.orderCreatedAt
      || originalActor === state.orderTerms.customerId || originalActor.toLowerCase() === state.orderTerms.customerEmail.toLowerCase()
      || (historyId && (!row || occurredAt > row.recordedAt || [row.actorId, row.actorEmail].filter(Boolean).every(actor => actor !== originalActor)))) {
      throw new PurchaseError('书证中的平台接单人、时间及订单历史须相符');
    }
    return { ...evidence, originalActor, authorityReference, occurredAt, historyId, termsVersion: state.termsVersion };
  }
  if (input.action === 'review_customer_terms') {
    const mode = input.paymentMode;
    if (mode !== 'prepay' && mode !== 'credit' && mode !== 'partial_prepay') throw new PurchaseError('请选择本单约定的付款方式', 400);
    if (mode === 'partial_prepay' && (!positiveCents(input.requiredPrepayCents) || input.requiredPrepayCents >= state.principal)) {
      throw new PurchaseError('约定预付款须大于零且少于本单应付金额', 400);
    }
    return { ...evidence, mode, termsVersion: state.termsVersion,
      requiredPrepayCents: mode === 'prepay' ? state.principal : mode === 'credit' ? 0 : input.requiredPrepayCents as number,
      balanceTerms: mode === 'prepay' ? null : requiredText(input.balanceTerms, '账期或尾款条件') };
  }
  if (input.action === 'verify_bank_receipt') return previewBankReceipt(tx, order, input, evidence);
  if (input.action === 'record_customer_receipt') {
    if (!state.plan) throw new PurchaseError('请先核对本单付款条件');
    const allocation = await previewBankAllocation(tx, order, activities, input, evidence, state.outstandingCents);
    if (order.paidAt || state.payment.paymentAttemptId) throw new PurchaseError('本单已有全额付款记录，请核对原始账务');
    return { ...allocation, accounting: await customerCashProjection(tx, order, allocation.amountCents) };
  }
  if (!state.creditExceptionRequired || !state.creditVersion) throw new PurchaseError('目前没有可单独批准的超授信例外');
  return { ...evidence, creditVersion: state.creditVersion, credit: state.credit };
}

export async function previewPurchaseStartAction(tx: Db, input: PurchaseStartInput, actor: PurchaseActor) {
  const order = await loadPurchaseOrderSource(tx, input.orderId);
  const activities = await readPurchaseActivities(tx, order.id);
  const { review } = await purchaseStartReview(tx, order, activities);
  if (input.version !== review.version) throw new PurchaseError('订单或支付依据已变化，请重新核对当前版本');
  const snapshot = { orderId: order.id, requestId: input.requestId, action: input.action, actor: { id: actor.id, email: actor.email },
    review, operation: await previewOperation(tx, order, activities, input, review) };
  return { snapshot, actionHash: pricingContentHash(snapshot) };
}

export async function applyPurchaseStartAction(tx: Db, input: PurchaseStartInput, actor: PurchaseActor, authorization?: PurchaseAuthorization) {
  const requestKey = pricingContentHash({ orderId: input.orderId, requestId: input.requestId });
  const intent = pricingContentHash({ actorId: actor.id, input: { ...input, actionHash: undefined } });
  const previous = await findPurchaseActivityByRequest(tx, requestKey);
  if (previous) {
    if (!input.actionHash || previous.actionHash !== input.actionHash || previous.intent !== intent) throw new PurchaseError('操作编号已用于其他核对版本');
    return;
  }
  const { snapshot, actionHash } = await previewPurchaseStartAction(tx, input, actor);
  if (input.actionHash !== actionHash) throw new PurchaseError('订单或支付依据已变化，请重新核对当前版本');
  const receipt = snapshot.operation;
  const activityId = await addPurchaseActivity(tx, { orderId: input.orderId, actor, action: input.action, requestKey,
    amountCents: 'action' in receipt && receipt.action === 'record_customer_receipt' ? receipt.amountCents : undefined,
    referenceKey: 'receiptReferenceKey' in receipt ? receipt.receiptReferenceKey : undefined,
    detail: { intent, actionHash, authorization, snapshot },
  });
  if (input.action === 'record_customer_receipt') {
    await postVerifiedCustomerCash(tx, input.orderId, { bankAllocationId: activityId }, actor.id);
  }
}
