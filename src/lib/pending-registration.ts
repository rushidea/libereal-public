import { randomBytes } from 'crypto';
import { prisma } from '@/lib/prisma';
import type { LegalAcceptanceSnapshot } from '@/lib/legal-documents';

const PENDING_REGISTRATION_PREFIX = 'pending-registration:';
const PENDING_REGISTRATION_TTL_MS = 15 * 60 * 1000;

export type VerifiedRegistrationProfile = {
  name: string;
  phone: string;
  institution?: string | null;
  fullInstitution: string;
  institutionType?: string;
  institutionName?: string;
  institutionUnit?: string;
  department?: string;
  institutionFacility?: string;
  school: string;
  college: string;
  major: string;
  building: string;
  piLab: string;
  affiliatedLab?: string | null;
  acceptedLegalIds: string[];
  legalAcceptedAt?: string;
  legalAcceptedSnapshot?: LegalAcceptanceSnapshot;
};

function identifier(userId: string): string {
  return `${PENDING_REGISTRATION_PREFIX}${userId}`;
}

export async function storePendingRegistration(
  userId: string,
  profile: VerifiedRegistrationProfile,
): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const registrationIdentifier = identifier(userId);

  await prisma.verificationToken.deleteMany({ where: { identifier: registrationIdentifier } });
  await prisma.verificationToken.create({
    data: {
      identifier: registrationIdentifier,
      token,
      expires: new Date(Date.now() + PENDING_REGISTRATION_TTL_MS),
    },
  });

  await prisma.verificationToken.create({
    data: {
      identifier: `${registrationIdentifier}:payload:${token}`,
      token: JSON.stringify(profile),
      expires: new Date(Date.now() + PENDING_REGISTRATION_TTL_MS),
    },
  });

  return token;
}

export async function consumePendingRegistration(
  userId: string,
  token: string | undefined,
): Promise<VerifiedRegistrationProfile | null> {
  if (!token) return null;

  const registrationIdentifier = identifier(userId);
  const reference = await prisma.verificationToken.findFirst({
    where: {
      identifier: registrationIdentifier,
      token,
      expires: { gt: new Date() },
    },
    select: { token: true },
  });
  if (!reference) return null;

  const payload = await prisma.verificationToken.findFirst({
    where: {
      identifier: `${registrationIdentifier}:payload:${token}`,
      expires: { gt: new Date() },
    },
    select: { token: true },
  });
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload.token) as VerifiedRegistrationProfile;
    await prisma.verificationToken.deleteMany({
      where: {
        identifier: { startsWith: registrationIdentifier },
      },
    });
    return parsed;
  } catch {
    return null;
  }
}
