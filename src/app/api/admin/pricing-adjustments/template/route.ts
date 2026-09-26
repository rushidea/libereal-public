import { NextResponse } from 'next/server';
import { requireAdminPricingRead } from '@/lib/admin-pricing-step-up';
import { readPricingAdjustmentTemplate } from '@/lib/pricing-adjustment-template';

export async function GET() {
  const admin = await requireAdminPricingRead();
  if (admin instanceof NextResponse) return admin;

  const file = await readPricingAdjustmentTemplate();
  const encodedName = encodeURIComponent(file.fileName);
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="pricing-adjustment-template.xlsx"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
