import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import type { Prisma } from '@prisma/client';

const VALID_STATUSES = ['pending', 'shipped', 'completed', 'cancelled'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAdmin('points.write');
  if (user instanceof NextResponse) return user;

  try {
    const body = await req.json();
    const { status, trackingNumber, adminNote } = body;

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: `无效的状态，必须是 ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }

    const updateData: Prisma.PointsRedemptionUpdateInput = {};
    if (status !== undefined) updateData.status = status;
    if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber || null;
    if (adminNote !== undefined) updateData.adminNote = adminNote || null;
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '没有要更新的字段' }, { status: 400 });
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const existing = await tx.pointsRedemption.findUnique({
        where: { id },
        include: { user: { select: { email: true } } },
      });
      if (!existing) return { kind: 'missing' as const };
      if (existing.pointsReturned && status && status !== 'cancelled') {
        return { kind: 'locked' as const };
      }

      const returningPoints = status === 'cancelled' && !existing.pointsReturned;
      if (!returningPoints) {
        const updated = await tx.pointsRedemption.updateMany({
          where: { id, status: existing.status, pointsReturned: existing.pointsReturned },
          data: updateData,
        });
        if (updated.count !== 1) return { kind: 'conflict' as const };
        return { kind: 'ok' as const };
      }

      const claimed = await tx.pointsRedemption.updateMany({
        where: { id, status: existing.status, pointsReturned: false },
        data: {
          status: 'cancelled',
          pointsReturned: true,
          ...(trackingNumber !== undefined ? { trackingNumber: trackingNumber || null } : {}),
          ...(adminNote !== undefined ? { adminNote: adminNote || null } : {}),
        },
      });
      if (claimed.count !== 1) return { kind: 'conflict' as const };

      if (existing.pointsCost > 0) {
        await tx.user.update({
          where: { id: existing.userId },
          data: { points: { increment: existing.pointsCost } },
        });
        await tx.pointsLog.create({
          data: {
            userId: existing.userId,
            delta: existing.pointsCost,
            type: 'redemption_refund',
            reason: `取消兑换退回：${existing.productName}`,
            relatedId: existing.id,
          },
        });
      }
      await tx.pointsProduct.updateMany({
        where: { id: existing.productId, stock: { gte: 0 } },
        data: { stock: { increment: 1 } },
      });
      if (existing.user?.email) {
        await tx.notification.create({
          data: {
            email: existing.user.email,
            role: 'user',
            type: 'points_redemption_refund',
            title: '兑换已取消',
            content: `兑换「${existing.productName}」已取消，${existing.pointsCost} 积分已退回。`,
            linkUrl: '/account/points',
          },
        });
      }
      return { kind: 'ok' as const };
    });

    if (outcome.kind === 'missing') return NextResponse.json({ error: '兑换记录不存在' }, { status: 404 });
    if (outcome.kind === 'locked') {
      return NextResponse.json({ error: '已取消并退回积分的兑换不能改回其他状态' }, { status: 409 });
    }
    if (outcome.kind === 'conflict') {
      return NextResponse.json({ error: '兑换状态已改变，请刷新后重试' }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/points/redemptions PATCH]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
