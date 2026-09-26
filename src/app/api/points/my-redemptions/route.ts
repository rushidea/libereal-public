import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/session';

export async function GET() {
  const user = await requireUser();
  if (user instanceof NextResponse) return user;
  const userId = user.id;

  try {
    const redemptions = await prisma.pointsRedemption.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // shippingInfo is a JSON string column; parse for response
    const parsed = redemptions.map((r) => ({
      ...r,
      shippingInfo: r.shippingInfo ? JSON.parse(r.shippingInfo) : null,
    }));

    return NextResponse.json({ redemptions: parsed });
  } catch (err) {
    console.error('[points/my-redemptions]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
