import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPointsMutation } from '@/lib/admin-points-step-up';
import { writeAuditLog } from '@/lib/audit';
import { validatePointsTarget } from '@/lib/points';

interface UndoRequest {
  logId: string;
  stepUpToken?: string;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function POST(req: NextRequest) {
  try {
    const body: UndoRequest = await req.json();
    const user = await requireAdminPointsMutation(typeof body.stepUpToken === 'string' ? body.stepUpToken.trim() : undefined);
    if (user instanceof NextResponse) return user;
    const { logId } = body;

    if (!logId) {
      return NextResponse.json({ error: 'logId required' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const log = await tx.pointsLog.findUnique({
        where: { id: logId },
        select: { id: true, userId: true, delta: true, type: true, reason: true, undoOfId: true },
      });
      if (!log) return { status: 404 as const, error: '日志记录不存在' };
      if (log.type !== 'admin_adjust') {
        return { status: 400 as const, error: '只能撤销管理员调整的积分' };
      }

      const existingUndo = await tx.pointsLog.findFirst({
        where: {
          type: 'admin_undo',
          OR: [
            { undoOfId: log.id },
            { relatedId: log.id },
          ],
        },
        select: { id: true },
      });
      if (log.undoOfId || existingUndo) {
        return { status: 409 as const, error: '这条积分调整已经撤销' };
      }

      const target = await tx.user.findUnique({
        where: { id: log.userId },
        select: { id: true, points: true, email: true },
      });
      if (!target) return { status: 404 as const, error: '用户不存在' };

      // Reverse the delta: +100 becomes -100, -50 becomes +50.
      const reverseDelta = -log.delta;
      const newPoints = target.points + reverseDelta;
      if (newPoints < 0) {
        return { status: 400 as const, error: '撤销后积分为负，不允许' };
      }
      const targetCheck = validatePointsTarget(newPoints);
      if (!targetCheck.valid) {
        return { status: 400 as const, error: targetCheck.error };
      }

      // 以撤销前余额作为条件，避免撤销覆盖同时发生的其他积分调整。
      const updated = await tx.user.updateMany({
        where: { id: log.userId, points: target.points },
        data: { points: newPoints },
      });
      if (updated.count !== 1) {
        return { status: 409 as const, error: '积分已被其他操作修改，请刷新后重试' };
      }

      await tx.pointsLog.create({
        data: {
          userId: log.userId,
          delta: reverseDelta,
          type: 'admin_undo',
          reason: `撤销：${log.reason || '管理员调整'} (${logId})`,
          relatedId: logId,
          undoOfId: log.id,
          adminEmail: user.email,
        },
      });
      await writeAuditLog({ actorId: user.id, actorEmail: user.email, action: 'points.adjustment_undone', resource: 'points', targetType: 'User', targetId: log.userId, before: { points: target.points }, after: { points: newPoints }, reason: `撤销积分记录 ${logId}`, metadata: { undoOfId: log.id } }, tx);

      return { status: 200 as const, oldPoints: target.points, newPoints, delta: reverseDelta, userEmail: target.email };
    });

    if (result.status !== 200) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({
      success: true,
      oldPoints: result.oldPoints,
      newPoints: result.newPoints,
      delta: result.delta,
      userEmail: result.userEmail,
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return NextResponse.json({ error: '这条积分调整已经撤销' }, { status: 409 });
    }
    console.error('[points/undo]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
