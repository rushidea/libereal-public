import { afterSaleActions, hasChoice, type AfterSaleAction } from '@/lib/after-sale-options';
import type { AdminPermissionKey } from '@/lib/admin-permissions';
import { purchaseObject } from '@/lib/purchase-activity';
import { documentSha256, positiveCents, PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';

export type SaleActor = { id: string; email: string };
export type SaleEvidence = { reference: string; sha256: string; documentRow: number; occurredAt: string };
export type SaleAuthorization = { permission: AdminPermissionKey; sessionFingerprint: string; verifiedAt: string };
export type SaleInput = { orderId: string; caseId: string; action: AfterSaleAction; requestId: string; data: Record<string, unknown> };

export function saleInput(orderId: string, raw: unknown): SaleInput {
  const body = purchaseObject(raw);
  if (!hasChoice(afterSaleActions, body.action)) throw new PurchaseError('请选择售后办理事项', 400);
  return { orderId: requiredText(orderId, '原订单号'), caseId: body.action === 'open' ? '' : requiredText(body.caseId, '售后单号'),
    action: body.action, requestId: requiredText(body.requestId, '操作编号'), data: purchaseObject(body.data) };
}
export function salePermission(input: SaleInput): AdminPermissionKey {
  if (['prepare_refund', 'approve_refund', 'refund_result', 'stop_refund', 'review_refund_source', 'release_refund_source', 'invoice_outcome', 'verify_invoice_line', 'invoice_reissue'].includes(input.action)) return 'finance.write';
  if (input.action === 'approve_exchange') return 'purchases.approve';
  if (input.action === 'attribute_resend') return 'purchases.write';
  if (input.action === 'supplier') return input.data.outcome === 'financial_result' ? 'purchases.pay' : 'purchases.write';
  if (input.action === 'technical' && input.data.authority === 'supplier') return 'purchases.write';
  return 'orders.write';
}
export function saleProof(raw: Record<string, unknown>): SaleEvidence {
  const occurredAt = purchaseTimestamp(raw.occurredAt, '实际发生时间');
  if (Date.parse(occurredAt) > Date.now()) throw new PurchaseError('实际事实的时间须已经到达', 400);
  const row = raw.documentRow ?? 1;
  if (!positiveCents(row)) throw new PurchaseError('请填写正整数凭据行号', 400);
  return { reference: requiredText(raw.reference, '凭据出处'), sha256: documentSha256(raw.sha256, '原文摘要'), documentRow: row, occurredAt };
}
export function cents(value: unknown, allowZero = false) {
  if (allowZero && value === 0) return 0;
  if (!positiveCents(value)) throw new PurchaseError('金额须以人民币分为单位填写', 400);
  return value;
}
export function quantity(value: unknown) {
  if (!positiveCents(value)) throw new PurchaseError('请填写办理的实际件数', 400);
  return value;
}
export function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (!choices.includes(value as T)) throw new PurchaseError('请选择' + label, 400);
  return value as T;
}
export function condition(ok: unknown, message: string): asserts ok {
  if (!ok) throw new PurchaseError(message);
}
