import { NextResponse } from 'next/server';
import { requireAdminPricingRead } from '@/lib/admin-pricing-step-up';
import { parsePriceAdjustmentRequest } from '@/lib/pricing-adjustment-rules';
import { previewPriceAdjustment } from '@/lib/pricing-adjustment-service';

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

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    let body: unknown = null;
    try {
      body = raw ? JSON.parse(raw) as unknown : null;
    } catch {
      console.error('[admin/pricing-adjustments/preview] invalid json bytes=', raw.length);
      return jsonResponse({ error: '请求格式无效' }, 400);
    }

    const parsed = parsePriceAdjustmentRequest(body);
    if (!parsed.ok) return jsonResponse({ error: parsed.error }, 400);

    const admin = await requireAdminPricingRead(parsed.value.stepUpToken);
    if (admin instanceof NextResponse) return admin;

    const preview = await previewPriceAdjustment(parsed.value);
    const payload = { preview };
    console.info('[admin/pricing-adjustments/preview]', {
      brand: parsed.value.brand,
      mode: parsed.value.mode,
      items: parsed.value.catalogItems?.length ?? parsed.value.catalogNumbers?.length ?? 0,
      matched: preview.matchedCount,
      changes: preview.changeCount,
      requestBytes: raw.length,
      responseBytes: JSON.stringify(payload).length,
    });
    return jsonResponse(payload);
  } catch (error) {
    console.error('[admin/pricing-adjustments/preview]', error);
    return jsonResponse({ error: previewFailureMessage(error) }, 500);
  }
}
