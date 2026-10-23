import { generateId } from './id';
import NextAuth, { customFetch } from "next-auth";
import { CredentialsSignin } from "next-auth";
import { randomBytes } from "node:crypto";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import WeChat from "next-auth/providers/wechat";
import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";
import { getDatabasePath } from "./databasePath";
import {
  clearAccountLinkIntentCookie,
  consumeAccountLinkIntentForSession,
  createPendingOAuthLink,
  linkConflictParam,
  setPendingOAuthLinkCookie,
  shouldIssueSessionForProviderLink,
} from "./account-linking";
import { isAdminEmail, isGoogleAuthConfigured, MERGE_VERIFIED_COOKIE, normalizeEmail, normalizeWeChatSex, resolveSessionRole, wechatProfileUpdates, WECHAT_EMAIL_DOMAIN } from "./auth-helpers";
import { callbackPathFromAuthUrl, sanitizeAuthCallbackUrl, withAuthCallback } from "./auth-callback-url";
import {
  isWeChatMpOAuthConfigured,
  isWeChatProvider,
  normalizeWeChatOAuthAccount,
  WECHAT_OAUTH_PROVIDER_ID,
  WECHAT_WEB_PROVIDER_ID,
} from "./wechat-auth";
import { consumeWechatMiniLoginToken, WECHAT_MINI_LOGIN_PROVIDER_ID } from "./wechat-mini-auth";
import { isMfaPhase1Enabled } from './security/mfa-config';
import { clearMfaChallengeCookie, readMfaChallengeCookie, setMfaChallengeCookie } from './security/mfa-cookie';
import { createMfaLoginChallenge, isUserMfaEnabled, verifyMfaLoginChallenge } from './security/mfa-service';
import { getRequestIp } from './security/mfa-rate-limit';
import { consumePasskeyVerifiedToken } from './security/passkey-session';
import { recordSecurityEvent } from './security/security-events';
import { isSecuritySessionActive, registerSecuritySession } from './security/security-session-service';
import { createGoogleOAuthFetch } from './google-oauth-fetch';

const googleOAuthFetch = createGoogleOAuthFetch(process.env.GOOGLE_OAUTH_PROXY_URL?.trim());

const DB_PATH = getDatabasePath();

class FrozenAccountError extends CredentialsSignin {
  code = 'account-frozen';
}

class MfaVerifyError extends CredentialsSignin {
  code = 'mfa-invalid';
}

// FrozenAccountError retained for backward-compatible error code mapping in clients.
void FrozenAccountError;

function ensureAdminRoleInDb(db: Database.Database, userId: string, email: string | null | undefined): void {
  if (!isAdminEmail(email)) return;
  db.prepare(
    `UPDATE User SET role = 'admin', updatedAt = ? WHERE id = ? AND COALESCE(role, '') != 'admin'`
  ).run(new Date().toISOString(), userId);
}

const AUTH_SECRET = process.env.AUTH_SECRET ?? "";

async function maybeMfaRedirect(
  userId: string,
  provider: 'credentials' | 'google' | 'wechat' | 'wechat-mini',
  callbackUrl?: string,
) {
  try {
    if (!isMfaPhase1Enabled() || !isUserMfaEnabled(userId)) return true;
    const db = new Database(DB_PATH);
    const account = db.prepare('SELECT role FROM User WHERE id = ?').get(userId) as { role?: string } | undefined;
    db.close();
    // 管理员登录保持普通登录流程；高敏感管理员操作在操作前单独完成专用 MFA。
    if (account?.role === 'admin') return true;
    const ip = await getRequestIp();
    const challenge = await createMfaLoginChallenge(userId, provider, ip);
    await setMfaChallengeCookie(challenge.id, challenge.token);
    const params = new URLSearchParams({
      challengeId: challenge.id,
      provider,
    });
    const safeCallback = sanitizeAuthCallbackUrl(callbackUrl, '');
    if (safeCallback) {
      params.set('callbackUrl', safeCallback);
    }
    return `/login/mfa?${params.toString()}`;
  } catch (error) {
    if (error instanceof Error && error.message === 'MFA_CHALLENGE_RATE_LIMITED') {
      return '/login?error=MfaRateLimited';
    }
    console.error('[auth.mfa] challenge creation failed:', error instanceof Error ? error.message : 'unknown');
    return '/login?error=MfaUnavailable';
  }
}

function getWeChatEmail(providerAccountId: string | null | undefined): string | null {
  if (!providerAccountId) return null;
  return `wechat_${providerAccountId}@${WECHAT_EMAIL_DOMAIN}`.toLowerCase();
}

function recordLoginFailure(input: { userId?: string | null; reason: string }): void {
  try {
    const db = new Database(DB_PATH);
    recordSecurityEvent(db, {
      userId: input.userId ?? null,
      eventType: 'LOGIN_FAILED',
      metadata: { reason: input.reason },
    });
    db.close();
  } catch (error) {
    console.error('[auth] LOGIN_FAILED event write failed:', error instanceof Error ? error.message : 'unknown');
  }
}

/**
 * Fail closed. A JWT is a login only while its server session row is active.
 * Unknown, revoked, and expired rows are rejected so auth()-only routes cannot
 * keep using a cookie after revoke or password reset.
 */
async function sessionHasActiveServerRecord(userId: string, sessionId: string): Promise<boolean> {
  try {
    return await isSecuritySessionActive(userId, sessionId);
  } catch (error) {
    console.error('[auth.session] active session check failed:', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

function unauthenticatedSession(expires: Date | string) {
  return {
    expires: expires instanceof Date ? expires.toISOString() : expires,
    user: undefined,
  };
}

async function getCurrentAuthToken(): Promise<{ id?: string; email?: string; sessionId?: string } | null> {
  if (!AUTH_SECRET) return null;
  try {
    const cookieStore = await cookies();
    const cookieNames = ['__Secure-authjs.session-token', 'authjs.session-token'];
    for (const name of cookieNames) {
      const sessionToken = cookieStore.get(name)?.value;
      if (!sessionToken) continue;
      const token = await decode({ token: sessionToken, secret: AUTH_SECRET, salt: name });
      if (token) {
        return {
          id: typeof token.id === 'string' ? token.id : undefined,
          email: typeof token.email === 'string' ? token.email : undefined,
          sessionId: typeof token.sessionId === 'string' ? token.sessionId : undefined,
        };
      }
    }
  } catch {}
  return null;
}

type OAuthAccount = {
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
};

function oauthEmailTakenByOtherUser(
  db: Database.Database,
  userId: string,
  oauthEmail: string,
): boolean {
  const conflict = db.prepare(
    'SELECT id FROM User WHERE id != ? AND (lower(email) = ? OR lower(googleEmail) = ?)'
  ).get(userId, oauthEmail, oauthEmail) as { id: string } | undefined;
  return !!conflict;
}

async function resolveLinkingUserId(
  db: Database.Database,
  provider: 'google' | 'wechat',
): Promise<{ userId: string; callbackUrl?: string } | undefined> {
  const currentToken = await getCurrentAuthToken();
  const sessionActive = currentToken?.id && currentToken.sessionId
    ? await sessionHasActiveServerRecord(currentToken.id, currentToken.sessionId)
    : false;
  const session = sessionActive && currentToken?.id && currentToken.sessionId
    ? { userId: currentToken.id, sessionId: currentToken.sessionId }
    : null;
  // Logged-out or forged cookies never select a user. The intent must match this session.
  const linkIntent = await consumeAccountLinkIntentForSession(provider, session);
  if (!linkIntent) return undefined;

  const intentUser = db.prepare('SELECT id FROM User WHERE id = ?').get(linkIntent.userId) as { id: string } | undefined;
  if (!intentUser) return undefined;
  return { userId: intentUser.id, callbackUrl: linkIntent.callbackUrl };
}

async function redirectWithPendingOAuth(
  account: OAuthAccount,
  provider: 'google' | 'wechat',
  redirectUrl: string,
  opts: {
    mode: 'merge' | 'register';
    targetUserId?: string;
    oauthEmail?: string;
    oauthName?: string | null;
    oauthImage?: string | null;
    oauthSex?: number;
  },
): Promise<string> {
  await setPendingOAuthLinkCookie(createPendingOAuthLink(account, provider, {
    ...opts,
    oauthName: opts.oauthName ?? undefined,
    oauthImage: opts.oauthImage ?? undefined,
    oauthSex: opts.oauthSex,
  }));
  return redirectUrl;
}

async function readRequestCallbackPath(): Promise<string | undefined> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get('__Secure-authjs.callback-url')?.value
      ?? cookieStore.get('authjs.callback-url')?.value
      ?? cookieStore.get('__Secure-next-auth.callback-url')?.value
      ?? cookieStore.get('next-auth.callback-url')?.value;
    return callbackPathFromAuthUrl(raw);
  } catch {
    return undefined;
  }
}

async function resolveAuthReturnPath(explicit?: string | null): Promise<string | undefined> {
  const fromExplicit = sanitizeAuthCallbackUrl(explicit, '');
  if (fromExplicit) return fromExplicit;
  return readRequestCallbackPath();
}

function applyWeChatProfileSql(
  db: Database.Database,
  userId: string,
  profile: { name?: string | null; image?: string | null; sex?: number | null },
): void {
  const existing = db.prepare(
    'SELECT name, wechatNickname, displayAvatarUrl, sex FROM User WHERE id = ?'
  ).get(userId) as {
    name: string | null;
    wechatNickname: string | null;
    displayAvatarUrl: string | null;
    sex: number | null;
  } | undefined;
  if (!existing) return;

  const fields = wechatProfileUpdates(existing, profile);
  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  if (fields.avatar) {
    updates.push('avatar = ?');
    params.push(fields.avatar);
  }
  if (fields.name) {
    updates.push('name = ?');
    params.push(fields.name);
  }
  if (fields.wechatNickname) {
    updates.push('wechatNickname = ?');
    params.push(fields.wechatNickname);
  }
  if (fields.displayAvatarUrl) {
    updates.push('displayAvatarUrl = ?');
    params.push(fields.displayAvatarUrl);
  }
  if (fields.sex !== undefined) {
    updates.push('sex = ?');
    params.push(fields.sex);
  }
  if (updates.length === 0) return;

  updates.push('updatedAt = ?');
  params.push(new Date().toISOString());
  params.push(userId);
  db.prepare(`UPDATE User SET ${updates.join(', ')} WHERE id = ?`).run(...params);
}

function weChatProfileMapper(profile: {
  unionid?: string;
  openid: string;
  nickname: string;
  headimgurl: string;
  sex: number;
}) {
  const id = profile.unionid || profile.openid;
  return {
    id,
    name: profile.nickname,
    email: getWeChatEmail(id),
    image: profile.headimgurl,
    sex: normalizeWeChatSex(profile.sex),
  };
}

function createWeChatProviderConfig(
  id: string,
  clientId: string,
  clientSecret: string,
  platformType: 'OfficialAccount' | 'WebsiteApp',
) {
  const authUrl = platformType === 'OfficialAccount'
    ? 'https://open.weixin.qq.com/connect/oauth2/authorize#wechat_redirect'
    : 'https://open.weixin.qq.com/connect/qrconnect#wechat_redirect';

  return WeChat({
    id,
    clientId,
    clientSecret,
    platformType,
    authorization: {
      url: authUrl,
      params: {
        appid: clientId,
        scope: platformType === 'OfficialAccount' ? 'snsapi_userinfo' : 'snsapi_login',
        ...(platformType === 'OfficialAccount' ? { connect_redirect: '1' } : {}),
      },
    },
    profile: weChatProfileMapper,
  });
}

function insertAccount(db: Database.Database, userId: string, account: OAuthAccount) {
  const normalized = normalizeWeChatOAuthAccount(account);
  db.prepare(`
    INSERT OR IGNORE INTO Account (
      id, userId, type, provider, providerAccountId,
      refresh_token, access_token, expires_at, token_type, scope, id_token, session_state
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    generateId('acc'),
    userId,
    normalized.type ?? 'oauth',
    normalized.provider,
    normalized.providerAccountId,
    normalized.refresh_token ?? null,
    normalized.access_token ?? null,
    normalized.expires_at ?? null,
    normalized.token_type ?? null,
    normalized.scope ?? null,
    normalized.id_token ?? null,
    normalized.session_state ?? null
  );
}

async function verifyTurnstile(token: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY ?? '';
  if (!secret) {
    console.error('[verifyTurnstile] TURNSTILE_SECRET_KEY not configured');
    return false;
  }
  if (secret.startsWith('1x0000')) {
    // Cloudflare published test key — skip verification in dev only
    if (process.env.NODE_ENV === 'production') {
      console.error('[verifyTurnstile] Test key detected in production — rejecting');
      return false;
    }
    return true;
  }
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });
    const data = await res.json() as { success: boolean };
    return data.success;
  } catch {
    return false;
  }
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  providers: [
    ...(isGoogleAuthConfigured()
      ? [
          Google({
            clientId: process.env.AUTH_GOOGLE_ID!.trim(),
            clientSecret: process.env.AUTH_GOOGLE_SECRET!.trim(),
            // Skip OIDC discovery fetch (required on CN hosts that cannot reach accounts.google.com).
            authorization: {
              url: 'https://accounts.google.com/o/oauth2/v2/auth',
              params: { prompt: 'consent', access_type: 'offline', response_type: 'code' },
            },
            token: 'https://oauth2.googleapis.com/token',
            userinfo: 'https://openidconnect.googleapis.com/v1/userinfo',
            ...(googleOAuthFetch ? { [customFetch]: googleOAuthFetch } : {}),
          }),
        ]
      : []),
    // Desktop / non-mobile: WebsiteApp QR login (#wechat_redirect enables mobile app handoff).
    createWeChatProviderConfig(
      WECHAT_WEB_PROVIDER_ID,
      process.env.AUTH_WECHAT_ID ?? '',
      process.env.AUTH_WECHAT_SECRET ?? '',
      'WebsiteApp',
    ),
    // Mobile / WeChat in-app: OfficialAccount OAuth (redirects into WeChat app).
    ...(isWeChatMpOAuthConfigured()
      ? [
          createWeChatProviderConfig(
            WECHAT_OAUTH_PROVIDER_ID,
            process.env.AUTH_WECHAT_MP_ID!.trim(),
            process.env.AUTH_WECHAT_MP_SECRET!.trim(),
            'OfficialAccount',
          ),
        ]
      : []),
    Credentials({
      id: WECHAT_MINI_LOGIN_PROVIDER_ID,
      name: "wechat-mini",
      credentials: {
        loginToken: { label: "Login token", type: "text" },
      },
      async authorize(credentials) {
        const loginToken = credentials?.loginToken as string | undefined;
        if (!loginToken) return null;
        return consumeWechatMiniLoginToken(loginToken);
      },
    }),
    Credentials({
      id: 'mfa-verify',
      name: 'MFA verification',
      credentials: {
        challengeId: { label: 'Challenge ID', type: 'text' },
        code: { label: 'TOTP code', type: 'text' },
        recoveryCode: { label: 'Recovery code', type: 'text' },
        passkeyToken: { label: 'Passkey token', type: 'text' },
      },
      async authorize(credentials) {
        const challengeId = String(credentials?.challengeId ?? '').trim();
        const code = String(credentials?.code ?? '').trim();
        const recoveryCode = String(credentials?.recoveryCode ?? '').trim();
        const passkeyToken = String(credentials?.passkeyToken ?? '').trim();
        if (!/^[0-9a-f-]{36}$/i.test(challengeId)) return null;

        if (passkeyToken) {
          if (code || recoveryCode) return null;
          const challengeCookieToken = await readMfaChallengeCookie(challengeId);
          const passkeyLogin = await consumePasskeyVerifiedToken(passkeyToken, challengeId, challengeCookieToken ?? '');
          if (!passkeyLogin) throw new MfaVerifyError();
          return {
            id: passkeyLogin.userId,
            email: passkeyLogin.email,
            name: passkeyLogin.name,
            mfaVerifiedAt: passkeyLogin.mfaVerifiedAt,
            mfaMethod: 'passkey' as const,
          };
        }
        if (!!code === !!recoveryCode) return null;

        const token = await readMfaChallengeCookie(challengeId);
        if (!token) return null;
        const ip = await getRequestIp();
        const result = await verifyMfaLoginChallenge(challengeId, token, {
          code: code || undefined,
          recoveryCode: recoveryCode || undefined,
        }, ip);
        if (!result.ok) {
          if (result.clearCookie) await clearMfaChallengeCookie(challengeId);
          throw new MfaVerifyError();
        }
        await clearMfaChallengeCookie(challengeId);
        return {
          id: result.login.userId,
          email: result.login.email,
          name: result.login.name,
          mfaVerifiedAt: result.login.mfaVerifiedAt,
          mfaMethod: result.login.mfaMethod,
        };
      },
    }),
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        turnstileToken: { label: "Turnstile", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = normalizeEmail(credentials.email as string);
        const db = new Database(DB_PATH, { readonly: true });
        const user = db.prepare(
          'SELECT id, email, password, name, role FROM User WHERE lower(email) = ?'
        ).get(email) as { id: string; email: string; password: string | null; name: string | null; role: string | null } | undefined;
        db.close();
        if (!user || !user.password) return null;
        const valid = await bcrypt.compare(credentials.password as string, user.password);
        if (!valid) {
          recordLoginFailure({ userId: user.id, reason: 'invalid_password' });
          return null;
        }
        // isFrozen：允许登录，业务侧限制折扣价与下单/询价

        if (isAdminEmail(user.email)) {
          const writeDb = new Database(DB_PATH);
          ensureAdminRoleInDb(writeDb, user.id, user.email);
          writeDb.close();
        }

        const cookieStore = await cookies();
        const mergeVerified = cookieStore.get(MERGE_VERIFIED_COOKIE)?.value === user.id;
        if (mergeVerified) {
          // Set after registration or account merge; skips second Turnstile challenge.
          cookieStore.delete(MERGE_VERIFIED_COOKIE);
        } else {
          const token = credentials.turnstileToken as string | undefined;
          const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
          const secretKey = process.env.TURNSTILE_SECRET_KEY ?? '';
          const isTestSiteKey = siteKey.startsWith('1x0000') || !siteKey;
          const isTestSecretKey = secretKey.startsWith('1x0000') || !secretKey;

          if (token) {
            const valid = await verifyTurnstile(token);
            if (!valid) {
              recordLoginFailure({ userId: user.id, reason: 'turnstile' });
              return null;
            }
          } else if (!isTestSiteKey && !isTestSecretKey) {
            recordLoginFailure({ userId: user.id, reason: 'turnstile_missing' });
            return null;
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          mfaRequired: isUserMfaEnabled(user.id),
        };
      },
    }),
  ],
  events: {
    async signIn({ user, account }) {
      const signInEmail = user.email || getWeChatEmail(account?.providerAccountId);
      if (!signInEmail) return;
      try {
        const db = new Database(DB_PATH);
        let loginUserId: string | null = null;
        if (account?.provider === 'google') {
          const linked = account.providerAccountId ? db.prepare(`
            SELECT User.id
            FROM Account
            JOIN User ON User.id = Account.userId
            WHERE Account.provider = ? AND Account.providerAccountId = ?
          `).get('google', account.providerAccountId) as { id: string } | undefined : undefined;
          const normalizedSignInEmail = normalizeEmail(signInEmail);
          const existing = linked ?? db.prepare(
            'SELECT id FROM User WHERE lower(email) = ? OR lower(googleEmail) = ?'
          ).get(normalizedSignInEmail, normalizedSignInEmail) as { id: string } | undefined;
          if (existing) {
            loginUserId = existing.id;
            ensureAdminRoleInDb(db, existing.id, normalizedSignInEmail);
            const updates: string[] = ['googleEmail = ?'];
            const params: (string | null)[] = [signInEmail];
            if (user.image && user.image.startsWith('http')) {
              updates.push('avatar = ?');
              params.push(user.image);
            }
            if (user.name) {
              updates.push('name = ?');
              params.push(user.name);
            }
            updates.push('updatedAt = ?');
            params.push(new Date().toISOString());
            params.push(existing.id);
            db.prepare(`UPDATE User SET ${updates.join(', ')} WHERE id = ?`).run(...params);
          }
        } else if (account && isWeChatProvider(account.provider)) {
          const linked = db.prepare(`
            SELECT User.id
            FROM Account
            JOIN User ON User.id = Account.userId
            WHERE Account.provider = ? AND Account.providerAccountId = ?
          `).get('wechat', account.providerAccountId) as { id: string } | undefined;
          if (linked) {
            loginUserId = linked.id;
            applyWeChatProfileSql(db, linked.id, {
              name: user.name,
              image: user.image,
              sex: (user as { sex?: number }).sex,
            });
          }
        }
        if (!loginUserId && user?.id && account?.provider !== 'google' && !isWeChatProvider(account?.provider ?? '')) {
          loginUserId = user.id;
        }
        if (loginUserId) {
          const isMfaVerify = account?.provider === 'mfa-verify';
          const mfaEnabled = db.prepare('SELECT enabled FROM MfaSetting WHERE userId = ?').get(loginUserId) as { enabled: number } | undefined;
          if (isMfaVerify || !mfaEnabled?.enabled) {
            recordSecurityEvent(db, {
              userId: loginUserId,
              eventType: 'LOGIN_SUCCESS',
              metadata: { provider: account?.provider ?? 'unknown' },
            });
          }
        }
        db.close();
      } catch (e) {
        console.error('[events.signIn] error:', e);
      }
    },
  },
  callbacks: {
    async redirect({ url, baseUrl }) {
      if (url.startsWith('/') && !url.startsWith('//')) return `${baseUrl}${url}`;
      try {
        const target = new URL(url);
        if (target.origin === new URL(baseUrl).origin) return url;
      } catch {
        // Reject protocol-relative and malformed callback targets.
      }
      return baseUrl;
    },
    async signIn({ user, account, profile }) {
      if (account?.provider === 'mfa-verify') return true;

      if (account?.provider === 'credentials' && (user as { mfaRequired?: boolean }).mfaRequired) {
        return maybeMfaRedirect(user.id as string, 'credentials', await resolveAuthReturnPath());
      }

      if (account?.provider === WECHAT_MINI_LOGIN_PROVIDER_ID) {
        return maybeMfaRedirect(user.id as string, 'wechat-mini', await resolveAuthReturnPath());
      }

      if (account?.provider === 'google') {
        const providerAccountId = account.providerAccountId;
        const googleEmail = user.email?.toLowerCase();
        if (!providerAccountId || !googleEmail) return '/register?oauth=google';
        const googleEmailVerified = (profile as { email_verified?: boolean | string } | undefined)?.email_verified;
        if (googleEmailVerified !== true && googleEmailVerified !== 'true') {
          return '/login?error=GoogleEmailUnverified';
        }

        const db = new Database(DB_PATH);
        try {
          const linked = db.prepare(`
            SELECT User.id, User.email
            FROM Account
            JOIN User ON User.id = Account.userId
            WHERE Account.provider = ? AND Account.providerAccountId = ?
          `).get('google', providerAccountId) as { id: string; email: string } | undefined;

          const linkTarget = await resolveLinkingUserId(db, 'google');
          const currentUser = linkTarget
            ? db.prepare('SELECT id, email FROM User WHERE id = ?').get(linkTarget.userId) as { id: string; email: string } | undefined
            : undefined;

          if (currentUser) {
            if (linked && linked.id !== currentUser.id) {
              return `/account/settings?${linkConflictParam('google')}`;
            }
            if (!linked) {
              if (oauthEmailTakenByOtherUser(db, currentUser.id, googleEmail)) {
                return `/account/settings?${linkConflictParam('google')}`;
              }
              insertAccount(db, currentUser.id, account);
              db.prepare('UPDATE User SET googleEmail = ?, updatedAt = ? WHERE id = ?').run(googleEmail, new Date().toISOString(), currentUser.id);
            }
            ensureAdminRoleInDb(db, currentUser.id, googleEmail);
            user.email = currentUser.email;
            user.id = currentUser.id;
            await clearAccountLinkIntentCookie();
            const mfaRedirect = await maybeMfaRedirect(currentUser.id, 'google', await resolveAuthReturnPath(linkTarget?.callbackUrl));
            if (!shouldIssueSessionForProviderLink(mfaRedirect)) return mfaRedirect;
            return true;
          }

          if (linked) {
            ensureAdminRoleInDb(db, linked.id, googleEmail);
            user.email = linked.email;
            user.id = linked.id;
            return maybeMfaRedirect(linked.id, 'google', await resolveAuthReturnPath());
          }

          const googleReturnPath = await resolveAuthReturnPath();
          return await redirectWithPendingOAuth(
            account,
            'google',
            withAuthCallback(`/register?oauth=google&email=${encodeURIComponent(googleEmail)}`, googleReturnPath),
            { mode: 'register', oauthEmail: googleEmail, oauthName: user.name ?? undefined, oauthImage: user.image ?? undefined },
          );
        } catch (e) {
          console.error('[callbacks.signIn.google] error:', e);
          return '/login?error=GoogleLink';
        } finally {
          db.close();
        }
      }

      if (!account || !isWeChatProvider(account.provider)) return true;

      const providerAccountId = account.providerAccountId;
      if (!providerAccountId) return withAuthCallback('/register?wechat=unlinked', await resolveAuthReturnPath());

      const db = new Database(DB_PATH);
      try {
        const linked = db.prepare(`
          SELECT User.id, User.email
          FROM Account
          JOIN User ON User.id = Account.userId
          WHERE Account.provider = ? AND Account.providerAccountId = ?
        `).get('wechat', providerAccountId) as { id: string; email: string } | undefined;

        const linkTarget = await resolveLinkingUserId(db, 'wechat');
        const currentUser = linkTarget
          ? db.prepare('SELECT id, email FROM User WHERE id = ?').get(linkTarget.userId) as { id: string; email: string } | undefined
          : undefined;

        if (currentUser) {
          if (linked && linked.id !== currentUser.id) {
            return `/account/settings?${linkConflictParam('wechat')}`;
          }
          if (!linked) {
            insertAccount(db, currentUser.id, account);
          }
          user.email = currentUser.email;
          user.id = currentUser.id;
          await clearAccountLinkIntentCookie();
          const mfaRedirect = await maybeMfaRedirect(currentUser.id, 'wechat', await resolveAuthReturnPath(linkTarget?.callbackUrl));
          if (!shouldIssueSessionForProviderLink(mfaRedirect)) return mfaRedirect;
          return true;
        }

        if (linked) {
          user.email = linked.email;
          user.id = linked.id;
          return maybeMfaRedirect(linked.id, 'wechat', await resolveAuthReturnPath());
        }

        const wechatReturnPath = await resolveAuthReturnPath();
        return await redirectWithPendingOAuth(
          account,
          'wechat',
          withAuthCallback('/register?wechat=unlinked', wechatReturnPath),
          {
            mode: 'register',
            oauthName: user.name,
            oauthImage: user.image,
            oauthSex: (user as { sex?: number }).sex,
          },
        );
      } catch (e) {
        console.error('[callbacks.signIn.wechat] error:', e);
        return '/login?error=WechatLink';
      } finally {
        db.close();
      }
    },
    async jwt({ token, user, account }) {
      if (user) {
        token.email = user.email || getWeChatEmail(account?.providerAccountId) || undefined;
        token.picture = user.image || undefined;
        const mfaUser = user as { mfaVerifiedAt?: number; mfaMethod?: 'totp' | 'recovery' | 'passkey' };
        if (account?.provider === 'mfa-verify' && mfaUser.mfaVerifiedAt && mfaUser.mfaMethod) {
          token.authLevel = 'mfa_verified';
          token.mfaVerifiedAt = mfaUser.mfaVerifiedAt;
          token.mfaMethod = mfaUser.mfaMethod;
          token.sessionId = token.sessionId ?? randomBytes(16).toString('base64url');
        } else {
          token.authLevel = 'primary_verified';
          token.mfaVerifiedAt = null;
          token.mfaMethod = null;
        }
        if (!token.sessionId && account?.provider !== 'mfa-verify') {
          token.sessionId = token.sessionId ?? randomBytes(16).toString('base64url');
        }
        // Google OAuth 'user.id' is the provider sub-id (e.g. 'google:123'), NOT our DB ID.
        // We must look up the real DB ID using the email.
        if (account && isWeChatProvider(account.provider)) {
           try {
             const db = new Database(DB_PATH, { readonly: true });
             const dbUser = db.prepare(`
               SELECT User.id, User.email
               FROM Account
               JOIN User ON User.id = Account.userId
               WHERE Account.provider = ? AND Account.providerAccountId = ?
             `).get(WECHAT_WEB_PROVIDER_ID, account.providerAccountId) as { id: string; email: string } | undefined;
             db.close();
             if (dbUser) {
               token.id = dbUser.id;
               token.email = dbUser.email;
             }
           } catch {}
        } else if (account?.provider === 'google') {
           try {
             const db = new Database(DB_PATH, { readonly: true });
             const linked = db.prepare(`
               SELECT User.id, User.email
               FROM Account
               JOIN User ON User.id = Account.userId
               WHERE Account.provider = ? AND Account.providerAccountId = ?
             `).get('google', account.providerAccountId) as { id: string; email: string } | undefined;
             const normalizedEmail = token.email ? normalizeEmail(token.email) : '';
             const dbUser = linked ?? (normalizedEmail ? db.prepare(
               'SELECT id, email FROM User WHERE lower(email) = ? OR lower(googleEmail) = ?'
             ).get(normalizedEmail, normalizedEmail) as { id: string; email: string } | undefined : undefined);
             db.close();
             if (dbUser) {
               token.id = dbUser.id;
               token.email = dbUser.email;
             }
           } catch {}
        } else {
           token.id = user.id as string;
        }
      } else if (token.email && !token.id) {
        // Fallback for subsequent requests if ID is missing
        try {
          const db = new Database(DB_PATH, { readonly: true });
          const dbUser = db.prepare('SELECT id FROM User WHERE lower(email) = ?').get(normalizeEmail(token.email)) as { id: string } | undefined;
          db.close();
          if (dbUser) token.id = dbUser.id;
        } catch {}
      }
      if (user && typeof token.id === 'string' && typeof token.sessionId === 'string') {
        try {
          const expiresAt = typeof token.exp === 'number' ? new Date(token.exp * 1000) : null;
          await registerSecuritySession({ userId: token.id, sessionId: token.sessionId, expiresAt });
        } catch (error) {
          console.error('[auth.session] security session registration failed:', error instanceof Error ? error.message : 'unknown');
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.image = typeof token.picture === 'string' ? token.picture : null;
        session.user.authLevel = token.authLevel === 'mfa_verified' ? 'mfa_verified' : 'primary_verified';
        session.user.mfaVerifiedAt = typeof token.mfaVerifiedAt === 'number' ? token.mfaVerifiedAt : null;
        session.user.mfaMethod = token.mfaMethod === 'totp' || token.mfaMethod === 'recovery' || token.mfaMethod === 'passkey' ? token.mfaMethod : null;
        session.user.sessionId = typeof token.sessionId === 'string' ? token.sessionId : null;
        // 直接调用 auth() 的接口不会走 requireActiveSession。在回调里拒绝
        // 缺失、已撤销或已过期的服务端会话，避免撤销后的 JWT 继续使用。
        const userId = typeof session.user.id === 'string' ? session.user.id : '';
        const sessionId = session.user.sessionId ?? '';
        if (!userId || !sessionId || !(await sessionHasActiveServerRecord(userId, sessionId))) {
          return unauthenticatedSession(session.expires);
        }
        // Fetch real role and avatar from DB, fallback to email lookup
        try {
          const db = new Database(DB_PATH, { readonly: true });
          let roleUser = db.prepare('SELECT role, avatar, displayAvatarUrl FROM User WHERE id = ?').get(token.id as string) as { role: string; avatar: string | null; displayAvatarUrl: string | null } | undefined;

          if (!roleUser && token.email) {
             const normalizedEmail = normalizeEmail(token.email as string);
             roleUser = db.prepare('SELECT role, avatar, displayAvatarUrl FROM User WHERE lower(email) = ?').get(normalizedEmail) as { role: string; avatar: string | null; displayAvatarUrl: string | null } | undefined;
             if (roleUser) {
                const idUser = db.prepare('SELECT id FROM User WHERE lower(email) = ?').get(normalizedEmail) as { id: string } | undefined;
                if (idUser) session.user.id = idUser.id;
             }
          }
          if (roleUser?.displayAvatarUrl || roleUser?.avatar) {
            session.user.image = roleUser.displayAvatarUrl || roleUser.avatar;
          }
          db.close();
          const resolvedRole = resolveSessionRole(roleUser?.role, token.email as string | undefined);
          (session.user).role = resolvedRole;
          if (resolvedRole === 'admin' && session.user.id && isAdminEmail(token.email as string)) {
            try {
              const writeDb = new Database(DB_PATH);
              ensureAdminRoleInDb(writeDb, session.user.id, token.email as string);
              writeDb.close();
            } catch {}
          }
        } catch {
          (session.user).role = resolveSessionRole(undefined, token.email as string | undefined);
        }
      }
      return session;
    },
  },
});
