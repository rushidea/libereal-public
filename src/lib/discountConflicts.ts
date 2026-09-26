// 折扣应用冲突检测（DiscountTemplateManager / 批量应用页 / BulkApplyTemplateModal 共用）
//
// 三类冲突：
// 1. 用户已有个人统一折扣率 → 套模板会覆盖
// 2. 用户已有品牌折扣 → 套模板会覆盖
// 3. 模板与用户品牌级别冲突（同一品牌不同折扣率）→ 列举具体冲突
// 附：
// 4. 用户已套用了其他折扣模板 → 套新模板会替换源模板

export interface DiscountConflictUser {
  id: string;
  name?: string | null;
  email: string;
  discountRate?: number | null;
  brandDiscounts?: string | null;
  sourceTemplateId?: string | null;
}

export interface DiscountTemplateForConflict {
  id: string;
  discountRate?: string | number | null;
  brandDiscounts?: string | null;
}

export interface DiscountConflictInfo {
  withPersonalDiscount: number;
  withBrandDiscounts: number;
  brandConflicts: { userName: string; brand: string; existing: number; incoming: number }[];
  hasOtherTemplate: number;
}

export function detectDiscountConflicts(
  users: DiscountConflictUser[],
  template: DiscountTemplateForConflict,
): DiscountConflictInfo {
  const info: DiscountConflictInfo = {
    withPersonalDiscount: 0,
    withBrandDiscounts: 0,
    brandConflicts: [],
    hasOtherTemplate: 0,
  };
  let templateBrands: Record<string, number> = {};
  if (template.brandDiscounts) {
    try { templateBrands = JSON.parse(template.brandDiscounts); } catch { templateBrands = {}; }
  }

  for (const u of users) {
    if (u.sourceTemplateId && u.sourceTemplateId !== template.id) info.hasOtherTemplate++;
    if (u.discountRate != null) info.withPersonalDiscount++;
    let userBrands: Record<string, number> = {};
    if (u.brandDiscounts) {
      try { userBrands = JSON.parse(u.brandDiscounts); } catch { userBrands = {}; }
    }
    if (Object.keys(userBrands).length > 0) info.withBrandDiscounts++;
    for (const [brand, rate] of Object.entries(templateBrands)) {
      if (userBrands[brand] != null && Math.abs(userBrands[brand] - rate) > 0.001) {
        info.brandConflicts.push({
          userName: u.name || u.email,
          brand,
          existing: userBrands[brand],
          incoming: rate,
        });
      }
    }
  }
  return info;
}
