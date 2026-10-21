/**
 * 并发核销子进程。由 coupon-redeem-concurrency.test.ts fork。
 * 两进程各自持有连接：读到券之后等待父进程放行，再同时进入条件更新。
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { redeemCoupon } from '@/lib/coupon-service';

type StartMessage = {
  type: 'start';
  code: string;
  userId: string;
  orderId: string;
  subtotal: number;
};

type ParentMessage = { type: 'go' } | StartMessage;

const databasePath = process.env.DATABASE_PATH;
if (!databasePath) throw new Error('DATABASE_PATH missing');
if (!process.send) throw new Error('coupon redeem worker must be forked');

const send = process.send.bind(process);

let releaseRead: () => void = () => {};
const bothRead = new Promise<void>((resolve) => {
  releaseRead = resolve;
});

const started = new Promise<StartMessage>((resolve) => {
  process.on('message', (msg: ParentMessage) => {
    if (msg.type === 'go') releaseRead();
    if (msg.type === 'start') resolve(msg);
  });
});

function finish(message: { type: 'done'; ok: boolean; error?: string; orderId?: string }) {
  send(message, () => {
    process.exit(0);
  });
}

async function main() {
  const adapter = new PrismaBetterSqlite3({ url: `file:${databasePath}` });
  const base = new PrismaClient({ adapter });
  const client = base.$extends({
    query: {
      couponInstance: {
        async findUnique({ args, query }) {
          const result = await query(args);
          send({ type: 'read' });
          await Promise.race([
            bothRead,
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error('等待并发对端超时')), 12_000);
            }),
          ]);
          return result;
        },
      },
    },
  });

  await base.$executeRawUnsafe('PRAGMA busy_timeout = 8000');
  send({ type: 'ready' });

  const start = await started;
  try {
    await client.$transaction(async (tx) => {
      const redeemed = await redeemCoupon(
        tx as unknown as Prisma.TransactionClient,
        start.code,
        start.userId,
        start.subtotal,
        start.orderId,
      );
      if (!redeemed.ok) throw new Error(`COUPON_APPLY:${redeemed.error}`);
      // 先读券再写订单，两笔事务才能同时停在核销前。正式下单仍是先建单再核销，失败抛错回滚。
      await tx.$executeRaw`
        INSERT INTO "Order" (
          id, email, subtotal, total, status, paymentMethod, owner_scope, shippingMethod, operationLogs, createdAt, updatedAt
        ) VALUES (
          ${start.orderId},
          'buyer@example.com',
          ${start.subtotal},
          ${start.subtotal},
          'pending',
          'bank_transfer',
          'personal',
          'logistics',
          '[]',
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `;
    }, { maxWait: 15_000, timeout: 15_000 });
    finish({ type: 'done', ok: true, orderId: start.orderId });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finish({ type: 'done', ok: false, error: message, orderId: start.orderId });
  } finally {
    await base.$disconnect().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  finish({ type: 'done', ok: false, error: message });
});
