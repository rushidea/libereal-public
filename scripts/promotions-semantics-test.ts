/**
 * 促销三级语义测试（落地 4）：独占 / 叠加 / 互斥取最低。
 *
 * 场景：
 * 1. 互斥取最低（默认）：同货号被两个互斥规则命中 → 只取优惠最大的一条；
 * 2. 独占型：exclusive 规则命中行，其他规则优惠被剔除（仅保留独占规则自身优惠）；
 * 3. 叠加型：stackable 规则优惠与其他规则优惠同时保留（可叠加）；
 * 4. 整单优惠（bundle 无 catalogNumber）始终保留；
 * 5. 混合：独占 + 互斥 + 叠加三规则同场。
 */
import { promotionEngine } from '@/lib/cart-promotions/engine';
import type { CartLine, RuleConfig } from '@/lib/cart-promotions/types';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

function line(cat: string, qty: number, price: number, brand = 'B', promo?: string, promoPrice?: number): CartLine {
  return {
    id: cat,
    product: { id: cat, brand, catalogNumber: cat, price, name: cat, spec: 's' },
    quantity: qty,
    promoMark: promo ? { ruleId: promo, price: promoPrice ?? 0 } : null,
  };
}

// ── 测试用规则（互斥默认 / 独占 / 叠加 三态）──
const rules: RuleConfig[] = [
  // 互斥（默认）：fixed-price 一口价 100
  {
    id: 't-exclusive-1', type: 'fixed-price', name: '互斥A', enabled: true,
    brand: 'B', exactTerms: ['X001'], terms: [], priceBySpec: [{ term: 'X001', spec: 's', price: 100 }],
    description: '一口价 100',
  },
  // 互斥（默认）：fixed-price 一口价 150（优惠更大）
  {
    id: 't-exclusive-2', type: 'fixed-price', name: '互斥B', enabled: true,
    brand: 'B', exactTerms: ['X001'], terms: [], priceBySpec: [{ term: 'X001', spec: 's', price: 150 }],
    description: '一口价 150',
  },
  // 独占：gift 赠品（命中 X002）
  {
    id: 't-exclusive-gift', type: 'gift', name: '独占赠品', enabled: true, exclusive: true,
    eligibleBrand: 'B', eligibleTerms: ['X002'], minQuantity: 1,
    giftBrand: 'B', giftTerms: ['G001'], maxGiftsPerTrigger: 1,
    description: '独占赠品（不与其他优惠同享）',
  },
  // 互斥：X002 也被一口价命中
  {
    id: 't-exclusive-fixed', type: 'fixed-price', name: 'X002一口价', enabled: true,
    brand: 'B', exactTerms: ['X002'], terms: [], priceBySpec: [{ term: 'X002', spec: 's', price: 80 }],
    description: 'X002 一口价 80',
  },
  // 叠加：stack-discount 折上折（命中 X003）
  {
    id: 't-stack', type: 'stack-discount', name: '折上九折', enabled: true, stackable: true,
    brand: 'B', terms: ['X003'], discountRate: 0.9,
    description: 'X003 折上九折',
  },
  // 互斥：X003 也被一口价命中（一口价 200 → 优惠 100；折上折优惠 10）
  {
    id: 't-stack-fixed', type: 'fixed-price', name: 'X003一口价', enabled: true,
    brand: 'B', exactTerms: ['X003'], terms: [], priceBySpec: [{ term: 'X003', spec: 's', price: 200 }],
    description: 'X003 一口价 200',
  },
  // 整单：bundle 组合折扣（无 catalogNumber）
  {
    id: 't-bundle', type: 'bundle', name: '组合9折', enabled: true,
    items: [{ brand: 'B', terms: ['X004'], quantity: 1 }], discountValue: 0.9, discountKind: 'percent',
    description: 'X004 组合 9 折',
  },
];

function byRule(evals: ReturnType<typeof promotionEngine.evaluateAll>, id: string) {
  const e = evals.find((x) => x.rule.id === id);
  return (e?.adjustments ?? []).reduce((s, a) => s + a.amount, 0);
}
function lineAdj(evals: ReturnType<typeof promotionEngine.evaluateAll>, cat: string) {
  return promotionEngine.dedupeAdjustments(evals).filter((a) => a.catalogNumber === cat);
}

console.log('【1】互斥取最低（默认）：同货号多规则只取最大');
{
  const items: CartLine[] = [line('X001', 1, 300, 'B', undefined, undefined)];
  const evals = promotionEngine.evaluateAll(items, rules);
  const xs = lineAdj(evals, 'X001');
  check('X001 仅保留 1 条优惠', xs.length === 1, `got ${xs.length}`);
  check('取优惠最大（300→100 立减 200 > 150）', xs.length === 1 && Math.abs(xs[0].amount - 200) < 0.01, JSON.stringify(xs.map((x) => x.amount)));
}

console.log('\n【2】独占型：独占规则命中行，其他规则优惠剔除');
{
  const items: CartLine[] = [
    line('X002', 1, 300, 'B', undefined, undefined), // 独占 gift 触发（主品）
    line('G001', 1, 50, 'B', 't-exclusive-gift', 0), // 赠品行
  ];
  const evals = promotionEngine.evaluateAll(items, rules);
  // X002 被独占规则（gift 主品）+ 一口价同时命中 → 一口价优惠应被剔除
  const x2 = lineAdj(evals, 'X002');
  check('X002 无一口价优惠（被独占剔除）', x2.length === 0, JSON.stringify(x2.map((x) => x.amount)));
  // 赠品行 G001 保留（独占规则自身优惠）
  const g = lineAdj(evals, 'G001');
  check('赠品行 G001 优惠保留（50）', g.length === 1 && Math.abs(g[0].amount - 50) < 0.01, JSON.stringify(g.map((x) => x.amount)));
  check('总优惠 = 50（仅赠品）', Math.abs(promotionEngine.totalDiscount(evals) - 50) < 0.01, `got ${promotionEngine.totalDiscount(evals)}`);
}

console.log('\n【3】叠加型：折上折与其他规则优惠叠加');
{
  const items: CartLine[] = [line('X003', 1, 100, 'B', undefined, undefined)];
  const evals = promotionEngine.evaluateAll(items, rules);
  // 一口价 200 → 优惠 = 100-200 <0 无优惠；折上折 = 100×0.1 = 10
  const x3 = lineAdj(evals, 'X003');
  check('X003 折上折优惠保留（10）', Math.abs(byRule(evals, 't-stack') - 10) < 0.01, `got ${byRule(evals, 't-stack')}`);
  check('X003 一口价不产生负优惠', Math.abs(byRule(evals, 't-stack-fixed') - 0) < 0.01, `got ${byRule(evals, 't-stack-fixed')}`);
  check('总优惠 = 10', Math.abs(promotionEngine.totalDiscount(evals) - 10) < 0.01, `got ${promotionEngine.totalDiscount(evals)}`);
}

console.log('\n【4】叠加型：与互斥规则同场（互斥取最大 + 叠加保留）');
{
  const items: CartLine[] = [
    line('X001', 1, 300, 'B', undefined, undefined), // 互斥：两规则取最大 200（300→100）
    line('X003', 1, 100, 'B', undefined, undefined), // 叠加：折上折 10（一口价不触发）
  ];
  const evals = promotionEngine.evaluateAll(items, rules);
  check('总优惠 = 200（互斥最大）+ 10（叠加）= 210', Math.abs(promotionEngine.totalDiscount(evals) - 210) < 0.01, `got ${promotionEngine.totalDiscount(evals)}`);
}

console.log('\n【5】整单优惠（bundle）始终保留');
{
  const items: CartLine[] = [line('X004', 1, 100, 'B', undefined, undefined)];
  const evals = promotionEngine.evaluateAll(items, rules);
  const bundle = byRule(evals, 't-bundle');
  check('bundle 优惠 10 保留', Math.abs(bundle - 10) < 0.01, `got ${bundle}`);
  const globals = promotionEngine.dedupeAdjustments(evals).filter((a) => !a.catalogNumber);
  check('无货号调整计入 global', globals.length === 1, `got ${globals.length}`);
}

console.log('\n【6】混合场景：独占 + 互斥 + 叠加同场');
{
  const items: CartLine[] = [
    line('X002', 1, 300, 'B', undefined, undefined),
    line('G001', 1, 50, 'B', 't-exclusive-gift', 0),
    line('X001', 1, 300, 'B', undefined, undefined),
    line('X003', 1, 100, 'B', undefined, undefined),
  ];
  const evals = promotionEngine.evaluateAll(items, rules);
  // 期望：G001 赠品 50（独占）+ X001 互斥取最大 200 + X003 折上折 10 = 260
  const total = promotionEngine.totalDiscount(evals);
  check('总优惠 = 50 + 200 + 10 = 260', Math.abs(total - 260) < 0.01, `got ${total}`);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
