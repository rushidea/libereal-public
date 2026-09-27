/**
 * 营销活动规则引擎 —— 统一类型定义。
 *
 * 设计目标：策略模式 + 注册表。
 * - 每种活动类型（RuleType）对应一个独立策略模块（strategies/*.ts），
 *   各自拥有独立的参数配置（RuleConfig）、触发条件与计算逻辑；
 * - 引擎（engine.ts）持有一个策略注册表，评估时按 rule.type 分发给对应策略；
 * - 新增活动类型 = 新建一个策略文件 + 注册一行，核心引擎与结算页零改动。
 *
 * 内置类型：addon（换购）/ gift（赠品）/ bundle（组合折扣）
 *           / buy-n-get-m（买 N 免 M，价格降序取最低）/ fixed-price（一口价）/ stack-discount（折上折叠加）。
 */

/** 活动类型枚举。新增类型时在此登记 + 新建 strategies/<type>.ts。 */
export type RuleType = 'addon' | 'gift' | 'bundle' | 'buy-n-get-m' | 'fixed-price' | 'stack-discount' | 'coupon';

/** 所有规则共有的基础字段 */
export interface BaseRuleConfig {
  /** 规则唯一 id（同时用于购物车促销标记 promoMark.ruleId） */
  id: string;
  type: RuleType;
  /** 活动名称 */
  name: string;
  /** 是否启用（管理员下架 = false，视为活动终止） */
  enabled: boolean;
  /** 一句话活动说明（展示在结算确认页） */
  description: string;
  /** 活动截止（ISO 日期，过期自动失效）；以公告为准时留空 */
  validFrom?: string;
  validUntil?: string;
  /**
   * 独占型促销（默认 false = 互斥取最低）。
   * - 互斥取最低（默认）：同一商品行被多个互斥规则命中时，只保留优惠金额最大的一个；
   * - exclusive=true：命中该规则的商品行**不参与其他任何促销**（该行其他规则优惠全部失效），
   *   典型场景「不与其他优惠同享」的赠品/一口价；
   * - stackable=true：优惠**可与其他规则叠加**（金额相加/折扣连乘），典型场景折上折。
   * 三值互斥：exclusive 与 stackable 同时为 true 时以 exclusive 为准。
   */
  exclusive?: boolean;
  /** 叠加型促销（见 exclusive 注释）：true = 优惠与其他规则叠加，不参与互斥去重 */
  stackable?: boolean;
}

/** 换购规则：主品累计件数达到门槛 → 可加价换购指定产品 */
export interface AddonRuleConfig extends BaseRuleConfig {
  type: 'addon';
  /** 主品品牌（精确匹配 Product.brand） */
  eligibleBrand: string;
  /** 主品货号前缀（混搭累计，命中任一前缀即计入） */
  eligibleTerms: string[];
  eligibleNameIncludes?: string[];
  /** 触发换购的最小件数 */
  minQuantity: number;
  /** 换购价（每件） */
  addonPrice: number;
  maxAddonsPerTrigger?: number;
  /**
   * 共享换购额度组。相同组内的换购品共同消耗主品触发的额度，适用于“二选一”等互斥品类。
   * 组内规则必须使用相同的主品范围与门槛。
   */
  sharedQuotaGroup?: string;
  sharedQuotaMode?: 'item' | 'selection';
  addonQuantityPerTrigger?: number;
  /** 换购品品牌（不限定则为 undefined） */
  addonBrand?: string;
  /** 换购品货号前缀（命中任一前缀即为可换购品） */
  addonTerms: string[];
  eligibleExactTerms?: string[];
  addonOptions?: { catalogNumber: string; price: number; quantity: number }[];
}

/** 赠品规则：主品累计件数达到门槛 → 直接赠送指定产品（0 元） */
export interface GiftRuleConfig extends BaseRuleConfig {
  type: 'gift';
  /** 同货号、同规格分别计算买赠额度。 */
  sameProduct?: boolean;
  /** 主品品牌（不限定则为 undefined） */
  eligibleBrand?: string;
  /** 主品货号前缀（不限定则为空数组） */
  eligibleTerms?: string[];
  /** 触发赠品的最小件数（specGifts 未配置时使用） */
  minQuantity: number;
  /** 赠品品牌（不限定则为 undefined） */
  giftBrand?: string;
  /** 赠品货号前缀（命中任一前缀即为赠品） */
  giftTerms: string[];
  /** 每满 minQuantity 件送几件（默认 1；specGifts 未配置时使用） */
  maxGiftsPerTrigger?: number;
  /**
   * 按规格赠品表（可空）：主品按规格文本匹配，每规格独立门槛与赠品数。
   * 例（matrix-gel 活动1）：[{spec:'1mL',minQuantity:2,giftQuantity:2},{spec:'5mL',minQuantity:1,giftQuantity:3},{spec:'10mL',minQuantity:1,giftQuantity:6}]
   * 配置后 minQuantity/maxGiftsPerTrigger 忽略，赠品额度 = Σ floor(该规格件数 / minQuantity) × giftQuantity。
   */
  specGifts?: { spec: string; minQuantity: number; giftQuantity: number }[];
}

/** 组合折扣规则：组合内各品类都满足指定数量 → 组合内商品享受综合折扣 */
export interface BundleRuleConfig extends BaseRuleConfig {
  type: 'bundle';
  /** 组合要求：每个组合项须达到的数量与商品范围 */
  items: {
    /** 组合项品牌（不限定则为 undefined） */
    brand?: string;
    /** 组合项货号前缀（命中任一前缀即计入该组合项） */
    terms: string[];
    /** 该组合项须满足的最小件数 */
    quantity: number;
  }[];
  /** 折扣值：percent 时 0~1（0.85 = 85 折）；fixed 时直接为优惠金额（元） */
  discountValue: number;
  /** percent = 按比例折扣；fixed = 固定减金额 */
  discountKind: 'percent' | 'fixed';
}

/**
 * 买 N 免 M 规则（买二送一/买三送一等）：
 * 主品范围内所有商品按单价降序排列，第 N、2N、3N… 位（即每组中价格最低的 M 件）免单。
 * 例：groupSize=3, freeCount=1 → 3 件免最低价 1 件；6 件免第 3、6 位（最低的两件）。
 */
export interface BuyNGetMRuleConfig extends BaseRuleConfig {
  type: 'buy-n-get-m';
  /** 主品品牌（不限定则为 undefined） */
  brand?: string;
  /** 主品货号前缀（命中任一前缀即参与） */
  terms: string[];
  /** 每满 groupSize 件触发一组免单 */
  groupSize: number;
  /** 每组免单件数（默认 1） */
  freeCount?: number;
}

/** Fixed-price rule: applies a configured price to matching product variants. */
export interface FixedPriceRuleConfig extends BaseRuleConfig {
  type: 'fixed-price';
  /** 主品品牌（不限定则为 undefined） */
  brand?: string;
  /** 主品货号前缀（命中任一前缀即参与；与 exactTerms 同时配置时取并集） */
  terms: string[];
  /** 精确货号列表（可选）：命中任一完整货号即参与（如 Annexin AP101 精确匹配，避免误伤 AP101AVF 等配件） */
  exactTerms?: string[];
  /**
   * 按规格文本匹配的一口价（优先于货号匹配）。
   * term 可选：缺省为全局规格匹配（如 EasyGo 48T/96T）；填写后仅对货号 === term 的行生效（Annexin 同规格异价场景）。
   */
  priceBySpec?: { term?: string; spec: string; price: number }[];
  /** 按货号前缀匹配的一口价（spec 未命中时使用） */
  priceByTerm?: { term: string; price: number }[];
}

/** 折上折规则（叠加型折扣）：在行价（含会员/品牌折扣后）基础上再打折，与「互斥取最低」相反 */
export interface StackDiscountRuleConfig extends BaseRuleConfig {
  type: 'stack-discount';
  /** 主品品牌（不限定则为 undefined） */
  brand?: string;
  /** 主品货号前缀（命中任一前缀即参与） */
  terms: string[];
  /** 叠加折扣率（0~1，0.9 = 在现有价格上再打 9 折） */
  discountRate: number;
}

/** 优惠券规则（落地 5）：订单级满减/无门槛券 */
export interface CouponRuleConfig extends BaseRuleConfig {
  type: 'coupon';
  /** 券模板 id（Coupon.id） */
  couponId: string;
  /** 券码（CouponInstance.code，下单时提交） */
  code: string;
  /** 满减门槛金额（满 X 减 Y；无门槛券为 0） */
  threshold: number;
  /** 优惠金额（减 Y 元） */
  discount: number;
  /** 无门槛券=true：可叠加折上折再减（stackable 语义）；满减券=false：互斥 */
  stackable: boolean;
  /** 模板二次授权状态（无门槛券必须 approved 才可用） */
  approvalStatus: 'auto' | 'pending' | 'approved' | 'rejected';
  /** 实例发放二次授权状态 */
  issueApprovalStatus: 'auto' | 'pending' | 'approved' | 'rejected';
}

/** 规则配置联合类型 */
export type RuleConfig =
  | AddonRuleConfig
  | GiftRuleConfig
  | BundleRuleConfig
  | BuyNGetMRuleConfig
  | FixedPriceRuleConfig
  | StackDiscountRuleConfig
  | CouponRuleConfig;

/**
 * 购物车行（引擎的最小输入，不依赖 CartContext，服务端/客户端可共用）。
 * 调用方（CartContext.CartItem 等）通过适配函数映射。
 */
export interface CartLine {
  id?: string;
  product: {
    id: string;
    /** 实际选中的规格主键，用于展示状态中的 SKU 身份；不参与规则前缀匹配。 */
    variantId?: string;
    brand: string;
    catalogNumber: string;
    price: number | null;
    /** 服务端已从数据库匹配并定价；促销校验不得信任客户端回退身份。 */
    serverVerified?: boolean;
    /** 商品名（优惠明细展示用，可选） */
    name?: string;
    /** 规格（一口价按规格匹配用，可选） */
    spec?: string | null;
  };
  quantity: number;
  /** 快速下单行不参与活动 */
  isQuickOrder?: boolean;
  /** 促销标记：命中规则后由结算页加入（ruleId 对应 RuleConfig.id；price 为行内特价，如换购价/赠品 0 元） */
  promoMark?: { ruleId: string; price?: number; choice?: string } | null;
}

/** 评估上下文 */
export interface RuleContext {
  items: CartLine[];
  now: Date;
  rules: RuleConfig[];
}

/** 优惠明细项（正数 = 立减金额） */
export interface PriceAdjustment {
  /** 精确的购物车行标识，区分同货号的普通购买、规格和活动行。 */
  lineId?: string;
  ruleId: string;
  type: RuleType;
  name: string;
  description: string;
  /** 优惠金额（元，>0 表示立减） */
  amount: number;
  /** 关联货号（可空，如组合折扣关联组合内全部商品） */
  catalogNumber?: string;
  /** 类型特有数据（qty / original / addonPrice 等） */
  meta?: Record<string, unknown>;
}

/** 单条规则的评估结果 */
export interface RuleEvaluation<T extends RuleConfig = RuleConfig> {
  rule: T;
  /** 活动是否有效（启用 + 未过期） */
  active: boolean;
  /** 是否已触发 */
  triggered: boolean;
  /** 提示文案（含缺口/额度提示，直接展示在结算页） */
  summary: string;
  /** 类型特有数据（addon: mainCount/quota/remainingQuota/shortfall；gift: giftQuota/remainingGifts；bundle: 各组合项计数） */
  details?: Record<string, unknown>;
  /** 优惠明细（空数组 = 无优惠） */
  adjustments: PriceAdjustment[];
  /**
   * 独占命中的主品行货号（exclusive 规则专用，可选）：
   * 规则触发后，这些货号不参与其他任何促销。
   * 与 adjustments 的区别：gift/addon 的调整落在赠品/换购品上，而独占锁的是**主品**行。
   * 引擎 dedupeAdjustments 用它剔除其他规则对这批货号的优惠。
   */
  exclusiveLines?: string[];
}

/** 策略接口：每种活动类型实现一个，注册进引擎 */
export interface RuleStrategy<T extends RuleConfig = RuleConfig> {
  type: RuleType;
  /** 触发条件 + 计算逻辑。返回除 rule 外的评估结果。 */
  evaluate(config: T, ctx: RuleContext): Omit<RuleEvaluation, 'rule'>;
}
