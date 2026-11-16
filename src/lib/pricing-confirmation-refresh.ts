import { buildPreviewChunkBody, splitPreviewUpload } from './pricing-adjustment-preview-chunks';

/** Renew the preview after interactive verification, without changing what was approved. */
export async function refreshConfirmedPricingPreview(
  approved: Readonly<Record<string, unknown>>,
  isCurrent: () => boolean,
): Promise<boolean> {
  const expectedHash = approved.approvalHash;
  if (typeof expectedHash !== 'string' || !/^[a-f0-9]{64}$/.test(expectedHash)) {
    throw new Error('未取得有效的调价预览，请重新生成预览后确认');
  }
  const payload = { ...approved };
  delete payload.approvalHash;
  delete payload.stepUpToken;
  const slices = splitPreviewUpload({
    catalogItems: Array.isArray(payload.catalogItems) ? payload.catalogItems : undefined,
    catalogNumbers: Array.isArray(payload.catalogNumbers) ? payload.catalogNumbers as string[] : undefined,
  });
  const chunked = slices.length > 1;
  let batchId: string | undefined;
  let refreshedHash: unknown;
  for (let index = 0; index < (chunked ? slices.length : 1); index++) {
    if (!isCurrent()) return false;
    const response = await fetch(`/api/admin/pricing-adjustments/preview${chunked ? '/chunk' : ''}`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(chunked
        ? buildPreviewChunkBody(payload, slices[index], { batchId, chunkIndex: index, chunkCount: slices.length })
        : payload),
    });
    const data = await response.json().catch(() => ({})) as {
      error?: unknown; batchId?: string; complete?: boolean; preview?: { approvalHash?: unknown };
    };
    if (!isCurrent()) return false;
    if (!response.ok) {
      throw new Error(typeof data.error === 'string' ? data.error : '未能重新核对调价预览，请稍后重试');
    }
    if (chunked) {
      if (!data.batchId || (batchId && data.batchId !== batchId)
        || (index === slices.length - 1 ? data.complete !== true : data.complete !== false)) {
        throw new Error('未取得完整的调价预览，请重新生成预览后确认');
      }
      batchId = data.batchId;
    }
    refreshedHash = data.preview?.approvalHash;
  }
  if (refreshedHash !== expectedHash) {
    throw new Error('验证期间价格、范围或报价影响发生变化，请重新生成预览并确认');
  }
  return isCurrent();
}
