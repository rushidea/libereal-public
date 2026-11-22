import '@testing-library/jest-dom';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
const previousTestDirectory = process.env.LIBEREAL_TEST_DB_DIR;
const configuredRoot = process.env.LIBEREAL_TEST_DB_ROOT?.trim();
const cacheDirectory = configuredRoot ? resolve(configuredRoot) : resolve('.tmp-ci-cache', 'vitest');
mkdirSync(cacheDirectory, { recursive: true, mode: 0o700 });
const suiteDirectory = mkdtempSync(join(cacheDirectory, 'suite-'));
process.env.LIBEREAL_TEST_DB_DIR = suiteDirectory;
process.env.DATABASE_PATH = testDatabasePath('libereal-test');

afterAll(async () => {
  try {
    await disconnectTestPrisma();
  } finally {
    if (previousDatabasePath === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previousDatabasePath;
    if (previousTestDirectory === undefined) delete process.env.LIBEREAL_TEST_DB_DIR;
    else process.env.LIBEREAL_TEST_DB_DIR = previousTestDirectory;
    // This directory was created exclusively for the current test file.
    rmSync(suiteDirectory, { recursive: true });
  }
});
