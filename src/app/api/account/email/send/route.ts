import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import { isDeliverableEmail, isPlaceholderOAuthEmail, normalizeEmail } from '@/lib/auth-helpers';
import { sendAccountEmailCode } from '@/lib/email-verification';
import { rateLimitAsync } from '@/lib/rateLimit';
import { findUserByEmailCaseInsensitive } from '@/lib/user-lookup';

export async function POST(req: NextRequest) {
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;

  try {
    const body = await req.json().catch(() => ({})) as { email?: string };
    const requested = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const user = await prisma.user.findUnique({
      where: { id: activeUser.id },
      select: { email: true, emailVerified: true },
    });
    if (!user) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

    const placeholder = isPlaceholderOAuthEmail(user.email);
    let target = '';
    if (placeholder) {
      if (!isDeliverableEmail(requested)) {
        return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
      }
      target = requested;
      const existing = await findUserByEmailCaseInsensitive(target);
      if (existing && existing.id !== activeUser.id) {
        return NextResponse.json({ error: '该邮箱已被其他账户使用' }, { status: 409 });
      }
    } else if (!user.emailVerified) {
      target = normalizeEmail(user.email);
      if (!isDeliverableEmail(target)) {
        return NextResponse.json({ error: '请输入有效的邮箱地址' }, { status: 400 });
      }
      if (requested && requested !== target) {
        return NextResponse.json({ error: '无法更改已绑定的邮箱' }, { status: 400 });
      }
    } else {
      return NextResponse.json({ error: '邮箱已验证' }, { status: 400 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
      ?? req.headers.get('x-real-ip') ?? 'unknown';
    const limited = await rateLimitAsync(`account-email:${ip}:${activeUser.id}:${target}`);
    if (!limited.allowed) {
      return NextResponse.json({ error: '请求次数过多，请稍后重试' }, { status: 429 });
    }

    const result = await sendAccountEmailCode(target);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[account/email/send]', error);
    return NextResponse.json({ error: '邮箱验证码发送失败，请稍后重试' }, { status: 500 });
  }
}
