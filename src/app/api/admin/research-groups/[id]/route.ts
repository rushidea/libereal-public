import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let body: { action?: string; name?: string; email?: string; userId?: string; status?: string; stepUpToken?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求内容格式无效' }, { status: 400 });
  }
  const stepUpToken = typeof body.stepUpToken === 'string' ? body.stepUpToken.trim() : undefined;
  const admin = await requireAdmin('points.write', { token: stepUpToken, action: 'admin_sensitive' });
  if (admin instanceof NextResponse) return admin;
  if (stepUpToken && (!admin.sessionId || !(await consumeSecurityStepUpGrant(stepUpToken, { userId: admin.id, sessionId: admin.sessionId, action: 'admin_sensitive' })))) {
    return NextResponse.json({ error: '安全验证已失效，请重新验证' }, { status: 403 });
  }

  const { id } = await params;

  const group = await prisma.researchGroup.findUnique({ where: { id } });
  if (!group) return NextResponse.json({ error: '课题组不存在' }, { status: 404 });

  /** 审核通过：active + locked */
  if (body.action === 'approve') {
    if (group.status !== 'pending') {
      return NextResponse.json({ error: '仅待审核课题组可通过' }, { status: 409 });
    }
    const now = new Date();
    const updated = await prisma.researchGroup.update({
      where: { id },
      data: {
        status: 'active',
        locked: true,
        lockedAt: now,
        reviewedAt: now,
        reviewedByEmail: admin.email || 'admin',
      },
      select: {
        id: true,
        name: true,
        points: true,
        status: true,
        locked: true,
        lockedAt: true,
        reviewedAt: true,
        reviewedByEmail: true,
      },
    });
    return NextResponse.json(updated);
  }

  /** 审核不通过：丢弃（删除课题组及成员关系） */
  if (body.action === 'reject') {
    if (group.status !== 'pending') {
      return NextResponse.json({ error: '仅待审核课题组可拒绝' }, { status: 409 });
    }
    await prisma.researchGroup.delete({ where: { id } });
    return NextResponse.json({ ok: true, discarded: true });
  }

  if (body.action === 'rename') {
    if (group.locked) {
      return NextResponse.json({ error: '课题组已锁定，不可改名' }, { status: 409 });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 80) {
      return NextResponse.json({ error: '名称无效' }, { status: 400 });
    }
    const updated = await prisma.researchGroup.update({
      where: { id },
      data: { name },
      select: { id: true, name: true, points: true, status: true, locked: true },
    });
    return NextResponse.json(updated);
  }

  if (body.action === 'set_status') {
    if (group.status === 'pending') {
      return NextResponse.json({ error: '待审核课题组请使用通过或拒绝' }, { status: 409 });
    }
    const status = body.status === 'archived' ? 'archived' : 'active';
    const updated = await prisma.researchGroup.update({
      where: { id },
      data: { status },
      select: { id: true, name: true, points: true, status: true, locked: true },
    });
    return NextResponse.json(updated);
  }

  if (body.action === 'add_member') {
    if (group.status === 'pending') {
      return NextResponse.json({ error: '待审核课题组请先通过审核' }, { status: 409 });
    }
    if (group.status === 'archived') {
      return NextResponse.json({ error: '已归档课题组不可添加成员' }, { status: 409 });
    }

    let user: { id: string; email: string; name: string | null } | null = null;
    if (typeof body.userId === 'string' && body.userId.trim()) {
      user = await prisma.user.findUnique({
        where: { id: body.userId.trim() },
        select: { id: true, email: true, name: true },
      });
    } else if (typeof body.email === 'string' && body.email.trim()) {
      user = await prisma.user.findUnique({
        where: { email: body.email.trim().toLowerCase() },
        select: { id: true, email: true, name: true },
      });
    }
    if (!user) return NextResponse.json({ error: '请搜索并选择成员' }, { status: 400 });

    const existing = await prisma.researchGroupMember.findUnique({ where: { userId: user.id } });
    if (existing) {
      return NextResponse.json({ error: '该用户已加入其他课题组' }, { status: 409 });
    }

    const member = await prisma.researchGroupMember.create({
      data: { groupId: id, userId: user.id, role: 'member' },
      select: { id: true, role: true, user: { select: { id: true, email: true, name: true } } },
    });
    return NextResponse.json(member);
  }

  if (body.action === 'remove_member') {
    let userId = typeof body.userId === 'string' ? body.userId.trim() : '';
    if (!userId && typeof body.email === 'string' && body.email.trim()) {
      const byEmail = await prisma.user.findUnique({
        where: { email: body.email.trim().toLowerCase() },
        select: { id: true },
      });
      userId = byEmail?.id || '';
    }
    if (!userId) return NextResponse.json({ error: '请指定成员' }, { status: 400 });

    const membership = await prisma.researchGroupMember.findUnique({ where: { userId } });
    if (!membership || membership.groupId !== id) {
      return NextResponse.json({ error: '该用户不在此课题组' }, { status: 404 });
    }
    if (membership.role === 'owner') {
      return NextResponse.json({ error: '不能移除负责人，请先转让或归档' }, { status: 400 });
    }
    await prisma.researchGroupMember.delete({ where: { id: membership.id } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: '未知操作' }, { status: 400 });
}
