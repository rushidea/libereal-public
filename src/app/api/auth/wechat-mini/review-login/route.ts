import { NextRequest, NextResponse } from 'next/server';
import { rateLimitAsync } from '@/lib/rateLimit';

type ReviewLoginPayload = {
  username?: string;
  password?: string;
};

function getReviewCredentials() {
  const username = process.env.WECHAT_MINI_REVIEW_USERNAME?.trim();
  const password = process.env.WECHAT_MINI_REVIEW_PASSWORD?.trim();
  return username && password ? { username, password } : null;
}

function isReviewModeEnabled() {
  return process.env.WECHAT_MINI_REVIEW_MODE === '1';
}

function requestIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown';
}

export async function POST(req: NextRequest) {
  try {
    if (!isReviewModeEnabled()) {
      return NextResponse.json({ error: '登录入口已关闭' }, { status: 403 });
    }

    const limited = await rateLimitAsync(`wechat-mini-review:${requestIp(req)}`);
    if (!limited.allowed) {
      return NextResponse.json({ error: '请求次数过多，请稍后重试' }, { status: 429 });
    }

    const payload = (await req.json()) as ReviewLoginPayload;
    const username = payload.username?.trim() || '';
    const password = payload.password?.trim() || '';
    const expected = getReviewCredentials();
    if (!expected) {
      return NextResponse.json({ error: '评审登录尚未配置' }, { status: 503 });
    }

    if (!username || !password) {
      return NextResponse.json({ error: '请输入邮箱和密码' }, { status: 400 });
    }

    if (username !== expected.username || password !== expected.password) {
      return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      displayName: 'LIBEREAL 用户',
      message: '账号验证成功，正在继续微信授权。',
    });
  } catch (error) {
    console.error('[wechat-mini/review-login]', error);
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
  }
}
