/**
 * 将存量 DiscountTemplate.brandDiscounts 对齐到产品库标准品牌键。
 * 不修改 Product 数据。
 *
 * 用法：npx tsx scripts/align-discount-template-brands.ts
 */
import { prisma } from '@/lib/prisma';
import {
  alignBrandDiscounts,
  loadCatalogBrandKeys,
  parseBrandDiscountsJson,
  serializeBrandDiscounts,
} from '@/lib/discount-brand-catalog';

async function main() {
  const catalogKeys = await loadCatalogBrandKeys(prisma);
  console.log(`产品库标准品牌键 ${catalogKeys.length} 个`);

  const templates = await prisma.discountTemplate.findMany({
    select: { id: true, name: true, brandDiscounts: true },
  });

  let updated = 0;
  let unchanged = 0;
  const allUnmapped = new Set<string>();

  for (const tpl of templates) {
    const parsed = parseBrandDiscountsJson(tpl.brandDiscounts);
    if (!parsed || Object.keys(parsed).length === 0) {
      unchanged += 1;
      continue;
    }
    const { aligned, unmapped, renames } = alignBrandDiscounts(parsed, catalogKeys);
    for (const u of unmapped) allUnmapped.add(u);

    const next = Object.keys(aligned).length > 0 ? serializeBrandDiscounts(aligned) : '{}';
    const prev = tpl.brandDiscounts ?? '';
    if (next === prev || (prev === '[]' && next === '{}')) {
      unchanged += 1;
      continue;
    }

    await prisma.discountTemplate.update({
      where: { id: tpl.id },
      data: { brandDiscounts: next },
    });
    updated += 1;
    console.log(`[更新] ${tpl.name} (${tpl.id})`);
    if (renames.length) {
      console.log(`  重命名: ${renames.map((r) => `${r.from} -> ${r.to}`).join('; ')}`);
    }
    if (unmapped.length) {
      console.log(`  未映射丢弃: ${unmapped.join(', ')}`);
    }
  }

  console.log(`\n完成：更新 ${updated}，未变 ${unchanged}`);
  if (allUnmapped.size) {
    console.log(`未映射品牌汇总: ${[...allUnmapped].join(', ')}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
