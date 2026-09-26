import { NextRequest, NextResponse } from 'next/server';
import { rateLimitAsync } from '@/lib/rateLimit';
import { sendRegistrationEmailCode } from '@/lib/email-verification';
import { normalizeEmail } from '@/lib/auth-helpers';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const { email: rawEmail } = await req.json() as { email?: string };
    const email = rawEmail ? normalizeEmail(rawEmail) : '';
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      ?? req.headers.get('x-real-ip') ?? 'unknown';

    if (!EMAIL_PATTERN.test(email)) {
      return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
    }

    const limited = await rateLimitAsync(`register-email:${ip}:${email}`);
    if (!limited.allowed) {
      return NextResponse.json({ error: '请求次数过多，请稍后重试' }, { status: 429 });
    }

    const result = await sendRegistrationEmailCode(email);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[auth/email/send]', error);
    return NextResponse.json({ error: '邮箱验证码发送失败，请稍后重试' }, { status: 500 });
  }
}
