export const ORDER_PAYMENT_METHODS = [
  { value: 'bank_transfer', label: '对公转账', description: '先交货后对公转账，默认账期 30 天' },
  { value: 'rjmart', label: '锐竞', description: '先交货后通过锐竞平台结算' },
  { value: 'casmart', label: '喀斯玛', description: '先交货后通过喀斯玛平台结算' },
  { value: 'alipay', label: '支付宝', description: '下单后 24 小时内在线预付' },
] as const;

export type OrderPaymentMethod = typeof ORDER_PAYMENT_METHODS[number]['value'];

const PAYMENT_METHOD_ALIASES: Record<string, OrderPaymentMethod> = {
  bank_transfer: 'bank_transfer',
  transfer: 'bank_transfer',
  corporate: 'bank_transfer',
  '转账汇款': 'bank_transfer',
  '企业转账': 'bank_transfer',
  '对公转账': 'bank_transfer',
  '凭发票对公转账': 'bank_transfer',
  rjmart: 'rjmart',
  ruijing: 'rjmart',
  ruijin: 'rjmart',
  '锐竞': 'rjmart',
  '锐竞平台': 'rjmart',
  '锐竞（第三方平台）': 'rjmart',
  casmart: 'casmart',
  kasima: 'casmart',
  kasm: 'casmart',
  '喀斯玛': 'casmart',
  '喀斯玛平台': 'casmart',
  '喀斯玛（第三方平台）': 'casmart',
  alipay: 'alipay',
  zfb: 'alipay',
  '支付宝': 'alipay',
  '支付宝扫码': 'alipay',
};

const PAYMENT_METHOD_LABELS = Object.fromEntries(
  ORDER_PAYMENT_METHODS.map((method) => [method.value, method.label]),
) as Record<OrderPaymentMethod, string>;

export function normalizeOrderPaymentMethod(value: unknown): OrderPaymentMethod | null | undefined {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  return PAYMENT_METHOD_ALIASES[value.trim().toLowerCase()];
}

export function formatOrderPaymentMethod(value: string): string {
  const normalized = normalizeOrderPaymentMethod(value);
  if (normalized) return PAYMENT_METHOD_LABELS[normalized];
  if (value === 'weixin' || value === '微信扫码' || value === '微信支付') return '微信支付';
  if (value === 'card' || value === '银行卡') return '银行卡';
  return value;
}

export function isThirdPartyPaymentMethod(value: string): boolean {
  const normalized = normalizeOrderPaymentMethod(value);
  return normalized === 'rjmart' || normalized === 'casmart';
}

export function isPostDeliveryPaymentMethod(value: unknown): boolean {
  const normalized = normalizeOrderPaymentMethod(value);
  return normalized === 'bank_transfer' || normalized === 'rjmart' || normalized === 'casmart';
}

export function isAlipayPaymentMethod(value: unknown): boolean {
  return normalizeOrderPaymentMethod(value) === 'alipay';
}
