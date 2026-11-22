import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { addPurchaseActivity, findPurchaseActivityByRequest, readPurchaseActivities, type PurchaseActor, type PurchaseActivity, type PurchaseAuthorization } from '@/lib/purchase-activity';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { loadPurchaseOrderSource, loadPurchaseLines, type PurchaseSource } from '@/lib/purchase-source';
import { purchaseStartReview } from '@/lib/purchase-start';
import {
  attestPurchaseTerms, documentSha256, initialPurchaseTerms, missingPurchaseTerms, missingWrittenTerms, normalizePurchaseTerms, positiveCents, PurchaseError,
  purchaseTimestamp, requiredText, type PurchaseTerms,
} from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
type Status = 'draft' | 'approved' | 'ordered' | 'on_hold' | 'superseded';
type RequirementRow = {
  orderItemId: string; ownerId: string; source: string; terms: string; revision: number; purchaseOrderId: string | null;
  replacementId: string | null; fromPurchaseOrderId: string | null;
};
type OrderRow = { id: string; status: Status; revision: number; approvedHash: string | null };
type LineSource = PurchaseSource & { customerLineVersion?: string };
type LineEdit = { orderItemId: string; terms: PurchaseTerms };
type ReplacementInput = { name?: unknown; brand?: unknown; catalogNumber?: unknown; spec?: unknown; unit?: unknown; terms?: unknown };
type DispositionInput = { orderItemId: string; quantity: number; outcome: 'cancel' | 'replace'; replacement?: ReplacementInput };
export type PurchaseActionInput = {
  orderId: string; purchaseOrderId: string;
  action: 'approve' | 'approve_lead_time' | 'register_order' | 'record_payment' | 'report_change' | 'resolve_change';
  version: string; requestId: string; actionHash?: string; reference?: string; amountCents?: number; conditionReference?: string;
  occurredAt?: string; referenceSha256?: string; description?: string;
  changeKind?: 'delay' | 'price' | 'unavailable' | 'other';
  outcome?: 'original_terms' | 'revised_terms' | 'declined' | 'replacement';
  supplierReference?: string; supplierSha256?: string; customerReference?: string; customerSha256?: string;
  revisedTerms?: LineEdit[]; dispositions?: DispositionInput[]; refundFollowup?: string;
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

type ProcurementSnapshot = {
  lines: Array<{ orderItemId: string; source: LineSource; terms: PurchaseTerms; revision: number }>;
  operation: {
    occurredAt?: string; previousStatus?: Status; incidentId?: string; outcome?: string; reference?: string;
    dispositions?: Array<{ orderItemId: string; quantity: number }>;
  };
  eligibility?: unknown;
};

function snapshot(activity: PurchaseActivity | undefined) {
  return activity?.detail.snapshot as ProcurementSnapshot | undefined;
}

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

export async function purchaseWorkspace(tx: Db, orderId: string) {
  const order = await loadPurchaseOrderSource(tx, orderId);
  const activities = await readPurchaseActivities(tx, orderId);
  const { eligibility, review: startReview } = await purchaseStartReview(tx, order, activities);
  const rows = await tx.$queryRaw<RequirementRow[]>`
    SELECT orderItemId,ownerId,source,terms,revision,purchaseOrderId,NULL AS replacementId,NULL AS fromPurchaseOrderId
    FROM PurchaseRequirement WHERE orderId=${orderId}
    UNION ALL
    SELECT orderItemId,ownerId,source,terms,revision,purchaseOrderId,id AS replacementId,fromPurchaseOrderId
    FROM PurchaseReplacementLine WHERE orderId=${orderId} ORDER BY orderItemId`;
  const headers = await tx.$queryRaw<OrderRow[]>`SELECT id,status,revision,approvedHash FROM PurchaseOrder
    WHERE orderId=${orderId} AND (status <> 'superseded' OR EXISTS(
      SELECT 1 FROM PurchaseActivity a WHERE a.purchaseOrderId=PurchaseOrder.id
        AND a.action IN ('register_order','record_payment'))) ORDER BY createdAt,id`;
  const rowsByPosition = rows.map(rowView).sort((a, b) => a.source.position - b.source.position);
  const orders = headers.map(header => {
    const ledger = activities.filter(row => row.purchaseOrderId === header.id);
    const committed = ledger.find(row => row.action === 'register_order' || row.action === 'record_payment');
    const registration = ledger.find(row => row.action === 'register_order');
    const lines = contractLines(rowsByPosition.filter(line => line.purchaseOrderId === header.id), header.id, committed);
    const totalCents = lines.reduce((sum, line) => sum + (line.terms.linePayableCents ?? 0), 0);
    if (!Number.isSafeInteger(totalCents)) throw new PurchaseError('采购合计超过可精确表示的金额');
    const paidCents = ledger.reduce((sum, row) => sum + (row.action === 'record_payment' ? row.amountCents ?? 0 : 0), 0);
    const content = { orderId, purchaseOrderId: header.id, totalCents, lines: lines.map(line => ({
      orderItemId: line.orderItemId, source: line.source, terms: line.terms, revision: line.revision,
    })) };
    const contentHash = pricingContentHash(content);
    const revision = Number(header.revision);
    return { ...header, revision, totalCents, contentHash, lines, ledger, paidCents,
      version: pricingContentHash({ contentHash, status: header.status, revision }),
      orderedBefore: Boolean(registration),
      leadTimeApproved: ledger.some(row => row.action === 'approve_lead_time'
        && row.detail.contentHash === contentHash
        && pricingContentHash(snapshot(row)?.eligibility ?? null) === pricingContentHash(eligibility)),
      openIncidentId: currentIncident(ledger)?.id ?? null,
      orderReceipt: registration ? {
        occurredAt: snapshot(registration)?.operation.occurredAt ?? null, registeredAt: registration.createdAt,
        reference: snapshot(registration)?.operation.reference ?? null,
      } : null,
    };
  });
  return { orderId, orderStatus: order.status, eligibility, startReview, lines: rowsByPosition.filter(line => !line.replacementId), orders, activities };
}

export async function prepareOrderPurchases(tx: Db, orderId: string, actor: PurchaseActor) {
  const order = await loadPurchaseOrderSource(tx, orderId);
  const { eligibility } = await purchaseStartReview(tx, order, await readPurchaseActivities(tx, orderId));
  if (eligibility.eligible && order.status === 'confirmed') {
    const sources = await loadPurchaseLines(tx, order);
    for (const source of sources) {
      if (order.orderItems.some(item => item.id === source.orderItemId && (item.shippedQty > 0 || item.quantity < 1))) continue;
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
  const source = (await loadPurchaseLines(tx, original)).find(row => row.orderItemId === line.orderItemId);
  if (!source || original.orderItems.find(row => row.id === line.orderItemId)?.shippedQty) conflict();
  const supplied = normalizePurchaseTerms(input.terms);
  const same = pricingContentHash({ terms: supplied, source }) === pricingContentHash({ terms: normalizePurchaseTerms(line.terms), source: line.source });
  if (same && (!input.checkedEvidence || !line.missing.length)) return view;
  const terms = attestPurchaseTerms(supplied, source, actor, input.checkedEvidence === true);
  const missing = missingPurchaseTerms(terms, source);
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

function customerPlanVersion(view: Workspace) {
  return pricingContentHash({ orderTerms: view.startReview.termsVersion, acceptance: view.startReview.acceptance,
    plan: view.startReview.plan });
}

type Disposition = {
  orderItemId: string; quantity: number; outcome: 'cancel' | 'replace';
  replacement: { terms: PurchaseTerms; source: LineSource } | null;
};

function checkedEdits(po: PO, input: PurchaseActionInput) {
  if (po.orderedBefore || po.paidCents > 0) throw new PurchaseError('已有订购或付款，请选择取消受影响数量或另建替代采购');
  const edits = input.revisedTerms;
  if (!Array.isArray(edits) || edits.length !== po.lines.length || new Set(edits.map(edit => edit?.orderItemId)).size !== edits.length) conflict();
  const values = po.lines.map(line => {
    const edit = edits.find(row => row?.orderItemId === line.orderItemId);
    if (!edit) conflict();
    const terms = normalizePurchaseTerms(edit.terms);
    if (missingWrittenTerms(terms, line.source).length) throw new PurchaseError('变更后的条款仍缺核实依据');
    return { orderItemId: line.orderItemId, terms };
  });
  if (new Set(values.map(value => group(value.terms))).size !== 1) throw new PurchaseError('本次修订须对应同一供货方、收款方及付款条件');
  return values;
}

function committedDispositions(
  po: PO, input: PurchaseActionInput, customerLines: PurchaseSource[], remainingQuantities: ReadonlyMap<string, number>,
): Disposition[] {
  const entries = input.dispositions;
  if (!Array.isArray(entries) || !entries.length || entries.some(entry => !entry || typeof entry.orderItemId !== 'string')
    || new Set(entries.map(entry => entry.orderItemId)).size !== entries.length) {
    throw new PurchaseError('须逐行填写替代或取消数量', 400);
  }
  const prior = po.ledger.flatMap(row => row.action === 'resolve_change' ? snapshot(row)?.operation.dispositions ?? [] : []);
  const dispositions = entries.map(({ orderItemId, quantity, outcome, replacement }) => {
    const line = po.lines.find(row => row.orderItemId === orderItemId);
    const original = customerLines.find(row => row.orderItemId === orderItemId);
    if (!line || !original || !positiveCents(quantity) || quantity + prior.filter(row => row.orderItemId === orderItemId)
      .reduce((sum, row) => sum + row.quantity, 0) > line.source.quantity) {
      throw new PurchaseError('替代或取消的累计数量不得超过原采购行');
    }
    if (outcome === 'cancel') return { orderItemId, quantity, outcome, replacement: null };
    if (quantity > (remainingQuantities.get(orderItemId) ?? 0)) throw new PurchaseError('替代采购不得超过客户订单行未发货数量');
    if (outcome !== 'replace' || !replacement || input.outcome !== 'replacement') throw new PurchaseError('请核对每行的替代或取消结果', 400);
    const source: LineSource = {
      ...original, productId: null, variantId: null, written: null, quantity, customerLineVersion: pricingContentHash(original),
      name: requiredText(replacement.name, '替代商品名称'), brand: requiredText(replacement.brand, '替代商品品牌'),
      catalogNumber: requiredText(replacement.catalogNumber, '替代商品货号'), spec: requiredText(replacement.spec, '替代商品规格'),
      unit: requiredText(replacement.unit, '替代商品计量单位'),
    };
    const terms = normalizePurchaseTerms(replacement.terms);
    if (missingWrittenTerms(terms, source).length) throw new PurchaseError('替代行须具备当前有效的供货、收款和付款书证');
    return { orderItemId, quantity, outcome, replacement: { terms, source } };
  });
  if (input.outcome === 'replacement' && !dispositions.some(line => line.outcome === 'replace')) {
    throw new PurchaseError('请填写至少一条待独立批准的替代采购行', 400);
  }
  return dispositions;
}

function actionDetails(
  view: Workspace, po: PO, input: PurchaseActionInput, customerLines: PurchaseSource[],
  remainingQuantities: ReadonlyMap<string, number>, actor: PurchaseActor,
) {
  if (po.version !== input.version) conflict();
  const action = input.action;
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
  if (action === 'register_order' || action === 'record_payment') {
    if (action === 'register_order' && po.orderedBefore) throw new PurchaseError('原采购单已登记过供应商订购结果');
    if (po.approvedHash !== po.contentHash || (action === 'register_order' ? po.status !== 'approved' : !['approved', 'ordered'].includes(po.status))) conflict();
    const approval = po.ledger.findLast(row => row.action === 'approve');
    if (!po.orderedBefore && approval?.detail.customerPlanVersion !== customerPlanVersion(view)) {
      throw new PurchaseError('业务条件与该版采购批准不一致，请重新核对并批准');
    }
    const reference = requiredText(input.reference, action === 'register_order' ? '供应商确认订购的单据编号' : '本次实际付款的流水凭证');
    if (action === 'register_order') {
      const occurredAt = purchaseTimestamp(input.occurredAt, '供应商实际确认订购时间');
      const at = Date.parse(occurredAt);
      const lastSupplyDecision = po.ledger.findLast(row => Date.parse(row.createdAt) <= at
        && (row.action === 'report_change' || row.action === 'resolve_change'));
      if (!po.lines.length || !approval || at < Date.parse(approval.createdAt) || at > Date.now()
        || lastSupplyDecision?.action === 'report_change'
        || po.lines.some(line => missingPurchaseTerms(line.terms, line.source, at).length)) {
        throw new PurchaseError('实际订购须发生在本版批准后、供货书证有效期间，并提供对应供应商凭证');
      }
      return { action, reference, occurredAt, referenceSha256: documentSha256(input.referenceSha256, '实际订购凭据摘要') };
    }
    if (!positiveCents(input.amountCents) || input.amountCents > po.totalCents - po.paidCents) {
      throw new PurchaseError('付款金额须大于零且不得超过本采购单未付合计');
    }
    if (!po.orderedBefore && (!view.eligibility.eligible || po.lines.some(line => line.missing.length))) {
      throw new PurchaseError('订购前付款须先重新核对本单启动条件和供应商报价');
    }
    return { action, reference, amountCents: input.amountCents, conditionReference: requiredText(input.conditionReference, '本次付款条件已满足的依据') };
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
    const committed = po.orderedBefore || po.paidCents > 0;
    const disposedBefore = po.ledger.some(row => row.action === 'resolve_change' && snapshot(row)?.operation.dispositions?.length);
    if (input.outcome === 'replacement' && !committed) throw new PurchaseError('尚未订购或付款的采购单应按修订条款重新批准');
    if (input.outcome === 'original_terms' && disposedBefore) throw new PurchaseError('已经取消或交给替代单的数量不能恢复原单');
    const dispositions = committed && (input.outcome === 'declined' || input.outcome === 'replacement')
      ? committedDispositions(po, input, customerLines, remainingQuantities) : undefined;
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

export async function previewPurchaseAction(tx: Db, input: PurchaseActionInput, actor: PurchaseActor) {
  const view = await purchaseWorkspace(tx, input.orderId);
  const po = view.orders.find(order => order.id === input.purchaseOrderId);
  if (!po) conflict();
  requiredText(input.requestId, '操作编号');
  const validateSource = input.action === 'approve' || input.action === 'approve_lead_time'
    || input.action === 'register_order' || (input.action === 'record_payment' && !po.orderedBefore);
  const original = validateSource || input.action === 'resolve_change' ? await loadPurchaseOrderSource(tx, input.orderId) : null;
  const currentLines = original ? await loadPurchaseLines(tx, original) : [];
  const remaining = new Map(original?.orderItems.map(line => [line.id, line.quantity - line.shippedQty]));
  const operation = actionDetails(view, po, input, currentLines, remaining, actor);
  if (validateSource) {
    for (const line of po.lines) {
      const fresh = currentLines.find(row => row.orderItemId === line.orderItemId);
      const expectedVersion = line.source.customerLineVersion ?? pricingContentHash(line.source);
      if (!fresh || pricingContentHash(fresh) !== expectedVersion) conflict();
      if (!po.orderedBefore && input.action !== 'register_order' && line.source.quantity > (remaining.get(line.orderItemId) ?? 0)) {
        throw new PurchaseError('采购数量超过本客户订单行未发货数量');
      }
    }
  }
  const preview = { actorId: actor.id, actorEmail: actor.email, requestId: input.requestId, orderId: view.orderId, purchaseOrderId: po.id,
    version: po.version, totalCents: po.totalCents, paidCents: po.paidCents, lines: po.lines.map(line => ({
      orderItemId: line.orderItemId, source: line.source, terms: line.terms, revision: line.revision,
      fromPurchaseOrderId: line.fromPurchaseOrderId,
    })), eligibility: view.eligibility, operation };
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
  let status = po.status;
  let approvedHash = po.approvedHash;
  let groupKey: string | null = null;
  if (op.action === 'approve') { status = 'approved'; approvedHash = po.contentHash; }
  if (op.action === 'register_order') status = 'ordered';
  if (op.action === 'report_change') status = 'on_hold';
  if (op.action === 'resolve_change' && op.outcome === 'original_terms') status = op.previousStatus!;
  if (op.action === 'resolve_change' && op.outcome === 'declined' && !op.dispositions) status = 'superseded';
  if (op.action === 'resolve_change' && op.revisedTerms) {
    groupKey = pricingContentHash({ revisedPurchase: po.id, group: group(op.revisedTerms[0].terms) });
    await applyLineEdits(tx, po, actor, op.revisedTerms);
    status = 'draft';
    approvedHash = null;
  }
  const referenceKey = op.action === 'record_payment' || op.action === 'register_order'
    ? pricingContentHash({ action: op.action, party: op.action === 'record_payment' ? po.lines[0].terms.payee : po.lines[0].terms.supplier, reference: op.reference })
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
    detail: { intent, actionHash, authorization, contentHash: po.contentHash, customerPlanVersion: customerPlanVersion(view), snapshot: preview } });
  if (op.action === 'resolve_change' && op.dispositions) {
    await createReplacements(tx, input.orderId, po.id, authorizationId, actor, op.dispositions);
  }
  return purchaseWorkspace(tx, input.orderId);
}
