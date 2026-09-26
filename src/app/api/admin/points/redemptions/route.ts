import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  const user = await requireAdmin('points.read');
  if (user instanceof NextResponse) return user;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);

    const where: Prisma.PointsRedemptionWhereInput = {};
    if (status) where.status = status;

    const redemptions = await prisma.pointsRedemption.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { name: true, email: true } } },
    });

    // Reshape to flat structure with userName/userEmail
    const flat = redemptions.map((r) => ({
      ...r,
      userName: r.user?.name ?? null,
      userEmail: r.user?.email ?? '',
    }));

    return NextResponse.json({ redemptions: flat });
  } catch (err) {
    console.error('[admin/points/redemptions]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
