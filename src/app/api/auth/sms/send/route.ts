import { NextRequest, NextResponse } from 'next/server';
import { sendAliyunSmsCode, type AliyunSmsPurpose } from '@/lib/aliyun-sms';
import {
  generateSmsCode,
  normalizeChinaMobilePhone,
  storeSmsVerificationCode,
} from '@/lib/sms-verification';
import { rateLimitAsync } from '@/lib/rateLimit';
import { reportError } from '@/lib/errorReporting';
import { smsDailyLimitAsync } from '@/lib/sms-daily-limit';
import { prisma } from '@/lib/prisma';

type SmsPurpose = AliyunSmsPurpose;

function normalizePurpose(value: unknown): SmsPurpose {
  return value === 'phone-change' || value === 'reset-password' || value === 'security'
    ? value
    : 'register';
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip') ?? 'unknown';

  try {
    const { phone, purpose: rawPurpose, email } = await req.json();
    const purpose = normalizePurpose(rawPurpose);
    const normalizedPhone = normalizeChinaMobilePhone(String(phone ?? ''));
    if (!normalizedPhone) {
      return NextResponse.json({ error: '请输入有效的中国大陆手机号' }, { status: 400 });
    }

    const [ipLimit, phoneLimit] = await Promise.all([
      rateLimitAsync(`sms:${ip}`),
      rateLimitAsync(`sms:${normalizedPhone}`),
    ]);
    if (!ipLimit.allowed || !phoneLimit.allowed) {
      const resetIn = Math.max(ipLimit.resetIn, phoneLimit.resetIn);
      return NextResponse.json(
        { error: '验证码发送过于频繁，请稍后再试。', retryAfter: Math.ceil(resetIn / 1000) },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(resetIn / 1000)) } },
      );
    }

    if (purpose !== 'register') {
      const daily = await smsDailyLimitAsync(`${purpose}:${normalizedPhone}`);
      if (!daily.allowed) {
        return NextResponse.json(
          { error: '安全验证码今天已发送 3 次，请明天再试。', retryAfter: Math.ceil(daily.resetIn / 1000) },
          { status: 429, headers: { 'Retry-After': String(Math.ceil(daily.resetIn / 1000)) } },
        );
      }
    }

    if (purpose === 'reset-password') {
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const users = await prisma.user.findMany({
        where: normalizedEmail
          ? { email: normalizedEmail, phone: normalizedPhone, phoneVerifiedAt: { not: null } }
          : { phone: normalizedPhone, phoneVerifiedAt: { not: null } },
        select: { id: true },
        take: 2,
      });
      if (users.length !== 1) {
        return NextResponse.json({ ok: true });
      }
    } else if (purpose === 'security') {
      const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (normalizedEmail) {
        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
          select: { phone: true, phoneVerifiedAt: true },
        });
        if (!user || user.phone !== normalizedPhone || !user.phoneVerifiedAt) {
          return NextResponse.json({ ok: true });
        }
      }
    }

    const code = generateSmsCode();
    await sendAliyunSmsCode(normalizedPhone, code, purpose);
    await storeSmsVerificationCode(normalizedPhone, code, purpose);

    return NextResponse.json({ ok: true });
  } catch (err) {
    reportError(err, { tags: { route: 'auth.sms.send' } });
    const message = err instanceof Error ? err.message : '';
    if (message === 'ALIYUN_SMS_NOT_CONFIGURED') {
      return NextResponse.json({ error: '短信服务未配置，请联系管理员' }, { status: 503 });
    }
    return NextResponse.json({ error: '验证码发送失败，请稍后重试' }, { status: 502 });
  }
}
