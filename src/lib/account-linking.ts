import { cookies } from 'next/headers';
import { ACCOUNT_LINK_COOKIE, PENDING_OAUTH_COOKIE } from './auth-helpers';

export type LinkProvider = 'google' | 'wechat';

export type AccountLinkIntent = {
  userId: string;
  provider: LinkProvider;
  exp: number;
};

export type PendingOAuthLink = {
  provider: LinkProvider;
  providerAccountId: string;
  type?: string;
  refresh_token?: string | null;
  access_token?: string | null;
  expires_at?: number | null;
  token_type?: string | null;
  scope?: string | null;
  id_token?: string | null;
  session_state?: string | null;
  oauthEmail?: string;
  oauthName?: string;
  oauthImage?: string;
  oauthSex?: number;
  targetUserId?: string;
  registrationToken?: string;
  mode: 'merge' | 'register';
  exp: number;
};

const LINK_INTENT_TTL_MS = 10 * 60 * 1000;
const PENDING_OAUTH_TTL_MS = 15 * 60 * 1000;

export function createAccountLinkIntent(userId: string, provider: LinkProvider): AccountLinkIntent {
  return {
    userId,
    provider,
    exp: Date.now() + LINK_INTENT_TTL_MS,
  };
}

export function serializeAccountLinkIntent(intent: AccountLinkIntent): string {
  return Buffer.from(JSON.stringify(intent), 'utf8').toString('base64url');
}

export function parseAccountLinkIntent(raw: string | undefined | null): AccountLinkIntent | null {
  if (!raw) return null;
  try {
    const intent = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as AccountLinkIntent;
    if (!intent?.userId || !intent?.provider || !intent?.exp) return null;
    if (Date.now() > intent.exp) return null;
    if (intent.provider !== 'google' && intent.provider !== 'wechat') return null;
    return intent;
  } catch {
    return null;
  }
}

export async function setAccountLinkIntentCookie(intent: AccountLinkIntent): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(ACCOUNT_LINK_COOKIE, serializeAccountLinkIntent(intent), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(LINK_INTENT_TTL_MS / 1000),
  });
}

export async function readAccountLinkIntentCookie(): Promise<AccountLinkIntent | null> {
  const cookieStore = await cookies();
  return parseAccountLinkIntent(cookieStore.get(ACCOUNT_LINK_COOKIE)?.value);
}

export async function clearAccountLinkIntentCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(ACCOUNT_LINK_COOKIE);
}

export function linkSuccessParam(provider: LinkProvider): string {
  return provider === 'google' ? 'oauthLink=success' : 'wechatLink=success';
}

export function linkConflictParam(provider: LinkProvider): string {
  return provider === 'google' ? 'oauthLink=conflict' : 'wechatLink=conflict';
}

export function createPendingOAuthLink(
  account: {
    type?: string;
    provider: string;
    providerAccountId: string;
    refresh_token?: string | null;
    access_token?: string | null;
    expires_at?: number | null;
    token_type?: string | null;
    scope?: string | null;
    id_token?: string | null;
    session_state?: string | null;
  },
  provider: LinkProvider,
  opts: {
    mode: 'merge' | 'register';
    targetUserId?: string;
    oauthEmail?: string;
    oauthName?: string;
    oauthImage?: string;
    oauthSex?: number;
    registrationToken?: string;
  },
): PendingOAuthLink {
  return {
    provider,
    providerAccountId: account.providerAccountId,
    type: account.type,
    refresh_token: account.refresh_token,
    access_token: account.access_token,
    expires_at: account.expires_at,
    token_type: account.token_type,
    scope: account.scope,
    id_token: account.id_token,
    session_state: account.session_state,
    oauthEmail: opts.oauthEmail,
    oauthName: opts.oauthName,
    oauthImage: opts.oauthImage,
    oauthSex: opts.oauthSex,
    registrationToken: opts.registrationToken,
    targetUserId: opts.targetUserId,
    mode: opts.mode,
    exp: Date.now() + PENDING_OAUTH_TTL_MS,
  };
}

export function parsePendingOAuthLink(raw: string | undefined | null): PendingOAuthLink | null {
  if (!raw) return null;
  try {
    const pending = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as PendingOAuthLink;
    if (!pending?.provider || !pending?.providerAccountId || !pending?.mode || !pending?.exp) return null;
    if (Date.now() > pending.exp) return null;
    if (pending.provider !== 'google' && pending.provider !== 'wechat') return null;
    if (pending.mode !== 'merge' && pending.mode !== 'register') return null;
    return pending;
  } catch {
    return null;
  }
}

export function serializePendingOAuthLink(pending: PendingOAuthLink): string {
  return Buffer.from(JSON.stringify(pending), 'utf8').toString('base64url');
}

export async function setPendingOAuthLinkCookie(pending: PendingOAuthLink): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(PENDING_OAUTH_COOKIE, serializePendingOAuthLink(pending), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(PENDING_OAUTH_TTL_MS / 1000),
  });
}

export async function readPendingOAuthLinkCookie(): Promise<PendingOAuthLink | null> {
  const cookieStore = await cookies();
  return parsePendingOAuthLink(cookieStore.get(PENDING_OAUTH_COOKIE)?.value);
}

export async function clearPendingOAuthLinkCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(PENDING_OAUTH_COOKIE);
}

export function providerLabel(provider: LinkProvider): string {
  return provider === 'google' ? 'Google' : '微信';
}

/** Upgrade a register-mode pending OAuth cookie to merge mode for an existing account. */
export function upgradePendingOAuthToMerge(
  pending: PendingOAuthLink,
  targetUserId: string,
): PendingOAuthLink {
  return {
    ...pending,
    mode: 'merge',
    targetUserId,
    exp: Date.now() + PENDING_OAUTH_TTL_MS,
  };
}
