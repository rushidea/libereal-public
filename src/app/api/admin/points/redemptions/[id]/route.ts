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

    const existing = await prisma.pointsRedemption.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: '兑换记录不存在' }, { status: 404 });
    }

    const updateData: Prisma.PointsRedemptionUpdateInput = {};
    if (status !== undefined) {
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json({ error: `无效的状态，必须是 ${VALID_STATUSES.join(', ')}` }, { status: 400 });
      }
      updateData.status = status;
    }
    if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber || null;
    if (adminNote !== undefined) updateData.adminNote = adminNote || null;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '没有要更新的字段' }, { status: 400 });
    }

    await prisma.pointsRedemption.update({ where: { id }, data: updateData });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/points/redemptions PATCH]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
