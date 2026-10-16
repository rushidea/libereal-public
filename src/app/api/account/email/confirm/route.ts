import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import { isDeliverableEmail, isPlaceholderOAuthEmail, normalizeEmail } from '@/lib/auth-helpers';
import { consumeAccountEmailCode } from '@/lib/email-verification';

export async function POST(req: NextRequest) {
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;

  try {
    const body = await req.json().catch(() => ({})) as { emailCode?: string };
    const emailCode = typeof body.emailCode === 'string' ? body.emailCode.trim() : '';
    if (!/^\d{6}$/.test(emailCode)) {
      return NextResponse.json({ error: '请先完成邮箱验证' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: activeUser.id },
      select: { email: true, emailVerified: true },
    });
    if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    if (isPlaceholderOAuthEmail(user.email)) {
      return NextResponse.json({ error: '请先验证并设置真实邮箱' }, { status: 400 });
    }
    if (user.emailVerified) {
      return NextResponse.json({ error: '邮箱已验证' }, { status: 400 });
    }
    const email = normalizeEmail(user.email);
    if (!isDeliverableEmail(email)) {
      return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
    }

    const owned = await consumeAccountEmailCode(email, emailCode);
    if (!owned) {
      return NextResponse.json({ error: '邮箱验证码错误或已过期' }, { status: 400 });
    }

    await prisma.user.update({
      where: { id: activeUser.id },
      data: { emailVerified: new Date() },
    });
    return NextResponse.json({ ok: true, email, message: '邮箱验证成功' });
  } catch (error) {
    console.error('[account/email/confirm]', error);
    return NextResponse.json({ error: '邮箱验证失败，请稍后重试' }, { status: 500 });
  }
}
