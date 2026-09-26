import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { sendMail } from '@/lib/mail';
import { sendAliyunSmsCode } from '@/lib/aliyun-sms';
import { getEphemeralStore } from '@/lib/ephemeral-store';
import { getMfaAuthenticatorPresence, createMfaStepUpChallenge, verifyMfaStepUpChallenge } from './mfa-service';
import type { MfaStepUpVerification } from './mfa-service';
import { enforceMfaRateLimits } from './mfa-rate-limit';
import { isMfaPhase1Enabled } from './mfa-config';

export const SECURITY_STEP_UP_METHODS = ['totp', 'sms', 'email'] as const;
export type SecurityStepUpMethod = typeof SECURITY_STEP_UP_METHODS[number];

export const SECURITY_STEP_UP_ACTIONS = [
  'password_change',
  'password_setup',
  'passkey_add',
  'passkey_delete',
  'mfa_disable',
  'recovery_codes',
  'security_session_revoke',
  'security_device_remove',
  'admin_mfa_policy',
  'admin_sensitive',
  'organization_permissions',
] as const;
export type SecurityStepUpAction = typeof SECURITY_STEP_UP_ACTIONS[number];

const CODE_TTL_MS = 10 * 60 * 1000;
const GRANT_TTL_MS = 5 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

type StepUpIntent = {
  userId: string;
  sessionId: string;
  action: SecurityStepUpAction;
  method: SecurityStepUpMethod;
  codeHash?: string;
  attempts?: number;
};

function intentKey(challengeId: string): string {
  return `security-step-up:intent:${challengeId}`;
}

function grantKey(token: string): string {
  return `security-step-up:grant:${createHmac('sha256', getSecret()).update(token).digest('hex')}`;
}

function getSecret(): string {
  return process.env.SECURITY_CODE_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'local-security-code-secret';
}

function hashCode(userId: string, action: SecurityStepUpAction, method: SecurityStepUpMethod, code: string): string {
  return createHmac('sha256', getSecret()).update(`${userId}:${action}:${method}:${code}`).digest('hex');
}

function isMethod(value: unknown): value is SecurityStepUpMethod {
  return typeof value === 'string' && (SECURITY_STEP_UP_METHODS as readonly string[]).includes(value);
}

export function isSecurityStepUpAction(value: unknown): value is SecurityStepUpAction {
  return typeof value === 'string' && (SECURITY_STEP_UP_ACTIONS as readonly string[]).includes(value);
}

export async function getSecurityStepUpAvailability(userId: string): Promise<{
  methods: SecurityStepUpMethod[];
  preferredMethod: SecurityStepUpMethod | null;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true, phone: true, phoneVerifiedAt: true },
  });
  if (!user) return { methods: [], preferredMethod: null };

  const presence = getMfaAuthenticatorPresence(userId);
  const methods: SecurityStepUpMethod[] = [];
  if (presence.hasTotp && isMfaPhase1Enabled()) methods.push('totp');
  if (user.phone && user.phoneVerifiedAt) methods.push('sms');
  if (user.email && user.emailVerified) methods.push('email');
  return { methods, preferredMethod: methods[0] ?? null };
}

async function enforceStartRateLimit(userId: string, action: SecurityStepUpAction, method: SecurityStepUpMethod, ip?: string | null): Promise<void> {
  const result = await enforceMfaRateLimits({
    userId,
    provider: `security-step-up:${action}:${method}`,
    ip,
    setup: true,
  });
  if (!result.allowed) throw new Error('SECURITY_STEP_UP_RATE_LIMITED');
}

async function recordStepUpEvent(input: {
  userId: string;
  eventType: 'SECURITY_STEP_UP_SUCCESS' | 'SECURITY_STEP_UP_FAILED';
  action: SecurityStepUpAction;
  method: SecurityStepUpMethod;
  ip?: string | null;
  reason?: string;
}): Promise<void> {
  await prisma.securityEvent.create({
    data: {
      userId: input.userId,
      eventType: input.eventType,
      ip: input.ip ?? null,
      metadata: JSON.stringify({ action: input.action, method: input.method, ...(input.reason ? { reason: input.reason } : {}) }),
    },
  });
}

async function sendVerificationCode(input: {
  userId: string;
  action: SecurityStepUpAction;
  method: 'sms' | 'email';
  phone?: string | null;
  email?: string | null;
}): Promise<string> {
  const code = randomInt(100000, 1_000_000).toString();
  if (input.method === 'sms') {
    if (!input.phone) throw new Error('SECURITY_STEP_UP_METHOD_UNAVAILABLE');
    await sendAliyunSmsCode(input.phone, code, 'security');
  } else {
    if (!input.email) throw new Error('SECURITY_STEP_UP_METHOD_UNAVAILABLE');
    const actionLabel = input.action === 'password_change' || input.action === 'password_setup' ? '修改密码' : '安全设置变更';
    const result = await sendMail({
      to: input.email,
      subject: `LIBEREAL · ${actionLabel}验证码`,
      text: `本次${actionLabel}验证码：${code}。验证码将在 10 分钟后失效，请勿转发给他人。`,
      html: `<p>本次${actionLabel}验证码：<strong style="font-size:20px;letter-spacing:2px">${code}</strong></p><p>验证码将在 10 分钟后失效，请勿转发给他人。</p>`,
    });
    if (!result.ok || (process.env.NODE_ENV === 'production' && result.skipped)) {
      throw new Error('SECURITY_STEP_UP_DELIVERY_FAILED');
    }
  }
  return code;
}

export async function startSecurityStepUp(input: {
  userId: string;
  sessionId: string;
  action: SecurityStepUpAction;
  method: SecurityStepUpMethod;
  ip?: string | null;
}): Promise<{ challengeId: string; method: SecurityStepUpMethod; expiresAt: Date; challengeToken?: string }> {
  await enforceStartRateLimit(input.userId, input.action, input.method, input.ip);
  const availability = await getSecurityStepUpAvailability(input.userId);
  if (!availability.methods.includes(input.method)) throw new Error('SECURITY_STEP_UP_METHOD_UNAVAILABLE');

  const challengeId = randomUUID();
  const store = getEphemeralStore();
  const intent: StepUpIntent = {
    userId: input.userId,
    sessionId: input.sessionId,
    action: input.action,
    method: input.method,
  };

  if (input.method === 'totp') {
    const challenge = await createMfaStepUpChallenge(input.userId, input.ip);
    await store.set(intentKey(challenge.id), JSON.stringify(intent), CODE_TTL_MS);
    return { challengeId: challenge.id, method: input.method, expiresAt: challenge.expiresAt, challengeToken: challenge.token };
  }

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { email: true, phone: true },
  });
  const code = await sendVerificationCode({
    userId: input.userId,
    action: input.action,
    method: input.method,
    email: user?.email,
    phone: user?.phone,
  });
  intent.codeHash = hashCode(input.userId, input.action, input.method, code);
  intent.attempts = 0;
  await store.set(intentKey(challengeId), JSON.stringify(intent), CODE_TTL_MS);
  return { challengeId, method: input.method, expiresAt: new Date(Date.now() + CODE_TTL_MS) };
}

function sameHash(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export async function completeSecurityStepUp(input: {
  challengeId: string;
  userId: string;
  sessionId: string;
  action: SecurityStepUpAction;
  method: SecurityStepUpMethod;
  code: string;
  totpToken?: string | null;
  ip?: string | null;
}): Promise<{ grantToken: string; verifiedAt: number } | { error: 'invalid' | 'expired' | 'locked' | 'rate_limited' }> {
  const store = getEphemeralStore();
  const key = intentKey(input.challengeId);
  const raw = await store.get(key);
  if (!raw) return { error: 'expired' };

  let intent: StepUpIntent;
  try {
    intent = JSON.parse(raw) as StepUpIntent;
  } catch {
    await store.delete(key);
    return { error: 'invalid' };
  }
  if (intent.userId !== input.userId || intent.sessionId !== input.sessionId || intent.action !== input.action || intent.method !== input.method) {
    return { error: 'invalid' };
  }

  if (input.method === 'totp') {
    if (!input.totpToken) return { error: 'invalid' };
    const result: MfaStepUpVerification = await verifyMfaStepUpChallenge(input.challengeId, input.totpToken, input.userId, input.code, input.ip);
    if (!result.ok) {
      await recordStepUpEvent({ userId: input.userId, eventType: 'SECURITY_STEP_UP_FAILED', action: input.action, method: input.method, ip: input.ip, reason: result.reason });
      if (result.reason === 'expired') return { error: 'expired' };
      if (result.reason === 'locked' || result.reason === 'rate_limited') return { error: result.reason === 'locked' ? 'locked' : 'rate_limited' };
      return { error: 'invalid' };
    }
    await store.compareAndDelete(key, raw);
    await recordStepUpEvent({ userId: input.userId, eventType: 'SECURITY_STEP_UP_SUCCESS', action: input.action, method: input.method, ip: input.ip });
    return issueSecurityStepUpGrant(input.userId, input.sessionId, input.action, result.verifiedAt);
  }

  const lock = await store.acquireLock(`security-step-up:verify-lock:${input.challengeId}`, 5000);
  if (!lock) return { error: 'rate_limited' };
  try {
    const currentRaw = await store.get(key);
    if (!currentRaw) return { error: 'expired' };
    const current = JSON.parse(currentRaw) as StepUpIntent;
    const expected = current.codeHash ?? '';
    const actual = hashCode(input.userId, input.action, input.method, input.code.trim());
    if (!sameHash(expected, actual)) {
      const attempts = (current.attempts ?? 0) + 1;
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await store.delete(key);
        await recordStepUpEvent({ userId: input.userId, eventType: 'SECURITY_STEP_UP_FAILED', action: input.action, method: input.method, ip: input.ip, reason: 'locked' });
        return { error: 'locked' };
      }
      await store.set(key, JSON.stringify({ ...current, attempts }), CODE_TTL_MS);
      await recordStepUpEvent({ userId: input.userId, eventType: 'SECURITY_STEP_UP_FAILED', action: input.action, method: input.method, ip: input.ip, reason: 'invalid_code' });
      return { error: 'invalid' };
    }
    if (!(await store.compareAndDelete(key, currentRaw))) return { error: 'invalid' };
    await recordStepUpEvent({ userId: input.userId, eventType: 'SECURITY_STEP_UP_SUCCESS', action: input.action, method: input.method, ip: input.ip });
    return issueSecurityStepUpGrant(input.userId, input.sessionId, input.action, Date.now());
  } finally {
    await store.releaseLock(`security-step-up:verify-lock:${input.challengeId}`, lock);
  }
}

async function issueSecurityStepUpGrant(userId: string, sessionId: string, action: SecurityStepUpAction, verifiedAt: number): Promise<{ grantToken: string; verifiedAt: number }> {
  const grantToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
  await getEphemeralStore().set(grantKey(grantToken), JSON.stringify({ userId, sessionId, action }), GRANT_TTL_MS);
  return { grantToken, verifiedAt };
}

export async function hasSecurityStepUpGrant(token: string, input: { userId: string; sessionId: string; action: SecurityStepUpAction }): Promise<boolean> {
  if (!token || token.length > 256) return false;
  const raw = await getEphemeralStore().get(grantKey(token));
  if (!raw) return false;
  try {
    const grant = JSON.parse(raw) as Partial<StepUpIntent>;
    return grant.userId === input.userId && grant.sessionId === input.sessionId && grant.action === input.action;
  } catch {
    return false;
  }
}

export async function consumeSecurityStepUpGrant(token: string, input: { userId: string; sessionId: string; action: SecurityStepUpAction }): Promise<boolean> {
  if (!token || token.length > 256) return false;
  const store = getEphemeralStore();
  const key = grantKey(token);
  const raw = await store.get(key);
  if (!raw) return false;
  try {
    const grant = JSON.parse(raw) as Partial<StepUpIntent>;
    if (grant.userId !== input.userId || grant.sessionId !== input.sessionId || grant.action !== input.action) return false;
    return store.compareAndDelete(key, raw);
  } catch {
    return false;
  }
}

export function isSecurityStepUpMethod(value: unknown): value is SecurityStepUpMethod {
  return isMethod(value);
}
