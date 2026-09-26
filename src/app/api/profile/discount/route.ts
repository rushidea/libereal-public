import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getUserDisplayDiscount, TIER_DISCOUNT_RATES } from '@/lib/discount';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id as string },
      select: { discountRate: true, brandDiscounts: true, tier: true, points: true, isFrozen: true },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // 冻结账户不展示会员折扣信息，统一按目录价（1.0）
    if (user.isFrozen) {
      return NextResponse.json({
        discountRate: null,
        brandDiscounts: null,
        tier: user.tier,
        tierRate: 1,
        displayRate: 1,
        hasPersonalDiscount: false,
        frozen: true,
      });
    }

    const brandDiscounts = user.brandDiscounts ? JSON.parse(user.brandDiscounts) : null;

    return NextResponse.json({
      discountRate: user.discountRate,
      brandDiscounts,
      tier: user.tier,
      tierRate: TIER_DISCOUNT_RATES[user.tier] ?? 1.00,
      displayRate: getUserDisplayDiscount(user),
      hasPersonalDiscount: user.discountRate != null,
      frozen: false,
    });
  } catch (err) {
    console.error('[profile/discount GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
