import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getUserPointsBalance } from '@/lib/points-checkout-service';
import { POINTS_YUAN_RATE } from '@/lib/points-checkout';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const balance = await getUserPointsBalance(prisma, session.user.id as string);
  if (!balance) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const group = balance.group?.role === 'owner'
    ? {
        ...balance.group,
        members: await prisma.researchGroupMember.findMany({
          where: { groupId: balance.group.id },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            role: true,
            user: { select: { id: true, email: true, name: true } },
          },
        }),
      }
    : balance.group;

  return NextResponse.json({
    rate: POINTS_YUAN_RATE,
    personalPoints: balance.personalPoints,
    group,
  });
}
