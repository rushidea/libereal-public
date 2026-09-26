import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validatePointsDelta, validatePointsTarget } from '@/lib/points';
import { requireAdminPointsMutation } from '@/lib/admin-points-step-up';
import { writeAuditLog } from '@/lib/audit';

interface BatchRequest {
  emails: string[];
  mode: 'add' | 'subtract' | 'set';
  amount: number;
  reason: string;
  stepUpToken?: string;
}

interface ResultItem {
  email: string;
  userId?: string;
  userName?: string | null;
  oldPoints?: number;
  newPoints?: number;
  delta?: number;
  reason?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body: BatchRequest = await req.json();
    const user = await requireAdminPointsMutation(typeof body.stepUpToken === 'string' ? body.stepUpToken.trim() : undefined);
    if (user instanceof NextResponse) return user;
    const { emails, mode, amount, reason } = body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json({ error: 'emails 必填且非空' }, { status: 400 });
    }
    if (!['add', 'subtract', 'set'].includes(mode)) {
      return NextResponse.json({ error: 'mode 必须是 add/subtract/set' }, { status: 400 });
    }
    const amountValidation = mode === 'set' ? validatePointsTarget(amount) : validatePointsDelta(amount);
    if (!amountValidation.valid || (mode !== 'set' && amount <= 0)) {
      return NextResponse.json({ error: amountValidation.error || 'amount 参数无效' }, { status: 400 });
    }
    if (!reason || !reason.trim()) {
      return NextResponse.json({ error: '原因必填' }, { status: 400 });
    }

    const adminEmail = user.email || 'admin';
    const succeeded: ResultItem[] = [];
    const failed: ResultItem[] = [];

    for (const rawEmail of emails) {
      const email = rawEmail.trim();
      if (!email) continue;

      try {
        const result = await prisma.$transaction(async (tx) => {
          const target = await tx.user.findUnique({
            where: { email },
            select: { id: true, name: true, email: true, points: true },
          });
          if (!target) return { ok: false as const, reason: '用户不存在' };

          const newPoints = mode === 'set'
            ? amount
            : target.points + (mode === 'add' ? amount : -amount);
          if (newPoints < 0) {
            return { ok: false as const, reason: `积分不足（当前 ${target.points}，需扣除 ${amount}）` };
          }
          const balanceValidation = validatePointsTarget(newPoints);
          if (!balanceValidation.valid) {
            return { ok: false as const, reason: balanceValidation.error || '积分余额超出上限' };
          }
          if (newPoints === target.points) {
            return { ok: false as const, reason: '目标积分与当前积分相同' };
          }

          const updated = await tx.user.updateMany({
            where: { id: target.id, points: target.points },
            data: { points: newPoints },
          });
          if (updated.count !== 1) {
            return { ok: false as const, reason: '积分已被其他操作修改，请刷新后重试' };
          }

          const delta = newPoints - target.points;
          await tx.pointsLog.create({
            data: {
              userId: target.id,
              delta,
              type: 'admin_adjust',
              reason: reason.trim(),
              adminEmail,
            },
          });
          await writeAuditLog({ actorId: user.id, actorEmail: user.email, action: 'points.adjusted', resource: 'points', targetType: 'User', targetId: target.id, before: { points: target.points }, after: { points: newPoints }, reason: reason.trim(), metadata: { batch: true, mode } }, tx);
          return { ok: true as const, target, oldPoints: target.points, newPoints, delta };
        });
        if (!result.ok) {
          failed.push({ email, reason: result.reason });
          continue;
        }
        succeeded.push({
          email,
          userId: result.target.id,
          userName: result.target.name,
          oldPoints: result.oldPoints,
          newPoints: result.newPoints,
          delta: result.delta,
        });
      } catch {
        failed.push({ email, reason: '数据库写入失败' });
      }
    }

    return NextResponse.json({
      success: failed.length === 0,
      succeededCount: succeeded.length,
      failedCount: failed.length,
      succeeded,
      failed,
    });
  } catch (err) {
    console.error('[admin/points/adjust-batch POST]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
