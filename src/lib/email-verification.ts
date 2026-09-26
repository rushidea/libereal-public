import { createHash, randomInt } from 'crypto';
import { sendMail } from '@/lib/mail';
import { normalizeEmail } from '@/lib/auth-helpers';
import { getEphemeralStore } from '@/lib/ephemeral-store';
import { prisma } from '@/lib/prisma';

const REGISTRATION_EMAIL_PREFIX = 'registration-email:';
const CODE_TTL_MS = 10 * 60 * 1000;

function identifier(email: string): string {
  return `${REGISTRATION_EMAIL_PREFIX}${normalizeEmail(email)}`;
}

function hashCode(email: string, code: string): string {
  return createHash('sha256').update(`${identifier(email)}:${code}`).digest('hex');
}

export async function sendRegistrationEmailCode(rawEmail: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = normalizeEmail(rawEmail);
  const code = String(randomInt(100000, 1_000_000));
  const token = hashCode(email, code);
  const verificationIdentifier = identifier(email);

  const mailResult = await sendMail({
    to: email,
    subject: 'LIBEREAL · 注册邮箱验证码',
    text: `注册邮箱验证码：${code}。验证码将在 10 分钟后失效，请勿转发给他人。`,
    html: `<p>注册邮箱验证码：<strong style="font-size:20px;letter-spacing:2px">${code}</strong></p><p>验证码将在 10 分钟后失效，请勿转发给他人。</p>`,
  });

  if (!mailResult.ok || (process.env.NODE_ENV === 'production' && mailResult.skipped)) {
    return { ok: false, error: '邮箱验证码暂时无法发送，请稍后重试' };
  }

  await getEphemeralStore().set(`verification:${verificationIdentifier}`, token, CODE_TTL_MS);

  return { ok: true };
}

export async function consumeRegistrationEmailCode(rawEmail: string, code: string): Promise<boolean> {
  const email = normalizeEmail(rawEmail);
  const verificationIdentifier = identifier(email);
  const token = hashCode(email, code.trim());
  if (await getEphemeralStore().compareAndDelete(`verification:${verificationIdentifier}`, token)) return true;
  const legacy = await prisma.verificationToken.findUnique({ where: { token }, select: { identifier: true, expires: true } });
  if (!legacy || legacy.identifier !== verificationIdentifier || legacy.expires <= new Date()) return false;
  await prisma.verificationToken.delete({ where: { token } });
  return true;
}
