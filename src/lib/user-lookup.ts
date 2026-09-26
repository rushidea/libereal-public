import { prisma } from './prisma';
import { normalizeEmail } from './auth-helpers';

type UserRow = {
  id: string;
  email: string;
  password: string | null;
  googleEmail: string | null;
};

export async function findUserByEmailCaseInsensitive(
  email: string,
): Promise<UserRow | null> {
  const normalized = normalizeEmail(email);
  const users = await prisma.$queryRaw<UserRow[]>`
    SELECT id, email, password, googleEmail
    FROM User
    WHERE lower(email) = ${normalized}
    LIMIT 1
  `;
  return users[0] ?? null;
}

export async function findUserByOAuthEmailCaseInsensitive(
  email: string,
): Promise<UserRow | null> {
  const normalized = normalizeEmail(email);
  const users = await prisma.$queryRaw<UserRow[]>`
    SELECT id, email, password, googleEmail
    FROM User
    WHERE lower(email) = ${normalized} OR lower(googleEmail) = ${normalized}
    LIMIT 1
  `;
  return users[0] ?? null;
}
