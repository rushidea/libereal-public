/**
 * 方案③ 服务端展示价辅助模块（仅服务端使用，绝不下发原始价）。
 *
 * 职责：
 * 1. 解析当前请求者是否为"管理员确认的正式会员"（服务端查库，前端拿不到）。
 * 2. 为商品/变体计算展示价 displayPrice，并剥离 price/originalPrice/promotionalPrice 原始价字段。
 *
 * 注意：搜索类接口有 Redis 缓存，缓存内是"无用户态"的原始数据；
 * 用户相关的 displayPrice 必须在 API 路由层（缓存之后）按请求者状态附加。
 */
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  getProductDisplayPrice,
  isFormalMemberUser,
  type ProductDisplayPrice,
} from '@/lib/product-pricing';

/** 请求者的正式会员判定（每次请求查一次 DB；无 session 直接 false = 访客） */
export async function resolveIsFormalMember(): Promise<boolean> {
  const session = await auth();
  const userId = session?.user?.id as string | undefined;
  if (!userId) return false;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      approvalStatus: true,
      isNewUser: true,
      isFrozen: true,
      isBlacklisted: true,
    },
  });
  return isFormalMemberUser(user);
}

type PriceCarryingFields = {
  price?: number | null;
  originalPrice?: number | null;
  promotionalPrice?: number | null;
  brand?: string | null;
};

export type DisplayProduct<T extends PriceCarryingFields> = Omit<
  T,
  'price' | 'originalPrice' | 'promotionalPrice'
> & { displayPrice: ProductDisplayPrice };

/** 多规格商品的最低价（复刻原前端卡片逻辑：单规格用其价、多规格取最低） */
function lowestVariantPrice(variants: Array<{ price?: number | null }>): number | null | undefined {
  const prices = variants
    .map((variant) => Number(variant.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  return prices.length > 0 ? Math.min(...prices) : undefined;
}

/**
 * 为单个商品计算展示价并剥离原始价字段。
 * 多规格商品按最低变体价计展示价（并清空划线/促销，复刻原前端行为）。
 * 返回值只含 displayPrice + 非价格字段。
 */
export function attachDisplayPrice<
  T extends PriceCarryingFields & { variants?: Array<{ price?: number | null }> },
>(product: T, isFormalMember: boolean): DisplayProduct<T> {
  const variants = product.variants;
  const priceSource =
    Array.isArray(variants) && variants.length > 0
      ? {
          ...product,
          price: lowestVariantPrice(variants) ?? product.price,
          originalPrice: null,
          promotionalPrice: null,
        }
      : product;
  const displayPrice = getProductDisplayPrice(priceSource, { isFormalMember });
  const { price, originalPrice, promotionalPrice, ...rest } = product;
  return { ...(rest as T), displayPrice };
}

/**
 * 批量：为商品列表计算展示价并剥离原始价。
 */
export function attachDisplayPrices<T extends PriceCarryingFields>(
  products: T[],
  isFormalMember: boolean,
): DisplayProduct<T>[] {
  return products.map((product) => attachDisplayPrice(product, isFormalMember));
}

/**
 * 商品 + 嵌套变体的统一清洗：商品算 displayPrice 并剥离原始价；
 * 变体按用户态处理（非正式会员的变体不携带任何价格）。
 * 供搜索 API / 促销页等"商品带变体"的数据源复用。
 */
export function sanitizeProductsWithVariants<
  T extends PriceCarryingFields & {
    variants?: Array<{ price?: number | null; originalPrice?: number | null; promotionalPrice?: number | null }>;
  },
>(products: T[], isFormalMember: boolean) {
  return attachDisplayPrices(products, isFormalMember).map((product) => {
    if (!product.variants?.length) return product;
    const { variants, ...rest } = product;
    return {
      ...rest,
      // 变体处理函数会保留非价格字段，这里把类型还原为商品的变体类型
      variants: attachVariantsDisplayPrice(
        variants,
        isFormalMember,
      ) as NonNullable<T['variants']>,
    };
  });
}

/**
 * 变体价格处理（剥离 price/originalPrice/promotionalPrice 全部原始价字段）：
 * - 正式会员：保留 price，并附带 displayPrice（salePrice=price）。
 * - 非正式会员：不携带任何价格字段，displayPrice 缺省（UI 显示"登录查看"）。
 * 注意：变体没有 originalPrice，若按商品逻辑计算访客价会退化为变体销售价（=会员价），
 * 因此非正式会员的变体一律不显示价格。
 */
export function attachVariantsDisplayPrice<
  T extends {
    price?: number | null;
    originalPrice?: number | null;
    promotionalPrice?: number | null;
  },
>(
  variants: T[],
  isFormalMember: boolean,
): Array<Omit<T, 'price' | 'originalPrice' | 'promotionalPrice'> & { displayPrice?: ProductDisplayPrice }> {
  return variants.map((variant) => {
    const { price, originalPrice, promotionalPrice, ...rest } = variant;
    const base = rest as Omit<T, 'price' | 'originalPrice' | 'promotionalPrice'>;
    if (!isFormalMember || price == null || price <= 0) {
      return base;
    }
    return {
      ...base,
      price,
      displayPrice: { salePrice: price, showGuestDiscount: false, isPromo: false, hasPrice: true },
    };
  });
}
