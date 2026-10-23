import { admitPasswordResetEmail } from '@/lib/password-reset-rate-limit';
import { prisma } from '@/lib/prisma';

async function main() {
  const ip = process.env.RESET_TEST_IP;
  const email = process.env.RESET_TEST_EMAIL;
  if (!ip || !email || !process.env.DATABASE_PATH) throw new Error('password reset test environment missing');
  const admitted = await admitPasswordResetEmail(ip, email);
  process.stdout.write(String(admitted));
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
