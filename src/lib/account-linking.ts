import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { ACCOUNT_LINK_COOKIE, PENDING_OAUTH_COOKIE } from './auth-helpers';
import { getEphemeralStore, type EphemeralStore } from './ephemeral-store';

export type LinkProvider = 'google' | 'wechat';

export type AccountLinkIntent = {
  userId: string;
  sessionId: string;
  provider: LinkProvider;
  callbackUrl?: string;
  exp: number;
};

export type AccountLinkSession = {
  userId: string;
  sessionId: string;
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
  /** Server state id. Present only after the record is stored; never accepted from a client body. */
  stateId?: string;
};

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const ACCOUNT_LINK_STATE_PREFIX = 'account-link-intent:';
export const PENDING_OAUTH_STATE_PREFIX = 'pending-oauth-link:';

type LinkStateStore = Pick<EphemeralStore, 'get' | 'set' | 'delete' | 'compareAndDelete'>;

let stateStoreOverride: LinkStateStore | null = null;

export function setAccountLinkStateStoreForTests(store: LinkStateStore | null): void {
  stateStoreOverride = store;
}

function stateStore(): LinkStateStore {
  return stateStoreOverride ?? getEphemeralStore();
}

function newOpaqueId(): string {
  return randomBytes(32).toString('base64url');
}

function isOpaqueId(value: string | null | undefined): value is string {
  return typeof value === 'string' && OPAQUE_ID_PATTERN.test(value);
}

export function sanitizeLinkCallbackUrl(value: string | undefined): string | undefined {
  if (!value || value.length > 200) return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  if (/[\s\\]/.test(value) || value.includes('://')) return undefined;
  return value;
}

/**
 * Auth.js issues a session only when the sign-in callback returns true.
 * A string is a redirect and must be used whenever login MFA applies.
 */
export function shouldIssueSessionForProviderLink(mfaRedirect: true | string): boolean {
  return mfaRedirect === true;
}

const LINK_INTENT_TTL_MS = 10 * 60 * 1000;
const PENDING_OAUTH_TTL_MS = 15 * 60 * 1000;

export function createAccountLinkIntent(
  userId: string,
  provider: LinkProvider,
  sessionId: string,
  callbackUrl?: string,
): AccountLinkIntent {
  return {
    userId,
    sessionId,
    provider,
    callbackUrl: sanitizeLinkCallbackUrl(callbackUrl),
    exp: Date.now() + LINK_INTENT_TTL_MS,
  };
}

function parseStoredAccountLinkIntent(raw: string): AccountLinkIntent | null {
  try {
    const value = JSON.parse(raw) as Partial<AccountLinkIntent>;
    if (!value || typeof value.userId !== 'string' || !value.userId) return null;
    if (typeof value.sessionId !== 'string' || !value.sessionId) return null;
    if (value.provider !== 'google' && value.provider !== 'wechat') return null;
    if (typeof value.exp !== 'number' || !Number.isFinite(value.exp) || Date.now() > value.exp) return null;
    return {
      userId: value.userId,
      sessionId: value.sessionId,
      provider: value.provider,
      callbackUrl: sanitizeLinkCallbackUrl(typeof value.callbackUrl === 'string' ? value.callbackUrl : undefined),
      exp: value.exp,
    };
  } catch {
    return null;
  }
}

export async function saveAccountLinkIntent(intent: AccountLinkIntent): Promise<string> {
  if (!intent.userId || !intent.sessionId) throw new Error('ACCOUNT_LINK_SESSION_REQUIRED');
  if (intent.provider !== 'google' && intent.provider !== 'wechat') throw new Error('ACCOUNT_LINK_PROVIDER_INVALID');
  if (intent.exp <= Date.now()) throw new Error('ACCOUNT_LINK_EXPIRED');
  const id = newOpaqueId();
  const record: AccountLinkIntent = {
    ...intent,
    callbackUrl: sanitizeLinkCallbackUrl(intent.callbackUrl),
  };
  await stateStore().set(ACCOUNT_LINK_STATE_PREFIX + id, JSON.stringify(record), record.exp - Date.now());
  return id;
}

/**
 * Authorize a provider link. The cookie is only an id; the user id lives in
 * server state and must match the current authenticated session. Forged,
 * tampered, expired, logged-out, and replayed values return null and do not
 * authorize a link or a session.
 */
export async function consumeAccountLinkIntent(
  cookieValue: string | null | undefined,
  provider: LinkProvider,
  session: AccountLinkSession | null,
): Promise<AccountLinkIntent | null> {
  if (!session?.userId || !session.sessionId) return null;
  if (!isOpaqueId(cookieValue)) return null;
  const key = ACCOUNT_LINK_STATE_PREFIX + cookieValue;
  const raw = await stateStore().get(key);
  if (!raw) return null;
  const intent = parseStoredAccountLinkIntent(raw);
  if (!intent) return null;
  if (intent.provider !== provider) return null;
  if (intent.userId !== session.userId || intent.sessionId !== session.sessionId) return null;
  const consumed = await stateStore().compareAndDelete(key, raw);
  if (!consumed) return null;
  return intent;
}

export async function consumeAccountLinkIntentForSession(
  provider: LinkProvider,
  session: AccountLinkSession | null,
): Promise<AccountLinkIntent | null> {
  const cookieStore = await cookies();
  return consumeAccountLinkIntent(cookieStore.get(ACCOUNT_LINK_COOKIE)?.value, provider, session);
}

export async function setAccountLinkIntentCookie(intent: AccountLinkIntent): Promise<void> {
  const cookieValue = await saveAccountLinkIntent(intent);
  const cookieStore = await cookies();
  cookieStore.set(ACCOUNT_LINK_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.max(1, Math.floor((intent.exp - Date.now()) / 1000)),
  });
}

export async function clearAccountLinkIntentCookie(): Promise<void> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(ACCOUNT_LINK_COOKIE)?.value;
  if (isOpaqueId(cookieValue)) {
    await stateStore().delete(ACCOUNT_LINK_STATE_PREFIX + cookieValue);
  }
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

function optionalString(value: unknown): string | null | undefined {
  if (typeof value === 'string') return value;
  if (value === null) return null;
  return undefined;
}

function parseStoredPendingOAuthLink(raw: string, stateId: string): PendingOAuthLink | null {
  try {
    const value = JSON.parse(raw) as Partial<PendingOAuthLink>;
    if (!value) return null;
    if (value.provider !== 'google' && value.provider !== 'wechat') return null;
    if (value.mode !== 'merge' && value.mode !== 'register') return null;
    if (typeof value.providerAccountId !== 'string' || !value.providerAccountId) return null;
    if (typeof value.exp !== 'number' || !Number.isFinite(value.exp) || Date.now() > value.exp) return null;
    if (value.stateId !== stateId) return null;
    if (value.mode === 'merge' && (typeof value.targetUserId !== 'string' || !value.targetUserId)) return null;
    return {
      provider: value.provider,
      providerAccountId: value.providerAccountId,
      type: typeof value.type === 'string' ? value.type : undefined,
      refresh_token: optionalString(value.refresh_token),
      access_token: optionalString(value.access_token),
      expires_at: typeof value.expires_at === 'number' ? value.expires_at : value.expires_at === null ? null : undefined,
      token_type: optionalString(value.token_type),
      scope: optionalString(value.scope),
      id_token: optionalString(value.id_token),
      session_state: optionalString(value.session_state),
      oauthEmail: typeof value.oauthEmail === 'string' ? value.oauthEmail : undefined,
      oauthName: typeof value.oauthName === 'string' ? value.oauthName : undefined,
      oauthImage: typeof value.oauthImage === 'string' ? value.oauthImage : undefined,
      oauthSex: typeof value.oauthSex === 'number' ? value.oauthSex : undefined,
      targetUserId: typeof value.targetUserId === 'string' ? value.targetUserId : undefined,
      registrationToken: typeof value.registrationToken === 'string' ? value.registrationToken : undefined,
      mode: value.mode,
      exp: value.exp,
      stateId,
    };
  } catch {
    return null;
  }
}

export async function savePendingOAuthLink(pending: PendingOAuthLink): Promise<string> {
  if (pending.provider !== 'google' && pending.provider !== 'wechat') throw new Error('PENDING_OAUTH_PROVIDER_INVALID');
  if (pending.mode !== 'merge' && pending.mode !== 'register') throw new Error('PENDING_OAUTH_MODE_INVALID');
  if (!pending.providerAccountId || pending.exp <= Date.now()) throw new Error('PENDING_OAUTH_INVALID');
  if (pending.mode === 'merge' && !pending.targetUserId) throw new Error('PENDING_OAUTH_TARGET_REQUIRED');
  const stateId = isOpaqueId(pending.stateId) ? pending.stateId : newOpaqueId();
  const record: PendingOAuthLink = { ...pending, stateId };
  await stateStore().set(PENDING_OAUTH_STATE_PREFIX + stateId, JSON.stringify(record), record.exp - Date.now());
  return stateId;
}

export async function readPendingOAuthLinkValue(cookieValue: string | null | undefined): Promise<PendingOAuthLink | null> {
  if (!isOpaqueId(cookieValue)) return null;
  const raw = await stateStore().get(PENDING_OAUTH_STATE_PREFIX + cookieValue);
  if (!raw) return null;
  return parseStoredPendingOAuthLink(raw, cookieValue);
}

export async function consumePendingOAuthLinkValue(cookieValue: string | null | undefined): Promise<PendingOAuthLink | null> {
  if (!isOpaqueId(cookieValue)) return null;
  const key = PENDING_OAUTH_STATE_PREFIX + cookieValue;
  const raw = await stateStore().get(key);
  if (!raw) return null;
  const pending = parseStoredPendingOAuthLink(raw, cookieValue);
  if (!pending) return null;
  const consumed = await stateStore().compareAndDelete(key, raw);
  if (!consumed) return null;
  return pending;
}

function pendingCookieOptions(exp: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.max(1, Math.floor((exp - Date.now()) / 1000)),
  };
}

export async function setPendingOAuthLinkCookie(pending: PendingOAuthLink): Promise<void> {
  const stateId = await savePendingOAuthLink(pending);
  const cookieStore = await cookies();
  cookieStore.set(PENDING_OAUTH_COOKIE, stateId, pendingCookieOptions(pending.exp));
}

export async function readPendingOAuthLinkCookie(): Promise<PendingOAuthLink | null> {
  const cookieStore = await cookies();
  return readPendingOAuthLinkValue(cookieStore.get(PENDING_OAUTH_COOKIE)?.value);
}

export async function consumePendingOAuthLinkCookie(): Promise<PendingOAuthLink | null> {
  const cookieStore = await cookies();
  const pending = await consumePendingOAuthLinkValue(cookieStore.get(PENDING_OAUTH_COOKIE)?.value);
  if (pending) cookieStore.delete(PENDING_OAUTH_COOKIE);
  return pending;
}

export async function clearPendingOAuthLinkCookie(): Promise<void> {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(PENDING_OAUTH_COOKIE)?.value;
  if (isOpaqueId(cookieValue)) {
    await stateStore().delete(PENDING_OAUTH_STATE_PREFIX + cookieValue);
  }
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
