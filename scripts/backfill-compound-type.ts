import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DB_PATH = process.env.DATABASE_PATH || resolve(process.cwd(), 'prisma/dev.db');
const CATEGORY = '分子生物学';
const SUBCATEGORY = '小分子化合物';
const BATCH_SIZE = 500;

const adapter = new PrismaBetterSqlite3({ url: `file:${DB_PATH}` });
const prisma = new PrismaClient({ adapter });

/** Infer L3 type from product name — matches /api/products type filter logic. */
export function inferCompoundType(name: string): string {
  if (name.includes('抑制剂')) return '抑制剂';
  if (name.includes('拮抗剂')) return '拮抗剂';
  if (name.includes('激动剂') || /\bagonist\b/i.test(name)) return '激动剂';
  return '其它化合物';
}

async function backfillCompoundTypes() {
  console.log(`Database: ${DB_PATH}`);
  console.log(`Scope: ${CATEGORY} / ${SUBCATEGORY}`);

  const products = await prisma.product.findMany({
    where: { category: CATEGORY, subcategory: SUBCATEGORY },
    select: { id: true, catalogNumber: true, name: true, type: true },
  });

  console.log(`Found ${products.length} products in scope`);

  const toUpdate: { id: string; type: string; prev: string | null }[] = [];
  const counts: Record<string, number> = {
    抑制剂: 0,
    拮抗剂: 0,
    激动剂: 0,
    其它化合物: 0,
  };

  for (const p of products) {
    const inferred = inferCompoundType(p.name);
    counts[inferred]++;
    if (p.type !== inferred) {
      toUpdate.push({ id: p.id, type: inferred, prev: p.type });
    }
  }

  console.log('\nInferred distribution:');
  for (const [type, count] of Object.entries(counts)) {
    console.log(`  ${type}: ${count}`);
  }
  console.log(`\nProducts needing update: ${toUpdate.length}`);

  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(({ id, type }) =>
        prisma.product.update({ where: { id }, data: { type } })
      )
    );
    updated += batch.length;
    if (updated % 1000 === 0 || updated === toUpdate.length) {
      console.log(`Updated ${updated} / ${toUpdate.length}`);
    }
  }

  const inhibitorCount = await prisma.product.count({
    where: {
      category: CATEGORY,
      subcategory: SUBCATEGORY,
      type: '抑制剂',
    },
  });

  console.log('\n=== Backfill complete ===');
  console.log(`Updated: ${updated}`);
  console.log(`DB count with type=抑制剂: ${inhibitorCount}`);
}

backfillCompoundTypes()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
