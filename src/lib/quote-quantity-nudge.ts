/**
 * 客户按报价单价接受报价时的数量软提醒。
 * 数量没有上限，服务端不拒绝。只在前端列出超过阈值的行，用户确认后可以继续。
 *
 * 分类只用商品上已有的 category / subcategory / type：
 * - 一级分类见 QUOTE_QUANTITY_KIND_BY_CATEGORY
 * - 二级分类例外见 QUOTE_QUANTITY_KIND_BY_SUBCATEGORY（覆盖一级）
 * - 三级 type 只有写进 QUOTE_QUANTITY_KIND_BY_TYPE 才参与判断。
 *   Product.type 是细分标签，不是试剂/耗材枚举，默认不据此归类。
 * 对不上这些表的商品不提醒。
 */

export type QuoteQuantityKind = 'reagent' | 'consumable';

export const QUOTE_QUANTITY_NUDGE_THRESHOLDS: Readonly<Record<QuoteQuantityKind, number>> = {
  reagent: 10,
  consumable: 50,
};

export const QUOTE_QUANTITY_KIND_LABEL: Readonly<Record<QuoteQuantityKind, string>> = {
  reagent: '试剂',
  consumable: '耗材',
};

/** 一级分类 → 核对类别。未列出的一级分类无法归类。 */
export const QUOTE_QUANTITY_KIND_BY_CATEGORY: Readonly<Record<string, QuoteQuantityKind>> = {
  一抗: 'reagent',
  二抗: 'reagent',
  ELISA试剂盒: 'reagent',
  蛋白和细胞系: 'reagent',
  生化和细胞检测试剂盒: 'reagent',
  样本制备和检测试剂盒: 'reagent',
  分子生物学: 'reagent',
  化学试剂: 'reagent',
  细胞生物学: 'reagent',
  抗体偶联试剂盒: 'reagent',
  材料合成: 'consumable',
};

/**
 * 二级分类覆盖一级。
 * 「分子生物学耗材」挂在试剂一级「分子生物学」下，按耗材阈值核对。
 */
export const QUOTE_QUANTITY_KIND_BY_SUBCATEGORY: Readonly<Record<string, QuoteQuantityKind>> = {
  分子生物学耗材: 'consumable',
};

/** 三级 type → 核对类别。留空表示不按 type 单独归类。 */
export const QUOTE_QUANTITY_KIND_BY_TYPE: Readonly<Record<string, QuoteQuantityKind>> = {};

export type QuoteQuantityTaxonomy = {
  category?: string | null;
  subcategory?: string | null;
  type?: string | null;
};

export type QuoteQuantityNudgeLine = QuoteQuantityTaxonomy & {
  key: string;
  name?: string | null;
  catalogNumber?: string | null;
  quantity: number;
};

export type QuoteQuantityNudge = {
  key: string;
  name: string;
  catalogNumber: string | null;
  quantity: number;
  kind: QuoteQuantityKind;
  threshold: number;
};

function mappedKind(value: string | null | undefined, table: Readonly<Record<string, QuoteQuantityKind>>): QuoteQuantityKind | null {
  const key = value?.trim() ?? '';
  if (!key || !Object.hasOwn(table, key)) return null;
  return table[key] ?? null;
}

export function classifyQuoteQuantityKind(input: QuoteQuantityTaxonomy): QuoteQuantityKind | null {
  return mappedKind(input.subcategory, QUOTE_QUANTITY_KIND_BY_SUBCATEGORY)
    ?? mappedKind(input.category, QUOTE_QUANTITY_KIND_BY_CATEGORY)
    ?? mappedKind(input.type, QUOTE_QUANTITY_KIND_BY_TYPE);
}

export function findQuoteQuantityNudges(lines: QuoteQuantityNudgeLine[]): QuoteQuantityNudge[] {
  const nudges: QuoteQuantityNudge[] = [];
  for (const line of lines) {
    if (!Number.isInteger(line.quantity) || line.quantity < 1) continue;
    const kind = classifyQuoteQuantityKind(line);
    if (!kind) continue;
    const threshold = QUOTE_QUANTITY_NUDGE_THRESHOLDS[kind];
    if (line.quantity <= threshold) continue;
    nudges.push({
      key: line.key,
      name: line.name?.trim() || '未知产品',
      catalogNumber: line.catalogNumber?.trim() || null,
      quantity: line.quantity,
      kind,
      threshold,
    });
  }
  return nudges;
}
