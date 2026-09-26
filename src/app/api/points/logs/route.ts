import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getUserPointsBalance } from '@/lib/points-checkout-service';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  try {
    const [logs, user, balance] = await Promise.all([
      prisma.pointsLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          delta: true,
          type: true,
          reason: true,
          relatedId: true,
          adminEmail: true,
          createdAt: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { points: true, tier: true },
      }),
      getUserPointsBalance(prisma, userId),
    ]);

    const groupLogs = balance?.group
      ? await prisma.groupPointsLog.findMany({
          where: { groupId: balance.group.id },
          orderBy: { createdAt: 'desc' },
          take: 100,
          select: {
            id: true,
            delta: true,
            type: true,
            reason: true,
            relatedId: true,
            adminEmail: true,
            createdAt: true,
          },
        })
      : [];

    return NextResponse.json({
      logs,
      groupLogs: groupLogs.map((log) => ({
        id: log.id,
        delta: log.delta,
        type: log.type,
        reason: log.reason,
        relatedId: log.relatedId,
        adminEmail: log.adminEmail,
        createdAt: log.createdAt,
      })),
      currentPoints: user?.points ?? 0,
      currentTier: user?.tier ?? 'standard',
    });
  } catch (err) {
    console.error('[points/logs]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
