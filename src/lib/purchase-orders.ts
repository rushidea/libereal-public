import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { addPurchaseActivity, findPurchaseActivityByRequest, purchaseObject, purchaseOperation, readPurchaseActivities, type PurchaseActor, type PurchaseActivity, type PurchaseAuthorization } from '@/lib/purchase-activity';
import {
  approvalAt, contractContent, dispositionSummary, isPurchaseApproval, legacyApproval, legacyApprovalReview, legacyArchiveEvidence, purchaseSnapshot as snapshot, remainingApproval,
  type PurchaseLineSource as LineSource, type PurchaseStatus as Status, type RemainingScope,
} from '@/lib/purchase-contract';
import { previewShipmentAttribution, purchaseFulfillmentReview, type ShipmentAttributionInput } from '@/lib/purchase-fulfillment';
import { agreedDocumentTerms, assertSupplierDocumentScopes, missingDocumentScopes, restoreDocumentScopes } from '@/lib/purchase-document-scope';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { loadPurchaseOrderSource, loadPurchaseLines, type PurchaseSource, type SourceOrder } from '@/lib/purchase-source';
import { creditExceptionMatches, paymentPlanAt, paymentPlanContent, paymentPlanFromReview, purchaseCreditVersion, purchaseStartReview, type PaymentPlan } from '@/lib/purchase-start';
import { purchaseCreditAt } from '@/lib/purchase-credit-history';
import {
  attestPurchaseTerms, documentSha256, initialPurchaseTerms, missingPurchaseTerms, missingWrittenTerms, normalizePurchaseTerms, positiveCents, PurchaseError,
  purchaseTimestamp, requireNewDocumentsForChangedTerms, requiredText, type PurchaseTerms,
} from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
type RequirementRow = {
  orderItemId: string; ownerId: string; source: string; terms: string; revision: number; purchaseOrderId: string | null;
  replacementId: string | null; fromPurchaseOrderId: string | null;
};
type OrderRow = { id: string; status: Status; revision: number; approvedHash: string | null };
type LineEdit = { orderItemId: string; terms: PurchaseTerms };
type ReplacementInput = { name?: unknown; brand?: unknown; catalogNumber?: unknown; spec?: unknown; unit?: unknown; terms?: unknown };
type DispositionInput = { orderItemId: string; quantity: number; outcome: 'cancel' | 'replace'; replacement?: ReplacementInput };
export type PurchaseActionInput = {
  orderId: string; purchaseOrderId: string;
  action: 'approve' | 'approve_lead_time' | 'register_order' | 'record_payment' | 'report_change' | 'resolve_change'
    | 'review_legacy_approval' | 'approve_remaining' | 'record_late_order_exception' | 'resolve_order_exception' | 'reapprove_purchase';
  version: string; requestId: string; actionHash?: string; reference?: string; amountCents?: number; conditionReference?: string;
  occurredAt?: string; referenceSha256?: string; description?: string;
  changeKind?: 'delay' | 'price' | 'unavailable' | 'other';
  outcome?: 'original_terms' | 'revised_terms' | 'declined' | 'replacement';
  supplierReference?: string; supplierSha256?: string; customerReference?: string; customerSha256?: string;
  revisedTerms?: LineEdit[]; dispositions?: DispositionInput[]; refundFollowup?: string;
  paymentReference?: string; paymentSha256?: string; leadTimeReference?: string; leadTimeSha256?: string;
  remainingLines?: Array<{ orderItemId: string; payableCents: number }>;
  appliedPaidCents?: number;
  documentScopes?: unknown;
  exceptionOutcome?: 'supplier_cancelled' | 'supplier_resolution_pending' | 'liability_review';
  exceptionId?: string;
  exceptionResolution?: 'supplier_cancelled' | 'payable_verified';
};

const group = (terms: PurchaseTerms) => pricingContentHash({
  supplier: terms.supplier, payee: terms.payee, currency: terms.currency, paymentTerms: terms.paymentTerms,
});
const now = () => new Date().toISOString();

function conflict(): never {
  throw new PurchaseError('采购单或依据已有变化，请刷新并核对当前版本');
}

function rowView(row: RequirementRow) {
  const source: LineSource = JSON.parse(row.source);
  const terms: PurchaseTerms = JSON.parse(row.terms);
  return { ...row, source, terms, revision: Number(row.revision), missing: missingPurchaseTerms(terms, source) };
}

type Line = ReturnType<typeof rowView>;

function contractLines(current: Line[], purchaseOrderId: string, fact: PurchaseActivity | undefined) {
  const recorded = snapshot(fact)?.lines;
  if (!Array.isArray(recorded) || !recorded.length) return current;
  return recorded.map(line => {
    const saved = current.find(row => row.orderItemId === line.orderItemId);
    return {
      ...line, purchaseOrderId, ownerId: saved?.ownerId ?? fact!.actorId,
      replacementId: saved?.replacementId ?? null, fromPurchaseOrderId: saved?.fromPurchaseOrderId ?? null,
      missing: missingPurchaseTerms(line.terms, line.source),
    };
  });
}

function currentIncident(ledger: PurchaseActivity[]) {
  const report = ledger.findLast(row => row.action === 'report_change');
  if (report && !ledger.some(row => row.action === 'resolve_change' && snapshot(row)?.operation.incidentId === report.id)) return report;
  return undefined;
}

function supplierCommitmentReview(ledger: PurchaseActivity[]) {
  const exceptions = ledger.flatMap(row => {
    if (row.action !== 'record_late_order_exception') return [];
    const operation = purchaseOperation(row.detail);
    if (operation.category !== 'credit') return [];
    const decision = ledger.find(event => event.action === 'resolve_order_exception' && purchaseOperation(event.detail).exceptionId === row.id);
    const outcome = decision && purchaseOperation(decision.detail).resolution;
    const resolution = outcome === 'supplier_cancelled' || outcome === 'payable_verified' ? outcome : null;
    return [{ id: row.id, actorId: row.actorId, occurredAt: String(operation.occurredAt), reference: String(operation.reference),
      outcome: String(operation.exceptionOutcome), resolution,
      resolutionId: resolution ? decision?.id ?? null : null, resolutionActorId: resolution ? decision?.actorId ?? null : null }];
  });
  const state = exceptions.some(row => row.resolution === 'supplier_cancelled') ? 'supplier_cancelled'
    : exceptions.some(row => !row.resolution) ? 'pending' : exceptions.length ? 'payable_verified' : 'ordinary';
  return { exceptions, state, payable: state === 'payable_verified' ? exceptions[0] : undefined };
}

function remainingDemand(order: SourceOrder) {
  return new Map(order.orderItems.map(line => [line.id, Math.max(0, line.quantity - line.shippedQty)]));
}

function canPrepareOrder(order: SourceOrder) {
  return !order.archivedAt && (order.status === 'confirmed' || order.status === 'partially_shipped');
}

function outstandingSource(source: PurchaseSource, quantity: number): LineSource {
  return source.quantity === quantity ? source : { ...source, quantity, customerLineVersion: pricingContentHash(source) };
}

function orderCancellation(order: SourceOrder) {
  if (order.status !== 'cancelled' && order.status !== 'closed') return null;
  const entry = order.statusHistory.filter(row => row.toStatus === order.status && row.fromStatus && row.fromStatus !== row.toStatus)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  return entry ? { id: entry.id, occurredAt: entry.createdAt.toISOString(), actorId: entry.actorId, status: entry.toStatus } : null;
}

type StartReview = Awaited<ReturnType<typeof purchaseStartReview>>['review'];

function fundingVersion(review: StartReview, plan: PaymentPlan | null, historicalFormat = false) {
  return pricingContentHash({ orderTerms: review.termsVersion, acceptance: review.acceptance,
    plan: historicalFormat ? plan : paymentPlanContent(plan) });
}

function approvalMatchesFunding(approval: PurchaseActivity, review: StartReview, activities: PurchaseActivity[], plan: PaymentPlan | null = review.plan) {
  if (typeof approval.detail.fundingTermsVersion === 'string') return approval.detail.fundingTermsVersion === fundingVersion(review, plan);
  if (approval.detail.customerPlanVersion === fundingVersion(review, plan, true)) return true;
  const original = snapshot(approval)?.eligibility as { basis?: { planEvidenceId?: string | null } } | undefined;
  const reviewId = original?.basis?.planEvidenceId;
  if (reviewId === undefined) return false;
  const row = activities.find(row => row.id === reviewId && row.action === 'review_customer_terms');
  if (reviewId && !row) return false;
  const previousPlan = paymentPlanFromReview(review.orderTerms, review.termsVersion, row);
  return approval.detail.customerPlanVersion === fundingVersion(review, previousPlan, true)
    && fundingVersion(review, previousPlan) === fundingVersion(review, plan);
}

function fundingUnchangedSince(approval: PurchaseActivity, review: StartReview, activities: PurchaseActivity[], plan: PaymentPlan | null, through: number) {
  const position = activities.findIndex(row => row.id === approval.id);
  if (position < 0) return false;
  const authorized = fundingVersion(review, plan);
  return activities.slice(position + 1).every(row => row.action !== 'review_customer_terms' || Date.parse(row.createdAt) > through
    || fundingVersion(review, paymentPlanFromReview(review.orderTerms, review.termsVersion, row)) === authorized);
}

export async function purchaseWorkspace(tx: Db, orderId: string) {
  const order = await loadPurchaseOrderSource(tx, orderId);
  const activities = await readPurchaseActivities(tx, orderId);
  const { eligibility, review: startReview } = await purchaseStartReview(tx, order, activities);
  const demand = remainingDemand(order);
  const cancellation = orderCancellation(order);
  const rows = await tx.$queryRaw<RequirementRow[]>`
    SELECT orderItemId,ownerId,source,terms,revision,purchaseOrderId,NULL AS replacementId,NULL AS fromPurchaseOrderId
    FROM PurchaseRequirement WHERE orderId=${orderId}
    UNION ALL
    SELECT orderItemId,ownerId,source,terms,revision,purchaseOrderId,id AS replacementId,fromPurchaseOrderId
    FROM PurchaseReplacementLine WHERE orderId=${orderId} ORDER BY orderItemId`;
  const headers = await tx.$queryRaw<OrderRow[]>`SELECT id,status,revision,approvedHash FROM PurchaseOrder
    WHERE orderId=${orderId} AND (status <> 'superseded' OR EXISTS(
      SELECT 1 FROM PurchaseActivity a WHERE a.purchaseOrderId=PurchaseOrder.id
        AND a.action IN ('register_order','record_payment','record_late_order_exception'))) ORDER BY createdAt,id`;
  const rowsByPosition = rows.map(rowView).sort((a, b) => a.source.position - b.source.position);
  const orders = headers.map(header => {
    const ledger = activities.filter(row => row.purchaseOrderId === header.id);
    const commitment = supplierCommitmentReview(ledger);
    const committed = ledger.find(row => row.action === 'register_order' || row.action === 'record_payment'
      || commitment.exceptions.some(exception => exception.id === row.id));
    const normalRegistration = ledger.find(row => row.action === 'register_order');
    const registration = normalRegistration ?? ledger.find(row => row.id === commitment.payable?.id);
    const registered = snapshot(registration);
    const execution = registered?.operation?.execution;
    const lines = contractLines(rowsByPosition.filter(line => line.purchaseOrderId === header.id), header.id, committed);
    const totalCents = lines.reduce((sum, line) => sum + (line.terms.linePayableCents ?? 0), 0);
    if (!Number.isSafeInteger(totalCents)) throw new PurchaseError('采购合计超过可精确表示的金额');
    const paidCents = ledger.reduce((sum, row) => sum + (row.action === 'record_payment' ? row.amountCents ?? 0 : 0), 0);
    if (!Number.isSafeInteger(paidCents)) throw new PurchaseError('历史已付款超过可精确表示的金额');
    const contentHash = pricingContentHash(contractContent(orderId, header.id, totalCents, lines));
    const disposed = dispositionSummary(ledger);
    const remaining = lines.flatMap(line => {
      const quantity = line.source.quantity - (disposed.quantities.get(line.orderItemId) ?? 0);
      return quantity > 0 ? [{ orderItemId: line.orderItemId, quantity }] : [];
    });
    const supplierCancelled = commitment.state === 'supplier_cancelled';
    const hasGoodsPayable = commitment.state === 'ordinary' || commitment.state === 'payable_verified';
    const remainingDecision = supplierCancelled ? undefined : remainingApproval(ledger, disposed.ids);
    const reviewedScope = snapshot(remainingDecision)?.operation.scope;
    const dueCents = !hasGoodsPayable ? null : disposed.ids.length ? (reviewedScope
      ? Math.max(0, reviewedScope.totalCents - reviewedScope.appliedPaidCents - (paidCents - snapshot(remainingDecision)!.paidCents)) : null)
      : Math.max(0, totalCents - paidCents);
    const legacy = legacyApproval(ledger);
    const legacyReview = legacy && legacyApprovalReview(ledger, legacy.id);
    const latestApproval = ledger.findLast(isPurchaseApproval);
    const fundingApproval = latestApproval?.id === legacy?.id ? legacyReview : latestApproval;
    const checkedTerms = snapshot(fundingApproval)?.operation.checkedTerms;
    const supply = lines.map(line => {
      const terms = checkedTerms?.find(checked => checked.orderItemId === line.orderItemId)?.terms ?? line.terms;
      return { source: line.source, terms: agreedDocumentTerms({ source: line.source, terms }, ledger) };
    });
    const openIncidentId = currentIncident(ledger)?.id ?? null;
    const needsRemainingReview = !supplierCancelled && disposed.ids.length > 0 && !reviewedScope && remaining.length > 0;
    const needsLegacyReview = Boolean(legacy && !legacyReview && header.approvedHash === contentHash);
    const canApproveRemaining = hasGoodsPayable && needsRemainingReview && !openIncidentId && !needsLegacyReview
      && (header.status === 'on_hold' || (header.status === 'ordered' && Boolean(registration)))
      && (Boolean(registration) || eligibility.eligible);
    const canRegisterOrder = commitment.state === 'ordinary' && !registration && !needsLegacyReview && Boolean(latestApproval)
      && (startReview.active || Boolean(cancellation)) && (header.status === 'approved' || header.status === 'on_hold');
    const revision = Number(header.revision);
    return { ...header, revision, totalCents, contentHash, lines, ledger, paidCents, dueCents, remaining,
      remainingScope: hasGoodsPayable ? reviewedScope ?? null : null, needsRemainingReview, canApproveRemaining, needsLegacyReview,
      needsFundingReapproval: commitment.state === 'ordinary' && !registration && header.status === 'approved'
        && eligibility.eligible && Boolean(fundingApproval && latestApproval
        && (!approvalMatchesFunding(fundingApproval, startReview, activities)
          || !fundingUnchangedSince(latestApproval, startReview, activities, startReview.plan, Date.now()))),
      canRegisterOrder,
      canRecordCommitmentException: Boolean(latestApproval && (!registration || cancellation) && (cancellation || commitment.state === 'ordinary')),
      commitmentState: commitment.state, commitmentExceptions: commitment.exceptions,
      documentReviewLines: missingDocumentScopes(supply),
      version: pricingContentHash({ contentHash, status: header.status, revision }),
      orderedBefore: Boolean(registration),
      leadTimeApproved: ledger.some(row => row.action === 'approve_lead_time'
        && row.detail.contentHash === contentHash
        && approvalMatchesFunding(row, startReview, activities)),
      openIncidentId,
      orderReceipt: registration ? {
        occurredAt: registered?.operation?.occurredAt ?? null, registeredAt: registration.createdAt,
        reference: registered?.operation?.reference ?? null,
        exception: !normalRegistration,
        lines: execution?.lines.map(line => ({ orderItemId: line.orderItemId, name: line.source.name, unit: line.source.unit,
          quantity: line.quantity, payableCents: line.payableCents })) ?? registered?.lines?.map(line => ({
          orderItemId: line.orderItemId, name: line.source.name, unit: line.source.unit, quantity: line.source.quantity,
          payableCents: line.terms.linePayableCents,
        })) ?? [],
      } : null,
    };
  });
  const lines = rowsByPosition.filter(line => !line.replacementId)
    .map(line => ({ ...line, availableQuantity: demand.get(line.orderItemId) ?? 0 }));
  const canPrepare = eligibility.eligible && canPrepareOrder(order)
    && [...demand].some(([id, quantity]) => quantity > 0 && !rowsByPosition.some(line => line.orderItemId === id));
  const fulfillment = await purchaseFulfillmentReview(tx, order, activities, orders);
  return { orderId, orderStatus: order.status, cancellation, canPrepare, eligibility, startReview, lines, orders, activities, fulfillment };
}

export async function previewPurchaseShipment(tx: Db, input: ShipmentAttributionInput, actor: PurchaseActor) {
  const view = await purchaseWorkspace(tx, input.orderId);
  return previewShipmentAttribution(input.orderId, view.fulfillment, input, actor);
}

export async function applyPurchaseShipment(tx: Db, input: ShipmentAttributionInput, actor: PurchaseActor, authorization?: PurchaseAuthorization) {
  const requestKey = pricingContentHash({ orderId: input.orderId, requestId: input.requestId, purpose: 'purchase_shipment_attribution' });
  const intent = pricingContentHash({ actorId: actor.id, input: { ...input, actionHash: undefined } });
  const prior = await findPurchaseActivityByRequest(tx, requestKey);
  if (prior) {
    if (!input.actionHash || prior.actionHash !== input.actionHash || prior.intent !== intent) conflict();
    return purchaseWorkspace(tx, input.orderId);
  }
  const { snapshot, actionHash } = await previewPurchaseShipment(tx, input, actor);
  if (input.actionHash !== actionHash) conflict();
  await addPurchaseActivity(tx, { orderId: input.orderId, orderItemId: snapshot.operation.target.orderItemId, actor,
    action: 'attribute_purchase_shipment', requestKey, referenceKey: snapshot.referenceKey, detail: { intent, actionHash, authorization, snapshot } });
  return purchaseWorkspace(tx, input.orderId);
}

export async function prepareOrderPurchases(tx: Db, orderId: string, actor: PurchaseActor) {
  const order = await loadPurchaseOrderSource(tx, orderId);
  const { eligibility } = await purchaseStartReview(tx, order, await readPurchaseActivities(tx, orderId));
  if (eligibility.eligible && canPrepareOrder(order)) {
    const demand = remainingDemand(order);
    const sources = await loadPurchaseLines(tx, order);
    for (const original of sources) {
      const quantity = demand.get(original.orderItemId) ?? 0;
      if (!quantity) continue;
      const source = outstandingSource(original, quantity);
      const stamp = now();
      const count = await tx.$executeRaw`INSERT INTO PurchaseRequirement
        (orderItemId,orderId,ownerId,source,terms,revision,createdAt,updatedAt)
        VALUES (${source.orderItemId},${orderId},${actor.id},${JSON.stringify(source)},${JSON.stringify(initialPurchaseTerms(source))},1,${stamp},${stamp})
        ON CONFLICT(orderItemId) DO NOTHING`;
      if (count === 1) await addPurchaseActivity(tx, { orderId, orderItemId: source.orderItemId, actor, action: 'prepare', detail: { eligibility, source } });
    }
  }
  return purchaseWorkspace(tx, orderId);
}

async function touchDraft(tx: Db, orderId: string, id: string) {
  await tx.$executeRaw`UPDATE PurchaseOrder SET revision=revision+1,updatedAt=${now()},
    status=CASE WHEN EXISTS(SELECT 1 FROM PurchaseRequirement WHERE purchaseOrderId=${id}) THEN 'draft' ELSE 'superseded' END
    WHERE id=${id} AND orderId=${orderId} AND status='draft'`;
}

async function createDraft(tx: Db, orderId: string, groupKey: string) {
  const stamp = now();
  await tx.$executeRaw`INSERT INTO PurchaseOrder (id,orderId,groupKey,status,revision,createdAt,updatedAt)
    VALUES (${`PO-${randomUUID()}`},${orderId},${groupKey},'draft',1,${stamp},${stamp}) ON CONFLICT DO NOTHING`;
  const [row] = await tx.$queryRaw<{ id: string; committed: number }[]>`
    SELECT p.id,EXISTS(SELECT 1 FROM PurchaseActivity a WHERE a.purchaseOrderId=p.id
      AND a.action IN ('register_order','record_payment')) AS committed FROM PurchaseOrder p
    WHERE p.orderId=${orderId} AND p.groupKey=${groupKey} AND p.status='draft'`;
  if (!row) conflict();
  return row;
}

async function findOpenDraft(tx: Db, orderId: string, terms: PurchaseTerms) {
  const key = group(terms);
  const first = await createDraft(tx, orderId, key);
  if (!first.committed) return first.id;
  const next = await createDraft(tx, orderId, pricingContentHash({ key, separateFrom: first.id }));
  if (next.committed) conflict();
  return next.id;
}

export async function savePurchaseLine(tx: Db, input: { orderId: string; orderItemId: string; revision: number; terms: PurchaseTerms; checkedEvidence?: boolean }, actor: PurchaseActor) {
  const view = await purchaseWorkspace(tx, input.orderId);
  if (!view.eligibility.eligible) throw new PurchaseError(view.eligibility.reason ?? '请核实采购启动条件');
  const line = view.lines.find(row => row.orderItemId === input.orderItemId);
  const current = view.orders.find(order => order.id === line?.purchaseOrderId);
  if (!line || line.revision !== input.revision || (current && (current.status !== 'draft' || current.orderedBefore || current.paidCents > 0))) conflict();
  const original = await loadPurchaseOrderSource(tx, input.orderId);
  const fresh = (await loadPurchaseLines(tx, original)).find(row => row.orderItemId === line.orderItemId);
  const quantity = remainingDemand(original).get(line.orderItemId);
  if (!fresh || !quantity) conflict();
  const source = outstandingSource(fresh, quantity);
  const supplied = normalizePurchaseTerms(input.terms);
  requireNewDocumentsForChangedTerms(line.terms, supplied, line.source.quantity !== source.quantity);
  for (const row of view.activities) {
    if (row.action !== 'save_line' || row.orderItemId !== line.orderItemId) continue;
    const previous = row.detail.terms as PurchaseTerms | undefined;
    if (previous?.verification) requireNewDocumentsForChangedTerms(previous, supplied, true);
  }
  const same = pricingContentHash({ terms: supplied, source }) === pricingContentHash({ terms: normalizePurchaseTerms(line.terms), source: line.source });
  if (same && (!input.checkedEvidence || !line.missing.length)) return view;
  const terms = attestPurchaseTerms(supplied, source, actor, input.checkedEvidence === true);
  const missing = missingPurchaseTerms(terms, source);
  if (!missing.length) await assertSupplierDocumentScopes(tx, [{ source, terms }]);
  const target = missing.length ? null : await findOpenDraft(tx, input.orderId, terms);
  const changed = await tx.$executeRaw`UPDATE PurchaseRequirement SET source=${JSON.stringify(source)},terms=${JSON.stringify(terms)},
    purchaseOrderId=${target},ownerId=${actor.id},revision=revision+1,updatedAt=${now()}
    WHERE orderItemId=${line.orderItemId} AND orderId=${input.orderId} AND revision=${line.revision}`;
  if (changed !== 1) conflict();
  for (const id of new Set([line.purchaseOrderId, target])) if (id) await touchDraft(tx, input.orderId, id);
  await addPurchaseActivity(tx, { orderId: input.orderId, purchaseOrderId: target, orderItemId: line.orderItemId, actor, action: 'save_line',
    detail: { previous: line.terms, terms, fromPurchase: line.purchaseOrderId, missing } });
  return purchaseWorkspace(tx, input.orderId);
}

type Workspace = Awaited<ReturnType<typeof purchaseWorkspace>>;
type PO = Workspace['orders'][number];

type Disposition = {
  orderItemId: string; quantity: number; outcome: 'cancel' | 'replace';
  replacement: { terms: PurchaseTerms; source: LineSource } | null;
};

function checkedEdits(po: PO, input: PurchaseActionInput) {
  if (po.orderedBefore || po.paidCents > 0 || po.commitmentExceptions.length) throw new PurchaseError('已有订购或付款，请选择取消受影响数量或另建替代采购');
  const edits = input.revisedTerms;
  if (!Array.isArray(edits) || edits.length !== po.lines.length || new Set(edits.map(edit => edit?.orderItemId)).size !== edits.length) conflict();
  const values = po.lines.map(line => {
    const edit = edits.find(row => row?.orderItemId === line.orderItemId);
    if (!edit) conflict();
    const terms = normalizePurchaseTerms(edit.terms);
    requireNewDocumentsForChangedTerms(line.terms, terms);
    if (missingWrittenTerms(terms, line.source).length) throw new PurchaseError('变更后的条款仍缺核实依据');
    return { orderItemId: line.orderItemId, terms };
  });
  if (new Set(values.map(value => group(value.terms))).size !== 1) throw new PurchaseError('本次修订须对应同一供货方、收款方及付款条件');
  return values;
}

function attributedQuantity(view: Workspace, purchaseOrderId: string, orderItemId: string) {
  return view.fulfillment.delivered.reduce((sum, row) => sum + (row.purchaseOrderId === purchaseOrderId && row.orderItemId === orderItemId ? row.quantity : 0), 0);
}

function pendingReplacementQuantity(view: Workspace, purchase: PO, orderItemId: string) {
  if (purchase.status === 'superseded' || purchase.commitmentState === 'supplier_cancelled'
    || !purchase.lines.some(line => line.orderItemId === orderItemId && line.fromPurchaseOrderId)) return 0;
  const quantity = purchase.remaining.find(line => line.orderItemId === orderItemId)?.quantity ?? 0;
  return Math.max(0, quantity - attributedQuantity(view, purchase.id, orderItemId));
}

function activeReplacementQuantity(view: Workspace, orderItemId: string) {
  return view.orders.reduce((sum, purchase) => sum + pendingReplacementQuantity(view, purchase, orderItemId), 0);
}

function committedDispositions(
  view: Workspace, po: PO, input: PurchaseActionInput, customerLines: PurchaseSource[], remainingQuantities: ReadonlyMap<string, number>,
): Disposition[] {
  const entries = input.dispositions;
  if (!Array.isArray(entries) || !entries.length || entries.some(entry => !entry || typeof entry.orderItemId !== 'string')
    || new Set(entries.map(entry => entry.orderItemId)).size !== entries.length) {
    throw new PurchaseError('须逐行填写替代或取消数量', 400);
  }
  const prior = dispositionSummary(po.ledger).quantities;
  const dispositions = entries.map(({ orderItemId, quantity, outcome, replacement }) => {
    const line = po.lines.find(row => row.orderItemId === orderItemId);
    const original = customerLines.find(row => row.orderItemId === orderItemId);
    if (!line || !original || !positiveCents(quantity) || quantity + (prior.get(orderItemId) ?? 0)
      + attributedQuantity(view, po.id, orderItemId) > line.source.quantity) {
      throw new PurchaseError('替代或取消的累计数量不得超过原采购行尚未发出的数量');
    }
    if (outcome === 'cancel') return { orderItemId, quantity, outcome, replacement: null };
    const active = activeReplacementQuantity(view, orderItemId);
    const retained = active - Math.min(quantity, pendingReplacementQuantity(view, po, orderItemId));
    if (retained + quantity > (remainingQuantities.get(orderItemId) ?? 0)) {
      throw new PurchaseError('累计有效替代采购不得超过客户订单行未发货数量');
    }
    if (outcome !== 'replace' || !replacement || input.outcome !== 'replacement') throw new PurchaseError('请核对每行的替代或取消结果', 400);
    const source: LineSource = {
      ...original, productId: null, variantId: null, written: null, quantity, customerLineVersion: pricingContentHash(original),
      name: requiredText(replacement.name, '替代商品名称'), brand: requiredText(replacement.brand, '替代商品品牌'),
      catalogNumber: requiredText(replacement.catalogNumber, '替代商品货号'), spec: requiredText(replacement.spec, '替代商品规格'),
      unit: requiredText(replacement.unit, '替代商品计量单位'),
    };
    const terms = normalizePurchaseTerms(replacement.terms);
    requireNewDocumentsForChangedTerms(line.terms, terms, line.source.quantity !== quantity);
    if (missingWrittenTerms(terms, source).length) throw new PurchaseError('替代行须具备当前有效的供货、收款和付款书证');
    return { orderItemId, quantity, outcome, replacement: { terms, source } };
  });
  if (input.outcome === 'replacement' && !dispositions.some(line => line.outcome === 'replace')) {
    throw new PurchaseError('请填写至少一条待独立批准的替代采购行', 400);
  }
  return dispositions;
}

function checkedApproval(view: Workspace, po: PO, approval: PurchaseActivity | undefined, plan = view.startReview.plan, through = Date.now()) {
  if (!approval || po.approvedHash !== po.contentHash) conflict();
  const continuous = fundingUnchangedSince(approval, view.startReview, view.activities, plan, through);
  if (continuous && approval.detail.contentHash === po.contentHash && approvalMatchesFunding(approval, view.startReview, view.activities, plan)) {
    return { approval, archived: undefined };
  }
  const legacy = legacyApproval(po.ledger);
  const archived = legacy?.id === approval.id ? legacyApprovalReview(po.ledger, approval.id) : undefined;
  if (continuous && archived && archived.detail.contentHash === po.contentHash && approvalMatchesFunding(archived, view.startReview, view.activities, plan)) return { approval, archived };
  if (legacy?.id === approval.id && !archived) throw new PurchaseError('旧采购批准须先具名核对原授权、供货及付款书证');
  throw new PurchaseError('业务条件与该版采购批准不一致，请重新核对并批准');
}

function assertApprovedTerms(po: PO, approval: ReturnType<typeof checkedApproval>, at: number) {
  const approvedScope = snapshot(approval.approval)?.operation.scope;
  const lines = approvedScope ? po.lines.filter(line => approvedScope.lines.some(item => item.orderItemId === line.orderItemId)) : po.lines;
  const previous = snapshot(approval.archived)?.operation.checkedTerms;
  const current = previous ?? snapshot(approval.approval)?.operation.checkedTerms;
  if (!lines.length || lines.some(line => {
    if (!current) return missingPurchaseTerms(line.terms, line.source, at).length > 0;
    const term = current.find(entry => entry.orderItemId === line.orderItemId)?.terms;
    return !term || missingWrittenTerms(term, line.source, at).length > 0;
  })) throw new PurchaseError('实际订购或预付款须对应有效期间内、已经核对的供货书证与批准');
  return {
    approvalId: approval.approval.id, approvedAt: approval.approval.createdAt, archiveReviewId: approval.archived?.id ?? null,
    totalCents: approvedScope?.totalCents ?? po.totalCents,
    lines: lines.map(line => {
      const scoped = approvedScope?.lines.find(item => item.orderItemId === line.orderItemId);
      return { orderItemId: line.orderItemId, source: line.source, terms: current?.find(row => row.orderItemId === line.orderItemId)?.terms ?? line.terms,
        quantity: scoped?.quantity ?? line.source.quantity, payableCents: scoped?.payableCents ?? line.terms.linePayableCents! };
    }),
  };
}

function reviewLegacyApproval(view: Workspace, po: PO, input: PurchaseActionInput) {
  const approval = legacyApproval(po.ledger);
  if (!approval || !po.needsLegacyReview || !view.startReview.acceptance
    || (!view.startReview.active && !view.cancellation)) conflict();
  const evidence = legacyArchiveEvidence(view.orderId, po.id, po.contentHash, approval, po.ledger);
  const at = Date.parse(approval.createdAt);
  if (view.cancellation && Date.parse(view.cancellation.occurredAt) <= at) conflict();
  const originalBasis = evidence.approval.recorded.eligibility as { eligible?: boolean; basis?: { acceptanceId?: string } } | undefined;
  if (originalBasis?.eligible !== true || originalBasis.basis?.acceptanceId !== view.startReview.acceptance.id) {
    throw new PurchaseError('旧批准与已经核实的原客户订单接单依据不一致');
  }
  const edits = input.revisedTerms;
  if (!Array.isArray(edits) || edits.length !== po.lines.length || new Set(edits.map(edit => edit?.orderItemId)).size !== edits.length) conflict();
  const checkedTerms = po.lines.map(line => {
    const raw = edits.find(edit => edit?.orderItemId === line.orderItemId)?.terms;
    const terms = normalizePurchaseTerms(raw);
    const approved = normalizePurchaseTerms(line.terms);
    if ((Object.keys(approved) as Array<keyof PurchaseTerms>).some(key => approved[key] !== terms[key])) {
      throw new PurchaseError('历史复核只补核书证，不改变原授权的供货、结算及金额条款');
    }
    if (missingWrittenTerms(terms, line.source, at).length) throw new PurchaseError('须补齐原批准时有效的供货和结算书证');
    return { orderItemId: line.orderItemId, terms };
  });
  const extendedLeadTime = checkedTerms.some(line => line.terms.leadTimeAssessment === 'exception_required');
  const fundingPlan = paymentPlanAt(view.startReview.orderTerms, view.activities, view.startReview.termsVersion, at);
  return { action: 'review_legacy_approval' as const, legacyApprovalId: approval.id, evidence, checkedTerms, fundingPlan,
    reference: requiredText(input.reference, '原采购授权的档案出处'), referenceSha256: documentSha256(input.referenceSha256, '原采购授权书证摘要'),
    ...(po.paidCents > 0 ? { paymentReference: requiredText(input.paymentReference, '已付款凭证的档案出处'),
      paymentSha256: documentSha256(input.paymentSha256, '已付款凭证摘要') } : {}),
    ...(extendedLeadTime ? { leadTimeReference: requiredText(input.leadTimeReference, '原超长交期的独立批准依据'),
      leadTimeSha256: documentSha256(input.leadTimeSha256, '原超长交期批准书证摘要') } : {}),
    description: requiredText(input.description, '核对原授权、付款及本次接续结果') };
}

function approveRemaining(po: PO, input: PurchaseActionInput) {
  if (!po.canApproveRemaining) conflict();
  const legacy = legacyApproval(po.ledger);
  const archived = legacy && legacyApprovalReview(po.ledger, legacy.id);
  const checkedTerms = snapshot(archived)?.operation.checkedTerms;
  const amounts = input.remainingLines;
  if (!Array.isArray(amounts) || amounts.length !== po.remaining.length || new Set(amounts.map(line => line?.orderItemId)).size !== amounts.length) {
    throw new PurchaseError('须按原单逐行核准所有尚未取消或替代的商品及应付金额', 400);
  }
  const lines = po.remaining.map(line => {
    const original = po.lines.find(item => item.orderItemId === line.orderItemId)!;
    const payableCents = amounts.find(item => item?.orderItemId === line.orderItemId)?.payableCents;
    if (typeof payableCents !== 'number' || !Number.isSafeInteger(payableCents) || payableCents < 0 || payableCents > (original.terms.linePayableCents ?? 0)) {
      throw new PurchaseError('剩余行应付须按书证核实，且不得超过原合同的行应付金额');
    }
    if (!po.orderedBefore) {
      const terms = checkedTerms?.find(row => row.orderItemId === line.orderItemId)?.terms;
      const missing = terms ? missingWrittenTerms(terms, original.source) : missingPurchaseTerms(original.terms, original.source);
      if (missing.length) throw new PurchaseError('剩余订购须使用仍有效的原供货和付款条件');
    }
    return { ...line, payableCents };
  });
  const totalCents = lines.reduce((sum, line) => sum + line.payableCents, 0);
  const appliedPaidCents = input.appliedPaidCents ?? (po.paidCents === 0 ? 0 : NaN);
  if (!Number.isSafeInteger(appliedPaidCents) || appliedPaidCents < 0 || appliedPaidCents > Math.min(totalCents, po.paidCents)) {
    throw new PurchaseError('已付款中抵扣剩余应付的金额须单独核实，且不得超过实际已付和本次核准合计');
  }
  const payments = po.ledger.flatMap(row => row.action === 'record_payment' && row.amountCents !== null
    ? [{ id: row.id, amountCents: row.amountCents }] : []);
  const scope: RemainingScope = { lines, totalCents, appliedPaidCents, dispositionIds: dispositionSummary(po.ledger).ids, payments };
  return { action: 'approve_remaining' as const, scope, checkedTerms, archiveReviewId: archived?.id ?? null,
    reference: requiredText(input.reference, '供方确认剩余行金额及付款归属的书面依据'),
    referenceSha256: documentSha256(input.referenceSha256, '剩余应付确认书证摘要'),
    description: requiredText(input.description, '逐行应付和原付款归属核对结果') };
}

function registrationDetails(view: Workspace, po: PO, input: PurchaseActionInput) {
  if (po.orderedBefore) throw new PurchaseError('原采购单已登记过供应商订购结果');
  if (po.commitmentState !== 'ordinary') throw new PurchaseError('本单已有实际承诺异常，请沿用原异常记录跟进');
  if (!['approved', 'on_hold'].includes(po.status)) conflict();
  const occurredAt = purchaseTimestamp(input.occurredAt, '供应商实际确认订购时间');
  const at = Date.parse(occurredAt);
  if (at > Date.now()) throw new PurchaseError('实际订购时间不能晚于登记时间');
  if (view.cancellation) {
    if (at >= Date.parse(view.cancellation.occurredAt)) throw new PurchaseError('客户取消后发生的订购须走异常处理并记录结果');
  } else if (!view.startReview.active) {
    throw new PurchaseError('原客户订单状态或取消时间无法核实');
  }
  const approval = approvalAt(po.ledger, at);
  if (!approval) throw new PurchaseError('实际订购须发生在对应采购批准后且供应条件未暂停的期间');
  const review = view.startReview;
  const fundingPlan = paymentPlanAt(review.orderTerms, view.activities, review.termsVersion, at);
  if (!review.acceptance || !fundingPlan) throw new PurchaseError('无法核实实际订购时的客户接单与付款条件');
  const execution = assertApprovedTerms(po, checkedApproval(view, po, approval, fundingPlan, at), at);
  const timelyReceipts = review.payment.receipts.filter(row => row.counted && typeof row.occurredAt === 'string' && Date.parse(row.occurredAt) <= at);
  const nativePaid = review.payment.nativePaidAt && Date.parse(review.payment.nativePaidAt) <= at;
  const receivedAt = nativePaid ? review.principal : timelyReceipts.reduce((sum, row) => sum + row.amountCents, 0);
  if (receivedAt < fundingPlan.requiredPrepayCents) throw new PurchaseError('须核实实际订购前本单已经满足的到账条件');
  return { action: 'register_order' as const, occurredAt, execution, fundingPlan, receivedAt, receiptIds: timelyReceipts.map(row => row.id), priorCancellation: view.cancellation,
    reference: requiredText(input.reference, '供应商确认订购的单据编号'), referenceSha256: documentSha256(input.referenceSha256, '实际订购凭据摘要') };
}

async function previewCommitment(tx: Db, original: SourceOrder, view: Workspace, po: PO, input: PurchaseActionInput, actor: PurchaseActor) {
  if (po.version !== input.version) conflict();
  const exceptional = input.action === 'record_late_order_exception';
  const occurredAt = purchaseTimestamp(input.occurredAt, '供应商实际接受订购时间');
  const at = Date.parse(occurredAt);
  if (at > Date.now()) throw new PurchaseError('实际订购时间不能晚于登记时间');
  const cancellation = view.cancellation && at >= Date.parse(view.cancellation.occurredAt) ? view.cancellation : null;
  if (exceptional && cancellation) {
    if (!po.ledger.some(isPurchaseApproval)) conflict();
    return commitmentException(input, actor, occurredAt, { category: 'cancellation', cancellation });
  }
  const order = registrationDetails(view, po, input);
  const approval = po.ledger.find(row => row.id === order.execution.approvalId)!;
  const basis = purchaseObject(snapshot(approval)?.eligibility).basis;
  const credit = await purchaseCreditAt(tx, original, basis, Date.parse(approval.createdAt), at, Math.max(0, view.startReview.principal - order.receivedAt));
  const review = view.startReview;
  const version = credit.credit && purchaseCreditVersion(view.orderId, review.termsVersion, review.acceptance, order.fundingPlan,
    { receiptIds: order.receiptIds, receivedCents: order.receivedAt }, credit.credit);
  const exception = view.activities.findLast(row => row.action === 'approve_credit_exception' && Date.parse(row.createdAt) < at);
  const exceptionId = credit.status === 'over_limit' && creditExceptionMatches(exception, version) ? exception?.id ?? null : null;
  const applicable = { ...credit, exceptionId };
  const allowed = credit.status === 'not_required' || credit.status === 'within_limit' || Boolean(exceptionId);
  if (exceptional) {
    if (allowed) throw new PurchaseError('实际承诺时的授信依据已核实，请补录正式订购');
    return { ...commitmentException(input, actor, occurredAt, { category: 'credit', cancellation: null }), execution: order.execution, credit: applicable };
  }
  if (!allowed) {
    const issue = credit.status === 'over_limit' ? '实际承诺时超过授信额度，且无当时适用的逐单批准'
      : credit.status === 'restricted' ? '实际承诺时授信处于限制状态' : '实际承诺时的授信依据或先后无法确认';
    throw new PurchaseError(`${issue}，请登记实际承诺异常`);
  }
  return { ...order, credit: applicable };
}

function commitmentException<Category extends 'credit' | 'cancellation'>(input: PurchaseActionInput, actor: PurchaseActor, occurredAt: string,
  classification: { category: Category; cancellation: Workspace['cancellation'] }) {
  const exceptionOutcome = input.exceptionOutcome;
  if (exceptionOutcome !== 'supplier_cancelled' && exceptionOutcome !== 'supplier_resolution_pending' && exceptionOutcome !== 'liability_review') {
    throw new PurchaseError('请选择供方取消、继续协调或责任待核的处理结果', 400);
  }
  return { action: 'record_late_order_exception' as const, occurredAt, ...classification, responsibleActor: actor.id, exceptionOutcome,
    reference: requiredText(input.reference, '实际订购及处理结果的书面出处'), referenceSha256: documentSha256(input.referenceSha256, '订购异常书证摘要'),
    description: requiredText(input.description, '异常处理结果和后续责任') };
}

function reapprovePurchase(view: Workspace, po: PO, input: PurchaseActionInput) {
  if (!po.needsFundingReapproval || po.needsLegacyReview || po.orderedBefore || po.openIncidentId || !view.eligibility.eligible
    || po.approvedHash !== po.contentHash) conflict();
  const approval = approvalAt(po.ledger, Date.now());
  if (!approval) conflict();
  const legacy = legacyApproval(po.ledger);
  const archived = legacy?.id === approval.id ? legacyApprovalReview(po.ledger, approval.id) : undefined;
  const verified = assertApprovedTerms(po, { approval, archived }, Date.now());
  const supply = verified.lines.map(line => ({ ...line, terms: agreedDocumentTerms(line, po.ledger) }));
  const lines = restoreDocumentScopes(supply, input.documentScopes);
  const checkedTerms = lines.map(line => ({ orderItemId: line.orderItemId, terms: line.terms }));
  const documentScopes = lines.filter(line => po.documentReviewLines.some(row => row.orderItemId === line.orderItemId))
    .map(line => ({ orderItemId: line.orderItemId, source: line.source, terms: line.terms }));
  return { action: 'reapprove_purchase' as const, originalApprovalId: approval.id, execution: { ...verified, lines }, documentScopes,
    scope: po.remainingScope ?? undefined, checkedTerms, fundingPlan: view.startReview.plan,
    payments: po.ledger.filter(row => row.action === 'record_payment').map(row => ({
      id: row.id, amountCents: row.amountCents, reference: snapshot(row)?.operation.reference, recordedAt: row.createdAt,
    })),
    reference: requiredText(input.reference, '客户付款条件变动的档案出处'), referenceSha256: documentSha256(input.referenceSha256, '新批准依据摘要'),
    description: requiredText(input.description, '本次重新批准的后续动作与旧款归属') };
}

function actionDetails(
  view: Workspace, po: PO, input: PurchaseActionInput, customerLines: PurchaseSource[],
  remainingQuantities: ReadonlyMap<string, number>, actor: PurchaseActor,
) {
  if (po.version !== input.version) conflict();
  const action = input.action;
  if (action === 'review_legacy_approval') return reviewLegacyApproval(view, po, input);
  if (action === 'reapprove_purchase') return reapprovePurchase(view, po, input);
  if (action === 'approve_remaining') return approveRemaining(po, input);
  if (action === 'resolve_order_exception') {
    const exception = po.commitmentExceptions.find(row => row.id === input.exceptionId && !row.resolution);
    const resolution = input.exceptionResolution;
    if (!exception || (resolution !== 'supplier_cancelled' && resolution !== 'payable_verified')) conflict();
    if (exception.outcome === 'supplier_cancelled' && resolution === 'payable_verified') {
      throw new PurchaseError('此前已登记供方取消，须按书面取消结果核对费用或退款');
    }
    const prior = po.ledger.find(row => row.id === exception.id)!;
    const description = requiredText(input.description, '核对结果及已付款的后续安排');
    return { action, exceptionId: exception.id, resolution, responsibleActor: actor.id, actualCommitment: purchaseOperation(prior.detail),
      remainingReviewPending: resolution === 'payable_verified' && po.needsRemainingReview,
      reference: requiredText(input.reference, '供方书面处理结果及原合同应付核对依据'),
      referenceSha256: documentSha256(input.referenceSha256, '异常处理结果书证摘要'),
      description,
      refund: resolution === 'supplier_cancelled' && po.paidCents > 0 ? {
        status: 'pending_review' as const, paidCents: po.paidCents, responsibleActor: actor.id, followup: description,
      } : null };
  }
  if (action === 'approve' || action === 'approve_lead_time') {
    if (po.status !== 'draft' || po.orderedBefore || po.paidCents || !po.lines.length || !view.eligibility.eligible
      || po.lines.some(line => line.missing.length)) {
      throw new PurchaseError('原订单的采购启动条件、供方材料或报价有效期需重新核对');
    }
    const needsLeadApproval = po.lines.some(line => line.terms.leadTimeAssessment === 'exception_required');
    if (action === 'approve_lead_time') {
      if (!needsLeadApproval || po.leadTimeApproved) throw new PurchaseError('本版没有待单独批准的超长订货周期例外');
      return { action, reference: requiredText(input.reference, '超长订货周期的书面批准依据'),
        referenceSha256: documentSha256(input.referenceSha256, '超长期书证摘要'), description: requiredText(input.description, '逐单例外批准结论') };
    }
    if (needsLeadApproval && !po.leadTimeApproved) throw new PurchaseError('本单订货周期超出客户约定，请先单独批准例外');
    return { action };
  }
  if (action === 'record_payment') {
    if (po.approvedHash !== po.contentHash || !['approved', 'ordered'].includes(po.status) || po.openIncidentId) conflict();
    if (po.needsLegacyReview) throw new PurchaseError('请先核对原批准、供货和已付款书证');
    if (!positiveCents(input.amountCents) || po.dueCents === null || input.amountCents > Math.min(po.dueCents, po.totalCents - po.paidCents)) {
      throw new PurchaseError('付款金额须大于零且不得超过本采购单未付合计');
    }
    const approval = approvalAt(po.ledger, Date.now());
    if (!po.orderedBefore) {
      if (!view.eligibility.eligible) throw new PurchaseError('订购前付款须先重新核对本单启动条件和供应商报价');
      assertApprovedTerms(po, checkedApproval(view, po, approval), Date.now());
    }
    return { action, reference: requiredText(input.reference, '本次实际付款的流水凭证'), amountCents: input.amountCents,
      conditionReference: requiredText(input.conditionReference, '本次付款条件已满足的依据'),
      approvalId: approval?.id ?? null, exceptionResolutionId: po.commitmentExceptions.find(row => row.resolution === 'payable_verified')?.resolutionId ?? null,
      authorizedDueCents: po.dueCents };
  }
  if (action === 'report_change') {
    if (po.openIncidentId || !['unavailable', 'delay', 'price', 'other'].includes(input.changeKind ?? '')) conflict();
    return { action, changeKind: input.changeKind, previousStatus: po.status, reference: requiredText(input.reference, '供货变化的来源'),
      description: requiredText(input.description, '缺货、延期、涨价或其他变化的具体情况') };
  }
  if (action === 'resolve_change') {
    const incident = po.ledger.find(row => row.id === po.openIncidentId);
    const previousStatus = snapshot(incident)?.operation.previousStatus;
    if (po.status !== 'on_hold' || !incident || !previousStatus || !input.outcome
      || !['original_terms', 'revised_terms', 'declined', 'replacement'].includes(input.outcome)) conflict();
    const committed = po.orderedBefore || po.paidCents > 0 || po.commitmentExceptions.length > 0;
    const disposedBefore = po.ledger.some(row => row.action === 'resolve_change' && snapshot(row)?.operation.dispositions?.length);
    if (input.outcome === 'replacement' && !committed) throw new PurchaseError('尚未订购或付款的采购单应按修订条款重新批准');
    if (input.outcome === 'original_terms' && po.commitmentState === 'supplier_cancelled') {
      throw new PurchaseError('供方已整笔取消。尚需订购的商品须另建采购并独立批准');
    }
    if (input.outcome === 'original_terms' && disposedBefore && (!po.remainingScope || !['approved', 'ordered'].includes(previousStatus))) {
      throw new PurchaseError('已经取消或交给替代单的数量不能恢复原单，请核对剩余商品');
    }
    const dispositions = committed && (input.outcome === 'declined' || input.outcome === 'replacement')
      ? committedDispositions(view, po, input, customerLines, remainingQuantities) : undefined;
    if (dispositions?.some(line => line.replacement) && !view.eligibility.eligible) {
      throw new PurchaseError('另建替代采购前须先核实客户订单仍符合采购启动条件');
    }
    return { action, outcome: input.outcome, incidentId: incident.id, previousStatus,
      supplierReference: requiredText(input.supplierReference, '人工协调供应商的书面依据'),
      customerReference: requiredText(input.customerReference, '客户对处理方案的书面回复'),
      ...(committed ? {
        supplierSha256: documentSha256(input.supplierSha256, '供方书面回复摘要'),
        customerSha256: documentSha256(input.customerSha256, '客户书面回复摘要'),
      } : {}),
      description: requiredText(input.description, '双方确认的具体结果'), dispositions,
      refund: dispositions && po.paidCents > 0 ? {
        status: 'pending_review', paidCents: po.paidCents, responsibleActor: actor.id,
        followup: requiredText(input.refundFollowup, '原付款与未决退款的后续核对安排'),
      } : null,
      revisedTerms: input.outcome === 'revised_terms' ? checkedEdits(po, input) : undefined };
  }
  throw new PurchaseError('无法识别的采购操作', 400);
}

function supplyEvidenceFor(po: PO, operation: ReturnType<typeof actionDetails> | Awaited<ReturnType<typeof previewCommitment>>) {
  if (operation.action === 'approve' || operation.action === 'approve_lead_time') return po.lines;
  if (operation.action === 'reapprove_purchase') return operation.execution.lines;
  if (operation.action === 'review_legacy_approval' || operation.action === 'resolve_change') {
    const edits = operation.action === 'review_legacy_approval' ? operation.checkedTerms : operation.revisedTerms ?? [];
    const originals = edits.map(edit => ({ source: po.lines.find(line => line.orderItemId === edit.orderItemId)!.source, terms: edit.terms }));
    const replacements = operation.action === 'resolve_change' ? (operation.dispositions ?? []).flatMap(row => row.replacement ? [row.replacement] : []) : [];
    return [...originals, ...replacements];
  }
  return [];
}

export async function previewPurchaseAction(tx: Db, input: PurchaseActionInput, actor: PurchaseActor) {
  const view = await purchaseWorkspace(tx, input.orderId);
  const po = view.orders.find(order => order.id === input.purchaseOrderId);
  if (!po) conflict();
  requiredText(input.requestId, '操作编号');
  const validateDemand = input.action === 'approve' || input.action === 'approve_lead_time' || input.action === 'reapprove_purchase'
    || (!po.orderedBefore && (input.action === 'record_payment' || input.action === 'approve_remaining'));
  const commitment = input.action === 'register_order' || input.action === 'record_late_order_exception';
  const validateSource = validateDemand || input.action === 'register_order' || input.action === 'review_legacy_approval';
  const original = validateSource || commitment || input.action === 'resolve_change' ? await loadPurchaseOrderSource(tx, input.orderId) : null;
  const currentLines = original ? await loadPurchaseLines(tx, original) : [];
  const remaining = original ? remainingDemand(original) : new Map<string, number>();
  const operation = commitment ? await previewCommitment(tx, original!, view, po, input, actor) : actionDetails(view, po, input, currentLines, remaining, actor);
  await assertSupplierDocumentScopes(tx, supplyEvidenceFor(po, operation), operation.action === 'reapprove_purchase'
    ? { restoredLines: operation.documentScopes } : undefined);
  const scoped = operation.action === 'register_order' ? operation.execution.lines
    : operation.action === 'approve_remaining' ? operation.scope.lines
    : operation.action === 'reapprove_purchase' ? operation.execution.lines
    : operation.action === 'record_payment' ? po.remainingScope?.lines : undefined;
  if (validateSource) {
    for (const line of po.lines) {
      const effective = scoped?.find(row => row.orderItemId === line.orderItemId);
      if (scoped && !effective) continue;
      const fresh = currentLines.find(row => row.orderItemId === line.orderItemId);
      const expectedVersion = line.source.customerLineVersion ?? pricingContentHash(line.source);
      if (!fresh || pricingContentHash(fresh) !== expectedVersion) conflict();
      const replacementQuantity = activeReplacementQuantity(view, line.orderItemId);
      const pending = line.fromPurchaseOrderId ? replacementQuantity : (effective?.quantity ?? line.source.quantity) + replacementQuantity;
      if (validateDemand && pending > (remaining.get(line.orderItemId) ?? 0)) {
        throw new PurchaseError('采购数量超过本客户订单行未发货数量');
      }
    }
  }
  const demand = validateDemand || input.action === 'resolve_change' ? [...remaining].map(([orderItemId, unshipped]) => ({
    orderItemId, unshipped, activeReplacements: activeReplacementQuantity(view, orderItemId), attributed: attributedQuantity(view, po.id, orderItemId),
  })) : undefined;
  const preview = { actorId: actor.id, actorEmail: actor.email, requestId: input.requestId, orderId: view.orderId, purchaseOrderId: po.id,
    version: po.version, totalCents: po.totalCents, paidCents: po.paidCents, lines: po.lines.map(line => ({
      orderItemId: line.orderItemId, source: line.source, terms: line.terms, revision: line.revision,
      fromPurchaseOrderId: line.fromPurchaseOrderId,
    })), eligibility: view.eligibility, funding: { termsVersion: view.startReview.termsVersion, plan: view.startReview.plan }, demand, operation };
  return { snapshot: preview, actionHash: pricingContentHash(preview) };
}

async function applyLineEdits(tx: Db, po: PO, actor: PurchaseActor, edits: LineEdit[]) {
  for (const edit of edits) {
    const line = po.lines.find(row => row.orderItemId === edit.orderItemId)!;
    const terms = attestPurchaseTerms(edit.terms, line.source, actor, true);
    if (missingPurchaseTerms(terms, line.source).length) conflict();
    const changed = line.replacementId
      ? await tx.$executeRaw`UPDATE PurchaseReplacementLine SET terms=${JSON.stringify(terms)},ownerId=${actor.id},
        revision=revision+1,updatedAt=${now()} WHERE id=${line.replacementId} AND purchaseOrderId=${po.id}`
      : await tx.$executeRaw`UPDATE PurchaseRequirement SET terms=${JSON.stringify(terms)},ownerId=${actor.id},
        revision=revision+1,updatedAt=${now()} WHERE orderItemId=${edit.orderItemId} AND purchaseOrderId=${po.id}`;
    if (changed !== 1) conflict();
  }
}

async function createReplacements(tx: Db, orderId: string, fromPurchaseOrderId: string, authorizationId: string, actor: PurchaseActor, dispositions: Disposition[]) {
  for (const disposition of dispositions) {
    if (!disposition.replacement) continue;
    const { source } = disposition.replacement;
    const terms = attestPurchaseTerms(disposition.replacement.terms, source, actor, true);
    if (missingPurchaseTerms(terms, source).length) conflict();
    const key = pricingContentHash({ group: group(terms), fromPurchaseOrderId, authorizationId });
    const draft = await createDraft(tx, orderId, key);
    if (draft.committed) conflict();
    const stamp = now();
    await tx.$executeRaw`INSERT INTO PurchaseReplacementLine
      (id,orderId,orderItemId,fromPurchaseOrderId,purchaseOrderId,authorizationId,quantity,ownerId,source,terms,revision,createdAt,updatedAt)
      VALUES (${randomUUID()},${orderId},${disposition.orderItemId},${fromPurchaseOrderId},${draft.id},${authorizationId},
      ${disposition.quantity},${actor.id},${JSON.stringify(source)},${JSON.stringify(terms)},1,${stamp},${stamp})`;
  }
}

export async function applyPurchaseAction(tx: Db, input: PurchaseActionInput, actor: PurchaseActor, authorization?: PurchaseAuthorization) {
  const requestKey = pricingContentHash({ orderId: input.orderId, purchaseOrderId: input.purchaseOrderId, requestId: requiredText(input.requestId, '操作编号') });
  const intent = pricingContentHash({ actorId: actor.id, input: { ...input, actionHash: undefined } });
  const prior = await findPurchaseActivityByRequest(tx, requestKey);
  if (prior) {
    if (prior.intent !== intent || prior.actionHash !== input.actionHash || !input.actionHash) conflict();
    return purchaseWorkspace(tx, input.orderId);
  }
  const { snapshot: preview, actionHash } = await previewPurchaseAction(tx, input, actor);
  if (input.actionHash !== actionHash) conflict();
  const view = await purchaseWorkspace(tx, input.orderId);
  const po = view.orders.find(row => row.id === input.purchaseOrderId)!;
  const op = preview.operation;
  if (op.action !== 'resolve_change' || op.dispositions?.some(line => line.replacement)) {
    await assertSupplierDocumentScopes(tx, supplyEvidenceFor(po, op), {
      attestation: { orderId: input.orderId, purchaseOrderId: op.action === 'resolve_change' ? undefined : po.id, actor },
      restoredLines: op.action === 'reapprove_purchase' ? op.documentScopes : undefined,
    });
  }
  let status = po.status;
  let approvedHash = po.approvedHash;
  let groupKey: string | null = null;
  if (op.action === 'approve') { status = 'approved'; approvedHash = po.contentHash; }
  if (op.action === 'approve_remaining') { status = po.orderedBefore ? 'ordered' : 'approved'; approvedHash = po.contentHash; }
  if (op.action === 'register_order' && status === 'approved') status = 'ordered';
  if (op.action === 'record_late_order_exception' && op.category === 'credit') status = 'on_hold';
  if (op.action === 'resolve_order_exception') {
    status = op.resolution === 'payable_verified' && !po.openIncidentId && !op.remainingReviewPending && po.remaining.length
      ? 'ordered' : 'on_hold';
  }
  if (op.action === 'report_change') status = 'on_hold';
  if (op.action === 'resolve_change' && op.outcome === 'original_terms') {
    if (po.commitmentState === 'pending') status = 'on_hold';
    else status = po.orderedBefore && (op.previousStatus === 'approved' || po.commitmentState === 'payable_verified')
      ? 'ordered' : op.previousStatus!;
  }
  if (op.action === 'resolve_change' && op.outcome === 'declined' && !op.dispositions) status = 'superseded';
  if (op.action === 'resolve_change' && op.revisedTerms) {
    groupKey = pricingContentHash({ revisedPurchase: po.id, group: group(op.revisedTerms[0].terms) });
    await applyLineEdits(tx, po, actor, op.revisedTerms);
    status = 'draft';
    approvedHash = null;
  }
  const referenceKey = op.action === 'record_payment' || op.action === 'register_order' || op.action === 'record_late_order_exception'
    ? pricingContentHash({ action: op.action === 'record_payment' ? op.action : 'register_order',
      party: op.action === 'record_payment' ? po.lines[0].terms.payee : po.lines[0].terms.supplier, reference: op.reference })
    : undefined;
  if (referenceKey) {
    const existing = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM PurchaseActivity WHERE referenceKey=${referenceKey}`;
    if (existing.length) throw new PurchaseError('同一笔实际业务凭证已登记，请核对原记录');
  }
  const updated = await tx.$executeRaw`UPDATE PurchaseOrder SET status=${status},approvedHash=${approvedHash},
    groupKey=COALESCE(${groupKey},groupKey),revision=revision+1,updatedAt=${now()}
    WHERE id=${po.id} AND orderId=${input.orderId} AND revision=${po.revision}`;
  if (updated !== 1) conflict();
  const authorizationId = await addPurchaseActivity(tx, { orderId: input.orderId, purchaseOrderId: po.id, action: op.action, actor,
    requestKey, referenceKey, amountCents: op.action === 'record_payment' ? op.amountCents : undefined,
    detail: { intent, actionHash, authorization, contentHash: po.contentHash,
      customerPlanVersion: fundingVersion(view.startReview, view.startReview.plan, true),
      fundingTermsVersion: fundingVersion(view.startReview, op.action === 'review_legacy_approval' ? op.fundingPlan : view.startReview.plan), snapshot: preview } });
  if (op.action === 'resolve_change' && op.dispositions) {
    await createReplacements(tx, input.orderId, po.id, authorizationId, actor, op.dispositions);
  }
  return purchaseWorkspace(tx, input.orderId);
}
