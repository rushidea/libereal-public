import { NextResponse } from 'next/server';
import { requireAdminPricingRead } from '@/lib/admin-pricing-step-up';
import { isPriceAdjustmentApprovalHash } from '@/lib/pricing-adjustment-approval';
import { readPriceAdjustmentDetails } from '@/lib/pricing-adjustment-service';

export async function GET(req: Request) {
  const admin = await requireAdminPricingRead();
  if (admin instanceof NextResponse) return admin;
  const search = new URL(req.url).searchParams;
  const approvalHash = search.get('approvalHash');
  const offset = Number(search.get('offset') ?? 0);
  if (!isPriceAdjustmentApprovalHash(approvalHash) || !Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ error: '预览参数无效' }, { status: 400 });
  const details = await readPriceAdjustmentDetails(approvalHash, offset);
  return details ? NextResponse.json(details) : NextResponse.json({ error: '此预览已失效，请重新预览后确认' }, { status: 409 });
}
