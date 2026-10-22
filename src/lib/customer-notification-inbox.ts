import { prisma } from '@/lib/prisma';
import {
  countUnreadByModule,
  resolveCustomerNotificationModule,
  type CustomerNotificationModule,
  type CustomerNotificationModuleCounts,
} from '@/lib/customer-notification-modules';
import {
  markBroadcastReceiptsRead,
  NOTIFICATION_SCOPE_BROADCAST,
  NOTIFICATION_SCOPE_PERSONAL,
} from '@/lib/notification-ack';

type ModuleFields = {
  type: string;
  linkUrl: string | null;
  metadata: string | null;
};

/**
 * Unread counts for the signed-in customer. Personal rows are scoped by email.
 * Broadcast read state comes from that user's receipt. No admin permission key.
 */
export async function getCustomerUnreadByModule(
  email: string,
  userId: string,
): Promise<CustomerNotificationModuleCounts> {
  const [personal, broadcasts] = await Promise.all([
    prisma.notification.findMany({
      where: {
        email,
        scope: NOTIFICATION_SCOPE_PERSONAL,
        isRead: false,
        deletedAt: null,
      },
      select: { type: true, linkUrl: true, metadata: true },
    }),
    prisma.notification.findMany({
      where: { scope: NOTIFICATION_SCOPE_BROADCAST, deletedAt: null },
      select: {
        type: true,
        linkUrl: true,
        metadata: true,
        receipts: {
          where: { userId },
          select: { isRead: true },
          take: 1,
        },
      },
    }),
  ]);

  return countUnreadByModule([
    ...personal.map((row) => ({ ...row, isRead: false })),
    ...broadcasts
      .filter((row) => !row.receipts[0]?.isRead)
      .map((row) => ({
        type: row.type,
        linkUrl: row.linkUrl,
        metadata: row.metadata,
        isRead: false as const,
      })),
  ]);
}

async function personalIdsForModule(email: string, moduleName: CustomerNotificationModule): Promise<string[]> {
  const rows = await prisma.notification.findMany({
    where: {
      email,
      scope: NOTIFICATION_SCOPE_PERSONAL,
      isRead: false,
      deletedAt: null,
    },
    select: { id: true, type: true, linkUrl: true, metadata: true },
  });
  return rows.filter((row) => resolveCustomerNotificationModule(row) === moduleName).map((row) => row.id);
}

async function unreadBroadcastIdsForModule(
  userId: string,
  moduleName: CustomerNotificationModule,
): Promise<string[]> {
  const rows = await prisma.notification.findMany({
    where: { scope: NOTIFICATION_SCOPE_BROADCAST, deletedAt: null },
    select: {
      id: true,
      type: true,
      linkUrl: true,
      metadata: true,
      receipts: {
        where: { userId },
        select: { isRead: true },
        take: 1,
      },
    },
  });
  return rows
    .filter((row) => !row.receipts[0]?.isRead && moduleMatches(row, moduleName))
    .map((row) => row.id);
}

function moduleMatches(row: ModuleFields, moduleName: CustomerNotificationModule): boolean {
  return resolveCustomerNotificationModule(row) === moduleName;
}

/** Marks the signed-in customer's unread rows for one sidebar module. */
export async function markCustomerNotificationModuleRead(
  email: string,
  userId: string,
  moduleName: CustomerNotificationModule,
): Promise<void> {
  const [personalIds, broadcastIds] = await Promise.all([
    personalIdsForModule(email, moduleName),
    unreadBroadcastIdsForModule(userId, moduleName),
  ]);

  if (personalIds.length > 0) {
    await prisma.notification.updateMany({
      where: {
        id: { in: personalIds },
        email,
        scope: NOTIFICATION_SCOPE_PERSONAL,
        deletedAt: null,
      },
      data: { isRead: true },
    });
  }

  await markBroadcastReceiptsRead(userId, broadcastIds);
}
