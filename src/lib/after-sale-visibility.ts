import { purchaseObject } from '@/lib/purchase-activity';

export const readsSaleFinance = (permissions: readonly string[]) => permissions.includes('finance.read');
export const readsSalePurchasing = (permissions: readonly string[]) => permissions.includes('purchases.read') || readsSaleFinance(permissions);

function select(operation: Record<string,unknown>, fields: readonly string[]) {
  return Object.fromEntries(fields.filter(field => Object.hasOwn(operation,field)).map(field => [field,operation[field]]));
}

export function salePurchaseFor<T extends Record<string,unknown>>(source: T, permissions: readonly string[]) {
  if (readsSalePurchasing(permissions)) return source;
  return select(source, ['id','purchaseOrderId','fromPurchaseOrderId','orderItemId','authorizationId','commitmentId',
    'approvalId','decisionId','shortfallId','quantity','orderedAt']) as Partial<T>;
}

const invoiceIdentity = ['invoiceId','allocationId','planId','originalNumber','issuedAt','expectedOutcome','correctionId'];

export function saleOperationFor(action: string, op: Record<string,unknown>, permissions: readonly string[]) {
  const finance = readsSaleFinance(permissions);
  const procurement = readsSalePurchasing(permissions);
  if (!finance && (action.includes('refund') || action==='agreement' && op.remedy==='refund')) return null;
  if (!finance && action==='agreement' && op.remedy==='refund_withdraw') return select(op,['remedy','quantity','originalRefundStopId']);
  if (action==='supplier') return procurement ? op : null;
  if (!finance && ['verify_invoice_line','invoice_outcome','invoice_reissue'].includes(action)) {
    return select(op,[...invoiceIdentity,'financeEventId','financeOrderId','agreementId','invoiceId','replacementEventId','number','result']);
  }
  const visible = { ...op };
  if (!finance) {
    delete visible.relatedCents;
    if (action==='agreement' && op.invoice) visible.invoice = select(purchaseObject(op.invoice),invoiceIdentity);
  }
  if (!procurement) {
    if (action==='bind_original_parcel') delete visible.priorSupplierEventIds;
    if (op.replacement) visible.replacement = salePurchaseFor(purchaseObject(op.replacement),permissions);
    if (Array.isArray(op.replacements)) visible.replacements = op.replacements.map(source=>salePurchaseFor(purchaseObject(source),permissions));
    if (action==='approve_exchange') return select(visible,['agreementId','technicalId','originalParcelLineId','purchaseOrderId','orderItemId',
      'quantity','returnRequirement','supplierDocumentShares','freeOfCharge','caseId']);
  }
  return visible;
}

export function saleSnapshotFor(raw: unknown, permissions: readonly string[], submittedBy?: string) {
  const snapshot = purchaseObject(raw);
  const action = typeof snapshot.action==='string'?snapshot.action:'';
  const operation = purchaseObject(snapshot.operation);
  const ownRefundRequest = submittedBy && snapshot.actor===submittedBy && action==='agreement' && operation.remedy==='refund'
    && permissions.includes('orders.read') && permissions.includes('orders.write') && !readsSaleFinance(permissions);
  return { ...snapshot, operation:ownRefundRequest
    ? select(operation,['remedy','amountCents','recipient','destination','method','decision','quantity','refundQuantity'])
    : saleOperationFor(action,operation,permissions) };
}
