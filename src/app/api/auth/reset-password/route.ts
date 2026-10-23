import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { validateNewPasswordLength } from '@/lib/password-policy';
import { revokeAllSecuritySessions } from '@/lib/security/security-session-service';

class ResetTokenConsumedError extends Error {
  constructor() {
    super('RESET_TOKEN_CONSUMED');
    this.name = 'ResetTokenConsumedError';
  }
}

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();

    if (!token || password === undefined || password === null || password === '') {
      return NextResponse.json({ error: '缺少必填参数' }, { status: 400 });
    }
    if (typeof password !== 'string') {
      return NextResponse.json({ error: '缺少必填参数' }, { status: 400 });
    }
    const passwordLengthError = validateNewPasswordLength(password);
    if (passwordLengthError) {
      return NextResponse.json({ error: passwordLengthError }, { status: 400 });
    }

    const user = await prisma.user.findFirst({
      where: {
        resetToken: token,
        resetTokenExpiry: { gt: new Date() },
      },
      select: { id: true, email: true },
    });

    if (!user) {
      return NextResponse.json({ error: '重置链接已失效或不存在，请重新申请' }, { status: 400 });
    }

    const hash = await bcrypt.hash(password, 12);
    try {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.user.updateMany({
          where: {
            id: user.id,
            resetToken: token,
            resetTokenExpiry: { gt: new Date() },
          },
          data: { password: hash, resetToken: null, resetTokenExpiry: null },
        });
        if (updated.count !== 1) throw new ResetTokenConsumedError();
        // Same transaction as the password write. A revoke failure rolls the
        // password change back instead of leaving stolen sessions signed in.
        await revokeAllSecuritySessions(user.id, tx);
      });
    } catch (err) {
      if (err instanceof ResetTokenConsumedError) {
        return NextResponse.json({ error: '重置链接已失效或不存在，请重新申请' }, { status: 400 });
      }
      throw err;
    }

    return NextResponse.json({ message: '密码重置成功，请使用新密码登录' });
  } catch (err) {
    console.error('[reset-password]', err);
    return NextResponse.json({ error: '服务器错误，请重试' }, { status: 500 });
  }
}
