import type { Prisma } from '@prisma/client';
import { isPostDeliveryPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { creditLimitForAccount } from '@/lib/customer-credit';
import { orderApprovalTerms } from '@/lib/order-approval';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { addPurchaseActivity, findPurchaseActivityByRequest, readPurchaseActivities, type PurchaseActivity, type PurchaseActor, type PurchaseAuthorization } from '@/lib/purchase-activity';
import { loadPurchaseOrderSource, type SourceOrder } from '@/lib/purchase-source';
import { documentSha256, positiveCents, PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
type PlanMode = 'prepay' | 'credit' | 'partial_prepay';
type PaymentPlan = { mode: PlanMode; requiredPrepayCents: number; balanceTerms: string | null; evidenceId: string | null };
type StartAction = 'verify_acceptance' | 'review_customer_terms' | 'record_customer_receipt' | 'approve_credit_exception';
export type PurchaseStartInput = {
  action: StartAction; orderId: string; version: string; requestId: string; actionHash?: string;
  reference?: unknown; sha256?: unknown; description?: unknown; historyId?: unknown; originalActor?: unknown; authorityReference?: unknown;
  occurredAt?: unknown; paymentMode?: unknown; requiredPrepayCents?: unknown; balanceTerms?: unknown;
  transactionReference?: unknown; allocationReference?: unknown; receiptKind?: unknown; receiptTotalCents?: unknown; amountCents?: unknown;
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

function activeOrder(order: SourceOrder) {
  return !order.archivedAt && ['confirmed', 'partially_shipped', 'shipped', 'completed'].includes(order.status);
}

function cents(value: number) {
  return Math.round(value * 100);
}

async function acceptance(tx: Db, order: SourceOrder, activities: PurchaseActivity[]) {
  const terms = orderApprovalTerms(order);
  const termsVersion = pricingContentHash(terms);
  const recorded = order.statusHistory.filter(entry => entry.fromStatus === 'pending' && entry.actorId);
  const platformSnapshots = recorded.filter(entry => {
    const meta = jsonObject(entry.metadata);
    return meta.action === 'accept_order' && meta.actorType === 'libereal_admin' && meta.version === 2;
  });
  if (platformSnapshots.length) {
    if (platformSnapshots.length !== 1 || recorded.length !== 1) return { proof: null, manual: false };
    const history = platformSnapshots[0];
    const meta = jsonObject(history.metadata);
    const snapshot = object(meta.snapshot);
    // A reserve may resolve an email-only customer's id inside the original acceptance transaction.
    const debtor = object(snapshot.credit).debtorId;
    const expected = { ...terms, customerId: snapshot.customerId === null && debtor === order.customerId ? null : terms.customerId };
    const acceptedTerms = Object.fromEntries(Object.keys(expected).map(key => [key, snapshot[key]]));
    const valid = typeof meta.orderVersion === 'string' && /^[a-f0-9]{64}$/.test(meta.orderVersion)
      && pricingContentHash(acceptedTerms) === pricingContentHash(expected);
    return { proof: valid ? { id: history.id, actor: history.actorId!, at: history.createdAt.toISOString(), origin: 'merchant_history' } : null, manual: false };
  }

  const reviewed = lastActivity(activities, 'verify_acceptance');
  const legacy = reviewed && operation(reviewed);
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
        && row.userId === order.customerId && cents(row.amount) === cents(order.total))) {
      const job = await tx.backgroundTask.findUnique({ where: { dedupeKey: `order-confirmation-email:${order.id}` } });
      const payload = jsonObject(job?.payload);
      if (job?.type === 'email.send' && payload.kind === 'quote' && payload.subject === 'LIBEREAL · 订单确认' && payload.to === order.email) {
        return makeProof('legacy_merchant_quote', job.id);
      }
    }
  }
  return { proof: null, manual: true };
}

function paymentPlan(order: SourceOrder, activities: PurchaseActivity[], termsVersion: string): PaymentPlan | null {
  const review = lastActivity(activities, 'review_customer_terms');
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

async function receiptEvidence(tx: Db, order: SourceOrder, activities: PurchaseActivity[], principal: number) {
  const receipts = activities.filter(row => row.purchaseOrderId === null && row.action === 'record_customer_receipt')
    .map(row => ({ id: row.id, ...operation(row), amountCents: row.amountCents ?? 0 }));
  const allocatedCents = receipts.reduce((sum, item) => sum + item.amountCents, 0);
  const alipay = order.paymentAttempts.filter(row => row.provider === 'alipay' && row.status === 'paid'
    && row.paidAt && row.tradeNo && order.paidAt && cents(row.amount) === principal);
  let paymentAttemptId: string | null = null;
  if (alipay.length === 1) {
    const [attempt] = alipay;
    const events = await tx.orderEvent.findMany({ where: { orderId: order.id, type: 'payment_received' } });
    if (events.some(row => {
      const meta = jsonObject(row.metadata);
      return meta.outTradeNo === attempt.outTradeNo && meta.tradeNo === attempt.tradeNo;
    })) paymentAttemptId = attempt.id;
  }
  const ar = order.receivable;
  const release = order.creditTransactions.filter(row => row.type === 'release' && row.userId === order.customerId && row.actorId
    && !row.reason && cents(row.amount) === -principal);
  const settled = ar && ar.status === 'paid' && ar.paidAt && order.paidAt?.getTime() === ar.paidAt.getTime()
    && ar.userId === order.customerId && cents(ar.amount) === principal && release.length === 1 ? ar.id : null;
  return { receivedCents: paymentAttemptId || settled ? principal : allocatedCents, allocatedCents, receipts, paymentAttemptId, settledReceivableId: settled };
}

async function creditEvidence(tx: Db, order: SourceOrder, outstandingCents: number) {
  const ar = order.receivable;
  const reserves = order.creditTransactions.filter(row => row.type === 'reserve' && row.userId === order.customerId);
  const validAmounts = [cents(order.total), outstandingCents];
  if (!order.customerId || !ar || ar.userId !== order.customerId || ar.status !== 'open' || !validAmounts.includes(cents(ar.amount))
    || reserves.length !== 1 || !validAmounts.includes(cents(reserves[0].amount))
    || order.creditTransactions.some(row => row.type === 'release')) return null;
  const account = await tx.creditAccount.findUnique({ where: { userId: ar.userId } });
  if (!account || !['active', 'credit_limited'].includes(account.status) || cents(account.usedAmount) < outstandingCents) return null;
  return { receivableId: ar.id, reserveId: reserves[0].id, accountId: account.id, userId: ar.userId,
    owedCents: outstandingCents, occupiedCents: cents(account.usedAmount), limitCents: cents(creditLimitForAccount(account)),
    paymentTermDays: ar.paymentTermDaysSnapshot, dueAt: ar.dueAt?.toISOString() ?? null };
}

export async function purchaseStartReview(tx: Db, order: SourceOrder, activities: PurchaseActivity[]) {
  const orderTerms = orderApprovalTerms(order);
  const termsVersion = pricingContentHash(orderTerms);
  const active = activeOrder(order);
  const accepted = await acceptance(tx, order, activities);
  const principal = cents(order.total);
  const plan = paymentPlan(order, activities, termsVersion);
  const payment = await receiptEvidence(tx, order, activities, principal);
  const outstandingCents = Math.max(0, principal - payment.receivedCents);
  const credit = outstandingCents > 0 && plan?.mode !== 'prepay' ? await creditEvidence(tx, order, outstandingCents) : null;
  const creditVersion = credit && pricingContentHash({ orderId: order.id, termsVersion, accepted: accepted.proof, plan, payment, credit });
  const exception = lastActivity(activities, 'approve_credit_exception');
  const overCredit = Boolean(credit && credit.occupiedCents > credit.limitCents);
  const start = !active ? '原客户订单尚未由 Libereal 接受，或已关闭'
    : !accepted.proof ? '平台接单依据或已接受的订单内容需要人工核对'
    : (!Number.isSafeInteger(principal) || principal < 0) || !plan ? '需核实本单约定的付款条件'
    : payment.receivedCents < plan.requiredPrepayCents ? '需核实本单约定的付款条件与实际收款记录'
    : outstandingCents > 0 && !credit ? '需核实本单应收、授信占用及余额'
    : overCredit && (!exception || operation(exception).creditVersion !== creditVersion) ? '本单超过授信，需要财务另行批准'
    : null;
  const eligible = start === null;
  const eligibility = { eligible, reason: start, basis: eligible && accepted.proof && plan ? {
    acceptanceId: accepted.proof.id, amount: order.total, mode: plan.mode, payment, planEvidenceId: plan.evidenceId,
    ...(payment.paymentAttemptId ? { paymentAttemptId: payment.paymentAttemptId } : {}),
    ...(credit ? { receivableId: credit.receivableId, reserveId: credit.reserveId, credit } : {}),
    ...(overCredit ? { exceptionId: exception?.id } : {}),
  } : null };
  const review = {
    orderTerms, orderCreatedAt: order.createdAt.toISOString(), termsVersion, acceptance: accepted.proof, canVerifyAcceptance: active && accepted.manual,
    history: order.statusHistory.filter(row => row.fromStatus === 'pending').map(row => ({
      id: row.id, actorId: row.actorId, actorEmail: row.actorEmail, recordedAt: row.createdAt.toISOString(),
    })),
    active, principal, plan, payment, outstandingCents, credit, creditVersion, overCredit,
    creditExceptionRequired: active && accepted.proof !== null && overCredit && !eligible
      && plan !== null && payment.receivedCents >= plan.requiredPrepayCents,
  };
  return { eligibility, review: { ...review, version: pricingContentHash(review) } };
}

async function previewOperation(tx: Db, input: PurchaseStartInput, state: Awaited<ReturnType<typeof purchaseStartReview>>['review']) {
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
  if (input.action === 'record_customer_receipt') {
    const transactionReference = requiredText(input.transactionReference, '到账凭证的交易流水编号');
    const allocationReference = requiredText(input.allocationReference, '本单回款分摊编号');
    const receiptKind = input.receiptKind;
    if (receiptKind !== 'bank_receipt' && receiptKind !== 'platform_receipt') {
      throw new PurchaseError('须提供银行或结算平台的实际到账凭证', 400);
    }
    const occurredAt = purchaseTimestamp(input.occurredAt, '实际到账时间');
    if (Date.parse(occurredAt) > Date.now() || !state.plan || state.outstandingCents === 0
      || !positiveCents(input.receiptTotalCents) || !positiveCents(input.amountCents)
      || input.amountCents > Math.min(input.receiptTotalCents, state.outstandingCents)) {
      throw new PurchaseError('本次核对金额须有实际到账凭证，且不得超过到账原额或本单未收余额');
    }
    const allocations = await tx.$queryRaw<{ amountCents: bigint; detail: string }[]>`
      SELECT amountCents,detail FROM PurchaseActivity WHERE action='record_customer_receipt'
        AND json_extract(detail,'$.snapshot.operation.transactionReference')=${transactionReference}`;
    const consistent = allocations.every(row => {
      const prior = object(object(jsonObject(row.detail).snapshot).operation);
      return prior.sha256 === sha256 && prior.receiptKind === receiptKind && prior.receiptTotalCents === input.receiptTotalCents
        && prior.occurredAt === occurredAt;
    });
    if (!consistent || allocations.reduce((sum, row) => sum + Number(row.amountCents), 0) + input.amountCents > input.receiptTotalCents) {
      throw new PurchaseError('同一到账凭据的版本、日期和可用分配金额须与原登记一致');
    }
    return { ...evidence, transactionReference, allocationReference, receiptKind, occurredAt, amountCents: input.amountCents, receiptTotalCents: input.receiptTotalCents };
  }
  if (!state.creditExceptionRequired || !state.creditVersion) throw new PurchaseError('目前没有可单独批准的超授信例外');
  return { ...evidence, creditVersion: state.creditVersion, credit: state.credit };
}

export async function previewPurchaseStartAction(tx: Db, input: PurchaseStartInput, actor: PurchaseActor) {
  const order = await loadPurchaseOrderSource(tx, input.orderId);
  const { review } = await purchaseStartReview(tx, order, await readPurchaseActivities(tx, order.id));
  if (input.version !== review.version) throw new PurchaseError('订单或支付依据已变化，请重新核对当前版本');
  const snapshot = { orderId: order.id, requestId: input.requestId, action: input.action, actor: { id: actor.id, email: actor.email },
    review, operation: await previewOperation(tx, input, review) };
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
  const receipt = input.action === 'record_customer_receipt' ? snapshot.operation : null;
  await addPurchaseActivity(tx, { orderId: input.orderId, actor, action: input.action, requestKey,
    ...(receipt && 'amountCents' in receipt ? {
      amountCents: receipt.amountCents,
      referenceKey: pricingContentHash({ purpose: 'customer_receipt_allocation', allocation: receipt.allocationReference }),
    } : {}),
    detail: { intent, actionHash, authorization, snapshot },
  });
}
