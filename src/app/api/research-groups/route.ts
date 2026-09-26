import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getUserPointsBalance } from '@/lib/points-checkout-service';

/** 用户提交创建课题组申请（pending，待管理员审核；一人仅可属于一个课题组） */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 });
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 80) {
    return NextResponse.json({ error: '请填写有效的课题组名称' }, { status: 400 });
  }

  const existing = await prisma.researchGroupMember.findUnique({
    where: { userId: session.user.id as string },
  });
  if (existing) {
    return NextResponse.json({ error: '已加入课题组或已有待审核申请，一人仅可属于一个课题组' }, { status: 409 });
  }

  const group = await prisma.$transaction(async (tx) => {
    return tx.researchGroup.create({
      data: {
        name,
        status: 'pending',
        locked: false,
        members: {
          create: {
            userId: session.user!.id as string,
            role: 'owner',
          },
        },
      },
      select: { id: true, name: true, points: true, status: true, locked: true },
    });
  });

  return NextResponse.json(group, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const balance = await getUserPointsBalance(prisma, session.user.id as string);
  if (!balance) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  return NextResponse.json({ group: balance.group });
}

/**
 * 课题组 owner 按邮箱邀请成员。
 * 仅已审核通过（active）的课题组可添加；锁定后仍可由负责人邀请。
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) {
    return NextResponse.json({ error: '请填写成员邮箱' }, { status: 400 });
  }

  const membership = await prisma.researchGroupMember.findUnique({
    where: { userId: session.user.id as string },
    select: {
      groupId: true,
      role: true,
      group: { select: { status: true, locked: true } },
    },
  });
  if (!membership || membership.role !== 'owner') {
    return NextResponse.json({ error: '仅课题组负责人可添加成员' }, { status: 403 });
  }
  if (membership.group.status === 'pending') {
    return NextResponse.json({ error: '课题组待管理员审核通过后方可添加成员' }, { status: 409 });
  }
  if (membership.group.status !== 'active') {
    return NextResponse.json({ error: '课题组当前不可添加成员' }, { status: 409 });
  }

  const invitee = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true },
  });
  if (!invitee) {
    return NextResponse.json({ error: '未找到该邮箱对应账号' }, { status: 404 });
  }
  if (invitee.id === session.user.id) {
    return NextResponse.json({ error: '不能添加自己' }, { status: 400 });
  }

  const existing = await prisma.researchGroupMember.findUnique({
    where: { userId: invitee.id },
  });
  if (existing) {
    return NextResponse.json({ error: '该用户已加入其他课题组' }, { status: 409 });
  }

  const member = await prisma.researchGroupMember.create({
    data: {
      groupId: membership.groupId,
      userId: invitee.id,
      role: 'member',
    },
    select: { id: true, role: true, user: { select: { id: true, email: true, name: true } } },
  });

  return NextResponse.json({ member });
}

/** 课题组负责人移除成员；负责人自身不可被移除。 */
export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { memberId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 });
  }

  const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : '';
  if (!memberId) {
    return NextResponse.json({ error: '缺少成员信息' }, { status: 400 });
  }

  const membership = await prisma.researchGroupMember.findUnique({
    where: { userId: session.user.id as string },
    select: {
      groupId: true,
      role: true,
      group: { select: { status: true } },
    },
  });
  if (!membership || membership.role !== 'owner') {
    return NextResponse.json({ error: '仅课题组负责人可移除成员' }, { status: 403 });
  }
  if (membership.group.status !== 'active') {
    return NextResponse.json({ error: '课题组当前不可管理成员' }, { status: 409 });
  }

  const target = await prisma.researchGroupMember.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      groupId: true,
      role: true,
      user: { select: { email: true, name: true } },
    },
  });
  if (!target || target.groupId !== membership.groupId) {
    return NextResponse.json({ error: '未找到该课题组成员' }, { status: 404 });
  }
  if (target.role === 'owner') {
    return NextResponse.json({ error: '课题组负责人不可移除' }, { status: 400 });
  }

  await prisma.researchGroupMember.delete({ where: { id: target.id } });

  return NextResponse.json({
    ok: true,
    member: {
      id: target.id,
      email: target.user.email,
      name: target.user.name,
    },
  });
}
