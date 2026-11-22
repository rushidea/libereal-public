import type { Prisma } from '@prisma/client';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { documentSha256, positiveCents, PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';

export type FulfillmentDb = Prisma.TransactionClient;
export type FulfillmentActor = { id: string; email: string };
export const parcelInclude = {
  lines: { orderBy: { id: 'asc' }, include: { receipts: { orderBy: { id: 'asc' }, include: { inventoryBatch: { select: { batchNumber: true, inventoryAccountId: true } } } } } },
  events: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.FulfillmentParcelInclude;

export function inputObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PurchaseError('请提交完整的物流记录', 400);
  return raw as Record<string, unknown>;
}

export function optionalText(raw: unknown, label: string) {
  return raw === undefined || raw === null || raw === '' ? null : requiredText(raw, label);
}

export function positiveQuantity(raw: unknown, label: string) {
  if (!positiveCents(raw)) throw new PurchaseError(label + '须为正整数', 400);
  return raw;
}

export function shipmentEvidence(input: Record<string, unknown>) {
  const occurredAt = purchaseTimestamp(input.occurredAt, '实际发生时间');
  if (Date.parse(occurredAt) > Date.now()) throw new PurchaseError('物流事实的发生时间不能晚于登记时间', 400);
  return { occurredAt, reference: requiredText(input.reference, '物流凭据出处'),
    sha256: documentSha256(input.sha256, '物流凭据摘要'), documentRow: positiveQuantity(input.documentRow ?? 1, '凭据行号') };
}

export function parcelKeys(purpose: string, ownerId: string, request: unknown, natural: object, content: object) {
  const requestId = requiredText(request, '操作编号');
  return { requestKey: pricingContentHash({ purpose, ownerId, requestId }), businessKey: pricingContentHash({ purpose, ...natural }),
    contentHash: pricingContentHash(content) };
}

export function verifyRepeat<T extends { requestKey: string; businessKey: string; contentHash: string }>(
  rows: T[], keys: { requestKey: string; businessKey: string; contentHash: string },
) {
  if (!rows.length) return null;
  if (rows.length !== 1 || rows[0].businessKey !== keys.businessKey || rows[0].contentHash !== keys.contentHash) {
    throw new PurchaseError('这笔操作或物流凭据已用于其他内容，请核对原记录');
  }
  return rows[0];
}

export function confirmPreview(approved: string | undefined, snapshot: object) {
  const actionHash = pricingContentHash(snapshot);
  if (approved !== undefined && approved !== actionHash) throw new PurchaseError('订单、数量或依据已变化，请重新预览');
  return { snapshot, actionHash };
}
