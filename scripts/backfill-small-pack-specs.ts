/**
 * Backfill missing volume specs for brands with known catalog conventions.
 * Run: npx tsx scripts/backfill-small-pack-specs.ts [--dry-run]
 */
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DB_PATH = process.env.DATABASE_PATH || resolve(process.cwd(), 'prisma/dev.db');
const DRY_RUN = process.argv.includes('--dry-run');

const adapter = new PrismaBetterSqlite3({ url: `file:${DB_PATH}` });
const prisma = new PrismaClient({ adapter });

async function main() {
  const abcamWhere = {
    brand: 'Abcam',
    category: '一抗',
    OR: [{ spec: null }, { spec: '' }],
  } as const;

  const cst20Where = {
    brand: 'CST',
    category: '一抗',
    catalogNumber: { endsWith: 'T' },
    OR: [{ spec: null }, { spec: '' }],
  } as const;

  const cst200Where = {
    brand: 'CST',
    category: '一抗',
    catalogNumber: { endsWith: 'S' },
    OR: [{ spec: null }, { spec: '' }],
  } as const;

  if (DRY_RUN) {
    const [abcam, cst20, cst200] = await Promise.all([
      prisma.product.count({ where: abcamWhere }),
      prisma.product.count({ where: cst20Where }),
      prisma.product.count({ where: cst200Where }),
    ]);
    console.log('[dry-run] would update:', { abcam, cst20, cst200 });
    return;
  }

  const abcam = await prisma.product.updateMany({ where: abcamWhere, data: { spec: '20µL' } });
  const cst20 = await prisma.product.updateMany({ where: cst20Where, data: { spec: '20µL' } });
  const cst200 = await prisma.product.updateMany({ where: cst200Where, data: { spec: '200µL' } });

  console.log('Updated specs:', { abcam: abcam.count, cst20: cst20.count, cst200: cst200.count });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
