import { NextResponse } from 'next/server';
import { requireAdminPricingRead } from '@/lib/admin-pricing-step-up';
import { parseCatalogMatchRequest } from '@/lib/pricing-adjustment-rules';
import { matchCatalogItems } from '@/lib/pricing-adjustment-service';

export async function POST(request: Request) {
  const admin = await requireAdminPricingRead();
  if (admin instanceof NextResponse) return admin;

  const body = await request.json().catch(() => null);
  const parsed = parseCatalogMatchRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const matches = await matchCatalogItems(parsed.brand, parsed.items);
    return NextResponse.json({ matches });
  } catch (error) {
    console.error('[admin/pricing-adjustments/match]', error);
    return NextResponse.json({ error: '商品匹配失败' }, { status: 500 });
  }
}
