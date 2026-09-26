import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import {
  BROADCAST_EMAIL,
  NOTIFICATION_SCOPE_BROADCAST,
} from '@/lib/notification-ack';
import { ensurePendingOrganizationApprovalNotifications } from '@/lib/organization-service';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin('content.read');
  if (admin instanceof NextResponse) return admin;

  try {
    await ensurePendingOrganizationApprovalNotifications();
    const { searchParams } = new URL(req.url);
    const scope = searchParams.get('scope');
    const includeDeleted = searchParams.get('includeDeleted') === '1';
    const query = searchParams.get('q')?.trim().slice(0, 100) || '';
    const take = Math.min(Number(searchParams.get('take') || 50) || 50, 100);
    const skip = Math.max(Number(searchParams.get('skip') || 0) || 0, 0);

    const where: Prisma.NotificationWhereInput = {};
    if (scope === 'personal' || scope === 'broadcast') {
      where.scope = scope;
    }
    if (!includeDeleted) {
      where.deletedAt = null;
    }
    if (query) {
      where.OR = [
        { title: { contains: query } },
        { content: { contains: query } },
        { email: { contains: query } },
        { type: { contains: query } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
    ]);

    return NextResponse.json({ notifications: rows, total, take, skip });
  } catch (err) {
    console.error('[admin notifications GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin('content.write');
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await req.json();
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    const linkUrl =
      typeof body?.linkUrl === 'string' && body.linkUrl.trim()
        ? body.linkUrl.trim()
        : null;
    const requiresAck = Boolean(body?.requiresAck);

    if (!title || !content) {
      return NextResponse.json({ error: 'title 与 content 必填' }, { status: 400 });
    }
    if (title.length > 200) {
      return NextResponse.json({ error: '标题过长' }, { status: 400 });
    }
    if (content.length > 5000) {
      return NextResponse.json({ error: '正文过长' }, { status: 400 });
    }

    const row = await prisma.notification.create({
      data: {
        email: BROADCAST_EMAIL,
        role: 'customer',
        type: 'public_announcement',
        title,
        content,
        linkUrl,
        scope: NOTIFICATION_SCOPE_BROADCAST,
        requiresAck,
        createdByUserId: admin.id,
        isRead: false,
      },
    });

    return NextResponse.json({ notification: row }, { status: 201 });
  } catch (err) {
    console.error('[admin notifications POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
