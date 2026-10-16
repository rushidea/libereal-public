import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import {
  isDeliverableEmail,
  isPlaceholderOAuthEmail,
  normalizeEmail,
  userHasPassword,
} from '@/lib/auth-helpers';
import { consumeAccountEmailCode } from '@/lib/email-verification';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';
import { findUserByEmailCaseInsensitive } from '@/lib/user-lookup';
import { validateNewPasswordLength } from '@/lib/password-policy';

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export async function POST(req: NextRequest) {
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  const userId = activeUser.id;

  try {
    const body = await req.json();
    const { email: rawEmail, emailCode: rawEmailCode, password, confirmPassword, stepUpToken } = body as {
      email?: string;
      emailCode?: string;
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

    const passwordLengthError = validateNewPasswordLength(password);
    if (passwordLengthError) {
      return NextResponse.json({ error: passwordLengthError }, { status: 400 });
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

    const placeholderEmail = isPlaceholderOAuthEmail(user.email);
    let targetEmail = normalizeEmail(user.email);
    const emailCode = typeof rawEmailCode === 'string' ? rawEmailCode.trim() : '';

    if (placeholderEmail) {
      if (!isDeliverableEmail(rawEmail)) {
        return NextResponse.json({ error: '请填写有效的邮箱' }, { status: 400 });
      }
      targetEmail = normalizeEmail(rawEmail!);
      if (!/^\d{6}$/.test(emailCode)) {
        return NextResponse.json({ error: '请先完成新邮箱验证' }, { status: 400 });
      }

      const existing = await findUserByEmailCaseInsensitive(targetEmail);

      if (existing && existing.id !== userId) {
        return NextResponse.json({ error: '该邮箱已被其他账户使用' }, { status: 409 });
      }
    } else if (rawEmail && normalizeEmail(rawEmail) !== targetEmail) {
      return NextResponse.json({ error: '无法更改已绑定的邮箱' }, { status: 400 });
    }

    const sessionId = activeUser.sessionId ?? '';
    if (!sessionId || !(await consumeSecurityStepUpGrant(String(stepUpToken), { userId, sessionId, action: 'password_setup' }))) {
      return NextResponse.json({ error: '安全验证已失效，请重新验证' }, { status: 403 });
    }

    if (placeholderEmail) {
      const owned = await consumeAccountEmailCode(targetEmail, emailCode);
      if (!owned) {
        return NextResponse.json({ error: '邮箱验证码错误或已过期，请重新获取并再次确认身份' }, { status: 400 });
      }
    }

    const hash = await bcrypt.hash(password, 12);

    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          email: targetEmail,
          password: hash,
          ...(placeholderEmail ? { emailVerified: new Date() } : {}),
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return NextResponse.json({ error: '该邮箱已被其他账户使用' }, { status: 409 });
      }
      throw error;
    }

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
