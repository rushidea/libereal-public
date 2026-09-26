#!/usr/bin/env tsx
/**
 * scripts/move-protein-marker.ts
 * 蛋白 Marker (预染/非预染/未染/PageRuler/EazePack WB 套装) 全部归到
 *   category=样本制备和检测试剂盒
 *   subcategory=WB辅助试剂
 *   type=蛋白Marker
 *
 * 匹配关键词: '预染', '蛋白Marker', '蛋白 Marker', '蛋白 marker', 'Protein Marker',
 *            '蛋白分子量标准', 'PageRuler', 'Spectra Multicolor'
 * 排除: 抗体应用名 (如 Lysosome Marker 描述) — 上面关键词已避开
 */
import { prisma } from '../src/lib/prisma';

const TO_CATEGORY = '样本制备和检测试剂盒';
const TO_SUBCATEGORY = 'WB辅助试剂';
const TO_TYPE = '蛋白Marker';

const APPLY = process.argv.includes('--apply');

async function main() {
  const matched = await prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: '预染' } },
        { name: { contains: '蛋白Marker' } },
        { name: { contains: '蛋白 Marker' } },
        { name: { contains: '蛋白 marker' } },
        { name: { contains: 'Protein Marker' } },
        { name: { contains: '蛋白分子量标准' } },
        { name: { contains: 'PageRuler' } },
        { name: { contains: 'Spectra Multicolor' } },
      ],
    },
    select: {
      id: true, name: true, catalogNumber: true, brand: true,
      category: true, subcategory: true, type: true,
    },
  });

  console.log(`Found ${matched.length} candidate products`);
  console.log('');
  for (const p of matched) {
    const needUpdate =
      p.category !== TO_CATEGORY ||
      p.subcategory !== TO_SUBCATEGORY ||
      p.type !== TO_TYPE;
    if (!needUpdate) continue;
    console.log(
      `  [${p.brand.padEnd(15)}] ${p.catalogNumber.padEnd(15)} ${p.name.slice(0, 50)}`,
    );
    console.log(
      `     FROM: ${p.category} / ${p.subcategory} / ${p.type || '(无)'}`,
    );
    console.log(
      `     TO:   ${TO_CATEGORY} / ${TO_SUBCATEGORY} / ${TO_TYPE}`,
    );
  }

  if (!APPLY) {
    console.log('');
    console.log('DRY-RUN. Re-run with --apply to commit.');
    return;
  }

  // Update all matched (idempotent — re-running won't change anything)
  const result = await prisma.product.updateMany({
    where: { id: { in: matched.map((p) => p.id) } },
    data: {
      category: TO_CATEGORY,
      subcategory: TO_SUBCATEGORY,
      type: TO_TYPE,
    },
  });
  console.log('');
  console.log(`Updated rows: ${result.count}`);

  // 验证
  const after = await prisma.product.groupBy({
    by: ['category', 'subcategory', 'type'],
    where: { type: TO_TYPE },
    _count: { _all: true },
  });
  console.log('');
  console.log('归类后 type=蛋白Marker 分布:');
  for (const r of after) {
    console.log(`  ${(r._count._all || 0).toString().padStart(4)}  ${r.category} / ${r.subcategory} / ${r.type}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
