import { NextResponse } from 'next/server';
import { requireAdminPricingRead } from '@/lib/admin-pricing-step-up';
import { parsePriceAdjustmentRequest } from '@/lib/pricing-adjustment-rules';
import { PREVIEW_UPLOAD_CHUNK_BYTES, PREVIEW_UPLOAD_CHUNK_SIZE } from '@/lib/pricing-adjustment-preview-chunks';
import { ingestPreviewChunk, PreviewBatchError } from '@/lib/pricing-adjustment-preview-batch';

export const maxDuration = 300;

function previewFailureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'PREVIEW_PLAN_TOO_LARGE') return '本次预览范围过大，请拆分表格后再生成预览';
  if (/SQLITE|database is locked|too many SQL variables|string or blob too big/i.test(message)) {
    return '读取商品库时失败，请拆分表格后重试';
  }
  return '生成调价预览失败';
}

function jsonResponse(body: unknown, status = 200) {
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Libereal-Preview': '1',
    },
  });
}

function asRecord(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

function chunkArrayTooLarge(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value.length > PREVIEW_UPLOAD_CHUNK_SIZE) return true;
  return JSON.stringify(value).length > PREVIEW_UPLOAD_CHUNK_BYTES * 2;
}

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) as unknown : null;
    } catch {
      console.error('[admin/pricing-adjustments/preview/chunk] invalid json bytes=', raw.length);
      return jsonResponse({ error: '请求格式无效' }, 400);
    }

    const input = asRecord(body);
    if (!input) return jsonResponse({ error: '请求格式无效' }, 400);
    const chunkIndex = input.chunkIndex;
    const chunkCount = input.chunkCount;
    const batchId = typeof input.batchId === 'string' ? input.batchId : undefined;
    if (typeof chunkIndex !== 'number' || typeof chunkCount !== 'number') {
      return jsonResponse({ error: '分块信息不完整' }, 400);
    }
    if (chunkArrayTooLarge(input.catalogItems) || chunkArrayTooLarge(input.catalogNumbers)) {
      return jsonResponse({ error: `每块最多 ${PREVIEW_UPLOAD_CHUNK_SIZE.toLocaleString('zh-CN')} 条` }, 400);
    }

    const parsed = parsePriceAdjustmentRequest(body);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

    const admin = await requireAdminPricingRead(parsed.value.stepUpToken);
    if (admin instanceof NextResponse) return admin;

    const result = await ingestPreviewChunk({
      ownerId: admin.id,
      batchId,
      chunkIndex,
      chunkCount,
      request: parsed.value,
    });
    console.info('[admin/pricing-adjustments/preview/chunk]', {
      batchId: result.batchId,
      chunkIndex: result.chunkIndex,
      chunkCount: result.chunkCount,
      received: result.receivedCount,
      complete: result.complete,
      requestBytes: raw.length,
    });
    return jsonResponse(result);
  } catch (error) {
    if (error instanceof PreviewBatchError) return jsonResponse({ error: error.message }, error.status);
    console.error('[admin/pricing-adjustments/preview/chunk]', error);
    return jsonResponse({ error: previewFailureMessage(error) }, 500);
  }
}
