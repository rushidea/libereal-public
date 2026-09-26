import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';

export async function PUT(req: NextRequest) {
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  const userId = activeUser.id;

  try {
    const { currentPassword, newPassword, stepUpToken } = await req.json();

    if (!currentPassword || !newPassword || !stepUpToken) {
      return NextResponse.json({ error: '请填写密码和安全验证信息' }, { status: 400 });
    }

    if (newPassword.length < 6) {
      return NextResponse.json({ error: '新密码长度至少为 6 位' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true, phone: true, phoneVerifiedAt: true },
    });

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    if (!user.password) {
      return NextResponse.json({ error: '账户未设置密码，请使用设置密码功能' }, { status: 400 });
    }

    const sessionId = activeUser.sessionId ?? '';
    if (!sessionId || !(await consumeSecurityStepUpGrant(String(stepUpToken), { userId, sessionId, action: 'password_change' }))) {
      return NextResponse.json({ error: '安全验证已失效，请重新验证' }, { status: 403 });
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return NextResponse.json({ error: '当前密码错误' }, { status: 400 });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { password: hash },
    });

    return NextResponse.json({ message: '密码更新成功' });
  } catch (err) {
    console.error('[profile/password]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
