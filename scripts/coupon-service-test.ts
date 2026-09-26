/**
 * 优惠券服务层测试（落地 5 整改后）：redeemCoupon 核销 + getUsableCoupons 通用券 + 有效期校验（依赖本地 dev.db）。
 *
 * 场景：
 * 1. 满减券正常核销：active→used、usedCount+1、返回负调整、redeemedOrderId 绑定订单；
 * 2. 无门槛券正常核销（stackable）；
 * 3. 未授权实例（issueApprovalStatus=pending）→ 拒绝；
 * 4. 已使用券 → 拒绝；
 * 5. 不属于该用户 → 拒绝；
 * 6. 未达门槛 → 拒绝；
 * 7. 模板待授权（approvalStatus=pending）→ 拒绝；
 * 8. 未到 validFrom 生效日 → 拒绝；
 * 9. getUsableCoupons 返回定向券 + 通用券（userId=null）；
 * 10. getUsableCoupons 不含未生效/已使用券。
 */
import { prisma } from '@/lib/prisma';
import { redeemCoupon, getUsableCoupons } from '@/lib/coupon-service';

let pass = 0, fail = 0;
function check(name: string, ok: boolean, extra?: string) {
  if (ok) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
}

async function main() {
  const now = new Date();
  const future = new Date(now.getTime() + 7 * 86400000);
  const past = new Date(now.getTime() - 7 * 86400000);
  const userId = 'test-coupon-user-001';
  let cleanupIds: string[] = [];

  // 建测试模板（满减券：满 100 减 30）
  const t1 = await prisma.coupon.create({
    data: {
      name: 'TEST 满100减30', type: 'threshold', threshold: 100, discount: 30,
      stackable: false, requiresApproval: false, approvalStatus: 'auto',
      validFrom: now, validUntil: future, description: 'test',
    },
  });
  // 无门槛券模板（已授权）
  const t2 = await prisma.coupon.create({
    data: {
      name: 'TEST 无门槛50', type: 'unrestricted', threshold: 0, discount: 50,
      stackable: true, requiresApproval: true, approvalStatus: 'approved',
      validFrom: now, validUntil: future, description: 'test',
    },
  });
  // 待授权模板
  const t3 = await prisma.coupon.create({
    data: {
      name: 'TEST 待授权', type: 'unrestricted', threshold: 0, discount: 50,
      stackable: true, requiresApproval: true, approvalStatus: 'pending',
      validFrom: now, validUntil: future, description: 'test',
    },
  });
  // 未来生效模板（validFrom 未到）
  const t4 = await prisma.coupon.create({
    data: {
      name: 'TEST 未来生效', type: 'threshold', threshold: 0, discount: 20,
      stackable: false, requiresApproval: false, approvalStatus: 'auto',
      validFrom: future, validUntil: null, description: 'test',
    },
  });
  cleanupIds = [t1.id, t2.id, t3.id, t4.id];

  const i1 = await prisma.couponInstance.create({ data: { couponId: t1.id, userId, code: 'TESTM100', status: 'active', issueApprovalStatus: 'auto', expiresAt: future } });
  const i2 = await prisma.couponInstance.create({ data: { couponId: t2.id, userId, code: 'TESTU050', status: 'active', issueApprovalStatus: 'approved', expiresAt: future } });
  const i3 = await prisma.couponInstance.create({ data: { couponId: t2.id, userId, code: 'TESTPEND', status: 'pending', issueApprovalStatus: 'pending', expiresAt: future } });
  const i4 = await prisma.couponInstance.create({ data: { couponId: t1.id, userId, code: 'TESTUSED', status: 'used', issueApprovalStatus: 'auto', redeemedAt: now, expiresAt: future } });
  const i5 = await prisma.couponInstance.create({ data: { couponId: t1.id, userId: 'other-user', code: 'TESTOTHR', status: 'active', issueApprovalStatus: 'auto', expiresAt: future } });
  const i6 = await prisma.couponInstance.create({ data: { couponId: t3.id, userId, code: 'TESTAPPR', status: 'active', issueApprovalStatus: 'auto', expiresAt: future } });
  // 通用券（userId=null）+ 未来生效券
  const i7 = await prisma.couponInstance.create({ data: { couponId: t2.id, userId: null, code: 'TESTGNRL', status: 'active', issueApprovalStatus: 'approved', expiresAt: future } });
  const i8 = await prisma.couponInstance.create({ data: { couponId: t4.id, userId, code: 'TESTFUTR', status: 'active', issueApprovalStatus: 'auto', expiresAt: future } });

  console.log('【1】满减券正常核销（subtotal 150 ≥ 100）');
  {
    const r = await redeemCoupon(prisma, 'TESTM100', userId, 150, 'ORD-TEST-001');
    check('ok', r.ok === true, JSON.stringify(r));
    if (r.ok) {
      check('返回负调整 -30', Math.abs(r.adjustment.amount + 30) < 0.01, `got ${r.adjustment.amount}`);
      const inst = await prisma.couponInstance.findUnique({ where: { id: i1.id } });
      check('实例状态 used', inst?.status === 'used');
      check('redeemedOrderId 绑定订单', inst?.redeemedOrderId === 'ORD-TEST-001', `got ${inst?.redeemedOrderId}`);
      const coupon = await prisma.coupon.findUnique({ where: { id: t1.id } });
      check('模板 usedCount=1', coupon?.usedCount === 1, `got ${coupon?.usedCount}`);
    }
  }

  console.log('\n【2】无门槛券正常核销');
  {
    const r = await redeemCoupon(prisma, 'TESTU050', userId, 200);
    check('ok', r.ok === true, JSON.stringify(r));
    if (r.ok) {
      check('返回负调整 -50', Math.abs(r.adjustment.amount + 50) < 0.01);
      const inst = await prisma.couponInstance.findUnique({ where: { id: i2.id } });
      check('实例状态 used', inst?.status === 'used');
    }
  }

  console.log('\n【3】未授权实例（发放 pending）→ 拒绝');
  {
    const r = await redeemCoupon(prisma, 'TESTPEND', userId, 200);
    check('拒绝', r.ok === false, JSON.stringify(r));
    check('提示待授权', (r.ok ? '' : r.error).includes('授权'), r.ok ? '' : r.error);
  }

  console.log('\n【4】已使用券 → 拒绝');
  {
    const r = await redeemCoupon(prisma, 'TESTUSED', userId, 200);
    check('拒绝', r.ok === false);
  }

  console.log('\n【5】不属于该用户 → 拒绝');
  {
    const r = await redeemCoupon(prisma, 'TESTOTHR', userId, 200);
    check('拒绝', r.ok === false);
    check('提示不属于当前账户', (r.ok ? '' : r.error).includes('不属于'), r.ok ? '' : r.error);
  }

  console.log('\n【6】未达门槛 → 拒绝');
  {
    // 用 i5 的重建：新建一个同券码测试门槛
    await prisma.couponInstance.create({ data: { couponId: t1.id, userId, code: 'TESTMIN', status: 'active', issueApprovalStatus: 'auto', expiresAt: future } });
    const r = await redeemCoupon(prisma, 'TESTMIN', userId, 50);
    check('拒绝', r.ok === false);
    check('提示未达门槛', (r.ok ? '' : r.error).includes('门槛'), r.ok ? '' : r.error);
  }

  console.log('\n【7】模板待授权 → 拒绝');
  {
    const r = await redeemCoupon(prisma, 'TESTAPPR', userId, 200);
    check('拒绝', r.ok === false);
    check('提示模板待授权', (r.ok ? '' : r.error).includes('模板'), r.ok ? '' : r.error);
  }

  console.log('\n【8】未到 validFrom 生效日 → 拒绝');
  {
    const r = await redeemCoupon(prisma, 'TESTFUTR', userId, 200);
    check('拒绝', r.ok === false, JSON.stringify(r));
    check('提示未到生效日期', (r.ok ? '' : r.error).includes('生效日期'), r.ok ? '' : r.error);
  }

  console.log('\n【9】getUsableCoupons 含定向券 + 通用券（userId=null）');
  {
    // 【2】已核销 TESTU050，这里新建一张未使用的定向券验证列表返回
    await prisma.couponInstance.create({ data: { couponId: t2.id, userId, code: 'TESTDIR1', status: 'active', issueApprovalStatus: 'approved', expiresAt: future } });
    const list = await getUsableCoupons(userId);
    const codes = list.map((c) => c.code);
    check('含定向券 TESTDIR1', codes.includes('TESTDIR1'), codes.join(','));
    check('含通用券 TESTGNRL', codes.includes('TESTGNRL'), codes.join(','));
    check('不含已使用券', !codes.includes('TESTM100'));
    check('不含未生效券 TESTFUTR', !codes.includes('TESTFUTR'));
    check('不含待授权券 TESTPEND', !codes.includes('TESTPEND'));
  }

  // 清理
  await prisma.couponInstance.deleteMany({ where: { couponId: { in: cleanupIds } } });
  await prisma.coupon.deleteMany({ where: { id: { in: cleanupIds } } });

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail > 0 ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
