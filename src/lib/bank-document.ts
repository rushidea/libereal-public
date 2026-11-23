import { positiveCents, PurchaseError } from '@/lib/purchase-terms';

export function bankTraceKey(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/gu, '').toUpperCase();
}

export function bankDocumentScope(documentKind: unknown, row: unknown): { documentKind: 'single_receipt' | 'statement'; statementRow: number } {
  if (documentKind !== 'single_receipt' && documentKind !== 'statement') {
    throw new PurchaseError('请选择银行回单或对账单原件', 400);
  }
  const statementRow = documentKind === 'single_receipt' ? 1 : row;
  if (!positiveCents(statementRow)) throw new PurchaseError('请填写对账单原件中该笔交易的行序号', 400);
  return { documentKind, statementRow };
}

export function sameBankDocumentRow(
  a: { sha256: unknown; documentKind?: unknown; statementRow?: unknown },
  b: { sha256: string; documentKind: 'single_receipt' | 'statement'; statementRow: number },
) {
  return a.sha256 === b.sha256 && (a.documentKind !== 'statement' || b.documentKind !== 'statement'
    || !positiveCents(a.statementRow) || a.statementRow === b.statementRow);
}
