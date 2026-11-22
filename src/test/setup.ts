import '@testing-library/jest-dom';
import { afterAll } from 'vitest';
import { testDatabasePath } from './test-database-path';

async function disconnectTestPrisma() {
  const prisma = globalThis.prisma;
  globalThis.prisma = undefined;
  await prisma?.$disconnect();
}

// Setup runs before test imports, including imports that capture the database path.
await disconnectTestPrisma();
const previousDatabasePath = process.env.DATABASE_PATH;
process.env.DATABASE_PATH = testDatabasePath('libereal-test');

afterAll(async () => {
  try {
    await disconnectTestPrisma();
  } finally {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
  }
});
