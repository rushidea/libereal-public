import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { buildCouponRule, redeemCoupon, restoreRedeemedOrderCoupons } from '@/lib/coupon-service';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

describe('redeemCoupon conditional claim', () => {
  function instance(overrides?: { maxUses?: number; usedCount?: number }) {
    return {
      id: 'inst-1',
      userId: 'user-1',
      code: 'SAVE50',
      status: 'active',
      issueApprovalStatus: 'auto',
      expiresAt: null,
      coupon: {
        id: 'coupon-1',
        approvalStatus: 'auto',
        validUntil: null,
        validFrom: null,
        maxUses: overrides?.maxUses ?? 1,
        usedCount: overrides?.usedCount ?? 0,
        threshold: 100,
        discount: 50,
        name: '满 100 减 50',
        stackable: false,
      },
    };
  }

  function mockTx(options?: { claimCount?: number; quotaCount?: number; claimError?: Error }) {
    return {
      couponInstance: {
        findUnique: vi.fn().mockResolvedValue(instance()),
        updateMany: options?.claimError
          ? vi.fn().mockRejectedValue(options.claimError)
          : vi.fn().mockResolvedValue({ count: options?.claimCount ?? 1 }),
      },
      coupon: {
        updateMany: vi.fn().mockResolvedValue({ count: options?.quotaCount ?? 1 }),
      },
    };
  }

  it('redeems after atomically claiming the instance and template quota', async () => {
    const tx = mockTx();
    const result = await redeemCoupon(tx as unknown as Prisma.TransactionClient, 'SAVE50', 'user-1', 150, 'ORD-1');

    expect(result).toMatchObject({
      ok: true,
      adjustment: { type: 'coupon', label: '满 100 减 50', amount: -50 },
    });
    expect(tx.couponInstance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inst-1', status: 'active' },
      data: expect.objectContaining({ status: 'used', redeemedOrderId: 'ORD-1' }),
    }));
    expect(tx.coupon.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'coupon-1',
        OR: [{ maxUses: 0 }, { usedCount: { lt: 1 } }],
      },
      data: { usedCount: { increment: 1 } },
    });
  });

  it('rejects a coupon consumed after validation but before claim', async () => {
    const tx = mockTx({ claimCount: 0 });
    const result = await redeemCoupon(tx as unknown as Prisma.TransactionClient, 'SAVE50', 'user-1', 150, 'ORD-1');

    expect(result).toEqual({ ok: false, error: '优惠券不可用（已使用/已作废）' });
    expect(tx.coupon.updateMany).not.toHaveBeenCalled();
  });

  it('rejects redemption when the template quota is exhausted concurrently', async () => {
    const tx = mockTx({ quotaCount: 0 });
    const result = await redeemCoupon(tx as unknown as Prisma.TransactionClient, 'SAVE50', 'user-1', 150, 'ORD-1');

    expect(result).toEqual({ ok: false, error: '该券已发放完毕' });
    expect(tx.couponInstance.updateMany).toHaveBeenCalledOnce();
  });

  it('returns a Chinese retry message when the claim hits a write conflict', async () => {
    for (const conflict of [
      Object.assign(new Error('database is locked'), { code: 'P2034' }),
      Object.assign(new Error('Operation has timed out'), { code: 'P1008' }),
    ]) {
      const tx = mockTx({ claimError: conflict });
      const result = await redeemCoupon(tx as unknown as Prisma.TransactionClient, 'SAVE50', 'user-1', 150, 'ORD-1');
      expect(result).toEqual({ ok: false, error: '优惠券正在被其他订单使用，请重试' });
      expect(tx.coupon.updateMany).not.toHaveBeenCalled();
    }
  });
});

type WorkerMessage = {
  type: string;
  ok?: boolean;
  error?: string;
  orderId?: string;
};

class RaceWorker {
  private readonly child: ChildProcess;
  private readonly queue: WorkerMessage[] = [];
  private readonly pending: Array<{
    type: string;
    resolve: (message: WorkerMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor() {
    this.child = fork(path.join(process.cwd(), 'src/test/helpers/coupon-redeem-race-worker.ts'), [], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    this.child.on('message', (message: WorkerMessage) => {
      const index = this.pending.findIndex((waiter) => waiter.type === message.type);
      if (index >= 0) {
        const [waiter] = this.pending.splice(index, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      this.queue.push(message);
    });
    this.child.on('exit', (code) => {
      for (const waiter of this.pending.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(`核销子进程退出 ${code}，尚未收到 ${waiter.type}`));
      }
    });
  }

  wait(type: string, timeoutMs = 15_000) {
    const queued = this.queue.findIndex((message) => message.type === type);
    if (queued >= 0) return Promise.resolve(this.queue.splice(queued, 1)[0]);
    return new Promise<WorkerMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pending.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) this.pending.splice(index, 1);
        reject(new Error(`等待子进程 ${type} 超时`));
      }, timeoutMs);
      this.pending.push({ type, resolve, reject, timer });
    });
  }

  send(message: { type: string; code?: string; userId?: string; orderId?: string; subtotal?: number }) {
    this.child.send(message);
  }

  stop() {
    if (this.child.exitCode === null && !this.child.killed) this.child.kill('SIGKILL');
  }
}

async function seedCoupon(options: { code: string; maxUses: number; couponId?: string }) {
  const couponId = options.couponId ?? (await prisma.coupon.create({
    data: {
      name: '满100减10',
      type: 'threshold',
      threshold: 100,
      discount: 10,
      stackable: false,
      requiresApproval: false,
      approvalStatus: 'auto',
      maxUses: options.maxUses,
    },
  })).id;
  await prisma.couponInstance.create({
    data: {
      couponId,
      userId: 'buyer-1',
      code: options.code,
      status: 'active',
      issueApprovalStatus: 'auto',
    },
  });
  return couponId;
}

async function raceRedeem(attempts: Array<{ code: string; orderId: string }>) {
  const workers = attempts.map(() => new RaceWorker());
  try {
    await Promise.all(workers.map((worker) => worker.wait('ready')));
    workers.forEach((worker, index) => worker.send({
      type: 'start',
      code: attempts[index].code,
      userId: 'buyer-1',
      orderId: attempts[index].orderId,
      subtotal: 200,
    }));
    await Promise.all(workers.map((worker) => worker.wait('read')));
    workers.forEach((worker) => worker.send({ type: 'go' }));
    return await Promise.all(workers.map((worker) => worker.wait('done')));
  } finally {
    workers.forEach((worker) => worker.stop());
  }
}

function applicationError(message: string | undefined) {
  return (message ?? '').replace(/^COUPON_APPLY:/, '');
}

describe('concurrent coupon redemption', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });
  beforeEach(() => {
    const db = getTestDb();
    db.pragma('busy_timeout = 5000');
    clearAllTables(db);
  });

  it.each(['discount', 'scope'])('rejects a changed %s after pre-evaluation without consuming the coupon', async (field) => {
    const id = await seedCoupon({ code: 'SYNTHETIC-CHANGED', maxUses: 0 });
    const rule = await buildCouponRule('SYNTHETIC-CHANGED');
    expect(rule).not.toBeNull();
    await prisma.coupon.update({ where: { id }, data: field === 'discount'
      ? { discount: 20 }
      : { scopeType: 'product', scopeTargets: '[{"productId":"other"}]' } });
    await expect(prisma.$transaction(async (tx) => {
      const result = await redeemCoupon(tx, 'SYNTHETIC-CHANGED', 'buyer-1', 200, 'synthetic-order', {
        ...rule!.snapshot, scopedSubtotal: 200, previewedDiscount: 10,
      });
      if (!result.ok) throw new Error(result.error);
    })).rejects.toThrow('优惠券规则在结算期间发生变化');
    expect(await prisma.couponInstance.findUnique({ where: { code: 'SYNTHETIC-CHANGED' }, include: { coupon: true } }))
      .toMatchObject({ status: 'active', redeemedOrderId: null, coupon: { usedCount: 0 } });
  });

  it('rolls back a claimed instance when the template conditional update fails', async () => {
    await seedCoupon({ code: 'SYNTHETIC-CAS-FAIL', maxUses: 0 });
    const rule = await buildCouponRule('SYNTHETIC-CAS-FAIL');
    expect(rule).not.toBeNull();
    await expect(prisma.$transaction(async (tx) => {
      const simulateChangedTemplate = {
        couponInstance: tx.couponInstance,
        coupon: { updateMany: async () => ({ count: 0 }) },
      } as unknown as Prisma.TransactionClient;
      const result = await redeemCoupon(simulateChangedTemplate, 'SYNTHETIC-CAS-FAIL', 'buyer-1', 200, 'synthetic-order', {
        ...rule!.snapshot, scopedSubtotal: 200, previewedDiscount: 10,
      });
      if (!result.ok) throw new Error(result.error);
    })).rejects.toThrow();
    expect(await prisma.couponInstance.findUnique({ where: { code: 'SYNTHETIC-CAS-FAIL' }, include: { coupon: true } }))
      .toMatchObject({ status: 'active', redeemedOrderId: null, coupon: { usedCount: 0 } });
  });

  it('lets only one of two overlapping orders redeem the same coupon and rolls the other back', async () => {
    await seedCoupon({ code: 'SAME-CODE', maxUses: 0 });

    const results = await raceRedeem([
      { code: 'SAME-CODE', orderId: 'order-a' },
      { code: 'SAME-CODE', orderId: 'order-b' },
    ]);

    const winners = results.filter((result) => result.ok);
    const losers = results.filter((result) => !result.ok);
    expect(winners, JSON.stringify(results)).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(applicationError(losers[0].error)).toMatch(/优惠券不可用（已使用\/已作废）|优惠券正在被其他订单使用，请重试/);
    expect(losers[0].error).not.toMatch(/SQLITE_BUSY|database is locked|P2034/);

    const winnerId = winners[0].orderId!;
    expect(await prisma.order.findUnique({ where: { id: winnerId }, select: { id: true } })).toEqual({ id: winnerId });
    expect(await prisma.order.findUnique({ where: { id: winnerId === 'order-a' ? 'order-b' : 'order-a' } })).toBeNull();
    expect(await prisma.couponInstance.findUnique({ where: { code: 'SAME-CODE' }, include: { coupon: true } })).toMatchObject({
      status: 'used',
      redeemedOrderId: winnerId,
      coupon: { usedCount: 1 },
    });

    const restored = await prisma.$transaction((tx) => restoreRedeemedOrderCoupons(tx, winnerId));
    const again = await prisma.$transaction((tx) => restoreRedeemedOrderCoupons(tx, winnerId));
    expect(restored).toBe(1);
    expect(again).toBe(0);
    expect(await prisma.couponInstance.findUnique({ where: { code: 'SAME-CODE' }, include: { coupon: true } })).toMatchObject({
      status: 'active',
      redeemedOrderId: null,
      redeemedAt: null,
      coupon: { usedCount: 0 },
    });
  }, 40_000);

  it('lets only one order consume the last template quota and keeps the losing instance unused', async () => {
    const couponId = await seedCoupon({ code: 'QUOTA-A', maxUses: 1 });
    await seedCoupon({ code: 'QUOTA-B', maxUses: 1, couponId });

    const results = await raceRedeem([
      { code: 'QUOTA-A', orderId: 'order-quota-a' },
      { code: 'QUOTA-B', orderId: 'order-quota-b' },
    ]);

    const winners = results.filter((result) => result.ok);
    const losers = results.filter((result) => !result.ok);
    expect(winners, JSON.stringify(results)).toHaveLength(1);
    expect(applicationError(losers[0].error)).toMatch(/该券已发放完毕|优惠券正在被其他订单使用，请重试/);
    expect(losers[0].error).not.toMatch(/SQLITE_BUSY|database is locked|P2034/);

    const winnerCode = winners[0].orderId === 'order-quota-a' ? 'QUOTA-A' : 'QUOTA-B';
    const loserCode = winnerCode === 'QUOTA-A' ? 'QUOTA-B' : 'QUOTA-A';
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.couponInstance.findUnique({ where: { code: winnerCode }, include: { coupon: true } })).toMatchObject({
      status: 'used',
      redeemedOrderId: winners[0].orderId,
      coupon: { usedCount: 1 },
    });
    expect(await prisma.couponInstance.findUnique({ where: { code: loserCode } })).toMatchObject({
      status: 'active',
      redeemedOrderId: null,
    });
  }, 40_000);

  it('rolls the whole order back when redemption fails inside the checkout transaction', async () => {
    await seedCoupon({ code: 'TAKEN', maxUses: 0 });
    await prisma.$transaction(async (tx) => {
      const redeemed = await redeemCoupon(tx, 'TAKEN', 'buyer-1', 200, 'order-first');
      expect(redeemed.ok).toBe(true);
    });

    await expect(prisma.$transaction(async (tx) => {
      await tx.order.create({
        data: {
          id: 'order-second',
          email: 'buyer@example.com',
          subtotal: 200,
          total: 190,
          status: 'pending',
          paymentMethod: 'bank_transfer',
        },
      });
      const redeemed = await redeemCoupon(tx, 'TAKEN', 'buyer-1', 200, 'order-second');
      if (!redeemed.ok) throw new Error(`COUPON_APPLY:${redeemed.error}`);
    })).rejects.toThrow('COUPON_APPLY:优惠券不可用（已使用/已作废）');

    expect(await prisma.order.findUnique({ where: { id: 'order-second' } })).toBeNull();
    expect(await prisma.couponInstance.findUnique({ where: { code: 'TAKEN' }, include: { coupon: true } })).toMatchObject({
      status: 'used',
      redeemedOrderId: 'order-first',
      coupon: { usedCount: 1 },
    });
  });
});
