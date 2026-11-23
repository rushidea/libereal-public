import { invoicePortionsFit, readInvoicePortions } from '@/lib/finance-invoice-coverage';
import { addInvoiceCharge } from '@/lib/finance-invoice-authority';
import { financeIdentity, invoiceStatus } from '@/lib/finance-workspace';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { purchaseObject } from '@/lib/purchase-activity';
import { positiveCents, requiredText } from '@/lib/purchase-terms';
import { cents, choice, condition, type SaleEvidence } from '@/lib/after-sale-records';
import { caseEvents, currentSaleAgreement, saleOperation, type SaleCase } from '@/lib/after-sale-workspace';

const invoicePart = { include: { invoice: true, plan: { select: { orderId: true } } } } as const;
const ordered = [{ createdAt: 'asc' as const }, { id: 'asc' as const }];

export async function afterSaleInvoiceChoices(tx: Db, orderId: string, finance = true) {
  const rows = await tx.financeInvoiceAllocation.findMany({ where: { plan: { orderId }, invoice: { side: 'customer' } },
    select: { id: true, planId: true, amountCents: true, invoiceId: true, invoice: { select: {
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
      correction: finance ? correction : null, linePortions: basis?.portions ?? [] };
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

export async function verifyInvoiceLine(tx: Db, row: SaleCase, data: Record<string, unknown>, proof: SaleEvidence) {
  const part = await allocation(tx, row.orderId, requiredText(data.invoiceAllocationId, '实际受影响的发票分摊'));
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

type AfterSaleInvoiceUse = { caseId: string; orderItemId: string; allocationId: string; amountCents: number; financeEventId: unknown };

async function afterSaleInvoiceUses(tx: Db, orderId: string, action: 'invoice_outcome' | 'invoice_reissue') {
  const events = await tx.afterSaleEvent.findMany({ where: { action, case: { orderId } },
    select: { detail: true, caseId: true, case: { select: { orderItemId: true } } } });
  return events.flatMap(event => {
    const op = purchaseObject(jsonObject(event.detail).operation);
    return typeof op.allocationId === 'string' && positiveCents(op.amountCents)
      ? [{ caseId:event.caseId, orderItemId:event.case.orderItemId, allocationId:op.allocationId,
        amountCents:op.amountCents, financeEventId:op.financeEventId }] : [];
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
const sumParts = (parts: IssuedPart[]) => parts.reduce((sum,part)=>sum+part.amountCents,0);

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
    return amountCents>0 ? [{ caseId:row.id, orderItemId:row.orderItemId, allocationId:part.allocationId,amountCents,financeEventId:null }] : [];
  });
}

export async function reviseInvoiceReissue(tx: Db, row: SaleCase, cases: SaleCase[], data: Record<string, unknown>, proof: SaleEvidence) {
  const earlier = currentSaleAgreement(row);
  const prior = purchaseObject(earlier && saleOperation(earlier).invoice);
  const correction = savedCorrection(row,earlier);
  const outcome = choice(data.invoiceOutcome, ['voided','reissue'] as const, '尚未重开的客户书面决定');
  condition(earlier && correction && data.invoiceAllocationId === prior.allocationId
    && (data.amountCents === undefined || data.amountCents === prior.amountCents)
    && Date.parse(proof.occurredAt) >= correction.occurredAt.getTime(),
    '只能修订本案已红冲和尚未重开的原分摊');
  const financeEventId = saleOperation(correction).financeEventId;
  const uses = await afterSaleInvoiceUses(tx,row.orderId,'invoice_reissue');
  const recorded = recordedReissue(uses,row,financeEventId);
  const reservations = cases.flatMap(item=>issuedReservation(item,uses));
  const competing = cases.some(other => {
    if (other.id===row.id || other.orderItemId!==row.orderItemId || !['awaiting_invoice','awaiting_invoice_reissue'].includes(other.customerState)) return false;
    const agreement = currentSaleAgreement(other);
    const terms = purchaseObject(agreement && saleOperation(agreement).invoice);
    return terms.invoiceId===prior.invoiceId && terms.expectedOutcome==='reissue'
      && Number(terms.replacementAmountCents) > sumParts(recordedReissue(uses,other,financeEventId)) + sumParts(reservations.filter(part=>part.caseId===other.id));
  });
  const issued = new Map<string,number>();
  for (const use of [...recorded,...reservations.filter(part=>part.caseId===row.id)]) {
    addInvoiceCharge(issued,use.allocationId,use.amountCents);
  }
  const bookings = await tx.financeEvent.findMany({ where: { action: 'record_invoice', orderId: row.orderId },
    include: { invoice: { include: { allocations: { where: { plan: { orderId: row.orderId } }, ...invoicePart } } } } });
  for (const event of bookings) {
    const link = purchaseObject(financeProof(event)?.replaces);
    if (link.correctionEventId !== financeEventId || link.invoiceId !== prior.invoiceId) continue;
    const part = event.invoice?.allocations.find(item=>item.planId===event.planId);
    if (!part) continue;
    const coverage = await invoiceCoverage(tx,part,row.orderItemId);
    const used = amountsAllocated([...uses,...reservations],part.id,row.orderItemId);
    const left = Math.min(coverage.total - used.totalUsed,(coverage.limit ?? coverage.max) - used.lineUsed);
    if (left <= 0) continue;
    condition(coverage.limit !== null && !competing,
      '已有涉及本商品的实际重开票，请先凭原件逐案核对票面和金额');
    addInvoiceCharge(issued,part.id,left);
  }
  const replacementIssuedParts = [...issued].map(([allocationId,amountCents])=>({ allocationId,amountCents }));
  const issuedCents = sumParts(replacementIssuedParts);
  const recordedCents = sumParts(recorded);
  const beforeCents = cents(prior.replacementAmountCents);
  condition(issuedCents < beforeCents,'已有实际重开票占满本版金额，请保留原票面和回填结果');
  const pendingCents = outcome === 'reissue' ? cents(data.replacementAmountCents) : 0;
  const totalCents = issuedCents + pendingCents;
  return { invoice: { ...prior, expectedOutcome:totalCents?'reissue':'voided', correctionId:correction.id,
    replacementAmountCents:totalCents||null, replacementIssuedParts, replacementIssuedCents:issuedCents,
    replacementRemainingCents:pendingCents, replacementRecordedCents:recordedCents },
    customerState: totalCents>recordedCents ? 'awaiting_invoice_reissue' : 'awaiting_close' };
}

export async function invoiceReissue(tx: Db, row: SaleCase, cases: SaleCase[], data: Record<string, unknown>, proof: SaleEvidence) {
  const agreement = currentSaleAgreement(row);
  const terms = purchaseObject(agreement && saleOperation(agreement).invoice);
  const correction = savedCorrection(row,agreement);
  condition(row.customerState === 'awaiting_invoice_reissue' && terms.expectedOutcome === 'reissue' && correction,
    '请先核对本案的原票红冲回执及客户的重开决定');
  const original = await allocation(tx, row.orderId, requiredText(terms.allocationId, '原票分摊'));
  const part = await allocation(tx, row.orderId, requiredText(data.invoiceAllocationId, '已实际重开的替代发票分摊'));
  const coverage = await invoiceCoverage(tx, part, row.orderItemId);
  const recorded = coverage.recorded?.op;
  const doc = part.invoice;
  const status = invoiceStatus(await tx.financeEvent.findMany({ where: { invoiceId: doc.id }, orderBy: ordered }));
  condition(original.invoiceId !== doc.id && status === 'recorded' && recorded && recorded.sha256 === doc.sha256
    && recorded.issuedAt === doc.issuedAt.toISOString() && recorded.number === doc.number && recorded.amountCents === coverage.total
    && financeIdentity(doc.issuer) === financeIdentity(original.invoice.issuer)
    && financeIdentity(doc.recipient) === financeIdentity(original.invoice.recipient)
    && doc.issuedAt >= correction.occurredAt && proof.occurredAt >= doc.issuedAt.toISOString(),
    '须关联同一交易方实际出具且晚于原票处理的有效替代票');
  const correctionOperation = saleOperation(correction);
  const linked = purchaseObject(recorded.replaces);
  const correctionId = correctionOperation.financeEventId;
  condition(linked.correctionEventId === correctionId && linked.invoiceId === original.invoiceId
    || !recorded.replaces && data.confirmReplacementEvidence === true && data.financeEventId === correctionId
      && proof.sha256 !== doc.sha256 && proof.sha256 !== correction.sha256 && proof.sha256 !== original.invoice.sha256,
    '请关联开票时已核对的原红冲记录，或凭另份明确列出两张票和原更正的书证具名补核');
  const uses = await afterSaleInvoiceUses(tx,row.orderId,'invoice_reissue');
  const alreadyRecordedCents = sumParts(recordedReissue(uses,row,correctionId));
  const totalCents = cents(terms.replacementAmountCents);
  const remaining = totalCents - alreadyRecordedCents;
  const reservedElsewhereInCase = sumParts(issuedReservation(row,uses).filter(use=>use.allocationId!==part.id));
  const amountCents = data.amountCents === undefined ? cents(remaining) : cents(data.amountCents);
  condition(amountCents <= remaining - reservedElsewhereInCase, '本票金额超出本案剩余重开份额，或占用了已签发的另一票');
  const otherReservations = cases.filter(item=>item.id!==row.id).flatMap(item=>issuedReservation(item,uses));
  const scope = availableAfterSaleAmount(coverage,amountsAllocated([...uses,...otherReservations],part.id,row.orderItemId),amountCents);
  const remainingCents = remaining - amountCents;
  return { operation: { correctionId: correction.id, financeEventId: correctionId, agreementId:agreement?.id,
    replacementEventId: coverage.recorded?.id, linkedAtIssuance: Boolean(recorded.replaces), originalInvoiceId: original.invoiceId, invoiceId: doc.id,
    allocationId: part.id, number: doc.number, issuedAt: doc.issuedAt.toISOString(), amountCents, alreadyRecordedCents, remainingCents, scope,
    note: requiredText(data.note, '替代票与原红冲回执的一致性及本商品实际金额') },
    customerState:remainingCents?'awaiting_invoice_reissue':'awaiting_close' };
}
