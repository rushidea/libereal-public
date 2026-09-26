/**
 * 验证：组合折扣(bundle) + 赠品(gift) 复合活动能否同时生效
 * 场景：购 5 箱培养板 + 2 箱冻存管 → 组合内 9 折；同时培养板满 5 箱 → 赠 1 箱培养板
 */
import { promotionEngine } from '../src/lib/cart-promotions/engine';
import type { CartLine, RuleConfig } from '../src/lib/cart-promotions/types';

function line(cat: string, qty: number, price: number, promoRuleId?: string, promoPrice?: number): CartLine {
  return {
    product: { id: 'p-' + cat, brand: 'Labselect', catalogNumber: cat, price, name: cat },
    quantity: qty,
    promoMark: promoRuleId ? { ruleId: promoRuleId, price: promoPrice } : null,
  };
}

const rules: RuleConfig[] = [
  { id: 'bundle-1', type: 'bundle', name: '培养板+冻存管组合9折', enabled: true, description: '',
    items: [
      { brand: 'Labselect', terms: ['11110'], quantity: 5 },
      { brand: 'Labselect', terms: ['CV-002'], quantity: 2 },
    ],
    discountValue: 0.9, discountKind: 'percent' },
  { id: 'gift-1', type: 'gift', name: '培养板满5箱送1箱', enabled: true, description: '',
    eligibleBrand: 'Labselect', eligibleTerms: ['11110'], minQuantity: 5, giftBrand: 'Labselect', giftTerms: ['11130'], maxGiftsPerTrigger: 1 },
];

// 场景 A：5 培养板 + 2 冻存管（无赠品行）→ 组合 9 折触发，赠品触发
console.log('【场景A】5培养板 + 2冻存管（无赠品行）');
{
  const items: CartLine[] = [line('11110-001', 5, 210), line('CV-002-001', 2, 50)];
  const evals = promotionEngine.evaluateAll(items, rules);
  for (const ev of evals) {
    const amounts = ev.adjustments.map((a) => a.amount).join(',');
    console.log('  [' + ev.rule.type + '] triggered=' + ev.triggered + ' | ' + ev.summary + ' | 优惠=' + amounts);
  }
  console.log('  去重后总优惠 = ' + promotionEngine.totalDiscount(evals));
}

// 场景 B：加入 1 箱赠品培养板（promoMark 标记）→ 赠品免费生效
console.log('\n【场景B】5培养板 + 2冻存管 + 1箱赠品培养板(免费)');
{
  const items: CartLine[] = [
    line('11110-001', 5, 210),
    line('CV-002-001', 2, 50),
    line('11130-001', 1, 220, 'gift-1', 0),
  ];
  const evals = promotionEngine.evaluateAll(items, rules);
  for (const ev of evals) {
    const ads = ev.adjustments.map((a) => (a.catalogNumber ?? '(整单)') + ':' + a.amount).join(',');
    console.log('  [' + ev.rule.type + '] triggered=' + ev.triggered + ' | ' + ev.summary + ' | 优惠=' + ads);
  }
  console.log('  去重后总优惠 = ' + promotionEngine.totalDiscount(evals));
}

// 场景 C：赠品行恰好命中组合 terms → 检查是否误计入组合件数
console.log('\n【场景C】赠品=组合内同款（赠 11110，组合 terms 含 11110）→ 验证误计入风险');
{
  const giftRule: RuleConfig = { id: 'gift-2', type: 'gift', name: '满5箱送1箱11110', enabled: true, description: '',
    eligibleBrand: 'Labselect', eligibleTerms: ['11110'], minQuantity: 5, giftBrand: 'Labselect', giftTerms: ['11110'], maxGiftsPerTrigger: 1 };
  const items: CartLine[] = [
    line('11110-001', 5, 210),
    line('CV-002-001', 2, 50),
    line('11110-002', 1, 210, 'gift-2', 0),
  ];
  const evals = promotionEngine.evaluateAll(items, [rules[0], giftRule]);
  const bundle = evals.find((e) => e.rule.type === 'bundle');
  const gift = evals.find((e) => e.rule.type === 'gift');
  const counts = bundle?.details?.counts as { terms: string[]; required: number; actual: number }[] | undefined;
  const comboActual = counts?.find((c) => c.terms[0] === '11110')?.actual;
  console.log('  bundle 组合 11110 实际件数 = ' + comboActual + '（若为 6 = 赠品行被误计入组合）');
  console.log('  赠品详情 = ' + JSON.stringify(gift?.details));
}
