import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

export async function GET() {
  const admin = await requireAdmin('points.read');
  if (admin instanceof NextResponse) return admin;

  const groups = await prisma.researchGroup.findMany({
    orderBy: [
      { status: 'asc' },
      { updatedAt: 'desc' },
    ],
    include: {
      members: {
        select: {
          id: true,
          role: true,
          createdAt: true,
          user: { select: { id: true, email: true, name: true } },
        },
      },
      _count: { select: { pointsLogs: true } },
    },
  });

  return NextResponse.json({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      points: g.points,
      status: g.status,
      locked: g.locked,
      lockedAt: g.lockedAt,
      reviewedAt: g.reviewedAt,
      reviewedByEmail: g.reviewedByEmail,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
      memberCount: g.members.length,
      members: g.members,
      logCount: g._count.pointsLogs,
    })),
  });
}

/** 管理员创建课题组：立即 active + locked；仅纳入负责人，成员事后搜索添加 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin('points.write');
  if (admin instanceof NextResponse) return admin;

  let body: { name?: string; ownerUserId?: string; ownerEmail?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) {
    return NextResponse.json({ error: '请填写有效的课题组名称' }, { status: 400 });
  }

  let owner: { id: string; email: string } | null = null;
  if (typeof body.ownerUserId === 'string' && body.ownerUserId.trim()) {
    owner = await prisma.user.findUnique({
      where: { id: body.ownerUserId.trim() },
      select: { id: true, email: true },
    });
  } else if (typeof body.ownerEmail === 'string' && body.ownerEmail.trim()) {
    owner = await prisma.user.findUnique({
      where: { email: body.ownerEmail.trim().toLowerCase() },
      select: { id: true, email: true },
    });
  }

  if (!owner) {
    return NextResponse.json({ error: '请搜索并选择负责人' }, { status: 400 });
  }

  const existingOwner = await prisma.researchGroupMember.findUnique({ where: { userId: owner.id } });
  if (existingOwner) {
    return NextResponse.json({ error: '该负责人已加入其他课题组' }, { status: 409 });
  }

  const now = new Date();
  const group = await prisma.researchGroup.create({
    data: {
      name,
      status: 'active',
      locked: true,
      lockedAt: now,
      reviewedAt: now,
      reviewedByEmail: admin.email || 'admin',
      members: {
        create: [{ userId: owner.id, role: 'owner' }],
      },
    },
    select: {
      id: true,
      name: true,
      points: true,
      status: true,
      locked: true,
    },
  });

  return NextResponse.json(group, { status: 201 });
}
