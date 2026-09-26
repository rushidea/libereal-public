import { NextResponse } from 'next/server';
import { requireAdminPricingRead } from '@/lib/admin-pricing-step-up';
import { classifyMissingCatalogPreview, MAX_CLASSIFY_PREVIEW } from '@/lib/product-smart-classify-catalog';

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: Request) {
  const admin = await requireAdminPricingRead();
  if (admin instanceof NextResponse) return admin;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
  const input = body as Record<string, unknown>;
  const brand = text(input.brand);
  if (!Array.isArray(input.items)) return NextResponse.json({ error: '请选择要判定的商品' }, { status: 400 });
  if (input.items.length > MAX_CLASSIFY_PREVIEW) {
    return NextResponse.json({ error: `单次最多判定 ${MAX_CLASSIFY_PREVIEW.toLocaleString('zh-CN')} 个商品` }, { status: 400 });
  }

  const items = input.items.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Record<string, unknown>;
    const catalogNumber = text(row.catalogNumber);
    const name = text(row.name) || catalogNumber;
    if (!catalogNumber || !name) return [];
    return [{ name, catalogNumber, spec: text(row.spec) }];
  });
  if (items.length === 0) return NextResponse.json({ error: '没有可判定的商品' }, { status: 400 });

  try {
    const suggestions = await classifyMissingCatalogPreview({ brand, items });
    return NextResponse.json({ suggestions });
  } catch (error) {
    console.error('[admin/pricing-adjustments/classify-preview]', error);
    return NextResponse.json({ error: '分类判定失败' }, { status: 500 });
  }
}
