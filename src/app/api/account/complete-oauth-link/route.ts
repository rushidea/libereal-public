import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  clearPendingOAuthLinkCookie,
  providerLabel,
  readPendingOAuthLinkCookie,
} from '@/lib/account-linking';
import { normalizeEmail } from '@/lib/auth-helpers';
import { linkPendingOAuthToUser } from '@/lib/oauth-account-link';

export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const pending = await readPendingOAuthLinkCookie();

    if (!pending || pending.mode !== 'register') {
      return NextResponse.json({ skipped: true, reason: 'no_pending_oauth' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    if (pending.provider === 'google' && pending.oauthEmail) {
      const oauthEmail = normalizeEmail(pending.oauthEmail);
      if (normalizeEmail(user.email) !== oauthEmail) {
        return NextResponse.json({
          skipped: true,
          reason: 'email_mismatch',
          error: '注册邮箱与 Google 账号邮箱不一致，请在账户设置中手动绑定',
        });
      }
    }

    const linked = await linkPendingOAuthToUser(pending, user.id);
    if (!linked.ok) {
      return NextResponse.json({ error: linked.error }, { status: 409 });
    }

    await clearPendingOAuthLinkCookie();

    return NextResponse.json({
      ok: true,
      provider: pending.provider,
      providerLabel: providerLabel(pending.provider),
      message: `${providerLabel(pending.provider)} 账号已绑定`,
    });
  } catch (err) {
    console.error('[account/complete-oauth-link]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
