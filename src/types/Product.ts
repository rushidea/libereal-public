import type { ProductDisplayPrice } from '@/lib/product-pricing';

export interface ProductVariant {
  /** ProductVariant 表主键；有值时加购需写入 cart.variantId 以便计价。 */
  id?: string;
  catalogNumber: string;
  spec: string;
  /** 会员价；方案③下仅正式会员可收到，非正式用户由服务端剥离 */
  price?: number;
  /** 服务端预计算展示价（仅正式会员携带） */
  displayPrice?: ProductDisplayPrice;
  /** 当前规格对应的销售单位 / 包装单位。 */
  salesUnit?: string;
  /** 规格级库存，-1 = 无限或未设定。 */
  stockQuantity?: number;
  /** 规格级货期；未单独维护时由商品本体提供。 */
  leadTime?: string;
  /** 规格级可售状态。 */
  inStock?: boolean;
}

export interface Product {
  id: string;
  variantId?: string;
  name: string;
  catalogNumber: string;
  brand: string;
  /** 会员成交价；方案③下仅服务端持有，前端只收 displayPrice */
  price?: number;
  category?: string;
  subcategory?: string;
  type?: string;
  spec?: string;
  target?: string;
  host?: string;
  applications?: string[];
  reactivity?: string[];
  description?: string;
  specificity?: string;
  productUsage?: string;
  speciesReactivity?: string;
  speciesPredicted?: string;
  inStock: boolean;
  originalPrice?: number;
  promotionalPrice?: number;
  promotion?: boolean;
  subBrand?: string;
  imageUrl?: string;
  hazardous?: boolean;
  variants?: ProductVariant[];
  /** 服务端预计算的展示价（salePrice/strikethroughPrice/showGuestDiscount/hasPrice） */
  displayPrice?: ProductDisplayPrice;

  // === P2-1: 生物医药专业字段 ===
  /** 货期/交货时间（如 "1-2 周" / "现货" / "4-6 周"）*/
  leadTime?: string;
  /** 当前 price 对应的销售单位，例如瓶、盒、箱。 */
  salesUnit?: string;
  /** 储存温度（如 "-20°C" / "4°C" / "室温" / "-80°C"）*/
  storageTemp?: string;
  /** 储存缓冲液/条件（如 "PBS, pH 7.4" / "50% 甘油, -20°C"）*/
  storageBuffer?: string;
  /** 有效期/保质期 */
  expiryDate?: string;
  /** 批号/Lot */
  lotNumber?: string;
  /** 克隆号（抗体）/ 目录株号（细胞）*/
  cloneNumber?: string;
  /** 纯度（如 ">95%" / "HPLC"）*/
  purity?: string;
  /** 分子量（kDa）*/
  molecularWeight?: number;
  /** 等电点（pI）*/
  isoelectricPoint?: number;
  /** 浓度（如 "1 mg/mL"）*/
  concentration?: string;
  /** CoA 证书下载 URL（Certificate of Analysis）*/
  cofaUrl?: string;
  /** SDS 安全表下载 URL */
  sdsUrl?: string;
  /** 引用文献 PMID 列表 */
  pmids?: string[];
  /** 是否有库存（精确数字，-1 = 无限）*/
  stockQuantity?: number;
}
