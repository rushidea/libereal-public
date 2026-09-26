import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('points.read');
  if (admin instanceof NextResponse) return admin;

  const { id } = await params;
  const group = await prisma.researchGroup.findUnique({
    where: { id },
    select: { id: true, name: true },
  });
  if (!group) return NextResponse.json({ error: '课题组不存在' }, { status: 404 });

  const logs = await prisma.groupPointsLog.findMany({
    where: { groupId: id },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: {
      id: true,
      delta: true,
      type: true,
      reason: true,
      relatedId: true,
      adminEmail: true,
      createdAt: true,
      actor: { select: { email: true, name: true } },
    },
  });

  return NextResponse.json({
    group,
    logs: logs.map(({ actor, ...log }) => ({
      ...log,
      actorName: actor?.name ?? actor?.email ?? null,
    })),
  });
}
