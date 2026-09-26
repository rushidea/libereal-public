import { generateId } from './id';
import { prisma } from './prisma';
import { normalizeWeChatSex } from './auth-helpers';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const LOGIN_TOKEN_TTL_MS = 5 * 60 * 1000;
const WECHAT_ACCESS_TOKEN_SKEW_MS = 5 * 60 * 1000;

export const WECHAT_MINI_LOGIN_PROVIDER_ID = 'wechat-mini';
export const WECHAT_MINI_CHALLENGE_STATUSES = {
  pending: 'pending',
  linked: 'linked',
  unlinked: 'unlinked',
  consumed: 'consumed',
  expired: 'expired',
} as const;

export type WechatMiniChallengeStatus =
  (typeof WECHAT_MINI_CHALLENGE_STATUSES)[keyof typeof WECHAT_MINI_CHALLENGE_STATUSES];

export type WechatMiniSession = {
  openid: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
};

type WechatAccessTokenResponse = {
  access_token?: string;
  expires_in?: number;
  errcode?: number;
  errmsg?: string;
};

type WechatMiniSchemeResponse = {
  openlink?: string;
  errcode?: number;
  errmsg?: string;
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export function isWeChatMiniConfigured(): boolean {
  return Boolean(process.env.WECHAT_MINI_APP_ID?.trim() && process.env.WECHAT_MINI_APP_SECRET?.trim());
}

export function getPublicWeChatMiniAppId(): string {
  return process.env.NEXT_PUBLIC_WECHAT_MINI_APP_ID?.trim() || process.env.WECHAT_MINI_APP_ID?.trim() || '';
}

export function getWechatMiniChallengeExpiresAt(now = Date.now()): Date {
  return new Date(now + CHALLENGE_TTL_MS);
}

export function getWechatMiniLoginTokenExpiresAt(now = Date.now()): Date {
  return new Date(now + LOGIN_TOKEN_TTL_MS);
}

export function normalizeWechatMiniProviderAccountId(session: Pick<WechatMiniSession, 'openid' | 'unionid'>): string {
  return session.unionid?.trim() || `mini_openid:${session.openid.trim()}`;
}

async function getWechatMiniAccessToken(): Promise<string> {
  const appid = process.env.WECHAT_MINI_APP_ID?.trim();
  const secret = process.env.WECHAT_MINI_APP_SECRET?.trim();
  if (!appid || !secret) {
    throw new Error('WECHAT_MINI_NOT_CONFIGURED');
  }

  const now = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + WECHAT_ACCESS_TOKEN_SKEW_MS) {
    return cachedAccessToken.token;
  }

  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);

  const response = await fetch(url, { cache: 'no-store' });
  const data = (await response.json()) as WechatAccessTokenResponse;
  if (!response.ok || data.errcode || !data.access_token) {
    const detail = data.errmsg || `HTTP ${response.status}`;
    throw new Error(`WECHAT_MINI_ACCESS_TOKEN_FAILED:${detail}`);
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: now + Math.max((data.expires_in ?? 7200) * 1000, WECHAT_ACCESS_TOKEN_SKEW_MS),
  };
  return cachedAccessToken.token;
}

export async function generateWechatMiniScheme(challengeId: string, expiresAt = getWechatMiniChallengeExpiresAt()): Promise<string | null> {
  if (!isWeChatMiniConfigured()) return null;

  const accessToken = await getWechatMiniAccessToken();
  const url = new URL('https://api.weixin.qq.com/wxa/generatescheme');
  url.searchParams.set('access_token', accessToken);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      jump_wxa: {
        path: 'pages/login/index',
        query: `challengeId=${challengeId}`,
      },
      is_expire: true,
      expire_time: Math.floor(expiresAt.getTime() / 1000),
    }),
  });
  const data = (await response.json()) as WechatMiniSchemeResponse;
  if (!response.ok || data.errcode || !data.openlink) {
    const detail = data.errmsg || `HTTP ${response.status}`;
    throw new Error(`WECHAT_MINI_SCHEME_FAILED:${detail}`);
  }
  return data.openlink;
}

export async function createWechatMiniLoginChallenge() {
  const id = generateId('wmc');
  const challenge = await prisma.wechatMiniLoginChallenge.create({
    data: {
      id,
      status: WECHAT_MINI_CHALLENGE_STATUSES.pending,
      expiresAt: getWechatMiniChallengeExpiresAt(),
    },
    select: { id: true, expiresAt: true },
  });
  return challenge;
}

export async function exchangeWechatMiniCode(code: string): Promise<WechatMiniSession> {
  const appid = process.env.WECHAT_MINI_APP_ID?.trim();
  const secret = process.env.WECHAT_MINI_APP_SECRET?.trim();
  if (!appid || !secret) {
    throw new Error('WECHAT_MINI_NOT_CONFIGURED');
  }

  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appid);
  url.searchParams.set('secret', secret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const response = await fetch(url, { cache: 'no-store' });
  const data = (await response.json()) as WechatMiniSession;
  if (!response.ok || data.errcode || !data.openid) {
    const detail = data.errmsg || `HTTP ${response.status}`;
    throw new Error(`WECHAT_MINI_CODE_EXCHANGE_FAILED:${detail}`);
  }
  return data;
}

export async function consumeWechatMiniLoginToken(loginToken: string): Promise<{ id: string; email: string; name: string | null } | null> {
  const token = loginToken.trim();
  if (!token) return null;

  const challenge = await prisma.wechatMiniLoginChallenge.findFirst({
    where: {
      loginToken: token,
      status: WECHAT_MINI_CHALLENGE_STATUSES.linked,
      userId: { not: null },
      expiresAt: { gt: new Date() },
    },
    select: { id: true, userId: true },
  });

  if (!challenge?.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: challenge.userId },
    select: { id: true, email: true, name: true },
  });
  if (!user) return null;

  await prisma.wechatMiniLoginChallenge.update({
    where: { id: challenge.id },
    data: {
      status: WECHAT_MINI_CHALLENGE_STATUSES.consumed,
      loginToken: null,
      completedAt: new Date(),
    },
  });

  return user;
}

export function normalizeMiniProgramSex(sex: unknown): number | undefined {
  return normalizeWeChatSex(sex);
}
