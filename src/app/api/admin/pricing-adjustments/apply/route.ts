import { NextResponse } from 'next/server';
import { requireAdminPricingMutation, requireAdminPricingRead } from '@/lib/admin-pricing-step-up';
import { prisma } from '@/lib/prisma';
import { isPriceAdjustmentApprovalHash } from '@/lib/pricing-adjustment-approval';
import { parsePriceAdjustmentRequest } from '@/lib/pricing-adjustment-rules';
import { applyPriceAdjustment, PriceAdjustmentApprovalChangedError, PriceAdjustmentPlanMissingError } from '@/lib/pricing-adjustment-service';
import { discountPricingFailure } from '@/lib/pricing';

/** Recover a committed result without replaying the mutation or relying on its preview cache. */
export async function GET(request: Request) {
  const admin = await requireAdminPricingRead();
  if (admin instanceof NextResponse) return admin;
  const approvalHash = new URL(request.url).searchParams.get('approvalHash');
  if (!isPriceAdjustmentApprovalHash(approvalHash)) {
    return NextResponse.json({ error: '调价确认标识无效' }, { status: 400 });
  }
  const headers = { 'Cache-Control': 'private, no-store' };
  const task = await prisma.backgroundTask.findUnique({
    where: { dedupeKey: `pricing-apply:${approvalHash}` },
    select: { type: true, status: true, result: true },
  });
  if (!task) return NextResponse.json({ result: null }, { headers });
  let result: Record<string, unknown> | null = null;
  try { result = JSON.parse(task.result || 'null'); } catch { /* An unreadable result is not permission to retry. */ }
  if (task.type !== 'pricing.apply' || task.status !== 'succeeded' || !result
    || result.approvalHash !== approvalHash || !Number.isInteger(result.updatedCount)
    || (result.updatedCount as number) < 0 || !Array.isArray(result.repricedQuotes)) {
    return NextResponse.json({ error: '未能核清原调价结果，请检查执行记录后再操作' }, { status: 409, headers });
  }
  return NextResponse.json({ result: { ...result, updatedCount: 0, recovered: true } }, { headers });
}

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
    const businessError = discountPricingFailure(error);
    if (businessError) return NextResponse.json({ error: businessError }, { status: 409 });
    if (error instanceof PriceAdjustmentPlanMissingError || error instanceof PriceAdjustmentApprovalChangedError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('[admin/pricing-adjustments/apply]', error);
    return NextResponse.json({ error: '执行调价失败' }, { status: 500 });
  }
}
