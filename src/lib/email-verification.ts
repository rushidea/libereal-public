import { createHash, randomInt } from 'crypto';
import { sendMail } from '@/lib/mail';
import { normalizeEmail } from '@/lib/auth-helpers';
import { getEphemeralStore } from '@/lib/ephemeral-store';
import { prisma } from '@/lib/prisma';

const REGISTRATION_EMAIL_PREFIX = 'registration-email:';
const ACCOUNT_EMAIL_PREFIX = 'account-email:';
const CODE_TTL_MS = 10 * 60 * 1000;

function identifier(prefix: string, email: string): string {
  return `${prefix}${normalizeEmail(email)}`;
}

function hashCode(prefix: string, email: string, code: string): string {
  const verificationIdentifier = identifier(prefix, email);
  return createHash('sha256').update(`${verificationIdentifier}:${code}`).digest('hex');
}

async function sendEmailOwnershipCode(
  prefix: string,
  rawEmail: string,
  subject: string,
  label: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normalizeEmail(rawEmail);
  const code = String(randomInt(100000, 1_000_000));
  const token = hashCode(prefix, email, code);
  const verificationIdentifier = identifier(prefix, email);

  const mailResult = await sendMail({
    to: email,
    subject,
    text: `${label}：${code}。验证码将在 10 分钟后失效，请勿转发给他人。`,
    html: `<p>${label}：<strong style="font-size:20px;letter-spacing:2px">${code}</strong></p><p>验证码将在 10 分钟后失效，请勿转发给他人。</p>`,
  });

  if (!mailResult.ok || (process.env.NODE_ENV === 'production' && mailResult.skipped)) {
    return { ok: false, error: '邮箱验证码暂时无法发送，请稍后重试' };
  }

  await getEphemeralStore().set(`verification:${verificationIdentifier}`, token, CODE_TTL_MS);

  return { ok: true };
}

async function consumeEmailOwnershipCode(prefix: string, rawEmail: string, code: string): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  const verificationIdentifier = identifier(prefix, email);
  const token = hashCode(prefix, email, code.trim());
  if (await getEphemeralStore().compareAndDelete(`verification:${verificationIdentifier}`, token)) return true;
  const legacy = await prisma.verificationToken.findUnique({ where: { token }, select: { identifier: true, expires: true } });
  if (!legacy || legacy.identifier !== verificationIdentifier || legacy.expires <= new Date()) return false;
  await prisma.verificationToken.delete({ where: { token } });
  return true;
}

export async function sendRegistrationEmailCode(rawEmail: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return sendEmailOwnershipCode(REGISTRATION_EMAIL_PREFIX, rawEmail, 'LIBEREAL · 注册邮箱验证码', '注册邮箱验证码');
}

export async function consumeRegistrationEmailCode(rawEmail: string, code: string): Promise<boolean> {
  return consumeEmailOwnershipCode(REGISTRATION_EMAIL_PREFIX, rawEmail, code);
}

export async function sendAccountEmailCode(rawEmail: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return sendEmailOwnershipCode(ACCOUNT_EMAIL_PREFIX, rawEmail, 'LIBEREAL · 绑定邮箱验证码', '绑定邮箱验证码');
}

export async function consumeAccountEmailCode(rawEmail: string, code: string): Promise<boolean> {
  return consumeEmailOwnershipCode(ACCOUNT_EMAIL_PREFIX, rawEmail, code);
}
