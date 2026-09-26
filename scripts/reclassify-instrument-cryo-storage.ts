#!/usr/bin/env tsx
/**
 * 将适配产品归入仪器设备子分类「液氮储存」「低温冰箱」。
 *
 * 用法：
 *   npx tsx scripts/reclassify-instrument-cryo-storage.ts
 *   npx tsx scripts/reclassify-instrument-cryo-storage.ts --apply
 */
import {
  needsInstrumentCryoReclassify,
  resolveInstrumentCryoTarget,
} from '../src/lib/instrument-cryo-reclassify';
import { prisma } from '../src/lib/prisma';

const APPLY = process.argv.includes('--apply');

async function main() {
  const candidates = await prisma.product.findMany({
    where: {
      OR: [
        { subcategory: { in: ['低温储存设备', '液氮储存', '低温冰箱'] } },
        { type: '液氮罐' },
        { catalogNumber: { startsWith: 'YDS-' } },
        { name: { contains: '液氮罐' } },
        { name: { contains: '液氮生物容器' } },
        { name: { contains: '液氮储存罐' } },
        { name: { contains: '低温冰箱' } },
        { name: { contains: '超低温冰箱' } },
        { name: { contains: '超低温保存箱' } },
        { name: { contains: '医用冰箱' } },
        { name: { contains: '血液冷藏箱' } },
        { name: { contains: '药品冷藏箱' } },
        { name: { contains: '-80℃冰箱' } },
        { name: { contains: '-86℃冰箱' } },
      ],
    },
    select: {
      id: true,
      catalogNumber: true,
      name: true,
      brand: true,
      category: true,
      subcategory: true,
      type: true,
    },
    orderBy: [{ brand: 'asc' }, { catalogNumber: 'asc' }],
  });

  const updates = candidates
    .map((product) => {
      const target = resolveInstrumentCryoTarget(product);
      if (!target || !needsInstrumentCryoReclassify(product)) return null;
      return { product, target };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  console.log(`扫描候选 ${candidates.length} 条，待更新 ${updates.length} 条`);
  for (const { product, target } of updates) {
    console.log(
      `  [${product.brand}] ${product.catalogNumber} ${product.name.slice(0, 48)}`,
    );
    console.log(
      `     ${product.category} / ${product.subcategory ?? '(无)'}  ->  仪器设备 / ${target}`,
    );
  }

  if (!APPLY) {
    console.log('');
    console.log('DRY-RUN。加上 --apply 后写入数据库。');
    return;
  }

  let updated = 0;
  for (const { product, target } of updates) {
    await prisma.product.update({
      where: { id: product.id },
      data: {
        category: '仪器设备',
        subcategory: target,
      },
    });
    updated += 1;
  }

  console.log('');
  console.log(`已更新 ${updated} 条`);

  const grouped = await prisma.product.groupBy({
    by: ['subcategory'],
    where: {
      category: '仪器设备',
      subcategory: { in: ['液氮储存', '低温冰箱', '低温储存设备'] },
    },
    _count: { _all: true },
  });
  console.log('仪器设备相关子分类计数：');
  for (const row of grouped) {
    console.log(`  ${row._count._all.toString().padStart(4)}  ${row.subcategory}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
