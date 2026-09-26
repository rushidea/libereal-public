import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const BROADCAST_EMAIL = 'broadcast';
export const NOTIFICATION_SCOPE_PERSONAL = 'personal';
export const NOTIFICATION_SCOPE_BROADCAST = 'broadcast';
export const FORCED_ACK_ERROR = 'forced_ack_required';

export type PendingForcedAck = {
  id: string;
  title: string;
  content: string;
  linkUrl: string | null;
  createdAt: Date;
};

/** Pending forced-ack broadcasts for a customer (excludes soft-deleted). */
export async function listPendingForcedAcks(userId: string): Promise<PendingForcedAck[]> {
  const broadcasts = await prisma.notification.findMany({
    where: {
      scope: NOTIFICATION_SCOPE_BROADCAST,
      requiresAck: true,
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      content: true,
      linkUrl: true,
      createdAt: true,
      receipts: {
        where: { userId },
        select: { acknowledgedAt: true },
        take: 1,
      },
    },
  });

  return broadcasts
    .filter((row) => !row.receipts[0]?.acknowledgedAt)
    .map(({ id, title, content, linkUrl, createdAt }) => ({
      id,
      title,
      content,
      linkUrl,
      createdAt,
    }));
}

export async function hasPendingForcedAck(userId: string): Promise<boolean> {
  const pending = await listPendingForcedAcks(userId);
  return pending.length > 0;
}

/**
 * Block customer write actions until forced broadcasts are acknowledged.
 * Admins are never blocked by customer broadcasts.
 */
export async function assertNoPendingForcedAck(
  userId: string,
  role?: string | null,
): Promise<NextResponse | null> {
  if (role === 'admin') return null;
  const pending = await hasPendingForcedAck(userId);
  if (!pending) return null;
  return NextResponse.json(
    {
      error: '请先阅读并确认重要通知后再继续操作。',
      code: FORCED_ACK_ERROR,
    },
    { status: 403 },
  );
}

export async function acknowledgeBroadcast(userId: string, notificationId: string) {
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      scope: NOTIFICATION_SCOPE_BROADCAST,
      requiresAck: true,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!notification) {
    return { ok: false as const, status: 404 as const, error: '通知不存在或无需确认' };
  }

  const now = new Date();
  await prisma.notificationReceipt.upsert({
    where: {
      notificationId_userId: { notificationId, userId },
    },
    create: {
      notificationId,
      userId,
      isRead: true,
      acknowledgedAt: now,
    },
    update: {
      isRead: true,
      acknowledgedAt: now,
    },
  });

  return { ok: true as const };
}

export async function markBroadcastReceiptsRead(userId: string, ids: string[]) {
  if (ids.length === 0) return;
  const existing = await prisma.notification.findMany({
    where: {
      id: { in: ids },
      scope: NOTIFICATION_SCOPE_BROADCAST,
      deletedAt: null,
    },
    select: { id: true },
  });
  await Promise.all(
    existing.map((row) =>
      prisma.notificationReceipt.upsert({
        where: {
          notificationId_userId: { notificationId: row.id, userId },
        },
        create: {
          notificationId: row.id,
          userId,
          isRead: true,
        },
        update: {
          isRead: true,
        },
      }),
    ),
  );
}
