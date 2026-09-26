/**
 * 规则引擎自测（纯逻辑，无 DB）：
 * 1. addon 换购：10 件主品 → 触发、quota=1、优惠 = (原价-2)×qty
 * 2. gift 赠品：20 件主品 → 触发、赠品优惠 = 赠品原价
 * 3. bundle 组合折扣：5 培养板 + 2 冻存管 → 9 折优惠
 * 4. 去重：同一货号多规则命中只取最大优惠
 */
import { promotionEngine } from '../src/lib/cart-promotions/engine';
import { PROMOTION_RULES } from '../src/lib/cart-promotions/rules';
import type { CartLine } from '../src/lib/cart-promotions/types';

function line(cat: string, qty: number, price: number, promoRuleId?: string, promoPrice?: number): CartLine {
  return {
    product: { id: `p-${cat}`, brand: cat.startsWith('CV') ? 'Labselect' : 'Labselect', catalogNumber: cat, price, name: cat },
    quantity: qty,
    promoMark: promoRuleId ? { ruleId: promoRuleId, price: promoPrice } : null,
  };
}

// 启用所有规则（gift/bundle 示例默认 disabled，这里临时开启）
const rules = PROMOTION_RULES.map((r) => ({ ...r, enabled: true }));

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail}`); }
}

// ── 1. addon：10 件培养板（¥210/件）+ 1 件换购冻存管（¥50，加 2 元）──
console.log('【1】addon 换购');
{
  const items: CartLine[] = [
    line('11110-001', 10, 210),
    line('CV-002-001', 1, 50, 'labselect-plates-10-boxes-addon', 2),
  ];
  const evals = promotionEngine.evaluateAll(items, rules);
  const addon = evals.find((e) => e.rule.type === 'addon');
  check('addon 触发', addon?.triggered === true, JSON.stringify(addon?.summary));
  check('quota = 1', addon?.details?.quota === 1);
  check('remainingQuota = 0（已用 1）', addon?.details?.remainingQuota === 0);
  check('优惠 = 48（50-2）', Math.abs((addon?.adjustments[0]?.amount ?? 0) - 48) < 0.01, `got ${addon?.adjustments[0]?.amount}`);
}

// ── 1b. addon 缺口：8 件主品 ──
{
  const items: CartLine[] = [line('11110-001', 8, 210)];
  const evals = promotionEngine.evaluateAll(items, rules);
  const addon = evals.find((e) => e.rule.type === 'addon');
  check('addon 未触发', addon?.triggered === false);
  check('shortfall = 2', addon?.details?.shortfall === 2, `got ${addon?.details?.shortfall}`);
}

// ── 2. gift：20 件培养板 + 1 件赠品冻存管（¥50 免费）──
console.log('【2】gift 赠品');
{
  const items: CartLine[] = [
    line('11110-001', 20, 210),
    line('CV-002-001', 1, 50, 'labselect-plates-20-boxes-gift', 0),
  ];
  const evals = promotionEngine.evaluateAll(items, rules);
  const gift = evals.find((e) => e.rule.type === 'gift');
  check('gift 触发', gift?.triggered === true, JSON.stringify(gift?.summary));
  check('giftQuota = 1', gift?.details?.giftQuota === 1);
  check('赠品优惠 = 50（免费）', Math.abs((gift?.adjustments[0]?.amount ?? 0) - 50) < 0.01, `got ${gift?.adjustments[0]?.amount}`);
}

// ── 3. bundle：5 培养板 + 2 冻存管 → 9 折（原价 5×210 + 2×50 = 1150，优惠 115）──
console.log('【3】bundle 组合折扣');
{
  const items: CartLine[] = [
    line('11110-001', 5, 210),
    line('CV-002-001', 2, 50),
  ];
  const evals = promotionEngine.evaluateAll(items, rules);
  const bundle = evals.find((e) => e.rule.type === 'bundle');
  check('bundle 触发', bundle?.triggered === true, JSON.stringify(bundle?.summary));
  check('优惠 = 115（1150×10%）', Math.abs((bundle?.adjustments[0]?.amount ?? 0) - 115) < 0.01, `got ${bundle?.adjustments[0]?.amount}`);
  check('details.subtotal = 1150', bundle?.details?.subtotal === 1150, `got ${bundle?.details?.subtotal}`);
}

// ── 3b. bundle 缺口：4 件培养板 ──
{
  const items: CartLine[] = [
    line('11110-001', 4, 210),
    line('CV-002-001', 2, 50),
  ];
  const evals = promotionEngine.evaluateAll(items, rules);
  const bundle = evals.find((e) => e.rule.type === 'bundle');
  check('bundle 未触发（培养板差 1）', bundle?.triggered === false, JSON.stringify(bundle?.summary));
  check('bundle 无优惠', (bundle?.adjustments.length ?? -1) === 0);
}

// ── 4. 去重：同一冻存管行同时被 addon 和 gift 命中 → 只取最大优惠 ──
console.log('【4】防重复优惠');
{
  // 只启用 addon + gift（隔离 bundle，聚焦去重语义）
  const rulesAG = rules.filter((r) => r.type !== 'bundle');
  // 10 件培养板（addon 触发）+ 1 件换购冻存管 + 1 件赠品冻存管
  const items: CartLine[] = [
    line('11110-001', 10, 210),
    line('CV-002-001', 1, 50, 'labselect-plates-10-boxes-addon', 2),
  ];
  // 让 gift 规则用同一行（模拟多规则命中同货号）：构造第二个 gift 标记行
  items.push(line('CV-002-002', 1, 80, 'labselect-plates-20-boxes-gift', 0));
  const evals = promotionEngine.evaluateAll(items, rulesAG);
  const dedup = promotionEngine.dedupeAdjustments(evals);
  const cvLines = dedup.filter((a) => a.catalogNumber?.startsWith('CV-002'));
  check('CV-002 两行各自独立优惠', cvLines.length === 2, `got ${cvLines.length}`);
  check('总优惠 = 48 + 80 = 128', Math.abs(promotionEngine.totalDiscount(evals) - 128) < 0.01, `got ${promotionEngine.totalDiscount(evals)}`);

  // 4b. 同货号重复标记（同一行两个规则）→ 只取最大
  const items2: CartLine[] = [
    line('11110-001', 10, 210),
    line('CV-002-001', 1, 50, 'labselect-plates-10-boxes-addon', 2),
    line('CV-002-001', 1, 50, 'labselect-plates-20-boxes-gift', 0), // 同货号不同规则
  ];
  const evals2 = promotionEngine.evaluateAll(items2, rulesAG);
  const dedup2 = promotionEngine.dedupeAdjustments(evals2);
  const cv2 = dedup2.filter((a) => a.catalogNumber === 'CV-002-001');
  check('同货号多规则只取最大优惠（50）', cv2.length === 1 && Math.abs(cv2[0].amount - 50) < 0.01, `got ${JSON.stringify(cv2.map((c) => c.amount))}`);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
