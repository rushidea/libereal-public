import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { AdminPermissionKey } from '@/lib/admin-permissions';
import { jsonObject } from '@/lib/order-catalog-repricing';

export type PurchaseActor = { id: string; email: string };
export type PurchaseAuthorization = {
  action: 'admin_sensitive'; permission: AdminPermissionKey; sessionFingerprint: string; verifiedAt: string;
};
type Db = Prisma.TransactionClient;
type ActivityRow = {
  id: string; purchaseOrderId: string | null; orderItemId: string | null; actorId: string;
  action: string; amountCents: bigint | null; detail: string; createdAt: string;
};

export async function readPurchaseActivities(tx: Db, orderId: string) {
  const rows = await tx.$queryRaw<ActivityRow[]>`SELECT id,purchaseOrderId,orderItemId,actorId,action,amountCents,detail,createdAt
    FROM PurchaseActivity WHERE orderId=${orderId} ORDER BY rowid`;
  return rows.map(row => ({ ...row, amountCents: row.amountCents == null ? null : Number(row.amountCents), detail: jsonObject(row.detail) }));
}

export type PurchaseActivity = Awaited<ReturnType<typeof readPurchaseActivities>>[number];

export async function addPurchaseActivity(tx: Db, input: {
  orderId: string; purchaseOrderId?: string | null; orderItemId?: string; actor: PurchaseActor;
  action: string; requestKey?: string; referenceKey?: string; amountCents?: number; detail: unknown;
}) {
  const id = randomUUID();
  await tx.$executeRaw`INSERT INTO PurchaseActivity
    (id,orderId,purchaseOrderId,orderItemId,actorId,action,requestKey,referenceKey,amountCents,detail,createdAt)
    VALUES (${id},${input.orderId},${input.purchaseOrderId ?? null},${input.orderItemId ?? null},
    ${input.actor.id},${input.action},${input.requestKey ?? null},${input.referenceKey ?? null},
    ${input.amountCents == null ? null : BigInt(input.amountCents)},${JSON.stringify(input.detail)},${new Date().toISOString()})`;
  return id;
}

export async function findPurchaseActivityByRequest(tx: Db, key: string) {
  const [row] = await tx.$queryRaw<{ detail: string }[]>`SELECT detail FROM PurchaseActivity WHERE requestKey=${key}`;
  return row && jsonObject(row.detail);
}
