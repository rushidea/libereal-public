import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { generateId } from './id';
import { prisma } from './prisma';
import { normalizeWeChatSex } from './auth-helpers';

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const LOGIN_TOKEN_TTL_MS = 5 * 60 * 1000;
const WECHAT_ACCESS_TOKEN_SKEW_MS = 5 * 60 * 1000;
const BROWSER_SECRET_BYTES = 32;
const COOKIE_PREFIX = 'libereal-wmc-bind-';
const CHALLENGE_ID_PATTERN = /^[A-Za-z0-9_-]{4,80}$/;
const BROWSER_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const BROWSER_SECRET_HASH_PATTERN = /^[a-f0-9]{64}$/;

/** Covers the pending challenge window plus the login token issued after WeChat confirms. */
export const WECHAT_MINI_BROWSER_SECRET_TTL_SECONDS = Math.ceil((CHALLENGE_TTL_MS + LOGIN_TOKEN_TTL_MS) / 1000);
export const WECHAT_MINI_BROWSER_SECRET_COOKIE_PATH = '/api/auth/wechat-mini/complete';

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

export function createWechatMiniBrowserSecret(): string {
  return randomBytes(BROWSER_SECRET_BYTES).toString('base64url');
}

export function hashWechatMiniBrowserSecret(secret: string): string {
  if (!BROWSER_SECRET_PATTERN.test(secret)) {
    throw new Error('WECHAT_MINI_BROWSER_SECRET_INVALID');
  }
  return createHash('sha256').update(secret).digest('hex');
}

export function getWechatMiniBrowserSecretCookieName(challengeId: string): string {
  if (!CHALLENGE_ID_PATTERN.test(challengeId)) {
    throw new Error('WECHAT_MINI_CHALLENGE_ID_INVALID');
  }
  const securePrefix = process.env.NODE_ENV === 'production' ? '__Secure-' : '';
  return `${securePrefix}${COOKIE_PREFIX}${challengeId}`;
}

export function wechatMiniBrowserSecretCookieOptions() {
  return {
    httpOnly: true as const,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: WECHAT_MINI_BROWSER_SECRET_COOKIE_PATH,
    maxAge: WECHAT_MINI_BROWSER_SECRET_TTL_SECONDS,
  };
}

export function wechatMiniBrowserSecretsMatch(
  storedHash: string | null | undefined,
  presentedSecret: string | null | undefined,
): boolean {
  if (!storedHash || !presentedSecret || !BROWSER_SECRET_PATTERN.test(presentedSecret)) return false;
  const presentedHash = createHash('sha256').update(presentedSecret).digest('hex');
  const left = Buffer.from(storedHash, 'hex');
  const right = Buffer.from(presentedHash, 'hex');
  if (left.length !== 32 || right.length !== 32) return false;
  return timingSafeEqual(left, right);
}

export async function createWechatMiniLoginChallenge(browserSecretHash: string) {
  if (!BROWSER_SECRET_HASH_PATTERN.test(browserSecretHash)) {
    throw new Error('WECHAT_MINI_BROWSER_SECRET_INVALID');
  }
  const id = generateId('wmc');
  const challenge = await prisma.wechatMiniLoginChallenge.create({
    data: {
      id,
      status: WECHAT_MINI_CHALLENGE_STATUSES.pending,
      expiresAt: getWechatMiniChallengeExpiresAt(),
      browserSecretHash,
    },
    select: { id: true, expiresAt: true },
  });
  return challenge;
}

type WechatMiniCompletionChallenge = {
  id: string;
  status: string;
  providerAccountId: string | null;
  userId: string | null;
  loginToken: string | null;
  oauthName: string | null;
  oauthImage: string | null;
  oauthSex: number | null;
};

export type WechatMiniCompletionDecision =
  | { ok: false; httpStatus: 404 | 403 | 410 | 409; error: string }
  | { ok: true; kind: 'linked'; challenge: WechatMiniCompletionChallenge; browserSecretHash: string }
  | { ok: true; kind: 'unlinked'; challenge: WechatMiniCompletionChallenge; browserSecretHash: string };

function completionChallenge(challenge: WechatMiniCompletionChallenge): WechatMiniCompletionChallenge {
  return {
    id: challenge.id,
    status: challenge.status,
    providerAccountId: challenge.providerAccountId,
    userId: challenge.userId,
    loginToken: challenge.loginToken,
    oauthName: challenge.oauthName,
    oauthImage: challenge.oauthImage,
    oauthSex: challenge.oauthSex,
  };
}

/**
 * Authorize completion only for the browser that started the challenge.
 * The presented secret comes from the httpOnly cookie, never from the page or request body.
 * A successful linked/unlinked claim clears the stored hash so the secret cannot be reused.
 */
export async function authorizeWechatMiniCompletion(
  challengeId: string,
  presentedSecret: string | null,
): Promise<WechatMiniCompletionDecision> {
  const challenge = await prisma.wechatMiniLoginChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      status: true,
      providerAccountId: true,
      userId: true,
      loginToken: true,
      oauthName: true,
      oauthImage: true,
      oauthSex: true,
      expiresAt: true,
      browserSecretHash: true,
    },
  });

  if (!challenge) {
    return { ok: false, httpStatus: 404, error: '登录请求不存在' };
  }
  if (!wechatMiniBrowserSecretsMatch(challenge.browserSecretHash, presentedSecret)) {
    return { ok: false, httpStatus: 403, error: '请回到发起登录的浏览器完成登录' };
  }

  if (challenge.expiresAt <= new Date()) {
    await prisma.wechatMiniLoginChallenge.update({
      where: { id: challenge.id },
      data: {
        status: WECHAT_MINI_CHALLENGE_STATUSES.expired,
        loginToken: null,
        browserSecretHash: null,
      },
    });
    return { ok: false, httpStatus: 410, error: '登录请求已过期，请重新尝试' };
  }

  if (challenge.status === WECHAT_MINI_CHALLENGE_STATUSES.consumed) {
    return { ok: false, httpStatus: 409, error: '登录请求已处理，请重新发起' };
  }

  const browserSecretHash = challenge.browserSecretHash;
  if (!browserSecretHash) {
    return { ok: false, httpStatus: 403, error: '请回到发起登录的浏览器完成登录' };
  }

  if (challenge.status === WECHAT_MINI_CHALLENGE_STATUSES.linked && challenge.loginToken) {
    const claimed = await prisma.wechatMiniLoginChallenge.updateMany({
      where: {
        id: challenge.id,
        browserSecretHash,
        status: WECHAT_MINI_CHALLENGE_STATUSES.linked,
        loginToken: challenge.loginToken,
        expiresAt: { gt: new Date() },
      },
      data: { browserSecretHash: null },
    });
    if (claimed.count !== 1) {
      return { ok: false, httpStatus: 409, error: '登录请求已处理，请重新发起' };
    }
    return {
      ok: true,
      kind: 'linked',
      browserSecretHash,
      challenge: completionChallenge(challenge),
    };
  }

  if (challenge.status === WECHAT_MINI_CHALLENGE_STATUSES.unlinked && challenge.providerAccountId) {
    const completedAt = new Date();
    const claimed = await prisma.wechatMiniLoginChallenge.updateMany({
      where: {
        id: challenge.id,
        browserSecretHash,
        status: WECHAT_MINI_CHALLENGE_STATUSES.unlinked,
        expiresAt: { gt: new Date() },
      },
      data: {
        browserSecretHash: null,
        status: WECHAT_MINI_CHALLENGE_STATUSES.consumed,
        completedAt,
      },
    });
    if (claimed.count !== 1) {
      return { ok: false, httpStatus: 409, error: '登录请求已处理，请重新发起' };
    }
    return {
      ok: true,
      kind: 'unlinked',
      browserSecretHash,
      challenge: completionChallenge({
        ...challenge,
        status: WECHAT_MINI_CHALLENGE_STATUSES.consumed,
      }),
    };
  }

  return { ok: false, httpStatus: 409, error: '微信授权尚未完成' };
}

export async function releaseWechatMiniBrowserClaim(
  challengeId: string,
  browserSecretHash: string,
  loginToken: string,
): Promise<void> {
  if (!loginToken || !BROWSER_SECRET_HASH_PATTERN.test(browserSecretHash)) return;
  await prisma.wechatMiniLoginChallenge.updateMany({
    where: {
      id: challengeId,
      browserSecretHash: null,
      loginToken,
      status: WECHAT_MINI_CHALLENGE_STATUSES.linked,
    },
    data: { browserSecretHash },
  });
}

export async function restoreWechatMiniUnlinkedClaim(
  challengeId: string,
  browserSecretHash: string,
): Promise<void> {
  if (!BROWSER_SECRET_HASH_PATTERN.test(browserSecretHash)) return;
  await prisma.wechatMiniLoginChallenge.updateMany({
    where: {
      id: challengeId,
      status: WECHAT_MINI_CHALLENGE_STATUSES.consumed,
      browserSecretHash: null,
    },
    data: {
      status: WECHAT_MINI_CHALLENGE_STATUSES.unlinked,
      browserSecretHash,
      completedAt: null,
    },
  });
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
