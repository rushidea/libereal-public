import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPointsMutation } from '@/lib/admin-points-step-up';
import { validatePointsDelta, validatePointsTarget } from '@/lib/points';
import { writeAuditLog } from '@/lib/audit';

interface AdjustRequest {
  userId: string;
  delta?: number;
  reason?: string;
  setTo?: number;
  stepUpToken?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: AdjustRequest = await req.json();
    const user = await requireAdminPointsMutation(typeof body.stepUpToken === 'string' ? body.stepUpToken.trim() : undefined);
    if (user instanceof NextResponse) return user;
    const { userId, delta, reason, setTo } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    const hasSetTo = setTo !== undefined;
    if (hasSetTo && delta !== undefined) {
      return NextResponse.json({ error: 'delta 和 setTo 只能提供一个' }, { status: 400 });
    }
    if (hasSetTo) {
      const validation = validatePointsTarget(setTo as number);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    } else {
      const validation = validatePointsDelta(delta as number);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    }

    const adminEmail = user.email;
    const reasonText = reason?.trim() || '管理员调整';

    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, points: true, email: true },
      });
      if (!target) return { status: 404 as const, error: '用户不存在' };

      const newPoints = hasSetTo ? (setTo as number) : target.points + (delta as number);
      if (newPoints < 0) {
        return { status: 400 as const, error: '积分不能为负' };
      }
      const balanceValidation = validatePointsTarget(newPoints);
      if (!balanceValidation.valid) {
        return { status: 400 as const, error: balanceValidation.error };
      }
      if (newPoints === target.points) {
        return { status: 400 as const, error: '目标积分与当前积分相同' };
      }

      // 以旧余额作为条件，避免并发请求互相覆盖积分。
      const updated = await tx.user.updateMany({
        where: { id: userId, points: target.points },
        data: { points: newPoints },
      });
      if (updated.count !== 1) {
        return { status: 409 as const, error: '积分已被其他操作修改，请刷新后重试' };
      }

      const actualDelta = newPoints - target.points;
      await tx.pointsLog.create({
        data: {
          userId,
          delta: actualDelta,
          type: 'admin_adjust',
          reason: reasonText,
          adminEmail,
        },
      });
      await writeAuditLog({ actorId: user.id, actorEmail: user.email, action: 'points.adjusted', resource: 'points', targetType: 'User', targetId: userId, before: { points: target.points }, after: { points: newPoints }, reason: reasonText }, tx);

      return { status: 200 as const, oldPoints: target.points, newPoints, delta: actualDelta, userEmail: target.email };
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
    console.error('[points/adjust]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
