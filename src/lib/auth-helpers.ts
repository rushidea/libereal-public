const ADMIN_EMAILS = (process.env.ADMIN_EMAILS ?? 'icylix@gmail.com')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const WECHAT_EMAIL_DOMAIN = 'wechat.local';
export const ACCOUNT_LINK_COOKIE = 'account-link-intent';
export const PENDING_OAUTH_COOKIE = 'pending-oauth-link';
export const MERGE_VERIFIED_COOKIE = 'merge-verified';

const BCRYPT_HASH_PREFIX = /^\$2[aby]\$\d{2}\$/;

export function isBcryptHash(password: string | null | undefined): boolean {
  return typeof password === 'string' && BCRYPT_HASH_PREFIX.test(password);
}

export function isGoogleAuthConfigured(): boolean {
  return !!(
    process.env.AUTH_GOOGLE_ID?.trim() &&
    process.env.AUTH_GOOGLE_SECRET?.trim()
  );
}

/**
 * Runtime toggle for the Google login UI. It is shown by default and can be
 * hidden only through an explicit NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED=false setting.
 */
export function isGoogleLoginEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_LOGIN_ENABLED !== 'false';
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPlaceholderOAuthEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return normalizeEmail(email).endsWith(`@${WECHAT_EMAIL_DOMAIN}`);
}

export function userHasPassword(password: string | null | undefined): boolean {
  return isBcryptHash(password);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(normalizeEmail(email));
}

export function resolveSessionRole(
  dbRole: string | null | undefined,
  email: string | null | undefined,
): string {
  if (dbRole === 'admin' || isAdminEmail(email)) return 'admin';
  return dbRole ?? 'customer';
}

export function isOAuthAvatarUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && url.startsWith('http');
}

/** WeChat profile.sex: 0=unknown, 1=male, 2=female */
export function normalizeWeChatSex(sex: unknown): number | undefined {
  if (typeof sex !== 'number' || !Number.isInteger(sex)) return undefined;
  if (sex === 0 || sex === 1 || sex === 2) return sex;
  return undefined;
}

export type WeChatOAuthProfile = {
  name?: string | null;
  image?: string | null;
  sex?: number | null;
};

/** Fields to persist when a user links or signs in with WeChat. */
export function wechatProfileUpdates(
  existing: {
    name?: string | null;
    wechatNickname?: string | null;
    displayAvatarUrl?: string | null;
    sex?: number | null;
  },
  profile: WeChatOAuthProfile,
): {
  avatar?: string;
  name?: string;
  wechatNickname?: string;
  displayAvatarUrl?: string;
  sex?: number;
} {
  const updates: {
    avatar?: string;
    name?: string;
    wechatNickname?: string;
    displayAvatarUrl?: string;
    sex?: number;
  } = {};

  if (isOAuthAvatarUrl(profile.image)) {
    updates.avatar = profile.image;
    if (!existing.displayAvatarUrl?.trim()) {
      updates.displayAvatarUrl = profile.image;
    }
  }
  if (profile.name?.trim()) {
    updates.name = profile.name.trim();
    if (!existing.wechatNickname?.trim()) {
      updates.wechatNickname = profile.name.trim();
    }
  }

  const sex = normalizeWeChatSex(profile.sex);
  if (sex !== undefined && existing.sex == null) {
    updates.sex = sex;
  }

  return updates;
}
