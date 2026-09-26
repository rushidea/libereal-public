import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  createAccountLinkIntent,
  linkSuccessParam,
  setAccountLinkIntentCookie,
  type LinkProvider,
} from '@/lib/account-linking';

const VALID_PROVIDERS = new Set<LinkProvider>(['google', 'wechat']);

function resolveCallbackUrl(provider: LinkProvider, source?: string): string {
  if (source === 'register') {
    return `/register/link?${linkSuccessParam(provider)}`;
  }
  return `/account/settings?${linkSuccessParam(provider)}`;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  try {
    const { provider, source } = await req.json() as { provider?: string; source?: string };

    if (!provider || !VALID_PROVIDERS.has(provider as LinkProvider)) {
      return NextResponse.json({ error: '无效的登录方式' }, { status: 400 });
    }

    const linked = await prisma.account.findFirst({
      where: { userId, provider },
      select: { id: true },
    });

    if (linked) {
      return NextResponse.json({ error: '该登录方式已绑定' }, { status: 409 });
    }

    await setAccountLinkIntentCookie(createAccountLinkIntent(userId, provider as LinkProvider));

    const callbackUrl = resolveCallbackUrl(provider as LinkProvider, source);

    return NextResponse.json({ ok: true, provider, callbackUrl });
  } catch (err) {
    console.error('[account/link-provider]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
