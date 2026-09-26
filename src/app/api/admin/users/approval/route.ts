import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const user = await requireAdmin('customers.write');
  if (user instanceof NextResponse) return user;

  try {
    const { userId, action } = await req.json();
    if (!userId || !action) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, approvalStatus: true, isNewUser: true },
    });
    if (!dbUser) {
      return NextResponse.json({ error: "用户不存在" }, { status: 404 });
    }

    if (action === 'approve') {
      await prisma.user.update({
        where: { id: userId },
        data: { approvalStatus: 'approved', isNewUser: false },
      });
    } else if (action === 'reject') {
      await prisma.user.update({
        where: { id: userId },
        data: { approvalStatus: 'rejected' },
      });
    } else {
      return NextResponse.json({ error: "无效操作" }, { status: 400 });
    }

    // Notify user of approval result
    if (action === 'approve') {
      await prisma.notification.create({
        data: {
          email: dbUser.email,
          role: 'customer',
          type: 'order_status_changed',
          title: '账号审核通过',
          content: '您的账号已审核通过，可以正常下单了',
          linkUrl: '/account',
          metadata: JSON.stringify({ userId }),
        },
      });
    } else if (action === 'reject') {
      await prisma.notification.create({
        data: {
          email: dbUser.email,
          role: 'customer',
          type: 'order_status_changed',
          title: '账号审核未通过',
          content: '您的账号审核未通过，请联系客服',
          linkUrl: '/contact',
          metadata: JSON.stringify({ userId }),
        },
      });
    }

    await writeAuditLog({ actorId: user.id, actorEmail: user.email, action: 'customer.approval_changed', resource: 'customers', targetType: 'User', targetId: userId, before: { approvalStatus: dbUser.approvalStatus, isNewUser: dbUser.isNewUser }, after: { approvalStatus: action === 'approve' ? 'approved' : 'rejected', isNewUser: action === 'approve' ? false : dbUser.isNewUser }, reason: action === 'approve' ? '审核通过' : '审核未通过' });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[admin/users/approval]", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
