type ProductPriceFields = {
  price?: number | null;
  promotionalPrice?: number | null;
};

type ProductDisplayFields = ProductPriceFields & {
  brand?: string | null;
  originalPrice?: number | null;
};

export type ProductDisplayPrice = {
  /** 主展示价（折后价 / 促销价 / 目录价） */
  salePrice: number;
  /** 划线价；无折扣时为 undefined */
  strikethroughPrice?: number;
  /** Whether a generic runtime pricing policy applies a guest display price. */
  showGuestDiscount: boolean;
  /** 是否为促销价（服务端判定；前端不再持有 promotionalPrice） */
  isPromo: boolean;
  hasPrice: boolean;
};

/** 用于判定"管理员确认的正式会员"的用户字段（服务端查库后传入，绝不下发前端） */
export type UserEligibilityFlags = {
  approvalStatus?: string | null;
  isNewUser?: boolean;
  isFrozen?: boolean;
  isBlacklisted?: boolean;
};

/**
 * 是否为"已激活的正式会员"：管理员审核通过(approvalStatus=approved)、
 * 非新用户(isNewUser=false)、未冻结、未黑名单。
 * 仅此类用户可下发会员价；其余（未登录 / 已注册未确认 / 冻结等）一律按访客展示。
 */
export function isFormalMemberUser(user: UserEligibilityFlags | null | undefined): boolean {
  return Boolean(
    user &&
      user.approvalStatus === 'approved' &&
      !user.isNewUser &&
      !user.isFrozen &&
      !user.isBlacklisted,
  );
}

export type ProductDisplayPriceOptions = {
  /** 是否管理员确认的正式会员。false/缺省 = 未登录或未确认 → 走访客展示逻辑 */
  isFormalMember?: boolean;
};

function normalizePrice(value: number | null | undefined): number {
  const price = Number(value ?? 0);
  return Number.isFinite(price) && price > 0 ? price : 0;
}

export function getEffectiveProductPrice(
  product: ProductPriceFields & { displayPrice?: ProductDisplayPrice },
): number {
  const promotionalPrice = normalizePrice(product.promotionalPrice);
  if (promotionalPrice > 0) return promotionalPrice;
  const price = normalizePrice(product.price);
  if (price > 0) return price;
  // 方案③：客户端原始价被剥离后，回退到服务端预计算的展示价
  return product.displayPrice?.salePrice ?? 0;
}

export function isPricedProduct(
  product: ProductPriceFields & { displayPrice?: ProductDisplayPrice },
): boolean {
  return getEffectiveProductPrice(product) > 0;
}

/**
 * 前台展示价（仅影响 UI，不改变下单计价）。服务端计算后仅下发 displayPrice，原始价不下发前端。
 *
 * 优先级：
 * 1. promotionalPrice > 0 → 直接展示促销价（可附带更高的划线原价/目录价）
 * 2. Otherwise use the catalog price and optionally show a higher reference price.
 */
export function getProductDisplayPrice(
  product: ProductDisplayFields,
  options: ProductDisplayPriceOptions = {},
): ProductDisplayPrice {
  const promotionalPrice = normalizePrice(product.promotionalPrice);
  const catalogPrice = normalizePrice(product.price);
  const originalPrice = normalizePrice(product.originalPrice);

  if (promotionalPrice > 0) {
    const strikethrough =
      originalPrice > promotionalPrice
        ? originalPrice
        : catalogPrice > promotionalPrice
          ? catalogPrice
          : undefined;
    return {
      salePrice: promotionalPrice,
      strikethroughPrice: strikethrough,
      showGuestDiscount: false,
      isPromo: true,
      hasPrice: true,
    };
  }

  if (catalogPrice <= 0) {
    return {
      salePrice: 0,
      showGuestDiscount: false,
      isPromo: false,
      hasPrice: false,
    };
  }


  return {
    salePrice: catalogPrice,
    strikethroughPrice: originalPrice > catalogPrice ? originalPrice : undefined,
    showGuestDiscount: false,
    isPromo: false,
    hasPrice: true,
  };
}
