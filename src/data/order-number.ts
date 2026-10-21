import type { Prisma, PrismaClient } from '@prisma/client';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 同一上海日订单号冲突时，事务内重新查最高序号的次数（含第一次）。 */
export const ORDER_NUMBER_ALLOCATION_ATTEMPTS = 3;

/** 撞号且重试耗尽时返回给客户端的固定文案，不含数据库或异常详情。 */
export const ORDER_NUMBER_BUSY_ERROR = '订单提交繁忙，请稍后重试';

export function orderDateInShanghai(date: Date): string {
  return new Date(date.getTime() + SHANGHAI_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
}

export function orderNumberPrefix(date: Date): string {
  return `ORD-${orderDateInShanghai(date)}-`;
}

export function sequenceOfOrderId(orderId: string, date: Date): number | null {
  const prefix = orderNumberPrefix(date);
  if (!orderId.startsWith(prefix)) return null;
  const suffix = orderId.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return null;
  const sequence = Number.parseInt(suffix, 10);
  return Number.isFinite(sequence) ? sequence : null;
}

/** 在同一上海日的订单号里取数值最大的序号，忽略其他日期和非数字后缀。 */
export function highestSameDayOrderId(date: Date, orderIds: readonly string[]): string | null {
  let bestId: string | null = null;
  let bestSequence = -1;
  for (const orderId of orderIds) {
    const sequence = sequenceOfOrderId(orderId, date);
    if (sequence === null || sequence < bestSequence) continue;
    bestSequence = sequence;
    bestId = orderId;
  }
  return bestId;
}

export function nextOrderNumber(date: Date, latestOrderId: string | null): string {
  const prefix = orderNumberPrefix(date);
  const latestSequence = latestOrderId?.startsWith(prefix)
    ? Number.parseInt(latestOrderId.slice(prefix.length), 10)
    : 0;
  const sequence = Number.isFinite(latestSequence) ? latestSequence + 1 : 1;

  return `${prefix}${String(sequence).padStart(3, '0')}`;
}

type OrderNumberClient = Pick<Prisma.TransactionClient, 'order'> | Pick<PrismaClient, 'order'>;

/**
 * 在调用方事务内查询当日最高序号并生成下一个订单号。
 * 购物车下单、接受报价、后台/代客下单都调用这一函数。
 */
export async function allocateOrderNumber(db: OrderNumberClient, now: Date = new Date()): Promise<string> {
  const prefix = orderNumberPrefix(now);
  const sameDayOrders = await db.order.findMany({
    where: { id: { startsWith: prefix } },
    select: { id: true },
  });
  return nextOrderNumber(now, highestSameDayOrderId(now, sameDayOrders.map((order) => order.id)));
}

export function isUniqueConstraintError(error: unknown): error is { code: 'P2002'; meta?: { target?: unknown }; message?: string } {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002';
}

function constraintTargets(error: { meta?: { target?: unknown } }): string[] {
  const target = error.meta?.target;
  if (Array.isArray(target)) return target.map((item) => String(item));
  if (typeof target === 'string' && target.trim()) return [target];
  return [];
}

function errorMessage(error: { message?: string }): string {
  if (typeof error.message === 'string') return error.message;
  return error instanceof Error ? error.message : '';
}

/** 订单主键撞号。幂等键 checkoutAttemptId 的唯一冲突返回 false，交给各接口做重放。 */
export function isOrderIdUniqueConflict(error: unknown): boolean {
  if (!isUniqueConstraintError(error)) return false;
  const targets = constraintTargets(error);
  const message = errorMessage(error);
  if (targets.some((target) => /checkoutAttemptId|checkout_attempt/i.test(target)) || /checkoutAttemptId|checkout_attempt/i.test(message)) {
    return false;
  }
  if (targets.some((target) => target === 'id' || target.endsWith('.id') || target === 'PRIMARY')) return true;
  return /Unique constraint failed on the fields: \(`id`\)/.test(message);
}

/**
 * 在交互事务内分配订单号并执行建单。主键撞号时整笔事务回滚后重新查询最高序号。
 * 其他错误（含幂等键冲突和业务校验）原样抛出，由调用方决定对客户端的文案。
 */
export async function withAllocatedOrderNumber<TResult>(
  db: Pick<PrismaClient, '$transaction'>,
  run: (tx: Prisma.TransactionClient, orderId: string) => Promise<TResult>,
  now: Date = new Date(),
): Promise<TResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ORDER_NUMBER_ALLOCATION_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(async (tx) => {
        const orderId = await allocateOrderNumber(tx, now);
        return run(tx, orderId);
      });
    } catch (error) {
      lastError = error;
      if (!isOrderIdUniqueConflict(error) || attempt === ORDER_NUMBER_ALLOCATION_ATTEMPTS - 1) {
        throw error;
      }
    }
  }
  throw lastError;
}
