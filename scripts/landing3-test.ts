/**
 * 落地 3 自测：新规则类型（buy-n-get-m / fixed-price / stack-discount）
 * + 新增 biosharp-labselect / multisciences 规则配置。
 */
import { promotionEngine } from '../src/lib/cart-promotions/engine';
import { PROMOTION_RULES } from '../src/lib/cart-promotions/rules';
import type { CartLine, RuleEvaluation } from '../src/lib/cart-promotions/types';

function line(cat: string, qty: number, price: number, brand = 'Labselect', spec?: string, promoRuleId?: string, promoPrice?: number): CartLine {
  return {
    product: { id: 'p-' + cat, brand, catalogNumber: cat, price, name: cat, spec },
    quantity: qty,
    promoMark: promoRuleId ? { ruleId: promoRuleId, price: promoPrice } : null,
  };
}

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name + ' ' + detail); }
}
function byRule(evals: RuleEvaluation[], ruleId: string): number {
  const ev = evals.find((e) => e.rule.id === ruleId);
  return ev ? ev.adjustments.reduce((s, a) => s + a.amount, 0) : 0;
}

// 1. buy-n-get-m：ELISA 买二送一（3 件价格降序，第 3 位免单）
console.log('【1】buy-n-get-m 买二送一');
{
  const items: CartLine[] = [
    line('EK0011', 1, 300, 'MultiSciences'),
    line('EK0021', 1, 500, 'MultiSciences'),
    line('EK0031', 1, 200, 'MultiSciences'),
  ];
  const evals = promotionEngine.evaluateAll(items, PROMOTION_RULES);
  const e = evals.find((x) => x.rule.id === 'multisciences-elisa-buy-two-get-one');
  check('3 件触发', e?.triggered === true);
  check('免单 1 件（最低价 200）', Math.abs(byRule(evals, 'multisciences-elisa-buy-two-get-one') - 200) < 0.01);
  // 6 件：降序 500,400,350,300,200,150 → 第 3 位 350、第 6 位 150 → 免 500
  const items6: CartLine[] = [300, 500, 200, 400, 150, 350].map((p, i) => line('EK00' + (i + 1) + '1', 1, p, 'MultiSciences'));
  const evals6 = promotionEngine.evaluateAll(items6, PROMOTION_RULES);
  check('6 件免 2 件（350+150=500）', Math.abs(byRule(evals6, 'multisciences-elisa-buy-two-get-one') - 500) < 0.01);
}

// 2. fixed-price：EasyGo 48T 728 / 96T 1228
console.log('【2】fixed-price 一口价');
{
  const items: CartLine[] = [
    line('EK102EGA', 1, 1500, 'MultiSciences', '48T'),
    line('EK106EG', 1, 1800, 'MultiSciences', '96T'),
  ];
  const evals = promotionEngine.evaluateAll(items, PROMOTION_RULES);
  const e = evals.find((x) => x.rule.id === 'multisciences-easygo-fixed-price');
  check('触发', e?.triggered === true);
  check('一口价优惠 772+572=1344', Math.abs(byRule(evals, 'multisciences-easygo-fixed-price') - 1344) < 0.01);
}

// 3. stack-discount：Th/Treg 折上九折 —— 已停用（日常 75 折低于官方折上折 76.5 折，直接按 75 折销售）
console.log('【3】Th/Treg 折上折已停用');
{
  const items: CartLine[] = [line('KTH001', 1, 1000, 'MultiSciences')];
  const evals = promotionEngine.evaluateAll(items, PROMOTION_RULES);
  const e = evals.find((x) => x.rule.id === 'multisciences-th-treg-stack-discount');
  check('规则停用（引擎不评估）', e === undefined);
  check('无折上折优惠', Math.abs(byRule(evals, 'multisciences-th-treg-stack-discount') - 0) < 0.01);
}

// 4. gift：fbs 胎牛血清同款买一赠一
console.log('【4】gift fbs 买一赠一');
{
  const items: CartLine[] = [
    line('BL205A', 1, 1300, 'Biosharp'),
    line('BL205A', 1, 1300, 'Biosharp', undefined, 'biosharp-fbs-bogo', 0),
  ];
  const evals = promotionEngine.evaluateAll(items, PROMOTION_RULES);
  const e = evals.find((x) => x.rule.id === 'biosharp-fbs-bogo');
  check('触发', e?.triggered === true);
  check('赠品优惠 1300', Math.abs(byRule(evals, 'biosharp-fbs-bogo') - 1300) < 0.01);
}

// 5. addon：marker-pvdf 6 支 +50 元 PVDF
console.log('【5】addon marker-pvdf');
{
  const items: CartLine[] = [
    line('BL712A', 6, 150, 'Biosharp'),
    line('TM-PVDF-R-22', 1, 200, 'Labselect', undefined, 'biosharp-marker-pvdf-addon', 50),
  ];
  const evals = promotionEngine.evaluateAll(items, PROMOTION_RULES);
  const e = evals.find((x) => x.rule.id === 'biosharp-marker-pvdf-addon');
  check('触发', e?.triggered === true);
  check('换购优惠 150', Math.abs(byRule(evals, 'biosharp-marker-pvdf-addon') - 150) < 0.01);
}

// 6. ultrafilter 加价购 2（吸头）
console.log('【6】ultrafilter 加价购 2（吸头）');
{
  const items: CartLine[] = [
    line('BS-UFC-005-030', 1, 60, 'Biosharp'),
    line('BS-200-T', 1, 20, 'Biosharp', undefined, 'biosharp-ultrafilter-tips-addon', 1),
  ];
  const evals = promotionEngine.evaluateAll(items, PROMOTION_RULES);
  const e = evals.find((x) => x.rule.id === 'biosharp-ultrafilter-tips-addon');
  check('触发', e?.triggered === true);
  check('换购优惠 19', Math.abs(byRule(evals, 'biosharp-ultrafilter-tips-addon') - 19) < 0.01);
}

// 7. 多规则同单：fbs 买一赠一 + EasyGo 一口价
console.log('【7】多规则同时命中');
{
  const items: CartLine[] = [
    line('BL205A', 1, 1300, 'Biosharp'),
    line('BL205A', 1, 1300, 'Biosharp', undefined, 'biosharp-fbs-bogo', 0),
    line('EK102EGA', 1, 1500, 'MultiSciences', '48T'),
  ];
  const evals = promotionEngine.evaluateAll(items, PROMOTION_RULES);
  check('gift 1300 + fixed 772 = 2072', Math.abs(promotionEngine.totalDiscount(evals) - 2072) < 0.01);
}

// 追加：matrix-gel 规格赠品表
console.log('【8】matrix-gel 规格赠品（1mL 2支→2箱培养板 / 10mL 1支→6箱）');
{
  const items: CartLine[] = [
    line('BL1833A', 2, 320, 'Biosharp', '1mL'),
    line('11110', 2, 210, 'Labselect', undefined, 'biosharp-matrix-gel-plate-gift', 0),
    line('BL18330', 1, 2000, 'Biosharp', '10mL'),
    line('11510', 6, 230, 'Labselect', undefined, 'biosharp-matrix-gel-plate-gift', 0),
  ];
  const evals = promotionEngine.evaluateAll(items, PROMOTION_RULES);
  const g = evals.find((x) => x.rule.id === 'biosharp-matrix-gel-plate-gift');
  check('2支1mL→2 + 1支10mL→6 = 8 箱额度', (g?.details?.giftQuota as number) === 8, 'got ' + g?.details?.giftQuota);
  check('赠品优惠 = 210×2 + 230×6 = 1800', Math.abs(byRule(evals, 'biosharp-matrix-gel-plate-gift') - 1800) < 0.01);
}

// 追加 BP 移液器规则测试（ultrafilter 加价购1 / lymphocyte 2瓶档）
console.log('【9】BP 移液器规则（ultrafilter +2元 / lymphocyte 2瓶）');
{
  const items: CartLine[] = [
    line('BS-UFC-040-010', 1, 60, 'Biosharp'),
    line('BP10001A', 1, 142.5, 'Biosharp', undefined, 'biosharp-ultrafilter-pipettor-addon', 2),
    line('BL1420A', 2, 120, 'Biosharp'),
    line('BP10005A', 1, 142.5, 'Biosharp', undefined, 'biosharp-lymphocyte-pipettor-gift', 0),
  ];
  const evals = promotionEngine.evaluateAll(items, PROMOTION_RULES);
  check('ultrafilter 加价购1 触发', evals.find((x) => x.rule.id === 'biosharp-ultrafilter-pipettor-addon')?.triggered === true);
  check('ultrafilter 换购优惠 140.5（142.5-2）', Math.abs(byRule(evals, 'biosharp-ultrafilter-pipettor-addon') - 140.5) < 0.01);
  check('lymphocyte 2瓶档触发', evals.find((x) => x.rule.id === 'biosharp-lymphocyte-pipettor-gift')?.triggered === true);
  check('lymphocyte 赠品优惠 142.5（免费）', Math.abs(byRule(evals, 'biosharp-lymphocyte-pipettor-gift') - 142.5) < 0.01);
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
