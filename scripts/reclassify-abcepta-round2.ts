import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { classifyAbceptaAntibody, type ReclassifyResult } from './reclassify-abcepta-antibodies';
import { productCategories } from '../src/data/categories';

const DB_PATH = process.env.DATABASE_PATH || resolve(process.cwd(), 'prisma/dev.db');
const BATCH_SIZE = 500;
const BRAND = 'Abcepta';
const SOURCE_CATEGORY = '一抗';
const SOURCE_SUBCATEGORY = 'WB抗体';
const DRY_RUN = process.argv.includes('--dry-run');

const adapter = new PrismaBetterSqlite3({ url: `file:${DB_PATH}` });
const prisma = new PrismaClient({ adapter });

const PRIMARY_L2 = productCategories.find((c) => c.name === SOURCE_CATEGORY)?.sub.map((s) => s.name) ?? [];

function isMonoclonalMarker(name: string, lower: string): boolean {
  return (
    /\bclone\b|\[clone\b|\(clone\b|monoclonal antibody|\bmab\b|\(m\d{2}\)|recombinant/i.test(name) ||
    /\bmouse mab\b|\brat mab\b|\brabbit mab\b/i.test(lower)
  );
}

function isPolyclonalEpitopePattern(name: string): boolean {
  return (
    /\(center\)|\(c-term\)|\(n-term\)|\(c-terminus\)|\(n-terminus\)|\(aa\d+-\d+\)/i.test(name) ||
    /\bantibody\s*-\s*(middle|n-terminal|c-terminal|terminal)/i.test(name) ||
    /\brabbit pab\b|\bpab\b/i.test(name)
  );
}

function isApoptosisAntibody(name: string, lower: string): boolean {
  if (/bcl10|bcl11|bcl3\b|bcl6\b|bcl7|bcl9|bclaf|bcl2a1\b/i.test(lower)) {
    return false;
  }
  return (
    /caspase|casp-\d+|casp\d/i.test(lower) ||
    /\bbcl-2\b|\bbcl2\b|\bbcl-xl\b|\bbcl-w\b|\bbcl2l|\bbax\b|\bbak\b|\bbad\b|\bbid\b|\bbim\b|\bpuma\b|\bnoxa\b/i.test(
      lower
    ) ||
    /\bapoptosis\b|\bparp\b|\bcytochrome c\b|\btrail\b|\bfas\b|\bfadd\b|\bcyto c\b/i.test(lower)
  );
}

function isConjugatedSecondary(name: string, lower: string): boolean {
  return (
    /(bovine|goat|rabbit|mouse|rat|human|chicken|donkey|sheep|guinea pig|hamster|swine|porcine|canine|feline)\s+(igg|igm|iga)/i.test(
      name
    ) &&
    /biotin|fluorescein|fitc|rhodamine|phycoerythrin|allophycocyanin|\bapc\b|\bpe\b|peroxidase|horseradish|alkaline phosphatase|texas red|alexa fluor|af\d{3}|cy3|cy5|cy7|atto \d+|agarose/i.test(
      lower
    )
  );
}

function secondarySubcategory(lower: string): string {
  if (/hrp|horseradish peroxidase|peroxidase/i.test(lower)) {
    return 'HRP偶联二抗';
  }
  if (/alexa fluor|af\d{3}/i.test(lower)) {
    return 'Alexa Fluor偶联二抗';
  }
  if (/fluorescein|rhodamine|cy3|cy5|cy7|fitc|phycoerythrin|allophycocyanin|\bapc\b|\bpe\b|atto \d+|texas red/i.test(lower)) {
    return '荧光偶联二抗';
  }
  return '其它二抗';
}

function isDirectLabeledPrimary(lower: string): boolean {
  return /af488|af594|af647|alexa fluor|allophycocyanin|phycoerythrin|\bpe\b|\bapc\b|fitc|cy3|cy5|cy7|biotin|peroxidase|rhodamine|texas red|atto \d+|conjugated|directly labeled|direct labeled/i.test(
    lower
  );
}

function isFlowCdMarker(name: string, lower: string): boolean {
  if (/phospho|cdkn|\bcdk/i.test(lower)) {
    return false;
  }
  return /(?:^|[\s/])CD\d+\b/i.test(name);
}

function isPolyclonalCatalog(catalog: string): boolean {
  return /^(AP|AI|ALS|ASC|AO|AH|AW|AN|AD|ABV|PRB|ASP|APR|PVG|ABG|ABT|AF4|AF1|AX1|ADR)/.test(catalog);
}

function isMonoclonalCatalog(catalog: string): boolean {
  return /^(AT|AM)/.test(catalog);
}

/**
 * Round 2: aggressive morphology rules for products still in the WB catch-all bucket.
 * Applies round 1 rules first, then catalog/name heuristics before wb-default.
 */
export function classifyAbceptaRound2(name: string, catalogNumber?: string | null): ReclassifyResult {
  const round1 = classifyAbceptaAntibody(name);
  if (round1.subcategory !== SOURCE_SUBCATEGORY) {
    return round1;
  }

  const lower = name.toLowerCase();
  const catalog = (catalogNumber ?? '').trim().toUpperCase();

  if (/isotype control/i.test(name)) {
    return { category: SOURCE_CATEGORY, subcategory: '同型对照抗体', rule: 'isotype-control' };
  }

  if (/carrier-free|carrier free|无载体/i.test(lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '无载体抗体', rule: 'carrier-free' };
  }

  if (/\b(panel|combo|antibody set|antibody kit)\b/i.test(lower) && !/assay kit|elisa kit/i.test(lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '抗体组合套装', rule: 'panel-combo' };
  }

  if (isApoptosisAntibody(name, lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '细胞凋亡', rule: 'apoptosis' };
  }

  if (isConjugatedSecondary(name, lower)) {
    return {
      category: '二抗',
      subcategory: secondarySubcategory(lower),
      rule: 'conjugated-species-igg',
    };
  }

  if (isDirectLabeledPrimary(lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '直标抗体', rule: 'conjugated-primary' };
  }

  if (isFlowCdMarker(name, lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '流式抗体', rule: 'cd-marker-broad' };
  }

  if (isMonoclonalCatalog(catalog) || isMonoclonalMarker(name, lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '单抗和重组抗体', rule: 'mono-catalog-or-marker' };
  }

  if (isPolyclonalCatalog(catalog) || isPolyclonalEpitopePattern(name)) {
    return { category: SOURCE_CATEGORY, subcategory: '重组多抗和传统多抗', rule: 'poly-catalog-or-pattern' };
  }

  if (/antibod|anitbod/i.test(lower)) {
    return { category: SOURCE_CATEGORY, subcategory: '重组多抗和传统多抗', rule: 'poly-antibody-fallback' };
  }

  return round1;
}

async function countAllPrimarySubcategories(label: string) {
  const rows = await prisma.$queryRawUnsafe<{ subcategory: string; count: number }[]>(
    `SELECT subcategory, COUNT(*) as count FROM Product
     WHERE brand = ? AND category = ?
     GROUP BY subcategory`,
    BRAND,
    SOURCE_CATEGORY
  );
  const countMap = new Map(rows.map((r) => [r.subcategory, Number(r.count)]));

  console.log(`\n=== ${label} (${BRAND} / ${SOURCE_CATEGORY}) ===`);
  for (const sub of PRIMARY_L2) {
    console.log(`  ${sub}: ${countMap.get(sub) ?? 0}`);
  }
  for (const row of rows) {
    if (!PRIMARY_L2.includes(row.subcategory)) {
      console.log(`  ${row.subcategory} (non-canonical): ${row.count}`);
    }
  }

  return countMap.get(SOURCE_SUBCATEGORY) ?? 0;
}

async function reclassifyRound2() {
  console.log(`\n--- Abcepta WB bucket reclassification (round 2) ---`);
  console.log(`Database: ${DB_PATH}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'APPLY'}`);

  const beforeWb = await countAllPrimarySubcategories('Before');

  const products = await prisma.product.findMany({
    where: { brand: BRAND, category: SOURCE_CATEGORY, subcategory: SOURCE_SUBCATEGORY },
    select: { id: true, name: true, catalogNumber: true, category: true, subcategory: true },
  });
  console.log(`\nProducts in ${SOURCE_CATEGORY}/${SOURCE_SUBCATEGORY}: ${products.length}`);

  const ruleCounts: Record<string, number> = {};
  const targetCounts: Record<string, number> = {};
  const toUpdate: { id: string; category: string; subcategory: string; rule: string }[] = [];

  for (const p of products) {
    const result = classifyAbceptaRound2(p.name, p.catalogNumber);
    ruleCounts[result.rule] = (ruleCounts[result.rule] ?? 0) + 1;

    const targetKey = `${result.category}/${result.subcategory}`;
    targetCounts[targetKey] = (targetCounts[targetKey] ?? 0) + 1;

    if (p.category !== result.category || p.subcategory !== result.subcategory) {
      toUpdate.push({ id: p.id, category: result.category, subcategory: result.subcategory, rule: result.rule });
    }
  }

  console.log('\nRound 2 classification rule hits (WB-bucket products):');
  for (const [rule, count] of Object.entries(ruleCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${rule}: ${count}`);
  }

  console.log('\nTarget distribution after round 2:');
  for (const [target, count] of Object.entries(targetCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${target}: ${count}`);
  }

  console.log(`\nProducts to update: ${toUpdate.length}`);

  if (!DRY_RUN && toUpdate.length > 0) {
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
  }

  if (!DRY_RUN) {
    const afterWb = await countAllPrimarySubcategories('After');

    const secondaryRows = await prisma.$queryRawUnsafe<{ subcategory: string; count: number }[]>(
      `SELECT subcategory, COUNT(*) as count FROM Product
       WHERE brand = ? AND category = '二抗'
       GROUP BY subcategory ORDER BY count DESC`,
      BRAND
    );
    if (secondaryRows.length > 0) {
      console.log(`\n=== Abcepta / 二抗 ===`);
      for (const row of secondaryRows) {
        console.log(`  ${row.subcategory}: ${row.count}`);
      }
    }

    console.log('\n=== Summary ===');
    console.log(`WB bucket before: ${beforeWb}`);
    console.log(`WB bucket after: ${afterWb}`);
    console.log(`Moved out of WB: ${beforeWb - afterWb}`);
    console.log(`Updated rows: ${toUpdate.length}`);
  } else {
    const remainingWb = ruleCounts['wb-default'] ?? 0;
    console.log('\n=== Dry-run Summary ===');
    console.log(`Would move out of WB: ${toUpdate.length}`);
    console.log(`Would remain in WB: ${remainingWb}`);
  }
}

if (process.argv[1]?.endsWith('reclassify-abcepta-round2.ts')) {
  reclassifyRound2()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
