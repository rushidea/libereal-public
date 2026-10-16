import { NextResponse } from 'next/server';
import {
  createWechatMiniBrowserSecret,
  createWechatMiniLoginChallenge,
  generateWechatMiniScheme,
  getPublicWeChatMiniAppId,
  getWechatMiniBrowserSecretCookieName,
  hashWechatMiniBrowserSecret,
  wechatMiniBrowserSecretCookieOptions,
} from '@/lib/wechat-mini-auth';

function getWechatMiniSchemeDisplayError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('85079') || message.includes('no online release')) {
    return '小程序还没有线上发布版本，请先在微信后台提交并发布小程序。';
  }
  if (message.includes('WECHAT_MINI_NOT_CONFIGURED')) {
    return '小程序登录还没有完成服务端配置。';
  }
  return '小程序直达链接暂不可用，请复制参数后在小程序里粘贴。';
}

export async function POST() {
  try {
    const browserSecret = createWechatMiniBrowserSecret();
    const challenge = await createWechatMiniLoginChallenge(hashWechatMiniBrowserSecret(browserSecret));
    const appId = getPublicWeChatMiniAppId();
    let scheme: string | null = null;
    let schemeError: string | null = null;

    try {
      scheme = await generateWechatMiniScheme(challenge.id, challenge.expiresAt);
    } catch (error) {
      schemeError = getWechatMiniSchemeDisplayError(error);
      console.error('[wechat-mini/challenge.scheme]', error);
    }

    const response = NextResponse.json({
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt.toISOString(),
      miniProgram: {
        appId: appId || null,
        path: 'pages/login/index',
        query: `challengeId=${challenge.id}`,
        scheme,
        schemeError,
      },
    });
    response.cookies.set(
      getWechatMiniBrowserSecretCookieName(challenge.id),
      browserSecret,
      wechatMiniBrowserSecretCookieOptions(),
    );
    return response;
  } catch (error) {
    console.error('[wechat-mini/challenge]', error);
    return NextResponse.json({ error: '无法创建微信小程序登录请求' }, { status: 500 });
  }
}
