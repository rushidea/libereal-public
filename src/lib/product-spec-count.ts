import { prisma } from '@/lib/prisma';
import {
  isVolumeMicroLiters,
  productQualifiesAs20UlAntibody,
  productQualifiesAs50UlAbceptaAntibody,
  type SmallPackAntibodyStats,
} from '@/lib/product-spec-utils';

export type { SmallPackAntibodyStats } from '@/lib/product-spec-utils';

const FEATURED_SLOTS: { category: string; count: number }[] = [
  // 一抗数量巨大，只给 3 个槽位
  { category: '一抗', count: 3 },
  // 其他品类各 1~2 个槽位
  { category: '蛋白和细胞系', count: 2 },
  { category: '化学试剂', count: 2 },
  { category: '二抗', count: 1 },
  { category: '分子生物学', count: 1 },
  { category: 'ELISA试剂盒', count: 1 },
];

export async function getFeaturedProductsForHome(limit: number = 10) {
  // 按品类权重配额，在 SSR 阶段直接按品类随机采样
  // 确保精选产品覆盖不同品类和品牌，而非被 Abcepta×一抗淹没
  const sampleSize = 200; // 每个品类最多取 200 个，足够洗牌
  const results: Array<{
    id: string;
    catalogNumber: string;
    brand: string | null;
    subBrand: string | null;
    name: string;
    category: string | null;
    subcategory: string | null;
    host: string | null;
    target: string | null;
    hazardous: boolean | null;
    spec: string | null;
    price: number;
    promotionalPrice: number | null;
    promotion: boolean | null;
    originalPrice: number | null;
    inStock: boolean | null;
    imageUrl: string | null;
  }> = [];

  for (const slot of FEATURED_SLOTS) {
    const rows = await prisma.product.findMany({
      where: { category: slot.category, hazardous: false },
      take: sampleSize,
      select: {
        id: true,
        catalogNumber: true,
        brand: true,
        subBrand: true,
        name: true,
        category: true,
        subcategory: true,
        host: true,
        target: true,
        hazardous: true,
        spec: true,
        price: true,
        promotionalPrice: true,
        promotion: true,
        originalPrice: true,
        inStock: true,
        imageUrl: true,
      },
    });

    // 打乱后取需要的个数
    const shuffled = rows.sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, slot.count);
    results.push(...picked);
  }

  // 如果还填不满 10 个（某些品类产品不足），从剩余品类补
  if (results.length < limit) {
    const usedCats = new Set(FEATURED_SLOTS.map(s => s.category));
    const remainingCats = ['仪器设备', '生化和细胞检测试剂盒', '样本制备和检测试剂盒', '细胞生物学', 'Western Blot'];
    for (const cat of remainingCats) {
      if (results.length >= limit) break;
      const rows = await prisma.product.findMany({
        where: { category: cat, hazardous: false },
        take: sampleSize,
        select: {
          id: true,
          catalogNumber: true,
          brand: true,
          subBrand: true,
          name: true,
          category: true,
          subcategory: true,
          host: true,
          target: true,
          hazardous: true,
          spec: true,
          price: true,
          promotionalPrice: true,
          promotion: true,
          originalPrice: true,
          inStock: true,
          imageUrl: true,
        },
      });
      const shuffled = rows.sort(() => Math.random() - 0.5);
      if (shuffled.length > 0) {
        results.push(shuffled[0]);
      }
    }
  }

  // prisma null → undefined（Product type 期望 undefined）
  return results.slice(0, limit).map((p) => ({
    id: p.id,
    catalogNumber: p.catalogNumber,
    brand: p.brand ?? '',
    name: p.name,
    price: p.price,
    inStock: p.inStock ?? false,
    category: p.category ?? undefined,
    subcategory: p.subcategory ?? undefined,
    host: p.host ?? undefined,
    target: p.target ?? undefined,
    spec: p.spec ?? undefined,
    subBrand: p.subBrand ?? undefined,
    imageUrl: p.imageUrl ?? undefined,
    promotionalPrice: p.promotionalPrice ?? undefined,
    promotion: p.promotion ?? false,
    originalPrice: p.originalPrice ?? undefined,
    hazardous: p.hazardous ?? false,
    applications: [],
    reactivity: [],
    variants: [],
  }));
}

export async function countAntibody20UlProducts(): Promise<number> {
  const products = await prisma.product.findMany({
    where: { category: '一抗' },
    select: {
      brand: true,
      catalogNumber: true,
      category: true,
      spec: true,
      variants: { select: { spec: true } },
    },
  });

  return products.filter(productQualifiesAs20UlAntibody).length;
}

export async function countAbcepta50UlAntibodies(): Promise<number> {
  const products = await prisma.product.findMany({
    where: { brand: 'Abcepta', category: '一抗' },
    select: {
      brand: true,
      catalogNumber: true,
      category: true,
      spec: true,
      variants: { select: { spec: true } },
    },
  });

  return products.filter(productQualifiesAs50UlAbceptaAntibody).length;
}

export async function getSmallPackAntibodyStats(): Promise<SmallPackAntibodyStats> {
  const [count20Ul, count50Ul] = await Promise.all([
    countAntibody20UlProducts(),
    countAbcepta50UlAntibodies(),
  ]);
  return { count20Ul, count50Ul, total: count20Ul + count50Ul };
}



export async function countProductsWithVolumeUl(
  volumeUl: number,
  options?: { category?: string },
): Promise<number> {
  const products = await prisma.product.findMany({
    where: options?.category ? { category: options.category } : undefined,
    select: {
      id: true,
      spec: true,
      variants: { select: { spec: true } },
    },
  });

  let count = 0;
  for (const p of products) {
    const specs = [p.spec, ...p.variants.map((v) => v.spec)].filter(Boolean) as string[];
    if (specs.some((s) => isVolumeMicroLiters(s, volumeUl))) {
      count += 1;
    }
  }
  return count;
}