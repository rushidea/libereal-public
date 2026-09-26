import { NextResponse } from 'next/server';
import { requireAdminPricingMutation } from '@/lib/admin-pricing-step-up';
import { parsePriceAdjustmentRequest } from '@/lib/pricing-adjustment-rules';
import { applyPriceAdjustment, PriceAdjustmentPlanMissingError } from '@/lib/pricing-adjustment-service';

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = parsePriceAdjustmentRequest(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const admin = await requireAdminPricingMutation(parsed.value.stepUpToken);
  if (admin instanceof NextResponse) return admin;

  try {
    const result = await applyPriceAdjustment(parsed.value, { id: admin.id, email: admin.email });
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof PriceAdjustmentPlanMissingError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('[admin/pricing-adjustments/apply]', error);
    return NextResponse.json({ error: '执行调价失败' }, { status: 500 });
  }
}
