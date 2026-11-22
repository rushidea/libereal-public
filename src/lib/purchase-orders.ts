import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { loadPurchaseOrderSource, loadPurchaseLines, purchaseEligibility, type PurchaseSource } from '@/lib/purchase-source';
import { initialPurchaseTerms, missingPurchaseTerms, normalizePurchaseTerms, positiveCents, PurchaseError, requiredText, type PurchaseTerms } from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
type Actor = { id: string; email: string };
type Status = 'draft' | 'approved' | 'ordered' | 'on_hold' | 'superseded';
type RequirementRow = { orderItemId: string; ownerId: string; source: string; terms: string; revision: number; purchaseOrderId: string | null };
type OrderRow = { id: string; groupKey: string; status: Status; revision: number; approvedHash: string | null };
type ActivityRow = { id: string; purchaseOrderId: string | null; orderItemId: string | null; actorId: string; action: string; amountCents: bigint | null; detail: string; createdAt: string };
type LineEdit = { orderItemId: string; terms: PurchaseTerms };
export type PurchaseActionInput = {
  orderId: string; purchaseOrderId: string; action: 'approve'|'register_order'|'record_payment'|'report_change'|'resolve_change';
  version: string; requestId: string; actionHash?: string; reference?: string; amountCents?: number; conditionReference?: string;
  description?: string; changeKind?: 'delay'|'price'|'unavailable'|'other'; outcome?: 'original_terms'|'revised_terms'|'declined';
  supplierReference?: string; customerReference?: string; revisedTerms?: LineEdit[];
};
function group(terms: PurchaseTerms) {
  return pricingContentHash({ supplier: terms.supplier, payee: terms.payee, currency: terms.currency, paymentTerms: terms.paymentTerms });
}
function parseRecord(raw: string): Record<string, unknown> { return JSON.parse(raw); }
function now() { return new Date().toISOString(); }
function conflict(): never { throw new PurchaseError('采购单或依据已有变化，请刷新并核对当前版本'); }

async function activity(tx: Db, input: { orderId: string; purchaseOrderId?: string | null; orderItemId?: string; actor: Actor;
  action: string; requestKey?: string; referenceKey?: string; amountCents?: number; detail: unknown }) {
  await tx.$executeRaw`INSERT INTO PurchaseActivity
    (id,orderId,purchaseOrderId,orderItemId,actorId,action,requestKey,referenceKey,amountCents,detail,createdAt)
    VALUES (${randomUUID()},${input.orderId},${input.purchaseOrderId ?? null},${input.orderItemId ?? null},
    ${input.actor.id},${input.action},${input.requestKey ?? null},${input.referenceKey ?? null},
    ${input.amountCents == null ? null : BigInt(input.amountCents)},${JSON.stringify(input.detail)},${now()})`;
}

export async function purchaseWorkspace(tx: Db, orderId: string) {
  const order = await loadPurchaseOrderSource(tx, orderId);
  const eligibility = await purchaseEligibility(tx, order);
  const rows = await tx.$queryRaw<RequirementRow[]>`SELECT orderItemId,ownerId,source,terms,revision,purchaseOrderId FROM PurchaseRequirement WHERE orderId=${orderId} ORDER BY orderItemId`;
  const headers = await tx.$queryRaw<OrderRow[]>`SELECT id,groupKey,status,revision,approvedHash FROM PurchaseOrder WHERE orderId=${orderId} AND status <> 'superseded' ORDER BY createdAt,id`;
  const history = await tx.$queryRaw<ActivityRow[]>`SELECT id,purchaseOrderId,orderItemId,actorId,action,amountCents,detail,createdAt FROM PurchaseActivity WHERE orderId=${orderId} ORDER BY rowid`;
  const activities = history.map(a => ({ ...a, amountCents: a.amountCents == null ? null : Number(a.amountCents), detail: parseRecord(a.detail) }));
  const lines = rows.map(row => {
    const source: PurchaseSource = JSON.parse(row.source), terms: PurchaseTerms = JSON.parse(row.terms);
    return { ...row, source, terms, revision: Number(row.revision), missing: missingPurchaseTerms(terms,source) };
  }).sort((a,b) => a.source.position - b.source.position);
  const orders = headers.map(header => {
    const own = lines.filter(l => l.purchaseOrderId === header.id);
    const totalCents = own.reduce((sum,l) => sum + (l.terms.linePayableCents ?? 0),0);
    if (!Number.isSafeInteger(totalCents)) throw new PurchaseError('采购合计超过可精确表示的金额');
    const ledger = activities.filter(a => a.purchaseOrderId === header.id);
    const paidCents = ledger.reduce((sum,a) => sum + (a.action === 'record_payment' ? a.amountCents ?? 0 : 0),0);
    const content = { orderId, purchaseOrderId: header.id, totalCents, lines: own.map(l => ({
      orderItemId: l.orderItemId, source: l.source, terms: l.terms, revision: l.revision,
    })) };
    const contentHash = pricingContentHash(content);
    const revision = Number(header.revision);
    const version = pricingContentHash({ contentHash, revision, status: header.status, approvedHash: header.approvedHash,
      paidCents, eligibility, orderStatus: order.status });
    return { id: header.id, status: header.status, revision, version, contentHash, approvedHash: header.approvedHash,
      totalCents, paidCents, lines: own, ledger, orderedBefore: ledger.some(a => a.action === 'register_order') };
  });
  return { orderId, orderStatus: order.status, eligibility, lines, orders, activities };
}

export async function prepareOrderPurchases(tx: Db, orderId: string, actor: Actor) {
  const order = await loadPurchaseOrderSource(tx, orderId);
  const eligibility = await purchaseEligibility(tx, order);
  if (eligibility.eligible && order.status === 'confirmed') {
    const sources = await loadPurchaseLines(tx, order);
    for (const source of sources) {
      if (order.orderItems.some(i => i.id === source.orderItemId && (i.shippedQty > 0 || i.quantity < 1))) continue;
      const stamp = now();
      const count = await tx.$executeRaw`INSERT INTO PurchaseRequirement
        (orderItemId,orderId,ownerId,source,terms,revision,createdAt,updatedAt)
        VALUES (${source.orderItemId},${orderId},${actor.id},${JSON.stringify(source)},${JSON.stringify(initialPurchaseTerms(source))},1,${stamp},${stamp})
        ON CONFLICT(orderItemId) DO NOTHING`;
      if (count === 1) await activity(tx,{ orderId, orderItemId: source.orderItemId, actor, action: 'prepare', detail: { eligibility, source } });
    }
  }
  return purchaseWorkspace(tx,orderId);
}

async function touchDraft(tx: Db, orderId: string, id: string) {
  // Retain vacated drafts and their history when a line moves to another supplier.
  await tx.$executeRaw`UPDATE PurchaseOrder SET revision=revision+1,updatedAt=${now()},
    status=CASE WHEN EXISTS(SELECT 1 FROM PurchaseRequirement WHERE purchaseOrderId=${id}) THEN 'draft' ELSE 'superseded' END
    WHERE id=${id} AND orderId=${orderId} AND status='draft'`;
}

export async function savePurchaseLine(tx: Db, input: { orderId: string; orderItemId: string; revision: number; terms: PurchaseTerms }, actor: Actor) {
  const view = await purchaseWorkspace(tx,input.orderId);
  if (!view.eligibility.eligible) throw new PurchaseError(view.eligibility.reason ?? '请核实采购启动条件');
  const line = view.lines.find(l => l.orderItemId === input.orderItemId);
  const current = view.orders.find(o => o.id === line?.purchaseOrderId);
  if (!line || line.revision !== input.revision || (current && (current.status !== 'draft' || current.orderedBefore || current.paidCents > 0))) conflict();
  const terms = normalizePurchaseTerms(input.terms);
  if (pricingContentHash(terms) === pricingContentHash(line.terms)) return view;
  const missing = missingPurchaseTerms(terms,line.source);
  let target: string | null = null;
  if (!missing.length) {
    const key = group(terms);
    const stamp = now();
    await tx.$executeRaw`INSERT INTO PurchaseOrder (id,orderId,groupKey,status,revision,createdAt,updatedAt)
      VALUES (${`PO-${randomUUID()}`},${input.orderId},${key},'draft',1,${stamp},${stamp}) ON CONFLICT DO NOTHING`;
    const [row] = await tx.$queryRaw<{id:string}[]>`SELECT id FROM PurchaseOrder WHERE orderId=${input.orderId} AND groupKey=${key} AND status='draft'`;
    if (!row) conflict();
    target = row.id;
  }
  const changed = await tx.$executeRaw`UPDATE PurchaseRequirement SET terms=${JSON.stringify(terms)}, purchaseOrderId=${target},
    ownerId=${actor.id},revision=revision+1,updatedAt=${now()} WHERE orderItemId=${line.orderItemId} AND orderId=${input.orderId} AND revision=${line.revision}`;
  if (changed !== 1) conflict();
  for (const id of new Set([line.purchaseOrderId,target])) if (id) await touchDraft(tx,input.orderId,id);
  await activity(tx,{ orderId: input.orderId, purchaseOrderId: target, orderItemId: line.orderItemId, actor, action: 'save_line',
    detail: { previous: line.terms, terms, fromPurchase: line.purchaseOrderId, missing } });
  return purchaseWorkspace(tx,input.orderId);
}

type Workspace = Awaited<ReturnType<typeof purchaseWorkspace>>;
type PO = Workspace['orders'][number];
function checkedEdits(po: PO, input: PurchaseActionInput) {
  const edits = input.revisedTerms;
  if (!Array.isArray(edits) || edits.length !== po.lines.length || new Set(edits.map(e => e.orderItemId)).size !== edits.length) conflict();
  const values = po.lines.map(line => {
    const edit = edits.find(e => e.orderItemId === line.orderItemId);
    if (!edit) conflict();
    const terms = normalizePurchaseTerms(edit.terms);
    if (missingPurchaseTerms(terms,line.source).length) throw new PurchaseError('变更后的条款仍缺核实依据');
    if ((po.orderedBefore || po.paidCents) && (terms.supplier !== line.terms.supplier || terms.payee !== line.terms.payee)) {
      throw new PurchaseError('已有订购或付款记录，供货方及收款方变更须另行核实原单处置');
    }
    return { orderItemId: line.orderItemId, terms };
  });
  if (new Set(values.map(v => group(v.terms))).size !== 1) throw new PurchaseError('本次修订须对应同一供货方、收款方及付款条件');
  if (values.reduce((sum,v) => sum + v.terms.linePayableCents!,0) < po.paidCents) throw new PurchaseError('修订金额低于已付金额，须先核实供应商结算');
  return values;
}

function actionDetails(view: Workspace, po: PO, input: PurchaseActionInput) {
  if (po.version !== input.version) conflict();
  const action = input.action;
  const startAction = action === 'approve' || action === 'register_order';
  if (startAction && (!po.lines.length || !view.eligibility.eligible || po.lines.some(l => l.missing.length))) {
    throw new PurchaseError('原订单的采购启动条件、供方材料或报价有效期需重新核对');
  }
  if (action === 'approve') {
    if (po.status !== 'draft') conflict();
    return { action };
  }
  if (action === 'register_order' || action === 'record_payment') {
    if (action === 'register_order' && po.orderedBefore) throw new PurchaseError('原采购单已登记过供应商订购结果');
    if (po.approvedHash !== po.contentHash || (action === 'register_order' ? po.status !== 'approved' : !['approved','ordered'].includes(po.status))) conflict();
    const reference = requiredText(input.reference, action === 'register_order' ? '供应商确认订购的单据编号' : '本次实际付款的流水凭证');
    if (action === 'register_order') return { action, reference };
    if (!positiveCents(input.amountCents) || input.amountCents! > po.totalCents - po.paidCents) throw new PurchaseError('付款金额须大于零且不得超过本采购单未付合计');
    if (!po.orderedBefore && (!view.eligibility.eligible || po.lines.some(l => l.missing.length))) throw new PurchaseError('订购前付款须先重新核对本单启动条件和供应商报价');
    return { action, reference, amountCents: input.amountCents!, conditionReference: requiredText(input.conditionReference,'本次付款条件已满足的依据') };
  }
  if (action === 'report_change') {
    if (po.status === 'on_hold' || !['unavailable','delay','price','other'].includes(input.changeKind ?? '')) conflict();
    return { action, changeKind: input.changeKind, previousStatus: po.status, reference: requiredText(input.reference,'供货变化的来源'),
      description: requiredText(input.description,'缺货、延期、涨价或其他变化的具体情况') };
  }
  if (action === 'resolve_change') {
    const incident = [...po.ledger].reverse().find(a => a.action === 'report_change');
    if (po.status !== 'on_hold' || !incident || !['original_terms','revised_terms','declined'].includes(input.outcome ?? '')) conflict();
    const supplierReference = requiredText(input.supplierReference,'人工协调供应商的依据');
    const customerReference = requiredText(input.customerReference,'客户对处理方案的明确回复依据');
    const description = requiredText(input.description,'双方确认的具体结果');
    const previous = (incident.detail.snapshot as {operation:{previousStatus:Status}}).operation.previousStatus;
    return { action, outcome: input.outcome, incidentId: incident.id, previousStatus: previous,
      supplierReference, customerReference, description,
      revisedTerms: input.outcome === 'revised_terms' ? checkedEdits(po,input) : undefined };
  }
  throw new PurchaseError('无法识别的采购操作',400);
}

export async function previewPurchaseAction(tx: Db, input: PurchaseActionInput, actor: Actor) {
  const view = await purchaseWorkspace(tx,input.orderId);
  const po = view.orders.find(o => o.id === input.purchaseOrderId);
  if (!po) conflict();
  requiredText(input.requestId,'操作编号');
  const operation = actionDetails(view,po,input);
  if (operation.action === 'approve' || operation.action === 'register_order' || (operation.action === 'record_payment' && !po.orderedBefore)) {
    const original = await loadPurchaseOrderSource(tx,input.orderId);
    const current = await loadPurchaseLines(tx,original);
    for (const line of po.lines) {
      const fresh = current.find(row => row.orderItemId === line.orderItemId);
      const { written: previousReply, ...savedGoods } = line.source;
      if (!fresh) conflict();
      const { written: currentReply, ...currentGoods } = fresh;
      if (pricingContentHash(currentGoods) !== pricingContentHash(savedGoods)) conflict();
      if (previousReply && previousReply.reference === line.terms.sourceReference && currentReply?.replyHash !== previousReply.replyHash) conflict();
      if (!po.orderedBefore && original.orderItems.find(row => row.id === line.orderItemId)?.shippedQty) {
        throw new PurchaseError('原商品行已有发货记录，请先核实是否仍需采购');
      }
    }
  }
  const snapshot = { actorId: actor.id, requestId: input.requestId, orderId: view.orderId, purchaseOrderId: po.id,
    version: po.version, totalCents: po.totalCents, paidCents: po.paidCents, lines: po.lines.map(l => ({
      orderItemId: l.orderItemId, source: l.source, terms: l.terms, revision: l.revision })), eligibility: view.eligibility, operation };
  return { snapshot, actionHash: pricingContentHash(snapshot) };
}

export async function applyPurchaseAction(tx: Db, input: PurchaseActionInput, actor: Actor) {
  const requestKey = pricingContentHash({ orderId: input.orderId, purchaseOrderId: input.purchaseOrderId, requestId: requiredText(input.requestId,'操作编号') });
  const submitted = { ...input, actionHash: undefined };
  const intent = pricingContentHash({ actorId: actor.id, input: submitted });
  const [prior] = await tx.$queryRaw<{detail:string}[]>`SELECT detail FROM PurchaseActivity WHERE requestKey=${requestKey}`;
  if (prior) {
    const stored = parseRecord(prior.detail);
    if (stored.intent !== intent || stored.actionHash !== input.actionHash || !input.actionHash) conflict();
    return purchaseWorkspace(tx,input.orderId);
  }
  const { snapshot, actionHash } = await previewPurchaseAction(tx,input,actor);
  if (input.actionHash !== actionHash) conflict();
  const view = await purchaseWorkspace(tx,input.orderId);
  const po = view.orders.find(o => o.id === input.purchaseOrderId)!;
  const op = snapshot.operation;
  let status = po.status;
  let approvedHash = po.approvedHash;
  let groupKey: string | null = null;
  if (op.action === 'approve') { status = po.orderedBefore ? 'ordered' : 'approved'; approvedHash = po.contentHash; }
  if (op.action === 'register_order') status = 'ordered';
  if (op.action === 'report_change') status = 'on_hold';
  if (op.action === 'resolve_change' && op.outcome === 'original_terms') status = op.previousStatus!;
  if (op.action === 'resolve_change' && op.outcome === 'revised_terms') {
    const edits = op.revisedTerms!;
    groupKey = group(edits[0].terms);
    for (const edit of edits) {
      const updated = await tx.$executeRaw`UPDATE PurchaseRequirement SET terms=${JSON.stringify(edit.terms)},ownerId=${actor.id},
        revision=revision+1,updatedAt=${now()} WHERE orderItemId=${edit.orderItemId} AND purchaseOrderId=${po.id}`;
      if (updated !== 1) conflict();
    }
    status = 'draft'; approvedHash = null;
  }
  const referenceKey = op.action === 'record_payment' || op.action === 'register_order'
    ? pricingContentHash({ action: op.action, party: op.action === 'record_payment' ? po.lines[0].terms.payee : po.lines[0].terms.supplier, reference: op.reference }) : undefined;
  if (referenceKey) {
    const priorRef = await tx.$queryRaw<{id:string}[]>`SELECT id FROM PurchaseActivity WHERE referenceKey=${referenceKey}`;
    if (priorRef.length) throw new PurchaseError('同一笔实际业务凭证已登记，请核对原记录');
  }
  const count = await tx.$executeRaw`UPDATE PurchaseOrder SET status=${status},approvedHash=${approvedHash},
    groupKey=COALESCE(${groupKey},groupKey),revision=revision+1,updatedAt=${now()} WHERE id=${po.id} AND orderId=${input.orderId} AND revision=${po.revision}`;
  if (count !== 1) conflict();
  await activity(tx,{ orderId: input.orderId, purchaseOrderId: po.id, action: op.action, actor, requestKey, referenceKey,
    amountCents: op.action === 'record_payment' ? op.amountCents : undefined, detail: { intent, actionHash, snapshot } });
  return purchaseWorkspace(tx,input.orderId);
}
