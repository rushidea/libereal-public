import crypto from 'crypto';
import { getEphemeralStore } from '@/lib/ephemeral-store';
import { prisma } from '@/lib/prisma';

const SMS_CODE_TTL_MS = 10 * 60 * 1000;
const SMS_IDENTIFIER_PREFIX = 'sms';

export type SmsVerificationPurpose = 'register' | 'phone-change' | 'reset-password' | 'security';

export function normalizeChinaMobilePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  const normalized = digits.startsWith('86') && digits.length === 13 ? digits.slice(2) : digits;
  return /^1[3-9]\d{9}$/.test(normalized) ? normalized : null;
}

export function generateSmsCode(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

function getSmsCodeSecret(): string {
  return process.env.SMS_CODE_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'local-sms-code-secret';
}

export function hashSmsCode(phone: string, code: string, purpose: SmsVerificationPurpose): string {
  return crypto
    .createHash('sha256')
    .update(`${SMS_IDENTIFIER_PREFIX}:${purpose}:${phone}:${code}:${getSmsCodeSecret()}`)
    .digest('hex');
}

export function getSmsVerificationIdentifier(phone: string, purpose: SmsVerificationPurpose): string {
  return `${SMS_IDENTIFIER_PREFIX}:${purpose}:${phone}`;
}

export async function storeSmsVerificationCode(
  phone: string,
  code: string,
  purpose: SmsVerificationPurpose,
): Promise<void> {
  const identifier = getSmsVerificationIdentifier(phone, purpose);
  await getEphemeralStore().set(`verification:${identifier}`, hashSmsCode(phone, code, purpose), SMS_CODE_TTL_MS);
}

export async function verifySmsCode(
  phone: string,
  code: string,
  purpose: SmsVerificationPurpose,
): Promise<boolean> {
  const identifier = getSmsVerificationIdentifier(phone, purpose);
  const token = hashSmsCode(phone, code.trim(), purpose);
  if (await getEphemeralStore().compareAndDelete(`verification:${identifier}`, token)) return true;
  const legacy = await prisma.verificationToken.findFirst({ where: { identifier, token, expires: { gt: new Date() } } });
  if (!legacy) return false;
  await prisma.verificationToken.deleteMany({ where: { identifier } });
  return true;
}
