import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getUsableCoupons } from '@/lib/coupon-service';

/** GET /api/coupons：当前用户可用券列表（结算页展示/选择） */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const coupons = await getUsableCoupons(session.user.id as string);
    return NextResponse.json(coupons);
  } catch (err) {
    console.error('[coupons GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
