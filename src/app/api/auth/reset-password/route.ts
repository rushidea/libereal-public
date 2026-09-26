import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const { token, password } = await req.json();

    if (!token || !password) {
      return NextResponse.json({ error: '缺少必填参数' }, { status: 400 });
    }
    if (password.length < 6) {
      return NextResponse.json({ error: '密码长度至少为 6 位' }, { status: 400 });
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
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hash, resetToken: null, resetTokenExpiry: null },
    });

    return NextResponse.json({ message: '密码重置成功，请使用新密码登录' });
  } catch (err) {
    console.error('[reset-password]', err);
    return NextResponse.json({ error: '服务器错误，请重试' }, { status: 500 });
  }
}
