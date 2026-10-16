import { isPlaceholderOAuthEmail, normalizeEmail } from '@/lib/auth-helpers';
import { prisma } from '@/lib/prisma';

export type MailboxIdentity = {
  email?: string | null;
  emailVerified?: Date | string | null;
};

export function normalizedEmailEquals(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return normalizeEmail(left) === normalizeEmail(right);
}

/** Mailbox that has been proven. Placeholder addresses never count, even if a timestamp is set. */
export function verifiedMailboxEmail(identity: MailboxIdentity | null | undefined): string | null {
  if (!identity?.email || identity.emailVerified == null || identity.emailVerified === '') return null;
  if (isPlaceholderOAuthEmail(identity.email)) return null;
  return normalizeEmail(identity.email);
}

export function verifiedEmailMatches(identity: MailboxIdentity | null | undefined, recordEmail: string | null | undefined): boolean {
  const mailbox = verifiedMailboxEmail(identity);
  return mailbox !== null && normalizedEmailEquals(mailbox, recordEmail);
}

/** Stored mailbox text for exact database filters. Comparison still treats email case as insignificant. */
export function verifiedStoredEmail(identity: MailboxIdentity | null | undefined): string | null {
  if (!identity?.email || !verifiedMailboxEmail(identity)) return null;
  return identity.email;
}

export async function emailKeyedAccess(userId: string, recordEmail: string | null | undefined): Promise<boolean> {
  if (!recordEmail) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, emailVerified: true },
  });
  return verifiedEmailMatches(user, recordEmail);
}
