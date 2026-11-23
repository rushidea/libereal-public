import type { Prisma } from '@prisma/client';
import { bankDocumentScope, bankTraceKey, sameBankDocumentRow } from '@/lib/bank-document';
import { jsonObject } from '@/lib/order-catalog-repricing';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { purchaseOperation, type PurchaseActivity } from '@/lib/purchase-activity';
import type { SourceOrder } from '@/lib/purchase-source';
import { positiveCents, PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';

type Db = Prisma.TransactionClient;
type Debtor = Pick<SourceOrder, 'id' | 'ownerScope' | 'customerId' | 'organizationId'>;
type Evidence = { reference: string; sha256: string; description: string };
type BankInput = { bankTrace?: unknown; receivingAccount?: unknown; payer?: unknown; documentKind?: unknown;
  statementRow?: unknown; occurredAt?: unknown; receiptTotalCents?: unknown };
type BankReceipt = Evidence & { owner: string; bankTrace: string; receivingAccount: string; payer: string;
  documentKind: 'single_receipt' | 'statement'; statementRow: number; occurredAt: string; receiptTotalCents: number };
type AllocationInput = { bankReceiptId?: unknown; legacyAllocationId?: unknown; allocationReference?: unknown; amountCents?: unknown; receiptKind?: unknown };

function ownerKey(order: Debtor) {
  const group = order.ownerScope === 'organization' && order.organizationId;
  const buyer = order.ownerScope === 'personal' && order.customerId;
  return group ? `organization:${group}` : buyer ? `customer:${buyer}` : `order:${order.id}`;
}

async function nativePaymentReferences(tx: Db, references: string[]) {
  if (!references.length) return new Set<string>();
  const attempts = await tx.paymentAttempt.findMany({ where: { provider: 'alipay', OR: [
    { outTradeNo: { in: references } }, { tradeNo: { in: references } },
  ] }, select: { outTradeNo: true, tradeNo: true } });
  return new Set(attempts.flatMap(row => row.tradeNo ? [row.outTradeNo, row.tradeNo] : [row.outTradeNo]).map(bankTraceKey));
}

async function verifiedReceipts(tx: Db, owner: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; actorId: string; detail: string; createdAt: string }>>`
    SELECT id, actorId, detail, createdAt FROM PurchaseActivity WHERE action='verify_bank_receipt'
      AND json_extract(detail,'$.snapshot.operation.bank.owner')=${owner} ORDER BY rowid`;
  return rows.map(row => ({ id: row.id, actorId: row.actorId, recordedAt: row.createdAt,
    bank: purchaseOperation(jsonObject(row.detail)).bank as BankReceipt }));
}

export async function purchaseReceiptAllocations(tx: Db, order: Debtor, activities: PurchaseActivity[]) {
  const banks = await verifiedReceipts(tx, ownerKey(order));
  const allocations = activities.filter(row => row.action === 'record_customer_receipt' && row.purchaseOrderId === null).map(row => {
    const operation = purchaseOperation(row.detail);
    const bank = banks.find(entry => entry.id === operation.bankReceiptId);
    return { id: row.id, actorId: row.actorId, amountCents: row.amountCents ?? 0, operation, bank };
  });
  const aliases = [...banks.map(row => row.bank.bankTrace), ...allocations.flatMap(row =>
    typeof row.operation.transactionReference === 'string' ? [row.operation.transactionReference] : [])];
  const knownNative = await nativePaymentReferences(tx, [...new Set(aliases.flatMap(alias => [alias, bankTraceKey(alias)]))]);
  const bankReceipts = banks.filter(row => !knownNative.has(bankTraceKey(row.bank.bankTrace)));
  const countedAllocations = allocations.filter(row => {
    if (!row.bank || !bankReceipts.includes(row.bank) || !positiveCents(row.amountCents)) return false;
    const old = allocations.find(other => other.id === row.operation.legacyAllocationId);
    if (!old) return !row.operation.legacyAllocationId;
    const alias = old.operation.transactionReference;
    return typeof alias === 'string' && !knownNative.has(bankTraceKey(alias));
  });
  const matchedLegacy = new Set(countedAllocations.map(row => row.operation.legacyAllocationId));
  const receipts = allocations.map(row => ({ id: row.id, ...row.operation, transactionReference: row.operation.transactionReference,
    receiptKind: row.operation.receiptKind, bankReceiptId: row.operation.bankReceiptId, occurredAt: row.bank?.bank.occurredAt ?? row.operation.occurredAt,
    amountCents: row.amountCents, counted: countedAllocations.includes(row),
    reconciled: matchedLegacy.has(row.id) }));
  return { receipts, bankReceipts, allocatedCents: receipts.reduce((total, row) => total + (row.counted ? row.amountCents : 0), 0),
    excludedReceiptIds: receipts.filter(row => !row.counted && !row.reconciled).map(row => row.id) };
}

export async function previewBankReceipt(tx: Db, order: Debtor, input: BankInput, evidence: Evidence) {
  const originalTrace = requiredText(input.bankTrace, '银行原件所列的交易流水号');
  const bankTrace = bankTraceKey(originalTrace);
  const receivingAccount = requiredText(input.receivingAccount, '实际收款账户的档案标识');
  const payer = requiredText(input.payer, '银行原件所列的付款人');
  const { receiptTotalCents } = input;
  if (!positiveCents(receiptTotalCents)) {
    throw new PurchaseError('请核对银行回单或对账单及实际到账原额', 400);
  }
  const { documentKind, statementRow } = bankDocumentScope(input.documentKind, input.statementRow);
  const occurredAt = purchaseTimestamp(input.occurredAt, '实际到账时间');
  if (Date.parse(occurredAt) > Date.now()) throw new PurchaseError('实际到账时间不能晚于核验时间');
  if ((await nativePaymentReferences(tx, [originalTrace, bankTrace])).has(bankTrace)) {
    throw new PurchaseError('该笔支付宝原生流水已归属原订单，由平台到账记录核对');
  }
  const existing = await tx.$queryRaw<{ id: string; detail: string }[]>`
    SELECT id,detail FROM PurchaseActivity WHERE action='verify_bank_receipt'
      AND (json_extract(detail,'$.snapshot.operation.bank.sha256')=${evidence.sha256}
        OR json_extract(detail,'$.snapshot.operation.bank.bankTrace')=${bankTrace})`;
  for (const row of existing) {
    const bank = purchaseOperation(jsonObject(row.detail)).bank as BankReceipt;
    if (bank.bankTrace === bankTrace || sameBankDocumentRow(bank, { sha256: evidence.sha256, documentKind, statementRow })) {
      throw new PurchaseError('原件中这笔银行到账已经核验，请使用既有到账记录分摊');
    }
  }
  const bank: BankReceipt = { ...evidence, owner: ownerKey(order), bankTrace, receivingAccount, payer,
    documentKind, statementRow, occurredAt, receiptTotalCents };
  return { ...evidence, action: 'verify_bank_receipt' as const, bank,
    receiptReferenceKey: pricingContentHash({ purpose: 'verified_bank_receipt', sha256: bank.sha256, statementRow }) };
}

export async function previewBankAllocation(tx: Db, order: Debtor, activities: PurchaseActivity[], input: AllocationInput,
  evidence: Evidence, outstandingCents: number) {
  if (input.receiptKind === 'platform_receipt') throw new PurchaseError('平台交易须由服务端匹配所属订单，人工录入保持待核对');
  if (input.receiptKind !== undefined && input.receiptKind !== 'bank_receipt') throw new PurchaseError('须提供已经核验的银行实际到账凭证', 400);
  const bankReceiptId = requiredText(input.bankReceiptId, '已核验并归属本付款对象的银行到账记录');
  const { bankReceipts } = await purchaseReceiptAllocations(tx, order, activities);
  const verified = bankReceipts.find(row => row.id === bankReceiptId);
  if (!verified) throw new PurchaseError('此银行到账尚未核验归属，或其流水须由平台核对');
  const { bank } = verified;
  const amountCents = input.amountCents;
  if (!positiveCents(amountCents) || amountCents > outstandingCents) throw new PurchaseError('本次分摊须大于零，且不得超过本单未收余额');
  const legacyAllocationId = input.legacyAllocationId ? requiredText(input.legacyAllocationId, '原人工分摊记录编号') : null;
  const legacy = legacyAllocationId && activities.find(row => row.id === legacyAllocationId && row.action === 'record_customer_receipt');
  const original = legacy ? purchaseOperation(legacy.detail) : null;
  if (legacyAllocationId && (!legacy || !original || original.bankReceiptId || original.receiptKind !== 'bank_receipt'
    || original.sha256 !== bank.sha256 || original.occurredAt !== bank.occurredAt || original.receiptTotalCents !== bank.receiptTotalCents
    || legacy.amountCents !== amountCents)) throw new PurchaseError('原人工分摊与已核验银行交易的原件、时间及金额须一致');
  if (original && typeof original.transactionReference === 'string'
    && (await nativePaymentReferences(tx, [original.transactionReference, bankTraceKey(original.transactionReference)])).has(bankTraceKey(original.transactionReference))) {
    throw new PurchaseError('原分摊所用平台流水应由原订单的服务端到账记录核对');
  }
  const allocationReference = requiredText(original?.allocationReference ?? input.allocationReference, '本单银行回款分摊编号');
  const allocations = await tx.$queryRaw<{ amountCents: bigint | null; detail: string }[]>`
    SELECT amountCents,detail FROM PurchaseActivity WHERE action='record_customer_receipt'
      AND json_extract(detail,'$.snapshot.operation.bankReceiptId')=${bankReceiptId}`;
  const allocatedBeforeCents = allocations.reduce((total, row) => total + Number(row.amountCents ?? 0), 0);
  if (allocatedBeforeCents + amountCents > bank.receiptTotalCents) throw new PurchaseError('本次分摊超过该笔实际到账的剩余可用金额');
  if (legacyAllocationId && allocations.some(row => purchaseOperation(jsonObject(row.detail)).legacyAllocationId === legacyAllocationId)) {
    throw new PurchaseError('此原人工分摊已经核验关联');
  }
  const receiptReferenceKey = legacyAllocationId
    ? pricingContentHash({ purpose: 'legacy_receipt_reconciliation', legacyAllocationId })
    : pricingContentHash({ purpose: 'customer_receipt_allocation', allocation: allocationReference });
  return { ...evidence, action: 'record_customer_receipt' as const, bankReceiptId, legacyAllocationId, transactionReference: bank.bankTrace, receiptKind: 'bank_receipt',
    allocationReference, amountCents, receiptTotalCents: bank.receiptTotalCents, allocatedBeforeCents,
    bank, receiptReferenceKey };
}

export async function orderReceiptEvidence(tx: Db, order: SourceOrder, activities: PurchaseActivity[], principal: number) {
  const { bankReceipts, ...recorded } = await purchaseReceiptAllocations(tx, order, activities);
  const alipay = order.paymentAttempts.filter(row => row.provider === 'alipay' && row.status === 'paid'
    && row.paidAt && row.tradeNo && order.paidAt && Math.round(row.amount * 100) === principal);
  let paymentAttemptId: string | null = null;
  let nativePaidAt: string | null = null;
  if (alipay.length === 1) {
    const [attempt] = alipay;
    const events = await tx.orderEvent.findMany({ where: { orderId: order.id, type: 'payment_received' } });
    if (events.some(row => {
      const meta = jsonObject(row.metadata);
      return meta.outTradeNo === attempt.outTradeNo && meta.tradeNo === attempt.tradeNo;
    })) {
      paymentAttemptId = attempt.id;
      nativePaidAt = attempt.paidAt!.toISOString();
    }
  }
  const ar = order.receivable;
  const release = order.creditTransactions.filter(row => row.type === 'release' && row.userId === order.customerId && row.actorId
    && !row.reason && Math.round(row.amount * 100) === -principal);
  const settled = ar && ar.status === 'paid' && ar.paidAt && order.paidAt?.getTime() === ar.paidAt.getTime()
    && ar.userId === order.customerId && Math.round(ar.amount * 100) === principal && release.length === 1 ? ar.id : null;
  const payment = { ...recorded, receivedCents: paymentAttemptId ? principal : recorded.allocatedCents,
    paymentAttemptId, nativePaidAt, settledReceivableId: settled };
  return { payment, bankReceipts };
}
