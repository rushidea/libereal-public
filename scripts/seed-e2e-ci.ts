/**
 * Synthetic account and product rows for Playwright smoke tests on an empty CI database.
 */
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const dbPath = process.env.DATABASE_PATH || resolve(process.cwd(), 'prisma/ci.db');
const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  await prisma.user.upsert({
    where: { email: 'e2e-customer@example.invalid' },
    create: {
      email: 'e2e-customer@example.invalid',
      name: 'Synthetic E2E Customer',
      role: 'customer',
    },
    update: {
      name: 'Synthetic E2E Customer',
      role: 'customer',
    },
  });

  await prisma.user.upsert({
    where: { email: 'e2e-admin@example.invalid' },
    create: {
      email: 'e2e-admin@example.invalid',
      name: 'Synthetic E2E Admin',
      role: 'admin',
    },
    update: {
      name: 'Synthetic E2E Admin',
      role: 'admin',
    },
  });

  await prisma.product.upsert({
    where: { brand_catalogNumber: { brand: 'Libereal Test', catalogNumber: 'MA121315' } },
    create: {
      catalogNumber: 'MA121315',
      name: 'E2E Test Anti-CD3 Antibody',
      brand: 'Libereal Test',
      price: 1280,
      category: '一抗',
      inStock: true,
    },
    update: {
      name: 'E2E Test Anti-CD3 Antibody',
      brand: 'Libereal Test',
      price: 1280,
      category: '一抗',
      inStock: true,
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
