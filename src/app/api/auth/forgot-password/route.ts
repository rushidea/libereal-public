import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetEmail } from '@/lib/mail';
import crypto from 'crypto';
import { normalizeChinaMobilePhone, verifySmsCode } from '@/lib/sms-verification';

const EMAIL_RESET_EXPIRY_MS = 24 * 60 * 60 * 1000;
const PHONE_RESET_EXPIRY_MS = 10 * 60 * 1000;
const EMAIL_RESET_MESSAGE = '如果该邮箱已注册，重置链接已发送至您的邮箱';

function createResetToken() {
  return crypto.randomBytes(32).toString('hex');
}

export async function POST(req: NextRequest) {
  try {
    const { method, email: rawEmail, phone: rawPhone, smsCode } = await req.json();
    const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
    const phone = normalizeChinaMobilePhone(String(rawPhone ?? ''));

    if (method === 'email') {
      if (!email || !email.includes('@')) {
        return NextResponse.json({ error: '请提供有效的邮箱地址' }, { status: 400 });
      }

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return NextResponse.json({ message: EMAIL_RESET_MESSAGE });
      }

      const resetToken = createResetToken();
      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken, resetTokenExpiry: new Date(Date.now() + EMAIL_RESET_EXPIRY_MS) },
      });

      const mailResult = await sendPasswordResetEmail(email, resetToken);
      if (!mailResult.ok) {
        console.warn('[forgot-password] reset email was not sent', mailResult);
      }

      return NextResponse.json({ message: EMAIL_RESET_MESSAGE });
    }

    if (method === 'phone') {
      if (!phone || !smsCode) {
        return NextResponse.json({ error: '请完成手机号短信验证' }, { status: 400 });
      }

      const users = await prisma.user.findMany({
        where: { phone, phoneVerifiedAt: { not: null } },
        select: { id: true },
        take: 2,
      });
      if (users.length !== 1) {
        return NextResponse.json({ error: '短信验证码错误或已过期' }, { status: 400 });
      }

      const smsVerified = await verifySmsCode(phone, String(smsCode), 'reset-password');
      if (!smsVerified) {
        return NextResponse.json({ error: '短信验证码错误或已过期' }, { status: 400 });
      }

      const resetToken = createResetToken();
      await prisma.user.update({
        where: { id: users[0].id },
        data: { resetToken, resetTokenExpiry: new Date(Date.now() + PHONE_RESET_EXPIRY_MS) },
      });

      return NextResponse.json({
        message: '手机号验证成功，请设置新密码',
        resetToken,
      });
    }

    return NextResponse.json({ error: '请选择找回方式' }, { status: 400 });
  } catch (err) {
    console.error('[forgot-password]', err);
    return NextResponse.json({ error: '服务器错误，请重试' }, { status: 500 });
  }
}
