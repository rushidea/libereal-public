import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdminPointsMutation } from '@/lib/admin-points-step-up';
import { injectGroupPoints, injectPersonalPoints } from '@/lib/points-checkout-service';
import { validatePointsDelta, validatePointsTarget } from '@/lib/points';
import { writeAuditLog } from '@/lib/audit';

export async function POST(req: NextRequest) {
  let body: {
    targetType?: string;
    userId?: string;
    groupId?: string;
    points?: number;
    reason?: string;
    stepUpToken?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 });
  }

  const user = await requireAdminPointsMutation(typeof body.stepUpToken === 'string' ? body.stepUpToken.trim() : undefined);
  if (user instanceof NextResponse) return user;

  const points = Number(body.points);
  const check = validatePointsDelta(points);
  if (!check.valid) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }
  if (points <= 0) {
    return NextResponse.json({ error: '注入积分必须为正数' }, { status: 400 });
  }

  const adminEmail = user.email || 'admin';

  try {
    if (body.targetType === 'personal') {
      if (!body.userId) {
        return NextResponse.json({ error: '缺少 userId' }, { status: 400 });
      }
      const result = await prisma.$transaction(async (tx) => {
        const target = await tx.user.findUnique({ where: { id: body.userId! }, select: { id: true, points: true } });
        if (!target) return { status: 404 as const, error: '用户不存在' };
        const targetPoints = target.points + points;
        const targetCheck = validatePointsTarget(targetPoints);
        if (!targetCheck.valid) return { status: 400 as const, error: targetCheck.error };
        const injected = await injectPersonalPoints(tx, {
          userId: body.userId!,
          points,
          adminEmail,
          reason: body.reason,
        });
        if (injected === false) return { status: 409 as const, error: '积分余额已被其他操作修改，请刷新后重试' };
        await writeAuditLog({
          actorId: user.id,
          actorEmail: user.email,
          action: 'points.injected',
          resource: 'points',
          targetType: 'User',
          targetId: target.id,
          before: { points: target.points },
          after: { points: targetPoints },
          reason: body.reason?.trim() || '管理员注入积分',
          metadata: { targetType: 'personal', points },
        }, tx);
        return { status: 200 as const };
      });
      if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, targetType: 'personal', points });
    }

    if (body.targetType === 'group') {
      if (!body.groupId) {
        return NextResponse.json({ error: '缺少 groupId' }, { status: 400 });
      }
      const result = await prisma.$transaction(async (tx) => {
        const target = await tx.researchGroup.findUnique({ where: { id: body.groupId! }, select: { id: true, points: true } });
        if (!target) return { status: 404 as const, error: '课题组不存在' };
        const targetPoints = target.points + points;
        const targetCheck = validatePointsTarget(targetPoints);
        if (!targetCheck.valid) return { status: 400 as const, error: targetCheck.error };
        const injected = await injectGroupPoints(tx, {
          groupId: body.groupId!,
          points,
          adminEmail,
          reason: body.reason,
        });
        if (injected === false) return { status: 409 as const, error: '积分余额已被其他操作修改，请刷新后重试' };
        await writeAuditLog({
          actorId: user.id,
          actorEmail: user.email,
          action: 'points.injected',
          resource: 'points',
          targetType: 'ResearchGroup',
          targetId: target.id,
          before: { points: target.points },
          after: { points: targetPoints },
          reason: body.reason?.trim() || '管理员注入课题组积分',
          metadata: { targetType: 'group', points },
        }, tx);
        return { status: 200 as const };
      });
      if (result.status !== 200) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ ok: true, targetType: 'group', points });
    }

    return NextResponse.json({ error: 'targetType 须为 personal 或 group' }, { status: 400 });
  } catch (error) {
    console.error('[admin/points/inject]', error);
    return NextResponse.json({ error: '注入失败' }, { status: 500 });
  }
}
