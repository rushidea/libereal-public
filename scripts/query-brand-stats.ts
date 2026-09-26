import { prisma } from '@/lib/prisma';

async function main() {
  // 品牌分布
  const brands = await prisma.product.groupBy({ by: ['brand'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } });
  console.log('=== 品牌分布（全部）===');
  brands.forEach(b => console.log(`${b.brand}\t${b._count.id}`));

  // 品类分布
  const cats = await prisma.product.groupBy({ by: ['category'], _count: { id: true }, orderBy: { _count: { id: 'desc' } } });
  console.log('\n=== 品类分布（全部）===');
  cats.forEach(c => console.log(`${c.category}\t${c._count.id}`));

  // 品牌×品类组合
  const brandCats = await prisma.product.groupBy({
    by: ['brand', 'category'],
    _count: { id: true },
    orderBy: [{ brand: 'asc' }, { _count: { id: 'desc' } }],
  });
  console.log('\n=== 品牌×品类 组合数 ===');
  const combos = new Map<string, number>();
  for (const bc of brandCats) {
    const key = `${bc.brand} × ${bc.category}`;
    console.log(`${key}\t${bc._count.id}`);
    combos.set(bc.brand, (combos.get(bc.brand) ?? 0) + 1);
  }
  console.log('\n=== 每个品牌的品类数 ===');
  combos.forEach((v, k) => console.log(`${k}\t${v}个品类`));

  await prisma.$disconnect();
}
main();