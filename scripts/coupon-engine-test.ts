/**
 * 优惠券测试（落地 5）：引擎策略 + 服务端核销 + 二次授权。
 *
 * 引擎层（不依赖 DB）：
 * 1. 满减券：达到门槛 → 立减；未达门槛 → 不触发；
 * 2. 无门槛券：无门槛直接减；stackable 语义（与行级促销共存）；
 * 3. 二次授权：approvalStatus/issueApprovalStatus 非 auto/approved → 不触发；
 * 4. 满减券金额不超过小计。
 *
 * 服务层（依赖 DB，须先建测试数据）：
 * 5. redeemCoupon 正常核销（状态 active→used、usedCount+1）；
 * 6. 未授权实例核销被拒；
 * 7. 已使用/过期/不属于用户 → 拒绝；
 * 8. 未达门槛 → 拒绝。
 */
import { promotionEngine } from '@/lib/cart-promotions/engine';
import type { CartLine, CouponRuleConfig } from '@/lib/cart-promotions/types';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

function line(cat: string, qty: number, price: number): CartLine {
  return {
    id: cat,
    product: { id: cat, brand: 'B', catalogNumber: cat, price, name: cat, spec: 's' },
    quantity: qty,
  };
}

function couponCfg(over: Partial<CouponRuleConfig>): CouponRuleConfig {
  return {
    id: 'coupon:TEST',
    type: 'coupon',
    couponId: 'c1',
    code: 'TESTCODE',
    name: '测试券',
    enabled: true,
    threshold: 0,
    discount: 50,
    stackable: false,
    approvalStatus: 'auto',
    issueApprovalStatus: 'auto',
    description: '测试券',
    ...over,
  };
}

function evalCoupon(cfg: CouponRuleConfig, items: CartLine[]) {
  const ev = promotionEngine.evaluateAll(items, [cfg], new Date())[0];
  return ev;
}

console.log('【1】满减券：达到门槛');
{
  const cfg = couponCfg({ threshold: 100, discount: 30, stackable: false });
  const items = [line('A1', 1, 150)];
  const ev = evalCoupon(cfg, items);
  check('触发', ev?.triggered === true, JSON.stringify(ev?.summary));
  check('立减 30', Math.abs((ev?.adjustments[0]?.amount ?? 0) - 30) < 0.01, `got ${ev?.adjustments[0]?.amount}`);
}

console.log('\n【2】满减券：未达门槛');
{
  const cfg = couponCfg({ threshold: 100, discount: 30, stackable: false });
  const items = [line('A1', 1, 80)];
  const ev = evalCoupon(cfg, items);
  check('不触发', ev?.triggered === false, JSON.stringify(ev?.summary));
  check('提示缺额', (ev?.summary ?? '').includes('差') || (ev?.summary ?? '').includes('满减'), ev?.summary);
}

console.log('\n【3】无门槛券：直接立减');
{
  const cfg = couponCfg({ threshold: 0, discount: 50, stackable: true });
  const items = [line('A1', 1, 30)];
  const ev = evalCoupon(cfg, items);
  check('触发', ev?.triggered === true, JSON.stringify(ev?.summary));
  // 立减不超过小计
  check('立减 30（封顶小计）', Math.abs((ev?.adjustments[0]?.amount ?? 0) - 30) < 0.01, `got ${ev?.adjustments[0]?.amount}`);
}

console.log('\n【4】二次授权：模板 pending → 不触发');
{
  const cfg = couponCfg({ approvalStatus: 'pending', issueApprovalStatus: 'auto' });
  const items = [line('A1', 1, 500)];
  const ev = evalCoupon(cfg, items);
  check('不触发', ev?.triggered === false, JSON.stringify(ev?.summary));
}

console.log('\n【5】二次授权：实例发放 pending → 不触发');
{
  const cfg = couponCfg({ approvalStatus: 'auto', issueApprovalStatus: 'pending' });
  const items = [line('A1', 1, 500)];
  const ev = evalCoupon(cfg, items);
  check('不触发', ev?.triggered === false, JSON.stringify(ev?.summary));
}

console.log('\n【6】门槛统计：促销标记行不计入门槛');
{
  const cfg = couponCfg({ threshold: 100, discount: 20, stackable: false });
  const items = [
    line('A1', 1, 80), // 正常行
    { ...line('G1', 1, 500), promoMark: { ruleId: 'gift', price: 0 } }, // 赠品行不计入
  ];
  const ev = evalCoupon(cfg, items);
  check('不触发（80 < 100）', ev?.triggered === false, JSON.stringify(ev?.summary));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
