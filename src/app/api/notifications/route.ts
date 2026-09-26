import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  markBroadcastReceiptsRead,
  NOTIFICATION_SCOPE_BROADCAST,
  NOTIFICATION_SCOPE_PERSONAL,
} from '@/lib/notification-ack';
import { ensurePendingOrganizationApprovalNotifications } from '@/lib/organization-service';

type NotificationRow = {
  id: string;
  userId: string | null;
  email: string;
  role: string;
  type: string;
  title: string;
  content: string;
  isRead: boolean;
  linkUrl: string | null;
  metadata: string | null;
  scope: string;
  requiresAck: boolean;
  createdByUserId: string | null;
  deletedAt: Date | null;
  createdAt: Date;
};

function serializeNotification(
  row: NotificationRow,
  receipt?: { isRead: boolean; acknowledgedAt: Date | null } | null,
) {
  const isBroadcast = row.scope === NOTIFICATION_SCOPE_BROADCAST;
  return {
    id: row.id,
    userId: row.userId,
    email: row.email,
    role: row.role,
    type: row.type,
    title: row.title,
    content: row.content,
    isRead: isBroadcast ? Boolean(receipt?.isRead) : row.isRead,
    linkUrl: row.linkUrl,
    metadata: row.metadata,
    scope: row.scope,
    requiresAck: row.requiresAck,
    acknowledgedAt: receipt?.acknowledgedAt ?? null,
    createdAt: row.createdAt,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ notifications: [] });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id as string },
      select: { id: true, email: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (user.role === 'admin') {
      await ensurePendingOrganizationApprovalNotifications();
      const rows = await prisma.notification.findMany({
        where: { role: 'admin', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return NextResponse.json({
        notifications: rows.map((row) => serializeNotification(row)),
      });
    }

    const [personal, broadcasts] = await Promise.all([
      prisma.notification.findMany({
        where: {
          email: user.email,
          scope: NOTIFICATION_SCOPE_PERSONAL,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.notification.findMany({
        where: {
          scope: NOTIFICATION_SCOPE_BROADCAST,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          receipts: {
            where: { userId: user.id },
            take: 1,
          },
        },
      }),
    ]);

    const merged = [
      ...personal.map((row) => serializeNotification(row)),
      ...broadcasts.map((row) => serializeNotification(row, row.receipts[0] ?? null)),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json({ notifications: merged.slice(0, 50) });
  } catch (err) {
    console.error('[notifications GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id as string },
      select: { id: true, email: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const body = await req.json();
    const { ids, markAll } = body;

    if (user.role === 'admin') {
      if (markAll) {
        await prisma.notification.updateMany({
          where: { role: 'admin', isRead: false, deletedAt: null },
          data: { isRead: true },
        });
      } else if (ids && Array.isArray(ids) && ids.length > 0) {
        await prisma.notification.updateMany({
          where: { id: { in: ids }, role: 'admin', deletedAt: null },
          data: { isRead: true },
        });
      } else {
        return NextResponse.json({ error: 'ids or markAll is required' }, { status: 400 });
      }
      return NextResponse.json({ success: true });
    }

    if (markAll) {
      await prisma.notification.updateMany({
        where: {
          email: user.email,
          scope: NOTIFICATION_SCOPE_PERSONAL,
          isRead: false,
          deletedAt: null,
        },
        data: { isRead: true },
      });
      const broadcastIds = (
        await prisma.notification.findMany({
          where: { scope: NOTIFICATION_SCOPE_BROADCAST, deletedAt: null },
          select: { id: true },
        })
      ).map((row) => row.id);
      // Mark broadcast receipts as read only — never set acknowledgedAt here
      await markBroadcastReceiptsRead(user.id, broadcastIds);
    } else if (ids && Array.isArray(ids) && ids.length > 0) {
      const idList = ids.filter((id: unknown): id is string => typeof id === 'string');
      await prisma.notification.updateMany({
        where: {
          id: { in: idList },
          email: user.email,
          scope: NOTIFICATION_SCOPE_PERSONAL,
          deletedAt: null,
        },
        data: { isRead: true },
      });
      await markBroadcastReceiptsRead(user.id, idList);
    } else {
      return NextResponse.json({ error: 'ids or markAll is required' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[notifications PATCH] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
