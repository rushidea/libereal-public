import type { Prisma } from '@prisma/client';
import { customerCashProjection } from '@/lib/customer-cash';
import { canMatchSupplierFinance, financeCustomerAllocationLimit, invoicePreviewNeedsManualPortions } from '@/lib/finance-actions';
import { financeWorkspace } from '@/lib/finance-workspace';
import { prisma } from '@/lib/prisma';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { assertBankAllocationAmount } from '@/lib/purchase-receipts';
import { loadPurchaseOrderSource } from '@/lib/purchase-source';
import { positiveCents, PurchaseError } from '@/lib/purchase-terms';
import { assertBusinessVersion, businessObjectId, invalidBusinessInput, strictFields } from './business-route';
import { HarnessServiceError } from './inquiry-tools-service';

type Context = { pilotOrderIds: readonly string[] };

async function readFinance(tx: Prisma.TransactionClient, orderId: string, { pilotOrderIds }: Context) {
  const exists = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, customerId: true } });
  if (!exists) throw new HarnessServiceError(404, 'not_found', 'OBJECT_NOT_FOUND', '未找到指定业务单据');
  const view = await financeWorkspace(tx, orderId);
  const order = await loadPurchaseOrderSource(tx, orderId);
  const scopedSources = view.banks.length ? await tx.purchaseActivity.findMany({
    where: { id: { in: view.banks.map(row => row.id) }, action: 'verify_bank_receipt', orderId: { in: [...pilotOrderIds] } },
    select: { id: true },
  }) : [];
  const permitted = new Set(scopedSources.map(row => row.id));
  const receiptKey = (id: string) => pricingContentHash(['finance-bank-receipt', orderId, id]);
  const banks = view.banks.filter(row => permitted.has(row.id)).map(row => ({
    receiptKey: receiptKey(row.id), receivedCents: row.totalCents, availableCents: row.availableCents,
  }));
  const creditAccount = order.receivable ? await tx.creditAccount.findUnique({
    where: { userId: order.receivable.userId }, select: { usedAmount: true },
  }) : null;
  const data = {
    orderId, status: view.status, archived: view.archived, principalCents: view.principalCents,
    receivable: view.receivable && {
      status: view.receivable.status, outstandingCents: view.receivable.outstandingCents,
      needsPrincipalReview: view.receivable.needsPrincipalReview,
    },
    verifiedCents: view.verifiedCents, postedCashCents: view.cashCents,
    postingOutstandingCents: view.postingOutstandingCents, authorityConflict: view.authorityConflict,
    bankReceipts: banks,
    allocations: view.receipts.map(row => ({
      allocationId: row.id, amountCents: row.amountCents, counted: row.counted, reconciled: row.reconciled,
      receiptKey: typeof row.bankReceiptId === 'string' && permitted.has(row.bankReceiptId) ? receiptKey(row.bankReceiptId) : null,
    })),
    invoicePlans: view.invoicePlans.map(plan => ({
      planId: plan.id, side: plan.side, purchaseOrderId: plan.purchaseOrderId, trigger: plan.trigger,
      closed: plan.closed, readyAt: plan.readyAt, remainingCents: plan.remainingCents, issuableCents: plan.issuableCents,
      invoices: plan.allocations.map(row => ({
        invoiceId: row.invoiceId, status: row.status, amountCents: row.amountCents,
      })),
      nextReviewAt: typeof plan.lastFollowup?.operation.nextReviewAt === 'string' ? plan.lastFollowup.operation.nextReviewAt : null,
    })),
    purchases: view.purchases.map(po => ({
      purchaseOrderId: po.id, agreedCents: po.agreedCents, paidCents: po.paidCents, dueCents: po.dueCents,
      invoicedCents: po.invoicedCents, pendingInvoiceCents: po.pendingInvoiceCents,
      reconciled: po.reconciled, supplierFollowup: Boolean(po.supplierFollowup),
    })),
  };
  return { view, order, data, objectVersion: pricingContentHash({
    financeVersion: view.version, banks, creditAccount, creditTransactions: order.creditTransactions,
  }) };
}

export function getFinanceWorkspace(orderId: string, context: Context) {
  return prisma.$transaction(async tx => {
    const { data, objectVersion } = await readFinance(tx, orderId, context);
    return { data, objectVersion };
  });
}

function parseIntent(value: unknown) {
  if (!value || typeof value !== 'object') invalidBusinessInput();
  const { action } = value as Record<string, unknown>;
  if (action === 'allocate_receipt') {
    const { receiptKey, amountCents } = strictFields(value, ['action', 'receiptKey', 'amountCents']);
    if (typeof receiptKey !== 'string' || !/^[0-9a-f]{64}$/.test(receiptKey) || !positiveCents(amountCents)) invalidBusinessInput();
    return { action, receiptKey, amountCents } as const;
  }
  if (action === 'invoice') {
    const { planId, amountCents } = strictFields(value, ['action', 'planId', 'amountCents']);
    if (!positiveCents(amountCents)) invalidBusinessInput();
    return { action, planId: businessObjectId(planId), amountCents } as const;
  }
  if (action === 'reconcile_supplier') {
    const { purchaseOrderId } = strictFields(value, ['action', 'purchaseOrderId']);
    return { action, purchaseOrderId: businessObjectId(purchaseOrderId) } as const;
  }
  invalidBusinessInput();
}

export function previewFinanceActionForHarness(orderId: string, context: Context, input: Record<string, unknown>, expectedVersion: string) {
  const intent = parseIntent(input.intent);
  return prisma.$transaction(async tx => {
    const { view, order, data, objectVersion } = await readFinance(tx, orderId, context);
    assertBusinessVersion(objectVersion, expectedVersion);
    const blockers = data.archived ? ['ORDER_ARCHIVED'] : [];
    let projection: Record<string, unknown> | null = null;
    if (!blockers.length && intent.action === 'allocate_receipt') {
      const bank = data.bankReceipts.find(row => row.receiptKey === intent.receiptKey);
      if (!bank) blockers.push('VERIFIED_RECEIPT_NOT_AVAILABLE');
      else {
        try {
          const orderRemaining = financeCustomerAllocationLimit(view);
          assertBankAllocationAmount(intent.amountCents, orderRemaining, bank.availableCents);
          const cash = await customerCashProjection(tx, order, intent.amountCents);
          projection = {
            receiptRemainingAfterCents: bank.availableCents - intent.amountCents,
            receivableRemainingAfterCents: cash.remainingCents, creditReleasePreviewCents: cash.releaseCents,
          };
        } catch (error) {
          if (!(error instanceof PurchaseError)) throw error;
          blockers.push('RECEIPT_ALLOCATION_REJECTED');
        }
      }
    } else if (!blockers.length && intent.action === 'invoice') {
      const plan = view.invoicePlans.find(row => row.id === intent.planId);
      if (!plan || plan.closed || !plan.readyAt || !plan.issuableCents || intent.amountCents > plan.issuableCents) {
        blockers.push('INVOICE_SCOPE_NOT_READY');
      } else if (invoicePreviewNeedsManualPortions(plan, intent.amountCents, new Date().toISOString())) {
        blockers.push('INVOICE_PORTIONS_REQUIRE_HUMAN_REVIEW');
      } else {
        projection = { side: plan.side, issuableCents: plan.issuableCents, cashPostedByInvoice: false };
      }
    } else if (!blockers.length && intent.action === 'reconcile_supplier') {
      const purchase = view.purchases.find(row => row.id === intent.purchaseOrderId);
      if (!purchase || !canMatchSupplierFinance(purchase)) blockers.push('SUPPLIER_EVIDENCE_NOT_MATCHED');
      else projection = { paidCents: purchase.paidCents, dueCents: purchase.dueCents,
        invoicedCents: purchase.invoicedCents, alreadyReconciled: purchase.reconciled };
    }
    return { objectVersion, data: {
      orderId, ...intent, projection, postedCashCents: data.postedCashCents,
      allowed: blockers.length === 0, blockers, humanActionRequired: true, actualDocumentsRequired: true,
    } };
  });
}
