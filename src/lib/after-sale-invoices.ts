import { jsonObject } from '@/lib/order-catalog-repricing';
import { purchaseObject } from '@/lib/purchase-activity';
import type { FulfillmentDb as Db } from '@/lib/fulfillment-records';
import { requiredText } from '@/lib/purchase-terms';
import { cents, choice, condition, type SaleEvidence } from '@/lib/after-sale-records';
import { currentSaleAgreement, saleOperation, type SaleCase } from '@/lib/after-sale-workspace';

export async function afterSaleInvoiceChoices(tx: Db, orderId: string) {
  return tx.financeInvoiceAllocation.findMany({ where: { plan: { orderId }, invoice: { side: 'customer' } },
    select: { id: true, planId: true, amountCents: true, invoiceId: true, invoice: { select: { number: true, issuer: true, issuedAt: true } } },
    orderBy: { id: 'asc' } });
}

export async function invoiceAgreement(tx: Db, row: SaleCase, data: Record<string, unknown>) {
  const id = requiredText(data.invoiceAllocationId, '实际受影响的原票分摊');
  const allocated = (await afterSaleInvoiceChoices(tx, row.orderId)).find(item => item.id === id);
  condition(allocated, '请选择本单实际受影响的客户原票及分摊');
  const entries = await tx.financeEvent.findMany({ where: { orderId: row.orderId, invoiceId: allocated.invoiceId, planId: allocated.planId,
    action: { in: ['record_invoice','verify_invoice_coverage'] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  const quantities = entries.flatMap(event => {
    const operation = purchaseObject(jsonObject(event.detail).operation);
    return Array.isArray(operation.portions) ? [operation.portions] : [];
  }).at(-1);
  if (quantities) condition(quantities.some(part => Array.isArray(part.lines) && part.lines.some((line: { orderItemId?: string }) => line.orderItemId === row.orderItemId)),
    '原票已核对的商品范围不包括本售后行');
  const amountCents = cents(data.amountCents);
  condition(amountCents <= Number(allocated.amountCents), '本次书面决定超出原票分摊金额');
  return { invoiceId: allocated.invoiceId, allocationId: allocated.id, planId: allocated.planId, originalNumber: allocated.invoice.number,
    issuer: allocated.invoice.issuer, issuedAt: allocated.invoice.issuedAt.toISOString(), allocationCents: Number(allocated.amountCents),
    amountCents, expectedOutcome: choice(data.invoiceOutcome, ['retained','voided'] as const, '客户书面确认的更正结果') };
}

export async function invoiceOutcome(tx: Db, row: SaleCase, data: Record<string, unknown>, proof: SaleEvidence) {
  const agreement = currentSaleAgreement(row);
  const terms = purchaseObject(agreement && saleOperation(agreement).invoice);
  const financeEventId = requiredText(data.financeEventId, '已办完的票据更正记录');
  const result = await tx.financeEvent.findFirst({ where: { id: financeEventId, action: 'resolve_correction', orderId: row.orderId },
    include: { invoice: { include: { allocations: true } } } });
  const detail = result && jsonObject(result.detail);
  const operation = purchaseObject(detail && detail.operation);
  const affected = Array.isArray(operation.affected) ? operation.affected : [];
  const authorization = purchaseObject(detail && detail.authorization);
  condition(row.customerState === 'awaiting_invoice' && typeof terms.invoiceId === 'string'
    && result?.invoice?.side === 'customer' && result.invoiceId === terms.invoiceId && result.approvedHash
    && authorization.permission === 'finance.write' && authorization.action==='admin_sensitive' && operation.outcome === terms.expectedOutcome
    && result.invoice.allocations.some(line => line.id === terms.allocationId && line.planId === terms.planId)
    && affected.some(line => line.orderId === row.orderId && line.planId === terms.planId && line.amountCents === terms.allocationCents)
    && operation.occurredAt === proof.occurredAt && operation.sha256 === proof.sha256 && operation.reference === proof.reference
    && agreement && Date.parse(proof.occurredAt) >= agreement.occurredAt.getTime(),
    '请关联客户书面决定指定的原票分摊及实际一致的更正回执');
  const already = await tx.afterSaleEvent.findMany({ where: { action: 'invoice_outcome', case: { orderId: row.orderId } }, select: { detail: true, caseId: true } });
  const used = already.reduce((sum, event) => {
    const op = purchaseObject(jsonObject(event.detail).operation);
    return op.allocationId === terms.allocationId && typeof op.amountCents === 'number' ? sum + op.amountCents : sum;
  }, 0);
  const amountCents = cents(terms.amountCents);
  condition(used + amountCents <= cents(terms.allocationCents), '发票更正已被其他售后分摊，原金额不足');
  return { operation: { financeEventId, agreementId: agreement.id, invoiceId: terms.invoiceId, allocationId: terms.allocationId,
    originalNumber: result.invoice.number, issuer: result.invoice.issuer, amountCents, result: operation.outcome,
    note: requiredText(data.note, '本行与实际票面处理的核对') }, customerState: 'awaiting_close' };
}
