import { invoicePortionsFit, readInvoicePortions } from '@/lib/finance-invoice-coverage';
import { addInvoiceCharge } from '@/lib/finance-invoice-authority';
import { financeIdentity, invoiceStatus } from '@/lib/finance-workspace';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { purchaseObject } from '@/lib/purchase-activity';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { positiveCents, requiredText } from '@/lib/purchase-terms';
import { cents, choice, condition, type SaleEvidence } from '@/lib/after-sale-records';
import { caseEvents, currentSaleAgreement, saleOperation, type SaleCase } from '@/lib/after-sale-workspace';

const invoicePart = { include: { invoice: true, plan: { select: { orderId: true } } } } as const;
const ordered = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

export async function afterSaleInvoiceChoices(tx: Db, orderId: string, finance = true) {
  const rows = await tx.financeInvoiceAllocation.findMany({ where: { plan: { orderId }, invoice: { side: 'customer' } },
    select: { id: true, planId: true, plan:{select:{reference:true}}, amountCents: true, invoiceId: true, invoice: { select: {
      number: true, issuer: true, issuedAt: true, events: { where: { action: { in: ['open_correction','resolve_correction'] } }, orderBy: ordered },
    } } }, orderBy: { id: 'asc' } });
  return Promise.all(rows.map(async row => {
    const last = row.invoice.events.at(-1);
    const op = last?.action === 'resolve_correction' ? financeProof(last) : null;
    const correction = last && op && Array.isArray(op.affected)
      && op.affected.some(part => part.orderId === orderId && part.planId === row.planId && part.amountCents === Number(row.amountCents))
      && typeof op.reference === 'string' && typeof op.sha256 === 'string' && typeof op.occurredAt === 'string'
      ? { id: last.id, orderId: last.orderId, outcome: op.outcome, reference: op.reference, sha256: op.sha256, occurredAt: op.occurredAt } : null;
    const basis = finance ? await allocationBasis(tx, orderId, row) : null;
    return { id: row.id, invoiceId: row.invoiceId, number: row.invoice.number, issuer: row.invoice.issuer,
      issuedAt: row.invoice.issuedAt.toISOString(), amountCents: finance ? Number(row.amountCents) : null,
      planReference:finance?row.plan.reference:null,correction: finance ? correction : null, linePortions: basis?.portions ?? [] };
  }));
}

async function allocation(tx: Db, orderId: string, id: string) {
  const selected = await tx.financeInvoiceAllocation.findUnique({ where: { id }, ...invoicePart });
  condition(selected?.plan.orderId === orderId && selected.invoice.side === 'customer', '请选择本单实际受影响的客户原票及分摊');
  return selected;
}

function financeProof(event: { detail: string; approvedHash: string }) {
  const detail = jsonObject(event.detail);
  const authorization = purchaseObject(detail.authorization);
  return event.approvedHash && authorization.permission === 'finance.write' && authorization.action === 'admin_sensitive'
    ? purchaseObject(detail.operation) : null;
}

async function allocationBasis(tx: Db, orderId: string, part: { id: string; invoiceId: string; planId: string; amountCents: bigint }) {
  const total = Number(part.amountCents);
  const events = await tx.financeEvent.findMany({ where: { orderId, invoiceId: part.invoiceId, planId: part.planId,
    action: { in: ['record_invoice', 'verify_invoice_coverage'] } }, orderBy: ordered });
  const authorized = events.flatMap(event => {
    const op = financeProof(event);
    return op && (event.action === 'record_invoice' || op.allocationId === part.id) ? [{ id: event.id, op, action: event.action }] : [];
  });
  const recorded = authorized.find(event => event.action === 'record_invoice');
  const scope = authorized.findLast(event => Array.isArray(event.op.portions));
  const goods = await tx.orderItem.findMany({ where: { orderId }, select: { id: true, quantity: true } });
  const known = readInvoicePortions(scope?.op.portions, total);
  const raw = !scope ? [{ invoiceScopeId: part.id, amountCents: total,
    lines: goods.map(item => ({ orderItemId: item.id, quantity: item.quantity })) }] : known ?? [];
  const evidenceIds = (known ?? []).map(part=>part.invoiceScopeId);
  const evidence = evidenceIds.length ? await tx.financeEvent.findMany({ where: { orderId, id:{in:evidenceIds},
    action:'verify_customer_invoice_scope' } }) : [];
  const originalProofs = new Map(evidence.map(event=>[event.id,financeProof(event)]));
  const amounts = Array.isArray(scope?.op.portions) ? scope.op.portions.map(purchaseObject) : [];
  const portions = raw.filter(part => part.lines.every(line => goods.some(item => item.id === line.orderItemId && item.quantity >= line.quantity)))
    .map(portion => {
      const recordedProof = purchaseObject(amounts.find(raw=>raw.invoiceScopeId===portion.invoiceScopeId)?.proof);
      const actual = originalProofs.get(portion.invoiceScopeId) ?? recordedProof;
      return { ...portion, reference:typeof actual.reference==='string'?actual.reference:null,
        documentRow:positiveCents(actual.documentRow)?actual.documentRow:null };
    });
  return { total, goods, portions, coverageId: scope?.id ?? null, recorded };
}

type Basis = Awaited<ReturnType<typeof allocationBasis>>;
type PortionAmount = { scopeId: string; amountCents: number };
const includesItem = (part: Basis['portions'][number], id: string) => part.lines.some(line => line.orderItemId === id);
const sharedPortions = (basis: Basis, id: string) => basis.portions.filter(part => part.lines.length > 1 && includesItem(part, id));
const fixedAmount = (basis: Basis, id: string) =>
  basis.portions.filter(part => part.lines.length === 1 && includesItem(part, id)).reduce((sum, part) => sum + part.amountCents, 0);

function readPortionAmounts(raw: unknown, eligible: Basis['portions'], amountCents: number) {
  if (raw === undefined) {
    if (amountCents === 0) return [];
    return eligible.length === 1 ? [{ scopeId: eligible[0].invoiceScopeId, amountCents }] : null;
  }
  if (!Array.isArray(raw)) return null;
  const parts: PortionAmount[] = [];
  for (const entry of raw) {
    const { scopeId, amountCents } = purchaseObject(entry);
    if (typeof scopeId !== 'string' || !positiveCents(amountCents) || parts.some(part => part.scopeId === scopeId)
      || !eligible.some(part => part.invoiceScopeId === scopeId)) return null;
    parts.push({ scopeId, amountCents });
  }
  return parts.reduce((sum, part) => sum + part.amountCents,0) === amountCents ? parts.sort((a,b) => a.scopeId.localeCompare(b.scopeId)) : null;
}

async function invoiceCoverage(tx: Db, part: Awaited<ReturnType<typeof allocation>>, itemId: string) {
  const basis = await allocationBasis(tx, part.plan.orderId, part);
  const confirmed = await tx.afterSaleEvent.findMany({ where: { action: 'verify_invoice_line', case: { orderId: part.plan.orderId } },
    select: { id: true, detail: true, case: { select: { orderItemId: true } } }, orderBy: ordered });
  const reviews = new Map(confirmed.flatMap(event => {
    const op = purchaseObject(jsonObject(event.detail).operation);
    if (op.allocationId !== part.id || op.coverageId !== basis.coverageId || !positiveCents(op.lineLimitCents)) return [];
    const id = event.case.orderItemId;
    const portions = readPortionAmounts(op.portionAmounts, sharedPortions(basis,id), op.lineLimitCents - fixedAmount(basis,id));
    return [[id, { id: event.id, amount: op.lineLimitCents, portions }] as const];
  }));
  const used = new Map<string,number>();
  const unresolved = new Set<string>();
  for (const [lineId, review] of reviews) {
    if (lineId === itemId) continue;
    if (review.portions) for (const portion of review.portions) addInvoiceCharge(used, portion.scopeId, portion.amountCents);
    else for (const portion of sharedPortions(basis,lineId)) unresolved.add(portion.invoiceScopeId);
  }
  const eligible = sharedPortions(basis,itemId);
  const min = fixedAmount(basis,itemId);
  const remaining = new Map(eligible.map(portion => [portion.invoiceScopeId,
    unresolved.has(portion.invoiceScopeId) ? 0 : portion.amountCents - (used.get(portion.invoiceScopeId) ?? 0)]));
  const otherFixed = basis.portions.filter(portion => portion.lines.length === 1 && !includesItem(portion,itemId)).reduce((sum,row)=>sum+row.amountCents,0);
  const totalRoom = basis.total - min - otherFixed - [...used.values()].reduce((sum,value)=>sum+value,0);
  const constraints = new Map([['total', totalRoom], ...[...remaining].map(([id, amount]) => ['portion:' + id, amount] as const)]);
  const rooms = new Map(eligible.map(portion => [portion.invoiceScopeId, { constraintKeys: ['total', 'portion:' + portion.invoiceScopeId] }]));
  const balances = { constraints, rooms };
  const max = min + Math.max(0, Math.min(totalRoom, [...remaining.values()].reduce((sum,amount)=>sum+Math.max(0,amount),0)));
  const manual = reviews.get(itemId);
  const recognized = manual?.portions !== null && manual && invoicePortionsFit(balances,manual.portions);
  // A zero shared balance excludes further use, but does not prove a disputed historical line split.
  const limit = recognized ? manual.amount : !manual && !eligible.length ? min : null;
  return { ...basis, min, max, limit, reviewId: manual?.id ?? null, eligible, balances,
    itemQuantity: basis.goods.find(row => row.id === itemId)?.quantity ?? 0 };
}

export async function verifyInvoiceLine(tx: Db, row: SaleCase, cases: SaleCase[], data: Record<string, unknown>, proof: SaleEvidence) {
  const part = await allocation(tx, row.orderId, requiredText(data.invoiceAllocationId, '实际受影响的发票分摊'));
  if (data.reissueParentAllocationId !== undefined) return verifyReissueLink(tx,row,cases,part,data,proof);
  const coverage = await invoiceCoverage(tx, part, row.orderItemId);
  const lineLimitCents = cents(data.amountCents);
  const portions = readPortionAmounts(data.portionAmounts, coverage.eligible, lineLimitCents - coverage.min);
  condition(coverage.limit === null && portions && lineLimitCents >= coverage.min && lineLimitCents <= coverage.max
    && invoicePortionsFit(coverage.balances,portions) && proof.occurredAt >= part.invoice.issuedAt.toISOString(),
    '原票已经核清本商品金额，或须按本商品原件选择尚有余额的具体分摊');
  return { operation: { invoiceId: part.invoiceId, allocationId: part.id, originalNumber: part.invoice.number, coverageId: coverage.coverageId,
    lineLimitCents, orderItemId: row.orderItemId, orderItemQuantity: coverage.itemQuantity, allocationCents: coverage.total,
    portionAmounts: portions, supersedesReviewId: coverage.reviewId, note: requiredText(data.note, '原发票分项及该商品金额的核对依据') } };
}

export async function invoiceAgreement(tx: Db, row: SaleCase, data: Record<string, unknown>) {
  const part = await allocation(tx, row.orderId, requiredText(data.invoiceAllocationId, '实际受影响的原票分摊'));
  const coverage = await invoiceCoverage(tx, part, row.orderItemId);
  const amountCents = cents(data.amountCents);
  condition(amountCents <= (coverage.limit ?? coverage.max), '本次书面决定超出原票该商品分摊范围');
  const expectedOutcome = choice(data.invoiceOutcome, ['retained', 'voided', 'reissue'] as const, '客户书面确认的更正结果');
  return { invoiceId: part.invoiceId, allocationId: part.id, planId: part.planId, originalNumber: part.invoice.number,
    issuer: part.invoice.issuer, issuedAt: part.invoice.issuedAt.toISOString(), allocationCents: coverage.total,
    amountCents, expectedOutcome, coverageId: coverage.coverageId, reviewId: coverage.reviewId,
    replacementAmountCents: expectedOutcome === 'reissue' ? cents(data.replacementAmountCents) : null };
}

type AfterSaleInvoiceUse = { eventId:string; caseId: string; orderItemId: string; allocationId: string; amountCents: number;
  financeEventId: unknown; sourceCorrectionEventId?: unknown; originalOutcomeId?: unknown; rootAllocationId?: unknown;
  parentAllocationId?: unknown };

async function afterSaleInvoiceUses(tx: Db, orderId: string, action: 'invoice_outcome' | 'invoice_reissue') {
  const events = await tx.afterSaleEvent.findMany({ where: { action, case: { orderId } },
    select: { id:true, detail: true, caseId: true, case: { select: { orderItemId: true } } } });
  return events.flatMap(event => {
    const op = purchaseObject(jsonObject(event.detail).operation);
    return typeof op.allocationId === 'string' && positiveCents(op.amountCents)
      ? [{ eventId:event.id, caseId:event.caseId, orderItemId:event.case.orderItemId, allocationId:op.allocationId,
        amountCents:op.amountCents, financeEventId:op.financeEventId, sourceCorrectionEventId:op.sourceCorrectionEventId,
        originalOutcomeId:op.correctionId,rootAllocationId:op.rootAllocationId,parentAllocationId:op.parentAllocationId }] : [];
  });
}

function amountsAllocated(uses: AfterSaleInvoiceUse[], allocationId: string, orderItemId: string, financeEventId?: string) {
  const selected = uses.filter(use => use.allocationId === allocationId && (!financeEventId || use.financeEventId === financeEventId));
  return { totalUsed:selected.reduce((sum,use)=>sum+use.amountCents,0),
    lineUsed:selected.filter(use=>use.orderItemId===orderItemId).reduce((sum,use)=>sum+use.amountCents,0) };
}

function availableAfterSaleAmount(coverage: Awaited<ReturnType<typeof invoiceCoverage>>, use: ReturnType<typeof amountsAllocated>, amountCents: number) {
  condition(coverage.limit !== null, '请先凭原件核对该商品行的票面分摊金额');
  condition(use.totalUsed + amountCents <= coverage.total && use.lineUsed + amountCents <= coverage.limit,
    '该发票或商品行已被其他售后分摊，原金额不足');
  return { lineLimitCents:coverage.limit, ...use, coverageId:coverage.coverageId, reviewId:coverage.reviewId };
}

export async function invoiceOutcome(tx: Db, row: SaleCase, data: Record<string, unknown>, proof: SaleEvidence) {
  const agreement = currentSaleAgreement(row);
  const terms = purchaseObject(agreement && saleOperation(agreement).invoice);
  condition(row.customerState === 'awaiting_invoice' && agreement && typeof terms.invoiceId === 'string', '请核对客户的实际票据决定');
  const part = await allocation(tx, row.orderId, requiredText(terms.allocationId, '原票分摊'));
  const financeEventId = requiredText(data.financeEventId, '已办完的票据更正记录');
  const result = await tx.financeEvent.findFirst({ where: { id: financeEventId, action: 'resolve_correction', invoiceId: part.invoiceId } });
  const operation = result && financeProof(result);
  const affected = Array.isArray(operation?.affected) ? operation.affected : [];
  const expected = terms.expectedOutcome === 'reissue' ? 'voided' : terms.expectedOutcome;
  const corrections = await tx.financeEvent.findMany({ where: { invoiceId: part.invoiceId,
    action: { in: ['open_correction','resolve_correction'] } }, orderBy: ordered });
  condition(corrections.at(-1)?.id === result?.id && operation && result && part.invoiceId === terms.invoiceId && part.planId === terms.planId
    && operation.outcome === expected && operation.originalSha256 === part.invoice.sha256
    && affected.some(line => line.orderId === row.orderId && line.planId === part.planId && line.amountCents === Number(part.amountCents))
    && operation.occurredAt === proof.occurredAt && operation.sha256 === proof.sha256 && operation.reference === proof.reference
    && Date.parse(proof.occurredAt) >= agreement.occurredAt.getTime(),
    '请关联客户书面决定指定的原票分摊及实际一致的更正回执');
  const amountCents = cents(terms.amountCents);
  const uses = await afterSaleInvoiceUses(tx,row.orderId,'invoice_outcome');
  const scope = availableAfterSaleAmount(await invoiceCoverage(tx,part,row.orderItemId),
    amountsAllocated(uses,part.id,row.orderItemId,financeEventId),amountCents);
  return { operation: { financeEventId, financeOrderId: result.orderId, agreementId: agreement.id, invoiceId: part.invoiceId, allocationId: part.id,
    originalNumber: part.invoice.number, issuer: part.invoice.issuer, amountCents, result: operation.outcome, scope,
    note: requiredText(data.note, '本行与实际票面处理的核对') },
    customerState: terms.expectedOutcome === 'reissue' ? 'awaiting_invoice_reissue' : 'awaiting_close' };
}

function savedCorrection(row: SaleCase, agreement = currentSaleAgreement(row)) {
  const invoice = purchaseObject(agreement && saleOperation(agreement).invoice);
  return caseEvents(row, 'invoice_outcome').findLast(event => {
    const op = saleOperation(event);
    return op.result === 'voided' && op.allocationId === invoice.allocationId
      && (op.agreementId === agreement?.id || event.id === invoice.correctionId);
  });
}

type IssuedPart = { allocationId: string; amountCents: number };
const sumParts = (parts: readonly { amountCents:number }[]) => parts.reduce((sum,part)=>sum+part.amountCents,0);

function recordedReissue(rows: AfterSaleInvoiceUse[], row: SaleCase, financeEventId: unknown) {
  return rows.filter(use=>use.caseId===row.id && use.financeEventId===financeEventId);
}

function issuedReservation(row: SaleCase, uses: AfterSaleInvoiceUse[]) {
  const agreement = currentSaleAgreement(row);
  const invoice = purchaseObject(agreement && saleOperation(agreement).invoice);
  if (!Array.isArray(invoice.replacementIssuedParts)) return [];
  return invoice.replacementIssuedParts.map(purchaseObject).flatMap(part => {
    if (typeof part.allocationId !== 'string' || !positiveCents(part.amountCents)) return [];
    const matched = uses.filter(use=>use.caseId===row.id && use.allocationId===part.allocationId);
    const amountCents = part.amountCents - sumParts(matched);
    return amountCents>0 ? [{ eventId:agreement?.id??row.id,caseId:row.id,orderItemId:row.orderItemId,allocationId:part.allocationId,
      amountCents,financeEventId:null,rootAllocationId:invoice.allocationId }] : [];
  });
}

async function reissueBook(tx: Db, orderId: string) {
  const parts = await tx.financeInvoiceAllocation.findMany({
    where:{plan:{orderId},invoice:{side:'customer'}},
    include:{plan:{select:{orderId:true,reference:true,events:{where:{action:'record_invoice'},orderBy:ordered}}},
      invoice:{include:{events:{where:{action:{in:['open_correction','resolve_correction']}},orderBy:ordered}}}},
  });
  const outcomes=new Map((await afterSaleInvoiceUses(tx,orderId,'invoice_outcome')).map(use=>[use.eventId,use]));
  const uses=(await afterSaleInvoiceUses(tx,orderId,'invoice_reissue')).map(use=>{
    const original=typeof use.originalOutcomeId==='string' ? outcomes.get(use.originalOutcomeId) : undefined;
    return {...use,rootAllocationId:use.rootAllocationId ?? (original?.caseId===use.caseId ? original.allocationId : undefined)};
  });
  const reviewed = await tx.afterSaleEvent.findMany({where:{action:'verify_invoice_line',case:{orderId}},
    select:{id:true,detail:true,approvedHash:true,sha256:true,documentRow:true,case:{select:{orderItemId:true}}}});
  const links = reviewed.flatMap(event=>{
    const detail=jsonObject(event.detail);
    if (!event.approvedHash || purchaseObject(detail.authorization).permission!=='finance.write') return [];
    const operation=purchaseObject(detail.operation);
    const link=purchaseObject(operation.reissueLink);
    return typeof link.allocationId==='string' && typeof link.parentAllocationId==='string'
      && typeof link.receiptId==='string' && typeof link.rootAllocationId==='string'
      && typeof link.bookingId==='string' && positiveCents(link.amountCents)
      ? [{id:event.id,orderItemId:event.case.orderItemId,allocationId:link.allocationId,parentAllocationId:link.parentAllocationId,
        receiptId:link.receiptId,rootAllocationId:link.rootAllocationId,bookingId:link.bookingId,amountCents:link.amountCents,
        sha256:event.sha256,documentRow:event.documentRow,otherPlan:operation.reissueScope==='other_plan'}] : [];
  });
  const entries = parts.map(part=>{
    const doc = part.invoice;
    const booking = part.plan.events.find(event=>event.invoiceId===doc.id && financeProof(event));
    const book = booking && financeProof(booking);
    const signed = book && book.sha256===doc.sha256 && book.issuedAt===doc.issuedAt.toISOString() && book.number===doc.number
      && book.amountCents===Number(part.amountCents);
    const correction = doc.events.at(-1);
    const proof = correction && financeProof(correction);
    const affected = Array.isArray(proof?.affected) ? proof.affected : [];
    const proved = !correction || proof?.originalSha256===doc.sha256 && affected.some(partOfInvoice=>partOfInvoice.orderId===orderId
      && partOfInvoice.planId===part.planId && partOfInvoice.amountCents===Number(part.amountCents));
    const financeStatus = proved ? invoiceStatus(doc.events) : 'correction_pending';
    const status = signed || financeStatus==='voided' ? financeStatus : 'correction_pending';
    const voidReceipt = status==='voided' && correction && typeof proof?.occurredAt==='string'
      ? { id:correction.id, invoiceId:doc.id, occurredAt:proof.occurredAt } : null;
    return { part,status,voidReceipt,bookingId:booking?.id??null,correctionId:correction?.id??null,
      recorded:signed ? book : null, link:purchaseObject(signed && book?.replaces) };
  });
  return {entries,uses,links};
}

type ReissueBook = Awaited<ReturnType<typeof reissueBook>>;
type ReissueEntry = ReissueBook['entries'][number];
type VoidReceipt = NonNullable<ReissueBook['entries'][number]['voidReceipt']>;
type ReissueEdge = { parentAllocationId:string; receiptId:string; amountCents:number; reviewId?:string };
const byReissueSource = (a:ReissueEdge,b:ReissueEdge)=>
  a.parentAllocationId.localeCompare(b.parentAllocationId) || (a.reviewId??'').localeCompare(b.reviewId??'');

function sameInvoiceParties(a: ReissueEntry, b: ReissueEntry) {
  return financeIdentity(a.part.invoice.issuer)===financeIdentity(b.part.invoice.issuer)
    && financeIdentity(a.part.invoice.recipient)===financeIdentity(b.part.invoice.recipient);
}

function validPredecessor(child: ReissueEntry, parent: ReissueEntry, receiptId: unknown) {
  const receipt=parent.voidReceipt;
  if (!receipt || !child.recorded || receipt.id!==receiptId || parent.part.invoiceId===child.part.invoiceId
    || receipt.occurredAt>child.part.invoice.issuedAt.toISOString() || !sameInvoiceParties(child,parent)) return false;
  return !child.recorded.replaces || (child.link.correctionEventId===receipt.id && child.link.invoiceId===receipt.invoiceId);
}

async function reissueChain(tx: Db, book: ReissueBook, row: SaleCase, original: ReissueEntry, root: VoidReceipt) {
  const related = new Map<string,ReissueEdge[]>();
  const unresolved = new Set<string>();
  const entries=new Map(book.entries.map(entry=>[entry.part.id,entry]));
  const reviews = book.links.filter(link=>link.orderItemId===row.orderItemId);
  const historical = book.uses.filter(use=>isReissueLineageUse(use,row.orderItemId,original.part.id) && use.financeEventId===root.id);
  const reviewedParts=new Set([...reviews,...historical].map(part=>part.allocationId));
  const candidates = book.entries.filter(entry=>entry.recorded && entry.part.invoiceId!==root.invoiceId && sameInvoiceParties(entry,original)
    && (entry.recorded.replaces || reviewedParts.has(entry.part.id)));
  const receiptIds=new Set([root.id,...candidates.map(entry=>entry.link.correctionEventId),...reviews.map(review=>review.receiptId),
    ...historical.map(use=>use.sourceCorrectionEventId)]);
  const candidateIds=new Set(candidates.map(entry=>entry.part.id));
  const scoped = await Promise.all(book.entries.filter(entry=>candidateIds.has(entry.part.id)
    || entry.voidReceipt && receiptIds.has(entry.voidReceipt.id)).map(async entry=>[
    entry.part.id,await invoiceCoverage(tx,entry.part,row.orderItemId),
  ] as const));
  const coverage = new Map(scoped);
  const coversLine = (entry: ReissueEntry) => {
    const scope=coverage.get(entry.part.id);
    return (scope?.limit ?? scope?.max ?? 0)>0;
  };
  const parentLimit = (id:string) => id===original.part.id ? Number.MAX_SAFE_INTEGER : sumParts(related.get(id)??[]);
  // Entries can share a printed date. Resolve known sources before propagating each successor.
  const dated = candidates.sort((a,b)=>a.part.invoice.issuedAt.getTime()-b.part.invoice.issuedAt.getTime()
    || a.part.invoice.createdAt.getTime()-b.part.invoice.createdAt.getTime() || a.part.id.localeCompare(b.part.id));
  for (let pass=0;pass<dated.length;pass++) {
    let changed=false;
    for (const entry of dated) {
      const id=entry.part.id;
      if (!coversLine(entry)) continue;
      const named=reviews.filter(review=>{
        const parent=entries.get(review.parentAllocationId);
        return review.allocationId===id && review.bookingId===entry.bookingId && parent && validPredecessor(entry,parent,review.receiptId);
      });
      const here=named.filter(review=>!review.otherPlan && review.rootAllocationId===original.part.id);
      const elsewhere=named.filter(review=>review.otherPlan || review.rootAllocationId!==original.part.id);
      const prior=historical.filter(use=>use.allocationId===id);
      const historicalReceipts=[...new Set(prior.map(use=>use.sourceCorrectionEventId??root.id))];
      const receiptId=entry.link.correctionEventId ?? (historicalReceipts.length===1 ? historicalReceipts[0] : undefined);
      const all=book.entries.filter(parent=>validPredecessor(entry,parent,receiptId));
      const samePlan=all.filter(parent=>parent.part.planId===entry.part.planId);
      const possible=samePlan.length ? samePlan : all.filter(coversLine);
      const edges:ReissueEdge[]=here.flatMap(review=>{
        return parentLimit(review.parentAllocationId)>=review.amountCents
          ? [{parentAllocationId:review.parentAllocationId,receiptId:review.receiptId,amountCents:review.amountCents,reviewId:review.id}] : [];
      }).sort(byReissueSource);
      const potentiallyHere=possible.some(parent=>parentLimit(parent.part.id)>0 || unresolved.has(parent.part.id));
      const parent=possible.length===1 ? possible[0] : null;
      const line=coverage.get(id)!;
      const outside=sumParts(elsewhere);
      const unassigned=(line.limit??line.max)-outside-sumParts(here);
      let pending=edges.length!==here.length || (potentiallyHere && unassigned>0 && (!here.length || possible.length>1));
      if (!here.length && parent && parentLimit(parent.part.id)>0 && line.limit!==null && unassigned>0) {
        const amount=!entry.recorded?.replaces && prior.length ? sumParts(prior) : unassigned;
        if (amount<=unassigned && amount<=parentLimit(parent.part.id)) {
          edges.push({parentAllocationId:parent.part.id,receiptId:parent.voidReceipt!.id,amountCents:amount});
          pending=false;
        }
      }
      if (line.limit===null || unassigned<0) {
        pending=potentiallyHere || here.length>0;
        edges.length=0;
      }
      if (JSON.stringify(edges)!==JSON.stringify(related.get(id)??[]) || pending!==unresolved.has(id)) changed=true;
      if (edges.length) related.set(id,edges); else related.delete(id);
      if (pending) unresolved.add(id); else unresolved.delete(id);
    }
    if (!changed) break;
  }
  return {related,unresolved,coverage,reviewedParts};
}

type ReissueChain = Awaited<ReturnType<typeof reissueChain>>;

function isReissueLineageUse(use: AfterSaleInvoiceUse, orderItemId: string, rootAllocationId: string) {
  return use.orderItemId===orderItemId && use.rootAllocationId===rootAllocationId;
}

function reissueBalances(chain: ReissueChain, uses: IssuedPart[]) {
  const demand=new Map<string,number>();
  for (const use of uses) addInvoiceCharge(demand,use.allocationId,use.amountCents);
  const ordered:string[]=[];
  const seen=new Set<string>();
  function visit(id:string) {
    if (seen.has(id) || !chain.related.has(id)) return;
    seen.add(id);
    for (const source of chain.related.get(id)!) visit(source.parentAllocationId);
    ordered.push(id);
  }
  for (const id of chain.related.keys()) visit(id);
  const balances=new Map<string,number>();
  for (const id of ordered.reverse()) {
    const edges=chain.related.get(id)!;
    const used=demand.get(id)??0;
    balances.set(id,sumParts(edges)-used);
    // A signed split reserves its exact source shares. A single inferred link carries only actual downstream use.
    for (const edge of edges) addInvoiceCharge(demand,edge.parentAllocationId,edge.reviewId?edge.amountCents:used);
  }
  return balances;
}

function reissueRoom(chain: ReissueChain, allocationId: string, balances: ReadonlyMap<string,number>) {
  const seen=new Set<string>();
  const pending=[{id:allocationId,draws:true}];
  let remaining=Number.POSITIVE_INFINITY;
  while (pending.length) {
    const {id,draws}=pending.pop()!;
    const key=JSON.stringify([id,draws]);
    if (seen.has(key)) continue;
    seen.add(key);
    const balance=balances.get(id)??Number.POSITIVE_INFINITY;
    // A verified share already drew from its parent, but a disputed parent cannot back a new attachment.
    if (draws || balance<0) remaining=Math.min(remaining,balance);
    for (const edge of chain.related.get(id)??[]) pending.push({id:edge.parentAllocationId,draws:draws&&!edge.reviewId});
  }
  return remaining;
}

function reissueFootprint(reviewed: ReissueBook['links'], used: AfterSaleInvoiceUse[]) {
  const byBucket=new Map<string,Set<string>>();
  const reviewAmounts=new Map<string,number>();
  const usedAtSource=new Map<string,number>();
  const usedAmounts=new Map<string,number>();
  const key=(item: Pick<AfterSaleInvoiceUse,'allocationId'|'orderItemId'|'rootAllocationId'> & { otherPlan?:boolean }) =>
    JSON.stringify([item.allocationId,item.orderItemId,item.rootAllocationId,item.otherPlan===true]);
  function sourceKey(bucket:string,parentId:string) {
    const source=JSON.stringify([bucket,parentId]);
    const sources=byBucket.get(bucket)??new Set<string>();
    sources.add(source);
    byBucket.set(bucket,sources);
    return source;
  }
  for (const review of reviewed) addInvoiceCharge(reviewAmounts,sourceKey(key(review),review.parentAllocationId),review.amountCents);
  for (const use of used) {
    const bucket=key(use);
    addInvoiceCharge(usedAmounts,bucket,use.amountCents);
    if (typeof use.parentAllocationId==='string') addInvoiceCharge(usedAtSource,sourceKey(bucket,use.parentAllocationId),use.amountCents);
  }
  const buckets=new Set([...byBucket.keys(),...usedAmounts.keys()]);
  return [...buckets].reduce((sum,id)=>{
    const sources=[...(byBucket.get(id)??[])];
    const confirmed=sources.reduce((total,source)=>total+Math.max(reviewAmounts.get(source)??0,usedAtSource.get(source)??0),0);
    return sum+Math.max(confirmed,usedAmounts.get(id)??0);
  },0);
}

function reissueReaches(sourceId:string, targetId:string, predecessors: ReadonlyMap<string,ReissueEdge[]>, links: ReissueBook['links']) {
  const pending=[sourceId];
  const seen=new Set<string>();
  while (pending.length) {
    const id=pending.pop()!;
    if (id===targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(predecessors.get(id)??[]).map(edge=>edge.parentAllocationId),
      ...links.filter(link=>link.allocationId===id).map(link=>link.parentAllocationId));
  }
  return false;
}

async function predecessorSaleShares(tx: Db, book: ReissueBook, parent: ReissueEntry, row: SaleCase, cases: SaleCase[],
  existing: AfterSaleInvoiceUse[], current: { original: ReissueEntry; chain: ReissueChain }) {
  const parentId=parent.part.id;
  const links=book.links.filter(link=>link.orderItemId===row.orderItemId && link.allocationId===parentId && !link.otherPlan
    && link.bookingId===parent.bookingId && book.entries.some(source=>source.part.id===link.parentAllocationId
      && validPredecessor(parent,source,link.receiptId)));
  const uses=existing.filter(use=>use.orderItemId===row.orderItemId && use.allocationId===parentId);
  const origins=new Map<unknown,number>();
  for (const id of new Set([...links,...uses].map(record=>record.rootAllocationId))) {
    origins.set(id,reissueFootprint(links.filter(link=>link.rootAllocationId===id),uses.filter(use=>use.rootAllocationId===id)));
  }
  if (parent.recorded?.replaces) {
    const checked=new Set([parentId]);
    for (const sale of cases.filter(sale=>sale.orderItemId===row.orderItemId)) {
      const decision=currentSaleAgreement(sale);
      const terms=purchaseObject(decision && saleOperation(decision).invoice);
      const earlier=book.entries.find(entry=>entry.part.id===terms.allocationId);
      const receipt=earlier?.voidReceipt;
      const outcome=savedCorrection(sale,decision);
      if (!earlier || !receipt || !outcome || receipt.id!==saleOperation(outcome).financeEventId || checked.has(earlier.part.id)) continue;
      checked.add(earlier.part.id);
      const lineage=earlier.part.id===current.original.part.id?current.chain:await reissueChain(tx,book,sale,earlier,receipt);
      condition(!lineage.unresolved.has(parentId),'请先核清前序分摊待确认的售后来源');
      origins.set(earlier.part.id,Math.max(origins.get(earlier.part.id)??0,sumParts(lineage.related.get(parentId)??[])));
    }
  }
  // A genuine later red receipt can start a fresh case on a share actually fulfilled and closed while this invoice was valid.
  const completed=new Map<unknown,number>();
  const evidence=[...links.map(link=>link.id),...uses.map(use=>use.eventId)];
  const red=parent.part.invoice.events.find(event=>event.id===parent.voidReceipt?.id);
  if (red) for (const use of uses) {
    const sale=cases.find(sale=>sale.id===use.caseId && sale.customerState==='closed');
    if (!sale) continue;
    const closing=caseEvents(sale,'close').at(-1);
    const attached=caseEvents(sale,'invoice_reissue').find(event=>event.id===use.eventId);
    if (!attached || !closing || attached.createdAt>closing.createdAt || closing.createdAt>red.createdAt
      || closing.occurredAt.toISOString()>parent.voidReceipt!.occurredAt) continue;
    completed.set(use.rootAllocationId,(completed.get(use.rootAllocationId)??0)+use.amountCents);
    evidence.push(closing.id);
  }
  return {origins,completed,evidence};
}

function directReissueSourceLimit(total: number, rootId: string, shares: Awaited<ReturnType<typeof predecessorSaleShares>>,
  links: ReissueBook['links'], uses: AfterSaleInvoiceUse[]) {
  const caseLinks=links.filter(link=>!link.otherPlan);
  const otherOrigins=new Set([...shares.origins.keys(),...caseLinks.map(link=>link.rootAllocationId),...uses.map(use=>use.rootAllocationId)]);
  otherOrigins.delete(rootId);
  const reserved=[...otherOrigins].reduce<number>((sum,id)=>sum+Math.max(
    (shares.origins.get(id)??0)-(shares.completed.get(id)??0),
    reissueFootprint(caseLinks.filter(link=>link.rootAllocationId===id),uses.filter(use=>use.rootAllocationId===id)),
  ),0);
  return total-sumParts(links.filter(link=>link.otherPlan))-reserved;
}

function usesFromPredecessor(uses: AfterSaleInvoiceUse[], chain: ReissueChain, parentId: string, row: SaleCase, originalId: string) {
  return uses.filter(use=>{
    if (use.parentAllocationId===parentId) return true;
    const edges=chain.related.get(use.allocationId);
    return edges?.length===1 && edges[0].parentAllocationId===parentId && isReissueLineageUse(use,row.orderItemId,originalId);
  }).map(use=>({...use,parentAllocationId:parentId}));
}

async function verifyReissueLink(tx: Db, row: SaleCase, cases: SaleCase[], part: Awaited<ReturnType<typeof allocation>>,
  data: Record<string,unknown>, proof: SaleEvidence) {
  const agreement=currentSaleAgreement(row);
  const terms=purchaseObject(agreement && saleOperation(agreement).invoice);
  const correction=savedCorrection(row,agreement);
  const book=await reissueBook(tx,row.orderId);
  const original=book.entries.find(entry=>entry.part.id===terms.allocationId);
  const root=original?.voidReceipt;
  condition(terms.expectedOutcome==='reissue' && correction && original && root && root.id===saleOperation(correction).financeEventId,
    '请先核对本案原票分摊、红冲回执及客户的重开决定');
  const parent=book.entries.find(entry=>entry.part.id===data.reissueParentAllocationId);
  const child=book.entries.find(entry=>entry.part.id===part.id);
  const receipt=parent?.voidReceipt;
  condition(parent && receipt && child && child.bookingId && child.part.invoiceId!==original.part.invoiceId
    && sameInvoiceParties(child,original) && validPredecessor(child,parent,data.sourceCorrectionEventId)
    && child.part.invoice.issuedAt.toISOString()<=proof.occurredAt
    && ![child.part.invoice.sha256,parent.part.invoice.sha256,correction.sha256].includes(proof.sha256),
    '请凭补充原件核对实际签发的票、前一张票的分摊及正式红冲回执');
  const chain=await reissueChain(tx,book,row,original,root);
  const childScope=chain.coverage.get(part.id) ?? await invoiceCoverage(tx,part,row.orderItemId);
  const parentScope=chain.coverage.get(parent.part.id) ?? await invoiceCoverage(tx,parent.part,row.orderItemId);
  const scope=choice(data.reissueScope??'this_case',['this_case','other_plan'] as const,'这份金额实际所属的开票安排');
  const parentId=parent.part.id;
  const fromCase=scope==='this_case';
  const rootAllocationId=fromCase ? original.part.id : parentId;
  const parentInCase=parentId===original.part.id ? parentScope.limit : sumParts(chain.related.get(parentId)??[]);
  const amountCents=cents(data.amountCents);
  condition(parentScope.limit!==null && childScope.limit!==null && parentInCase!==null
    && (fromCase ? amountCents<=parentInCase : parentId!==original.part.id)
    && !reissueReaches(parentId,part.id,chain.related,book.links),
    '请先核实本商品的原分摊，所核金额须在有效前序份额和替代票的商品金额内');
  const reviewed=book.links.filter(link=>link.allocationId===part.id || link.parentAllocationId===parentId);
  condition(!reviewed.some(link=>link.allocationId===part.id && link.parentAllocationId===parentId && link.orderItemId===row.orderItemId
    && link.sha256===proof.sha256 && link.documentRow===proof.documentRow),
    '这份原件行已核对过这对实际分摊，请查看原核对记录');
  const newLink={allocationId:part.id,parentAllocationId:parentId,receiptId:receipt.id,rootAllocationId,
    bookingId:child.bookingId,amountCents};
  const candidate={...newLink,id:'current-preview',orderItemId:row.orderItemId,sha256:proof.sha256,
    documentRow:proof.documentRow,otherPlan:!fromCase};
  const liveIds=new Set(book.entries.filter(entry=>entry.status!=='voided').map(entry=>entry.part.id));
  const existing:AfterSaleInvoiceUse[]=[...book.uses,...cases.flatMap(item=>issuedReservation(item,book.uses))];
  const active=existing.filter(use=>liveIds.has(use.allocationId));
  const fromSource=usesFromPredecessor(active,chain,parentId,row,original.part.id);
  const inAllocation=existing.filter(use=>use.allocationId===part.id);
  const childLinks=reviewed.filter(link=>link.allocationId===part.id);
  const parentLinks=reviewed.filter(link=>link.parentAllocationId===parentId);
  const lineOnly=(item:{orderItemId:string})=>item.orderItemId===row.orderItemId;
  condition(reissueFootprint([...childLinks,candidate],inAllocation)<=childScope.total
    && reissueFootprint([...childLinks,candidate].filter(lineOnly),inAllocation.filter(lineOnly))<=childScope.limit
    && reissueFootprint([...parentLinks,candidate],fromSource)<=parentScope.total
    && reissueFootprint([...parentLinks,candidate].filter(lineOnly),fromSource.filter(lineOnly))<=parentScope.limit,
    '所核份额超出前序分摊或后继票原已核对的商品金额');
  let ordinarySourceLimitCents: number | undefined;
  let directSourceLimitCents: number | undefined;
  const directFromOriginal=fromCase && parentId===original.part.id;
  const earlierShares=!fromCase || directFromOriginal
    ? await predecessorSaleShares(tx,book,parent,row,cases,existing,{original,chain}) : undefined;
  const lineReviews=parentLinks.filter(lineOnly);
  if (earlierShares) {
    if (!fromCase) {
      ordinarySourceLimitCents=parentScope.limit-[...earlierShares.origins.values()].reduce((sum,amount)=>sum+amount,0);
      condition(sumParts([...lineReviews.filter(link=>link.otherPlan),candidate])<=ordinarySourceLimitCents,
        '前序分摊中本商品的普通份额已不足，已核定的售后金额保留给原来源');
    } else {
      const lineUses=fromSource.filter(lineOnly);
      directSourceLimitCents=directReissueSourceLimit(parentScope.limit,parentId,earlierShares,lineReviews,lineUses);
      const ownReviews=lineReviews.filter(link=>!link.otherPlan && link.rootAllocationId===parentId);
      const ownUses=lineUses.filter(use=>use.rootAllocationId===parentId);
      condition(reissueFootprint([...ownReviews,candidate],ownUses)<=directSourceLimitCents,
        '前序发票仍有另一售后待办理的实际份额，本案可重开的金额不足');
    }
  }
  if (fromCase) {
    const next=await reissueChain(tx,{...book,links:[...book.links,candidate]},row,original,root);
    const applied=active.filter(use=>isReissueLineageUse(use,row.orderItemId,original.part.id));
    const before=reissueBalances(chain,applied);
    const after=reissueBalances(next,applied);
    condition(next.related.get(part.id)?.some(edge=>edge.reviewId===candidate.id) && [...after].every(([id,amount])=>
      id===part.id || amount>=Math.min(0,before.get(id)??0)), '该红冲来源剩余的实际可承接金额不足');
  }
  return {operation:{invoiceId:part.invoiceId,allocationId:part.id,originalNumber:part.invoice.number,orderItemId:row.orderItemId,
    predecessorNumber:parent.part.invoice.number,sourceCorrectionEventId:receipt.id,attributedCents:amountCents,
    reissueScope:scope,coverageId:childScope.coverageId,reviewId:childScope.reviewId,previousSources:chain.related.get(parentId),
    parentCoverageId:parentScope.coverageId,parentReviewId:parentScope.reviewId,parentSha256:parent.part.invoice.sha256,
    ordinarySourceLimitCents,directSourceLimitCents,
    priorReissueRecords:[...new Set([...reviewed.map(event=>event.id),...fromSource.map(event=>event.eventId),
      ...inAllocation.map(event=>event.eventId),...(earlierShares?.evidence??[])])].sort(),
    currentCorrectionEventId:child.correctionId,currentStatus:child.status,invoiceSha256:child.part.invoice.sha256,
    reissueLink:newLink,note:requiredText(data.note,'两张票的原件、红冲回执及本商品实际承接金额')}};
}

async function reissuePosition(tx: Db, row: SaleCase, cases: SaleCase[], book: ReissueBook) {
  const agreement = currentSaleAgreement(row);
  const terms = purchaseObject(agreement && saleOperation(agreement).invoice);
  const correction = savedCorrection(row,agreement);
  if (!agreement || !correction || row.customerState==='closed' || terms.expectedOutcome!=='reissue') return null;
  const financeEventId = saleOperation(correction).financeEventId;
  const original = book.entries.find(entry=>entry.part.id===terms.allocationId);
  const root = original?.voidReceipt;
  condition(original && root && root.id===financeEventId, '原票红冲回执待财务核对');
  const chain = await reissueChain(tx,book,row,original,root);
  const status = new Map(book.entries.map(entry=>[entry.part.id,entry.status]));
  const effective = book.uses.filter(use=>status.get(use.allocationId)!=='voided');
  const own = recordedReissue(book.uses,row,root.id);
  const allReservations = cases.flatMap(item=>issuedReservation(item,book.uses));
  const reservations = allReservations.filter(use=>status.get(use.allocationId)!=='voided');
  const recordedCents = sumParts(own.filter(use=>status.get(use.allocationId)==='recorded'));
  const recordedPendingCents = sumParts(own.filter(use=>status.get(use.allocationId)!=='recorded' && status.get(use.allocationId)!=='voided'));
  const competing = cases.some(other => {
    if (other.id===row.id || other.orderItemId!==row.orderItemId || other.customerState==='closed') return false;
    const otherAgreement = currentSaleAgreement(other);
    const otherTerms = purchaseObject(otherAgreement && saleOperation(otherAgreement).invoice);
    return otherTerms.invoiceId===terms.invoiceId && otherTerms.expectedOutcome==='reissue'
      && Number(otherTerms.replacementAmountCents) > sumParts(recordedReissue(effective,other,root.id))
        + sumParts(reservations.filter(part=>part.caseId===other.id));
  });
  const claimed = new Map<string,number>();
  for (const use of [...own,...allReservations.filter(use=>use.caseId===row.id)]) addInvoiceCharge(claimed,use.allocationId,use.amountCents);
  let needsAttribution = false;
  const unmatchedPending = new Set<string>();
  const decisive = new Set([...claimed.keys(),original.part.id,...chain.related.keys(),...chain.unresolved,...chain.reviewedParts]);
  const scopeProofs: { allocationId:string; coverageId:string|null; reviewId:string|null }[]=[];
  const candidates: IssuedPart[]=[];
  const sameLineage=(use:AfterSaleInvoiceUse)=>isReissueLineageUse(use,row.orderItemId,original.part.id);
  const liveUses = [...effective,...reservations].filter(sameLineage);
  for (const entry of book.entries) {
    const id=entry.part.id;
    const coverage=chain.coverage.get(id);
    if (coverage && decisive.has(id)) scopeProofs.push({allocationId:id,coverageId:coverage.coverageId,reviewId:coverage.reviewId});
    if (chain.unresolved.has(id)) {
      if (entry.status!=='voided') needsAttribution=true;
      if (entry.status==='correction_pending') unmatchedPending.add(id);
    }
    const sources=chain.related.get(id);
    if (!coverage || !sources) continue;
    const account = entry.status==='voided' ? [...book.uses,...allReservations] : [...effective,...reservations];
    const used = amountsAllocated(account,id,row.orderItemId);
    const usedByLineage=sumParts(account.filter(use=>use.allocationId===id && sameLineage(use)));
    const left = Math.min(coverage.total-used.totalUsed,(coverage.limit??0)-used.lineUsed,sumParts(sources)-usedByLineage);
    if (left<=0) continue;
    if (competing) {
      if (entry.status!=='voided') needsAttribution=true;
      if (entry.status==='correction_pending') unmatchedPending.add(id);
      continue;
    }
    candidates.push({allocationId:id,amountCents:left});
  }
  const liveCandidates=candidates.filter(part=>status.get(part.allocationId)!=='voided');
  const balances=reissueBalances(chain,[...liveUses,...liveCandidates]);
  for (const part of liveUses) if (reissueRoom(chain,part.allocationId,balances)<0) needsAttribution=true;
  for (const part of candidates) {
    const state=status.get(part.allocationId);
    if (state!=='voided' && reissueRoom(chain,part.allocationId,balances)<0) {
      needsAttribution=true;
      if (state==='correction_pending') unmatchedPending.add(part.allocationId);
      continue;
    }
    addInvoiceCharge(claimed,part.allocationId,part.amountCents);
  }
  const parts = [...claimed].map(([allocationId,amountCents])=>({allocationId,amountCents,status:status.get(allocationId)??'correction_pending'}))
    .sort((a,b)=>a.allocationId.localeCompare(b.allocationId));
  const issuedCents = sumParts(parts.filter(part=>part.status==='recorded'));
  const pendingCents = sumParts(parts.filter(part=>part.status==='correction_pending'));
  const voidedCents = sumParts(parts.filter(part=>part.status==='voided'));
  const remainingCents=Math.max(0,cents(terms.replacementAmountCents)-recordedCents);
  const pendingIds = new Set([...unmatchedPending,...parts.filter(part=>part.status==='correction_pending').map(part=>part.allocationId)]);
  const pendingReceipts = book.entries.filter(entry=>pendingIds.has(entry.part.id)).map(entry=>({
    allocationId:entry.part.id, number:entry.part.invoice.number, correctionId:entry.correctionId,
    ownerId:entry.part.invoice.events.at(-1)?.actorId??null,
  }));
  const version=pricingContentHash({root,parts,scopeProofs:scopeProofs.sort((a,b)=>a.allocationId.localeCompare(b.allocationId)),
    sourceReviews:book.links.filter(link=>link.orderItemId===row.orderItemId && decisive.has(link.allocationId)).sort((a,b)=>a.id.localeCompare(b.id)),
    uses:[...book.uses,...allReservations].filter(use=>decisive.has(use.allocationId)).sort((a,b)=>a.eventId.localeCompare(b.eventId)),book:book.entries.filter(entry=>decisive.has(entry.part.id)).map(entry=>({
    id:entry.part.id,bookingId:entry.bookingId,correctionId:entry.correctionId,status:entry.status,
    sha256:entry.part.invoice.sha256, predecessor:chain.related.get(entry.part.id)??null,
  })).sort((a,b)=>a.id.localeCompare(b.id)),needsAttribution, unmatchedPending:[...unmatchedPending].sort()});
  return {agreement,correction,terms,root,chain,effective,reservations,parts,issuedCents,pendingCents,voidedCents,recordedCents,recordedPendingCents,
    remainingCents,needsAttribution,pendingReceipts,version,
    ready:remainingCents===0 && pendingCents===0 && unmatchedPending.size===0 && !needsAttribution};
}

export async function afterSaleReissueViews(tx: Db, orderId: string, cases: SaleCase[]) {
  const relevant=cases.filter(row=>row.customerState==='awaiting_invoice_reissue'||row.customerState==='awaiting_close');
  if (!relevant.some(row=>savedCorrection(row) && purchaseObject(saleOperation(currentSaleAgreement(row)!).invoice).expectedOutcome==='reissue')) return [];
  const book=await reissueBook(tx,orderId);
  const views=await Promise.all(relevant.map(async row=>{
    const position=await reissuePosition(tx,row,cases,book);
    if (!position) return [];
    const {issuedCents,pendingCents,voidedCents,recordedCents,remainingCents,ready,pendingReceipts,needsAttribution}=position;
    return [{caseId:row.id,customerState:ready?'awaiting_close':'awaiting_invoice_reissue',
      invoiceReissue:{issuedCents,pendingCents,voidedCents,recordedCents,remainingCents,pendingReceipts,needsAttribution}}];
  }));
  return views.flat();
}

export async function invoiceReissueBeforeClose(tx: Db, row: SaleCase, cases: SaleCase[]) {
  const decision=currentSaleAgreement(row);
  if (!savedCorrection(row) || purchaseObject(decision && saleOperation(decision).invoice).expectedOutcome!=='reissue') return null;
  return reissuePosition(tx,row,cases,await reissueBook(tx,row.orderId));
}

export async function reviseInvoiceReissue(tx: Db, row: SaleCase, cases: SaleCase[], data: Record<string, unknown>, proof: SaleEvidence) {
  const book=await reissueBook(tx,row.orderId);
  const position=await reissuePosition(tx,row,cases,book);
  const outcome=choice(data.invoiceOutcome,['voided','reissue'] as const,'尚未重开的客户书面决定');
  condition(position && data.invoiceAllocationId===position.terms.allocationId
    && (data.amountCents===undefined || data.amountCents===position.terms.amountCents)
    && Date.parse(proof.occurredAt)>=position.correction.occurredAt.getTime(),'只能修订本案已红冲和尚未重开的原分摊');
  const {terms, correction, issuedCents, pendingCents, voidedCents, recordedCents, needsAttribution}=position;
  condition(!needsAttribution,'已有涉及本商品的实际重开票，请先凭原件逐案核对票面和金额');
  const reservedCents=issuedCents+pendingCents;
  condition(reservedCents<cents(terms.replacementAmountCents),'已有实际重开票占满本版金额，请保留原票面和回填结果');
  const pendingCustomerCents=outcome==='reissue'?cents(data.replacementAmountCents):0;
  const totalCents=reservedCents+pendingCustomerCents;
  return { invoice:{...terms,expectedOutcome:totalCents?'reissue':'voided',correctionId:correction.id,
    replacementAmountCents:totalCents||null,replacementIssuedParts:position.parts.filter(part=>part.status!=='voided')
      .map(({allocationId,amountCents})=>({allocationId,amountCents})),
    replacementIssuedCents:issuedCents,replacementPendingCents:pendingCents,replacementVoidedCents:voidedCents,
    replacementRemainingCents:pendingCustomerCents,replacementRecordedCents:recordedCents,reissueVersion:position.version},
    customerState:totalCents>recordedCents||pendingCents>0?'awaiting_invoice_reissue':'awaiting_close' };
}

export async function invoiceReissue(tx: Db, row: SaleCase, cases: SaleCase[], data: Record<string, unknown>, proof: SaleEvidence) {
  const book=await reissueBook(tx,row.orderId);
  const position=await reissuePosition(tx,row,cases,book);
  condition(position && !position.ready && ['awaiting_close','awaiting_invoice_reissue'].includes(row.customerState),
    '请先核对本案的原票红冲回执及客户的重开决定');
  const {agreement,terms,correction,root,chain,effective,reservations}=position;
  const original=await allocation(tx,row.orderId,requiredText(terms.allocationId,'原票分摊'));
  const part=await allocation(tx,row.orderId,requiredText(data.invoiceAllocationId,'已实际重开的替代发票分摊'));
  const entry=book.entries.find(item=>item.part.id===part.id);
  const doc=part.invoice;
  condition(original.invoiceId!==doc.id && entry?.status==='recorded' && entry.recorded
    && financeIdentity(doc.issuer)===financeIdentity(original.invoice.issuer)
    && financeIdentity(doc.recipient)===financeIdentity(original.invoice.recipient)
    && doc.issuedAt>=correction.occurredAt && proof.occurredAt>=doc.issuedAt.toISOString(),
    '须关联同一交易方实际出具且晚于原票处理的有效替代票');
  const amountCents=data.amountCents===undefined?cents(position.remainingCents):cents(data.amountCents);
  const sources=chain.related.get(part.id);
  const parents=book.entries.filter(parent=>validPredecessor(entry,parent,data.financeEventId));
  const samePlan=parents.filter(parent=>parent.part.planId===part.planId);
  const named=samePlan.length?samePlan:(await Promise.all(parents.map(async parent=>{
    const coverage=chain.coverage.get(parent.part.id) ?? await invoiceCoverage(tx,parent.part,row.orderItemId);
    return (coverage.limit??coverage.max)>0 ? [parent] : [];
  }))).flat();
  const parent=named.length===1?named[0]:null;
  const legacyParent=parent && (parent.part.id===original.id || chain.related.has(parent.part.id)) ? parent : null;
  condition(sources || !entry.recorded.replaces && data.confirmReplacementEvidence===true && legacyParent
    && !book.links.some(link=>link.allocationId===part.id && link.orderItemId===row.orderItemId)
    && ![doc.sha256,correction.sha256,original.invoice.sha256,legacyParent.part.invoice.sha256].includes(proof.sha256),
    '请关联开票时已核对的原红冲记录，或凭原件在发票核对中确认实际前序分摊和本商品金额');
  const predecessors=sources??[{parentAllocationId:legacyParent!.part.id,receiptId:legacyParent!.voidReceipt!.id,amountCents}];
  const confirmedElsewhere=sumParts(reservations.filter(use=>use.caseId===row.id && use.allocationId!==part.id));
  condition(amountCents<=position.remainingCents-position.recordedPendingCents-confirmedElsewhere,
    '本票金额超出本案剩余重开份额，或占用了已签发的另一票');
  const coverage=await invoiceCoverage(tx,part,row.orderItemId);
  const others=reservations.filter(use=>use.caseId!==row.id);
  const scope=availableAfterSaleAmount(coverage,amountsAllocated([...effective,...others],part.id,row.orderItemId),amountCents);
  const limits=sources ? chain : {...chain,related:new Map(chain.related).set(part.id,predecessors)};
  const active=[...effective,...reservations.filter(use=>use.caseId!==row.id || use.allocationId!==part.id)];
  const applied=active.filter(use=>isReissueLineageUse(use,row.orderItemId,original.id));
  condition(amountCents<=reissueRoom(limits,part.id,reissueBalances(limits,applied)),'本次金额超过原票更正链中实际承接的分摊余额');
  let directSource: {limitCents:number; evidence:string[]} | undefined;
  const sourceEntry=book.entries.find(entry=>entry.part.id===original.id);
  const inferredOriginal=predecessors.length===1 && !predecessors[0].reviewId && predecessors[0].parentAllocationId===original.id;
  const sourceLinks=book.links.filter(link=>link.orderItemId===row.orderItemId && link.parentAllocationId===original.id);
  if (inferredOriginal && sourceEntry && (sourceEntry.recorded?.replaces || sourceLinks.some(link=>link.otherPlan)
    || book.links.some(link=>link.allocationId===original.id && link.orderItemId===row.orderItemId && !link.otherPlan)
    || book.uses.some(use=>use.allocationId===original.id && use.orderItemId===row.orderItemId))) {
    const sourceCoverage=chain.coverage.get(original.id) ?? await invoiceCoverage(tx,original,row.orderItemId);
    condition(sourceCoverage.limit!==null,'请先凭原件核对该商品行的票面分摊金额');
    const existing=[...book.uses,...cases.flatMap(item=>issuedReservation(item,book.uses))];
    const shares=await predecessorSaleShares(tx,book,sourceEntry,row,cases,existing,{original:sourceEntry,chain});
    const lineUses=usesFromPredecessor(active,limits,original.id,row,original.id).filter(use=>use.orderItemId===row.orderItemId);
    const limitCents=directReissueSourceLimit(sourceCoverage.limit,original.id,shares,sourceLinks,lineUses);
    const draw={eventId:'current-preview',caseId:row.id,orderItemId:row.orderItemId,allocationId:part.id,
      amountCents,financeEventId:root.id,rootAllocationId:original.id,parentAllocationId:original.id};
    condition(reissueFootprint(sourceLinks.filter(link=>!link.otherPlan && link.rootAllocationId===original.id),
      [...lineUses.filter(use=>use.rootAllocationId===original.id),draw])<=limitCents,
    '前序发票仍有另一售后待办理的实际份额，本案可重开的金额不足');
    directSource={limitCents,evidence:[...new Set([...shares.evidence,...sourceLinks.map(link=>link.id),...lineUses.map(use=>use.eventId)])].sort()};
  }
  const remainingCents=position.remainingCents-amountCents;
  const receiptId=predecessors.every(source=>source.receiptId===predecessors[0].receiptId)?predecessors[0].receiptId:undefined;
  return {operation:{correctionId:correction.id,financeEventId:root.id,sourceCorrectionEventId:receiptId,
    parentAllocationId:predecessors.length===1?predecessors[0].parentAllocationId:undefined,
    reissueSources:predecessors.map(source=>{
      const parent=book.entries.find(entry=>entry.part.id===source.parentAllocationId);
      return {...source,number:parent?.part.invoice.number,planReference:parent?.part.plan.reference};
    }),
    rootAllocationId:original.id,agreementId:agreement.id,
    replacementEventId:entry.bookingId,linkedAtIssuance:Boolean(entry.recorded.replaces),originalInvoiceId:original.invoiceId,invoiceId:doc.id,
    allocationId:part.id,number:doc.number,issuedAt:doc.issuedAt.toISOString(),amountCents,alreadyRecordedCents:position.recordedCents,
    remainingCents,scope,directSource,reissueVersion:position.version,currentCorrectionEventId:entry.correctionId,
    note:requiredText(data.note,'替代票与原红冲回执的一致性及本商品实际金额') },
    customerState:remainingCents||position.pendingReceipts.length?'awaiting_invoice_reissue':'awaiting_close' };
}
