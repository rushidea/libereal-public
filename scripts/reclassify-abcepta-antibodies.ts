import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const DB_PATH = process.env.DATABASE_PATH || resolve(process.cwd(), 'prisma/dev.db');
const BATCH_SIZE = 500;
const BRAND = 'Abcepta';
const SOURCE_CATEGORY = '一抗';
const SOURCE_SUBCATEGORY = 'WB抗体';

const adapter = new PrismaBetterSqlite3({ url: `file:${DB_PATH}` });
const prisma = new PrismaClient({ adapter });

export type ReclassifyResult = {
  category: string;
  subcategory: string;
  rule: string;
};

/**
 * Best-effort Abcepta antibody reclassification from the WB catch-all bucket.
 * Order matters: more specific application/modification rules before isotype rules.
 */
export function classifyAbceptaAntibody(name: string): ReclassifyResult {
  const lower = name.toLowerCase();

  // ChIP kits/reagents belong under sample prep (different L1)
  if (/chip\s*(kit|reagent|assay)|chromatin immunoprecipitation kit/i.test(name)) {
    return { category: '样本制备和检测试剂盒', subcategory: 'ChIP和IP试剂', rule: 'chip-kit-reagent' };
  }

  // ChIP antibodies
  if (/chip antibody|for chip\b|chromatin immunoprecipitation/i.test(lower)) {
    return { category: SOURCE_CATEGORY, subcategory: 'ChIP和IP抗体', rule: 'chip-antibody' };
  }

  // Phospho-specific (before CD flow markers — e.g. Phospho-CD133)
  if (/phospho|phosphorylat|磷酸化|\(phospho\b/i.test(name)) {
    return { category: SOURCE_CATEGORY, subcategory: '磷酸化抗体', rule: 'phospho' };
  }

  // IHC / imaging
  if (/\bihc\b|immunohistochem|immunofluorescence|histo for ihc/i.test(lower)) {
    return { category: SOURCE_CATEGORY, subcategory: 'IHC和成像抗体', rule: 'ihc' };
  }

  // Secondary antibodies → 二抗 (often mis-bucketed in WB)
  if (
    /secondary antibody|anti-igg|anti-igm|anti-iga|f\(ab'\)|goat anti|rabbit anti|mouse anti|donkey anti|igg antibody|igm antibody|iga antibody/i.test(
      lower
    )
  ) {
    if (/hrp|horseradish peroxidase/i.test(lower)) {
      return { category: '二抗', subcategory: 'HRP偶联二抗', rule: 'secondary-hrp' };
    }
    if (/alexa fluor|atto \d+/i.test(lower)) {
      return { category: '二抗', subcategory: 'Alexa Fluor偶联二抗', rule: 'secondary-alexa' };
    }
    if (/fluorescein|rhodamine|cy3|cy5|fitc/i.test(lower)) {
      return { category: '二抗', subcategory: '荧光偶联二抗', rule: 'secondary-fluor' };
    }
    return { category: '二抗', subcategory: '其它二抗', rule: 'secondary-other' };
  }

  // Tag antibodies
  if (/his tag|his-tag|gst tag|gst-tag|flag tag|ha tag|myc tag|v5 tag/i.test(lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '标签抗体', rule: 'tag' };
  }

  // Loading controls
  if (/gapdh|beta-actin|actin|tubulin|loading control|housekeeping|alpha tubulin|beta tubulin/i.test(lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '内参抗体', rule: 'loading-control' };
  }

  // Flow cytometry CD markers
  if (/\bcd\d+\b|cluster of differentiation/i.test(lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '流式抗体', rule: 'cd-marker' };
  }

  // Monoclonal
  if (/\bmab\b|monoclonal|单抗|recombinant/i.test(lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '单抗和重组抗体', rule: 'monoclonal' };
  }

  // Polyclonal
  if (/\bpab\b|polyclonal|多抗|ascites/i.test(lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '重组多抗和传统多抗', rule: 'polyclonal' };
  }

  // Remaining generic primary antibodies stay in WB bucket
  return { category: SOURCE_CATEGORY, subcategory: SOURCE_SUBCATEGORY, rule: 'wb-default' };
}

async function countBySubcategory(label: string, brand: string, category: string) {
  const rows = await prisma.$queryRawUnsafe<{ subcategory: string; count: number }[]>(
    `SELECT subcategory, COUNT(*) as count FROM Product
     WHERE brand = ? AND category = ?
     GROUP BY subcategory ORDER BY count DESC`,
    brand,
    category
  );
  console.log(`\n=== ${label} (${brand} / ${category}) ===`);
  for (const row of rows) {
    console.log(`  ${row.subcategory}: ${row.count}`);
  }
  const wbCount = rows.find((r) => r.subcategory === SOURCE_SUBCATEGORY)?.count ?? 0;
  return wbCount;
}

async function runBatch1Fixes() {
  console.log('\n--- Batch 1: Quick DB fixes ---');

  const abcamElisa = await prisma.product.updateMany({
    where: { brand: 'Abcam', category: '一抗', subcategory: 'ELISA试剂盒' },
    data: { category: 'ELISA试剂盒', subcategory: 'ELISA辅助试剂' },
  });
  console.log(`Abcam 一抗/ELISA试剂盒 → ELISA试剂盒/ELISA辅助试剂: ${abcamElisa.count}`);

  const optical = await prisma.product.updateMany({
    where: {
      category: '仪器设备',
      subcategory: '仪器设备',
      OR: [{ name: { contains: 'Light source' } }, { name: { contains: 'Light Source' } }],
    },
    data: { subcategory: '光学仪器' },
  });
  console.log(`仪器设备/仪器设备 → 仪器设备/光学仪器: ${optical.count}`);

  const orphanRemaining = await prisma.product.count({
    where: { category: '仪器设备', subcategory: '仪器设备' },
  });
  if (orphanRemaining > 0) {
    console.warn(`Warning: ${orphanRemaining} orphan 仪器设备/仪器设备 products remain`);
  }
}

async function reclassifyAbcepta() {
  console.log(`\n--- Abcepta WB bucket reclassification ---`);
  console.log(`Database: ${DB_PATH}`);

  const beforeWb = await countBySubcategory('Before', BRAND, SOURCE_CATEGORY);

  const products = await prisma.product.findMany({
    where: { brand: BRAND, category: SOURCE_CATEGORY, subcategory: SOURCE_SUBCATEGORY },
    select: { id: true, name: true, category: true, subcategory: true },
  });
  console.log(`\nProducts in ${SOURCE_CATEGORY}/${SOURCE_SUBCATEGORY}: ${products.length}`);

  const ruleCounts: Record<string, number> = {};
  const targetCounts: Record<string, number> = {};
  const toUpdate: { id: string; category: string; subcategory: string; rule: string }[] = [];

  for (const p of products) {
    const result = classifyAbceptaAntibody(p.name);
    ruleCounts[result.rule] = (ruleCounts[result.rule] ?? 0) + 1;

    const targetKey = `${result.category}/${result.subcategory}`;
    targetCounts[targetKey] = (targetCounts[targetKey] ?? 0) + 1;

    if (p.category !== result.category || p.subcategory !== result.subcategory) {
      toUpdate.push({ id: p.id, category: result.category, subcategory: result.subcategory, rule: result.rule });
    }
  }

  console.log('\nClassification rule hits (all WB-bucket products):');
  for (const [rule, count] of Object.entries(ruleCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${rule}: ${count}`);
  }

  console.log('\nTarget subcategory distribution:');
  for (const [target, count] of Object.entries(targetCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${target}: ${count}`);
  }

  console.log(`\nProducts to update: ${toUpdate.length}`);

  let updated = 0;
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(({ id, category, subcategory }) =>
        prisma.product.update({ where: { id }, data: { category, subcategory } })
      )
    );
    updated += batch.length;
    if (updated % 5000 === 0 || updated === toUpdate.length) {
      console.log(`Updated ${updated} / ${toUpdate.length}`);
    }
  }

  const afterWb = await countBySubcategory('After', BRAND, SOURCE_CATEGORY);

  // Also show 二抗 counts if any moved there
  const secondaryCount = await prisma.product.count({ where: { brand: BRAND, category: '二抗' } });
  if (secondaryCount > 0) {
    console.log(`\nAbcepta 二抗 total: ${secondaryCount}`);
  }

  const phosphoCount = await prisma.product.count({
    where: { brand: BRAND, category: SOURCE_CATEGORY, subcategory: '磷酸化抗体' },
  });
  console.log(`\nAbcepta 磷酸化抗体 total: ${phosphoCount}`);

  console.log('\n=== Summary ===');
  console.log(`WB bucket before: ${beforeWb}`);
  console.log(`WB bucket after: ${afterWb}`);
  console.log(`Moved out of WB: ${beforeWb - afterWb}`);
  console.log(`Updated rows: ${updated}`);
}

async function main() {
  await runBatch1Fixes();
  await reclassifyAbcepta();
}

if (require.main === module || process.argv[1]?.endsWith('reclassify-abcepta-antibodies.ts')) {
  main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
