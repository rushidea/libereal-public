import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  const user = await requireAdmin('points.read');
  if (user instanceof NextResponse) return user;

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type');
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);

    const where: Prisma.PointsLogWhereInput = {};
    if (userId) where.userId = userId;
    if (type) where.type = type;

    const logs = await prisma.pointsLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { name: true, email: true } } },
    });

    // Reshape to flat with userName/userEmail and expose whether an adjustment was undone.
    const adjustmentIds = logs.filter((log) => log.type === 'admin_adjust').map((log) => log.id);
    const undoneLogs = adjustmentIds.length === 0
      ? []
      : await prisma.pointsLog.findMany({
          where: {
            type: 'admin_undo',
            OR: [
              { undoOfId: { in: adjustmentIds } },
              { relatedId: { in: adjustmentIds } },
            ],
          },
          select: { undoOfId: true, relatedId: true },
        });
    const undoneIds = new Set(
      undoneLogs.flatMap((log) => [log.undoOfId, log.relatedId]).filter((id): id is string => Boolean(id)),
    );
    const flat = logs.map((l) => ({
      id: l.id,
      userId: l.userId,
      delta: l.delta,
      type: l.type,
      reason: l.reason,
      relatedId: l.relatedId,
      undoOfId: l.undoOfId,
      isUndone: undoneIds.has(l.id),
      adminEmail: l.adminEmail,
      createdAt: l.createdAt,
      userName: l.user?.name ?? null,
      userEmail: l.user?.email ?? '',
    }));

    return NextResponse.json({ logs: flat });
  } catch (err) {
    console.error('[admin/points/logs]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
