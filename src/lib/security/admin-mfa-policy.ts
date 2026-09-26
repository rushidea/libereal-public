import { prisma } from '@/lib/prisma';
import { isAdminEmail } from '@/lib/auth-helpers';
import { isMfaAdminRequired } from './mfa-config';
import { getMfaAuthenticatorPresence } from './mfa-service';

export type AdminAuthenticatorRequirement = 'super_admin' | 'admin';

export interface AdminMfaPolicy {
  required: boolean;
  requirement: AdminAuthenticatorRequirement;
  hasTotp: boolean;
  hasPasskey: boolean;
  satisfied: boolean;
}

async function isSuperAdmin(userId: string, email: string): Promise<boolean> {
  if (isAdminEmail(email)) return true;

  const assignment = await prisma.adminUserRole.findFirst({
    where: { userId, role: { key: 'super_admin' } },
    select: { userId: true },
  });
  return assignment !== null;
}

export async function getAdminMfaPolicy(
  userId: string,
  email: string,
  enforced = isMfaAdminRequired(),
): Promise<AdminMfaPolicy> {
  const requirement: AdminAuthenticatorRequirement = await isSuperAdmin(userId, email) ? 'super_admin' : 'admin';
  if (!enforced) {
    return {
      required: false,
      requirement,
      hasTotp: false,
      hasPasskey: false,
      satisfied: true,
    };
  }

  const presence = getMfaAuthenticatorPresence(userId);
  const satisfied = requirement === 'super_admin'
    ? presence.hasTotp && presence.hasPasskey
    : presence.hasTotp || presence.hasPasskey;

  return { required: true, requirement, ...presence, satisfied };
}
