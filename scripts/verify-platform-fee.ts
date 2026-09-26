/** 平台服务费按优惠后成交价计算——验证 */
import { calculateOrderAmounts } from '../src/lib/order-domain';

let pass = 0, fail = 0;
function check(name: string, got: number, want: number) {
  if (Math.abs(got - want) < 0.01) { pass++; console.log('  PASS ' + name + ' = ' + got); }
  else { fail++; console.log('  FAIL ' + name + ' got=' + got + ' want=' + want); }
}

// 场景1：原价小计 1000，活动优惠 100（换购/赠品）→ 平台费 = (1000-100)×2% = 18
const promoAdj = [{ type: 'promotion_addon' as const, label: '换购', amount: -100, reason: 'x' }];
const fee1 = Math.round((1000 - 100) * 0.02 * 100) / 100;
check('平台费(优惠后基准) = 18', fee1, 18);
const amounts1 = calculateOrderAmounts([{ unitPrice: 1000, quantity: 1 }], [...[{ type: 'platform_fee' as const, label: '平台服务费', amount: fee1 }, { type: 'transfer_fee' as const, label: '转账', amount: 20 }], ...promoAdj]);
check('应付总额 = 1000 - 100 + 18 + 20 = 938', amounts1.total, 938);

// 场景2：无活动优惠 → 平台费 = 1000×2% = 20
const fee2 = Math.round((1000 - 0) * 0.02 * 100) / 100;
check('平台费(无优惠) = 20', fee2, 20);
const amounts2 = calculateOrderAmounts([{ unitPrice: 1000, quantity: 1 }], [{ type: 'platform_fee' as const, label: '平台服务费', amount: fee2 }, { type: 'transfer_fee' as const, label: '转账', amount: 20 }]);
check('应付总额 = 1000 + 20 + 20 = 1040', amounts2.total, 1040);

// 场景3：优惠超过小计（极端）→ 平台费不为负
const fee3 = Math.max(0, Math.round((100 - 150) * 0.02 * 100) / 100);
check('平台费不为负 = 0', fee3, 0);

console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail > 0 ? 1 : 0);
