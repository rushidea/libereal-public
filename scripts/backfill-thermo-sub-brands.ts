/**
 * Move Fisher BioReagents (FB catalog) to an independent brand and normalize Thermo aliases.
 * Run: npx tsx scripts/backfill-thermo-sub-brands.ts [--dry-run]
 */
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DB_PATH = process.env.DATABASE_PATH || resolve(process.cwd(), 'prisma/dev.db');
const DRY_RUN = process.argv.includes('--dry-run');

const adapter = new PrismaBetterSqlite3({ url: `file:${DB_PATH}` });
const prisma = new PrismaClient({ adapter });

async function main() {
  const fisherBioWhere = {
    catalogNumber: { startsWith: 'FB' },
  } as const;

  const invariantWhere = {
    brand: 'Thermo Fisher',
    subBrand: 'invariant',
  } as const;

  if (DRY_RUN) {
    const [fisherBio, invariant] = await Promise.all([
      prisma.product.count({ where: fisherBioWhere }),
      prisma.product.count({ where: invariantWhere }),
    ]);
    console.log('[dry-run] would update:', { fisherBioReagents: fisherBio, invariant });
    return;
  }

  const fisherBio = await prisma.product.updateMany({
    where: fisherBioWhere,
    data: { brand: 'Fisher BioReagents', subBrand: null },
  });
  const invariant = await prisma.product.updateMany({
    where: invariantWhere,
    data: { subBrand: 'Invariant' },
  });

  console.log('Updated subBrands:', { fisherBioReagents: fisherBio.count, invariant: invariant.count });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
