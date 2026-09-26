import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';
import { prisma } from '@/lib/prisma';
import {
  acknowledgeBroadcast,
  assertNoPendingForcedAck,
  BROADCAST_EMAIL,
  FORCED_ACK_ERROR,
  hasPendingForcedAck,
  listPendingForcedAcks,
  markBroadcastReceiptsRead,
  NOTIFICATION_SCOPE_BROADCAST,
} from '@/lib/notification-ack';

const { requireAdmin, auth, ensurePendingOrganizationApprovalNotifications } = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  auth: vi.fn(),
  ensurePendingOrganizationApprovalNotifications: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireAdmin }));
vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/organization-service', () => ({ ensurePendingOrganizationApprovalNotifications }));

import { GET as adminGet, POST as adminPost } from '@/app/api/admin/notifications/route';
import { DELETE as adminDelete } from '@/app/api/admin/notifications/[id]/route';
import { GET as pendingAckGet } from '@/app/api/notifications/pending-ack/route';
import { POST as acknowledgePost } from '@/app/api/notifications/acknowledge/route';
import { GET as notificationsGet, PATCH as notificationsPatch } from '@/app/api/notifications/route';

async function createForcedBroadcast(title = '系统维护') {
  return prisma.notification.create({
    data: {
      email: BROADCAST_EMAIL,
      role: 'customer',
      type: 'public_announcement',
      title,
      content: '今晚维护，请确认。',
      scope: NOTIFICATION_SCOPE_BROADCAST,
      requiresAck: true,
      createdByUserId: 'admin_test_id',
    },
  });
}

describe('notification broadcast + forced ack', () => {
  beforeAll(() => {
    getTestDb();
  });
  afterAll(() => {
    closeTestDb();
  });
  beforeEach(() => {
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db);
    seedUser(db, {
      id: 'customer_1',
      email: 'customer@example.com',
      role: 'customer',
      name: 'Customer',
    });
    requireAdmin.mockReset();
    requireAdmin.mockResolvedValue({
      id: 'admin_test_id',
      email: 'admin@test.com',
      role: 'admin',
      sessionId: 'session-1',
    });
    auth.mockReset();
    auth.mockResolvedValue({
      user: { id: 'customer_1', email: 'customer@example.com', role: 'customer', sessionId: 'session-2' },
    });
  });

  it('admin POST creates broadcast and requires content.write', async () => {
    const res = await adminPost(
      new NextRequest('http://localhost/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: '公共公告',
          content: '全员可见',
          requiresAck: true,
        }),
      }),
    );
    expect(requireAdmin).toHaveBeenCalledWith('content.write');
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.notification.scope).toBe('broadcast');
    expect(data.notification.requiresAck).toBe(true);
    expect(data.notification.email).toBe(BROADCAST_EMAIL);
  });

  it('admin GET requires content.read and lists rows', async () => {
    await createForcedBroadcast();
    const res = await adminGet(new NextRequest('http://localhost/api/admin/notifications'));
    expect(requireAdmin).toHaveBeenCalledWith('content.read');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
  });

  it('admin GET filters notifications by a search query', async () => {
    await createForcedBroadcast('采购审核提醒');
    await prisma.notification.create({
      data: {
        email: 'customer@example.com',
        role: 'customer',
        type: 'order_status_changed',
        title: '订单更新',
        content: '已发货',
        scope: 'personal',
      },
    });

    const res = await adminGet(new NextRequest('http://localhost/api/admin/notifications?q=采购审核'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(1);
    expect(data.notifications[0].title).toBe('采购审核提醒');
  });

  it('admin DELETE soft-deletes any notification and clears pending ack', async () => {
    const broadcast = await createForcedBroadcast();
    expect(await hasPendingForcedAck('customer_1')).toBe(true);

    const del = await adminDelete(
      new NextRequest(`http://localhost/api/admin/notifications/${broadcast.id}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: broadcast.id }) },
    );
    expect(requireAdmin).toHaveBeenCalledWith('content.write');
    expect(del.status).toBe(200);
    expect(await hasPendingForcedAck('customer_1')).toBe(false);

    const personal = await prisma.notification.create({
      data: {
        email: 'customer@example.com',
        role: 'customer',
        type: 'order_status_changed',
        title: '订单更新',
        content: '已发货',
        scope: 'personal',
      },
    });
    const delPersonal = await adminDelete(
      new NextRequest(`http://localhost/api/admin/notifications/${personal.id}`, {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: personal.id }) },
    );
    expect(delPersonal.status).toBe(200);
    const row = await prisma.notification.findUnique({ where: { id: personal.id } });
    expect(row?.deletedAt).toBeTruthy();
  });

  it('forbid admin routes without permission', async () => {
    requireAdmin.mockResolvedValue(NextResponse.json({ error: 'Forbidden' }, { status: 403 }));
    const res = await adminPost(
      new NextRequest('http://localhost/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'x', content: 'y' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('lists pending ack and acknowledge is idempotent', async () => {
    const broadcast = await createForcedBroadcast();
    const pendingRes = await pendingAckGet();
    expect(pendingRes.status).toBe(200);
    const pendingData = await pendingRes.json();
    expect(pendingData.pending).toHaveLength(1);
    expect(pendingData.pending[0].id).toBe(broadcast.id);

    const ack1 = await acknowledgePost(
      new NextRequest('http://localhost/api/notifications/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: broadcast.id }),
      }),
    );
    expect(ack1.status).toBe(200);
    expect(await hasPendingForcedAck('customer_1')).toBe(false);

    const ack2 = await acknowledgeBroadcast('customer_1', broadcast.id);
    expect(ack2.ok).toBe(true);
    expect(await listPendingForcedAcks('customer_1')).toHaveLength(0);
  });

  it('assertNoPendingForcedAck blocks customers but not admins', async () => {
    await createForcedBroadcast();
    const blocked = await assertNoPendingForcedAck('customer_1', 'customer');
    expect(blocked).toBeInstanceOf(NextResponse);
    expect(blocked!.status).toBe(403);
    const body = await blocked!.json();
    expect(body.code).toBe(FORCED_ACK_ERROR);

    const adminPass = await assertNoPendingForcedAck('admin_test_id', 'admin');
    expect(adminPass).toBeNull();
  });

  it('customer GET merges personal + broadcast; markAll does not acknowledge', async () => {
    const broadcast = await createForcedBroadcast('需确认公告');
    await prisma.notification.create({
      data: {
        email: 'customer@example.com',
        role: 'customer',
        type: 'quote_received',
        title: '报价',
        content: '已报价',
        scope: 'personal',
      },
    });

    const list = await notificationsGet(new NextRequest('http://localhost/api/notifications'));
    const listData = await list.json();
    expect(listData.notifications.length).toBe(2);

    await notificationsPatch(
      new NextRequest('http://localhost/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAll: true }),
      }),
    );

    expect(await hasPendingForcedAck('customer_1')).toBe(true);
    const receipt = await prisma.notificationReceipt.findUnique({
      where: {
        notificationId_userId: {
          notificationId: broadcast.id,
          userId: 'customer_1',
        },
      },
    });
    expect(receipt?.isRead).toBe(true);
    expect(receipt?.acknowledgedAt).toBeNull();

    await markBroadcastReceiptsRead('customer_1', [broadcast.id]);
    const receipt2 = await prisma.notificationReceipt.findUnique({
      where: {
        notificationId_userId: {
          notificationId: broadcast.id,
          userId: 'customer_1',
        },
      },
    });
    expect(receipt2?.acknowledgedAt).toBeNull();
  });

  it('soft-deleted notifications are hidden from customer list', async () => {
    const broadcast = await createForcedBroadcast();
    await prisma.notification.update({
      where: { id: broadcast.id },
      data: { deletedAt: new Date() },
    });
    const list = await notificationsGet(new NextRequest('http://localhost/api/notifications'));
    const data = await list.json();
    expect(data.notifications).toHaveLength(0);
  });
});
