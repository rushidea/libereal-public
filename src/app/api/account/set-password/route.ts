import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import {
  isPlaceholderOAuthEmail,
  normalizeEmail,
  userHasPassword,
} from '@/lib/auth-helpers';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';

export async function POST(req: NextRequest) {
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  const userId = activeUser.id;

  try {
    const body = await req.json();
    const { email: rawEmail, password, confirmPassword, stepUpToken } = body as {
      email?: string;
      password?: string;
      confirmPassword?: string;
      stepUpToken?: string;
    };

    if (!password || !confirmPassword || !stepUpToken) {
      return NextResponse.json({ error: '请填写密码和安全验证信息' }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: '两次输入的密码不一致' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: '密码至少 8 个字符' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, password: true, phone: true, phoneVerifiedAt: true },
    });

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    if (userHasPassword(user.password)) {
      return NextResponse.json({ error: '账户已设置密码，请使用修改密码功能' }, { status: 409 });
    }

    const sessionId = activeUser.sessionId ?? '';
    if (!sessionId || !(await consumeSecurityStepUpGrant(String(stepUpToken), { userId, sessionId, action: 'password_setup' }))) {
      return NextResponse.json({ error: '安全验证已失效，请重新验证' }, { status: 403 });
    }

    const placeholderEmail = isPlaceholderOAuthEmail(user.email);
    let targetEmail = normalizeEmail(user.email);

    if (placeholderEmail) {
      if (!rawEmail) {
        return NextResponse.json({ error: '请填写邮箱' }, { status: 400 });
      }
      targetEmail = normalizeEmail(rawEmail);

      const existing = await prisma.user.findFirst({
        where: {
          email: targetEmail,
          NOT: { id: userId },
        },
        select: { id: true },
      });

      if (existing) {
        return NextResponse.json({ error: '该邮箱已被其他账户使用' }, { status: 409 });
      }
    } else if (rawEmail && normalizeEmail(rawEmail) !== targetEmail) {
      return NextResponse.json({ error: '无法更改已绑定的邮箱' }, { status: 400 });
    }

    const hash = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: userId },
      data: {
        email: targetEmail,
        password: hash,
      },
    });

    return NextResponse.json({
      ok: true,
      email: targetEmail,
      message: '邮箱与密码设置成功，请使用新邮箱和密码登录',
    });
  } catch (err) {
    console.error('[account/set-password]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
