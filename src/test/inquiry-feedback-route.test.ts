import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

type MockSessionUser = {
  id: string;
  email: string;
  name?: string | null;
  role: string;
};

const { mockState, requireActiveSession, requireAdmin, auth } = vi.hoisted(() => {
  const state: {
    user: MockSessionUser | null;
    adminPermissions: Set<string>;
  } = {
    user: null,
    adminPermissions: new Set(['inquiries.read', 'inquiries.write']),
  };

  const requireActiveSessionFn = vi.fn(async () => {
    if (!state.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    return state.user;
  });

  const requireAdminFn = vi.fn(async (permission?: string) => {
    if (!state.user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }
    if (state.user.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (permission && !state.adminPermissions.has(permission)) {
      return NextResponse.json({ error: 'Forbidden', requiredPermission: permission }, { status: 403 });
    }
    return state.user;
  });

  const authFn = vi.fn(async () => (state.user ? { user: state.user } : null));

  return {
    mockState: state,
    requireActiveSession: requireActiveSessionFn,
    requireAdmin: requireAdminFn,
    auth: authFn,
  };
});

vi.mock('@/lib/session', () => ({
  requireActiveSession,
  requireAdmin,
}));

vi.mock('@/lib/auth', () => ({
  auth,
}));

import { GET as getFeedback, POST as postFeedback, PATCH as patchFeedback } from '@/app/api/inquiries/[id]/feedback/route';
import { GET as getInquiryDetail } from '@/app/api/inquiries/[id]/route';
import { POST as postQuote } from '@/app/api/inquiries/[id]/quote/route';
import { GET as getMyOrders } from '@/app/api/my-orders/route';
import { prisma } from '@/lib/prisma';

function ensureOrganizationTables() {
  const db = getTestDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS organization_members (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      pending_role_key TEXT,
      joined_at DATETIME,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(organization_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS organization_roles (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      key TEXT NOT NULL,
      name TEXT NOT NULL,
      permissions TEXT NOT NULL DEFAULT '[]',
      is_system INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(organization_id, key)
    );
    CREATE TABLE IF NOT EXISTS organization_role_assignments (
      member_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      assigned_by TEXT,
      assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (member_id, role_id)
    );
    CREATE TABLE IF NOT EXISTS organization_member_permissions (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      granted INTEGER NOT NULL DEFAULT 1,
      assigned_by TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(member_id, permission)
    );
  `);
}

function clearOrganizationTables() {
  const db = getTestDb();
  db.exec(`
    DELETE FROM organization_member_permissions;
    DELETE FROM organization_role_assignments;
    DELETE FROM organization_roles;
    DELETE FROM organization_members;
  `);
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function jsonReq(url: string, method: string, body?: unknown, headers?: Record<string, string>) {
  return new NextRequest(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedInquiryWithQuote(opts?: {
  inquiryId?: string;
  userId?: string;
  email?: string;
  status?: string;
  archivedAt?: Date | null;
  ownerScope?: 'personal' | 'organization';
  organizationId?: string | null;
  quoteStatus?: string;
  quoteVersion?: number;
  validUntil?: Date;
  quoteSubtotal?: number;
}) {
  const inquiryId = opts?.inquiryId ?? 'inq_fb_1';
  const userId = opts?.userId ?? 'cust_1';
  const email = opts?.email ?? 'cust1@test.com';
  const inquiry = await prisma.inquiry.create({
    data: {
      id: inquiryId,
      userId,
      email,
      name: '张科研',
      phone: '13800001111',
      institution: '测试大学',
      status: opts?.status ?? 'quote_sent',
      subtotal: opts?.quoteSubtotal ?? 200,
      archivedAt: opts?.archivedAt ?? null,
      ownerScope: opts?.ownerScope ?? 'personal',
      organizationId: opts?.organizationId ?? null,
      inquiryItems: {
        create: [
          {
            position: 0,
            name: '磷酸盐缓冲液 PBS',
            catalogNumber: 'PBS-500',
            unitPrice: 100,
            quantity: 2,
            lineTotal: 200,
            leadTime: '现货',
          },
        ],
      },
    },
    include: { inquiryItems: true },
  });

  const quote = await prisma.quote.create({
    data: {
      inquiryId: inquiry.id,
      version: opts?.quoteVersion ?? 1,
      status: opts?.quoteStatus ?? 'sent',
      subtotal: opts?.quoteSubtotal ?? 200,
      validUntil: opts?.validUntil ?? new Date(Date.now() + 7 * 86400000),
      sentAt: (opts?.quoteStatus ?? 'sent') === 'draft' ? null : new Date(),
      items: {
        create: [
          {
            inquiryItemId: inquiry.inquiryItems[0].id,
            position: 0,
            name: '磷酸盐缓冲液 PBS',
            catalogNumber: 'PBS-500',
            unitPrice: (opts?.quoteSubtotal ?? 200) / 2,
            quantity: 2,
            lineTotal: opts?.quoteSubtotal ?? 200,
            leadTime: '现货',
          },
        ],
      },
    },
  });

  return { inquiry, quote };
}

describe('inquiry feedback routes (/api/inquiries/[id]/feedback)', () => {
  beforeAll(() => {
    getTestDb();
    ensureOrganizationTables();
  });

  afterAll(() => {
    closeTestDb();
  });

  beforeEach(() => {
    const db = getTestDb();
    clearOrganizationTables();
    clearAllTables(db);
    seedAdmin(db, 'admin_1', 'secret-admin@test.com');
    seedUser(db, { id: 'cust_1', email: 'cust1@test.com', name: '张科研' });
    seedUser(db, { id: 'cust_2', email: 'cust2@test.com', name: '李教授' });
    mockState.user = null;
    mockState.adminPermissions = new Set(['inquiries.read', 'inquiries.write']);
    requireActiveSession.mockClear();
    requireAdmin.mockClear();
    auth.mockClear();
  });

  it('1. 正常业务流：支持4种反馈类型、管理员读取与处理、重发新版报价，且绝不自动创建订单', async () => {
    const { inquiry, quote } = await seedInquiryWithQuote();

    // 客户依次提交 4 种反馈类型
    mockState.user = { id: 'cust_1', email: 'cust1@test.com', name: '张科研', role: 'customer' };
    const types = ['price_negotiation', 'terms_change', 'consultation', 'intent_confirm'] as const;
    const createdIds: string[] = [];

    for (const [idx, feedbackType] of types.entries()) {
      const res = await postFeedback(
        jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
          feedbackType,
          content: `测试反馈内容-${feedbackType}`,
          quoteId: quote.id,
          quoteVersion: quote.version,
          clientRequestId: `req-normal-${idx}`,
        }),
        makeParams(inquiry.id),
      );
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.feedback.actorType).toBe('customer');
      expect(data.feedback.channel).toBe('website');
      expect(data.feedback.quoteId).toBe(quote.id);
      expect(data.feedback.quoteVersion).toBe(1);
      expect(data.feedback.handlingStatus).toBe('pending');
      createdIds.push(data.feedback.id);
    }

    // 管理员通知已写入
    const notifs = await prisma.notification.findMany({
      where: { role: 'admin', type: 'inquiry_feedback_received' },
    });
    expect(notifs).toHaveLength(4);
    expect(notifs[0].linkUrl).toBe(`/admin/inquiries?inquiryId=${inquiry.id}`);

    // 管理员读取全部反馈
    mockState.user = { id: 'admin_1', email: 'secret-admin@test.com', name: 'Admin', role: 'admin' };
    const adminListRes = await getFeedback(
      new NextRequest(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`),
      makeParams(inquiry.id),
    );
    expect(adminListRes.status).toBe(200);
    const adminListData = await adminListRes.json();
    expect(adminListData.feedbacks).toHaveLength(4);

    // 管理员重发新版报价 v2
    const quoteRes = await postQuote(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/quote`, 'POST', {
        items: [
          {
            name: '磷酸盐缓冲液 PBS',
            catalogNumber: 'PBS-500',
            price: 90,
            quantity: 3,
            leadTime: '3天',
          },
        ],
      }),
      makeParams(inquiry.id),
    );
    expect(quoteRes.status).toBe(200);
    const quoteData = await quoteRes.json();
    expect(quoteData.quote.version).toBe(2);

    // 管理员处理反馈并关联新版报价
    const handleRes = await patchFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'PATCH', {
        feedbackId: createdIds[0],
        handlingStatus: 'resolved',
        resolutionNote: '已调整单价为 90 元并发送 v2 报价',
        resolvedByQuoteId: quoteData.quote.id,
      }),
      makeParams(inquiry.id),
    );
    expect(handleRes.status).toBe(200);
    const handleData = await handleRes.json();
    expect(handleData.feedback.handlingStatus).toBe('resolved');
    expect(handleData.feedback.resolutionNote).toBe('已调整单价为 90 元并发送 v2 报价');
    expect(handleData.feedback.resolvedByQuoteId).toBe(quoteData.quote.id);
    expect(handleData.feedback.handledByAdminEmail).toBe('secret-admin@test.com');

    // 审计日志已记录
    const auditLogs = await prisma.auditLog.findMany({
      where: { action: { in: ['inquiry.feedback_submitted', 'inquiry.feedback_handled'] } },
    });
    expect(auditLogs.filter((l) => l.action === 'inquiry.feedback_submitted')).toHaveLength(4);
    expect(auditLogs.filter((l) => l.action === 'inquiry.feedback_handled')).toHaveLength(1);

    // 核心铁律：绝不自动生成订单、订单项或报价确认记录
    expect(await prisma.order.count()).toBe(0);
    expect(await prisma.orderItem.count()).toBe(0);
    expect(await prisma.quoteConfirmation.count()).toBe(0);
  });

  it('2. 管理员代录外部渠道反馈：成功、传 website 400、缺来源依据 400、无权限 403', async () => {
    const { inquiry, quote } = await seedInquiryWithQuote();
    mockState.user = { id: 'admin_1', email: 'secret-admin@test.com', name: 'Admin', role: 'admin' };

    // 传 website 拒绝冒充客户
    const webRes = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
        channel: 'website',
        channelReference: '站内消息',
        feedbackType: 'price_negotiation',
        content: '希望优惠',
        quoteId: quote.id,
      }),
      makeParams(inquiry.id),
    );
    expect(webRes.status).toBe(400);

    // 缺 channelReference 返回 400
    const missingRefRes = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
        channel: 'wechat',
        channelReference: '   ',
        feedbackType: 'price_negotiation',
        content: '希望优惠',
        quoteId: quote.id,
      }),
      makeParams(inquiry.id),
    );
    expect(missingRefRes.status).toBe(400);

    // 无 inquiries.write 权限返回 403
    mockState.adminPermissions = new Set(['inquiries.read']);
    const noPermRes = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
        channel: 'wechat',
        channelReference: '微信聊天 2026-11-20 14:20',
        feedbackType: 'price_negotiation',
        content: '客户微信询问能否 9 折',
        quoteId: quote.id,
      }),
      makeParams(inquiry.id),
    );
    expect(noPermRes.status).toBe(403);

    // 恢复权限后成功代录
    mockState.adminPermissions = new Set(['inquiries.read', 'inquiries.write']);
    const okRes = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
        channel: 'wechat',
        channelReference: '微信聊天 2026-11-20 14:20',
        feedbackType: 'price_negotiation',
        content: '客户微信询问能否 9 折',
        quoteId: quote.id,
      }),
      makeParams(inquiry.id),
    );
    expect(okRes.status).toBe(201);
    const okData = await okRes.json();
    expect(okData.feedback.actorType).toBe('admin_proxy');
    expect(okData.feedback.channel).toBe('wechat');
    expect(okData.feedback.channelReference).toBe('微信聊天 2026-11-20 14:20');

    // 审计日志记录 staff 代录，且不会重复给 admin 发客户提交通知
    const staffLog = await prisma.auditLog.findFirst({
      where: { action: 'inquiry.feedback_recorded_by_staff', targetId: okData.feedback.id },
    });
    expect(staffLog).not.toBeNull();
    expect(await prisma.notification.count({ where: { type: 'inquiry_feedback_received' } })).toBe(0);
  });

  it('3. 权限与越权拦截：未登录 401、跨客户 403、冻结客户 403、组织审计员只读/成员可写', async () => {
    const { inquiry, quote } = await seedInquiryWithQuote();

    // 未登录 401
    mockState.user = null;
    expect((await getFeedback(new NextRequest(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`), makeParams(inquiry.id))).status).toBe(401);
    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
      feedbackType: 'consultation',
      content: '咨询问题',
    }), makeParams(inquiry.id))).status).toBe(401);

    // 跨客户 403
    mockState.user = { id: 'cust_2', email: 'cust2@test.com', name: '李教授', role: 'customer' };
    expect((await getFeedback(new NextRequest(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`), makeParams(inquiry.id))).status).toBe(403);
    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
      feedbackType: 'consultation',
      content: '越权提交',
    }), makeParams(inquiry.id))).status).toBe(403);

    // 客户试图伪造 actorType 或 channel 返回 400
    mockState.user = { id: 'cust_1', email: 'cust1@test.com', name: '张科研', role: 'customer' };
    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
      actorType: 'admin_proxy',
      feedbackType: 'consultation',
      content: '伪造身份',
    }), makeParams(inquiry.id))).status).toBe(400);
    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
      channel: 'wechat',
      feedbackType: 'consultation',
      content: '伪造渠道',
    }), makeParams(inquiry.id))).status).toBe(400);

    // 冻结客户 403
    await prisma.user.update({ where: { id: 'cust_1' }, data: { isFrozen: true } });
    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
      feedbackType: 'price_negotiation',
      content: '冻结客户尝试提交',
      quoteId: quote.id,
    }), makeParams(inquiry.id))).status).toBe(403);
    await prisma.user.update({ where: { id: 'cust_1' }, data: { isFrozen: false } });

    // 组织询价权限：只读审计员 GET 200 / POST 403；有创建询价权限成员 POST 201
    const db = getTestDb();
    seedUser(db, { id: 'org_auditor', email: 'auditor@org.test', name: '审计员' });
    seedUser(db, { id: 'org_buyer', email: 'buyer@org.test', name: '采购员' });
    db.prepare(`INSERT INTO organizations (id, name, status, owner_user_id) VALUES ('org_1', '测试实验室', 'active', 'cust_1')`).run();
    db.prepare(`INSERT INTO organization_roles (id, organization_id, key, name, permissions) VALUES ('role_audit', 'org_1', 'auditor', '审计员', '["organization.records.read"]')`).run();
    db.prepare(`INSERT INTO organization_roles (id, organization_id, key, name, permissions) VALUES ('role_buyer', 'org_1', 'buyer', '采购员', '["organization.records.read","organization.inquiries.create"]')`).run();
    db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, status) VALUES ('mem_audit', 'org_1', 'org_auditor', 'active')`).run();
    db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, status) VALUES ('mem_buyer', 'org_1', 'org_buyer', 'active')`).run();
    db.prepare(`INSERT INTO organization_role_assignments (member_id, role_id) VALUES ('mem_audit', 'role_audit')`).run();
    db.prepare(`INSERT INTO organization_role_assignments (member_id, role_id) VALUES ('mem_buyer', 'role_buyer')`).run();

    const { inquiry: orgInq, quote: orgQuote } = await seedInquiryWithQuote({
      inquiryId: 'inq_org_1',
      userId: 'cust_1',
      email: 'cust1@test.com',
      ownerScope: 'organization',
      organizationId: 'org_1',
    });

    mockState.user = { id: 'org_auditor', email: 'auditor@org.test', name: '审计员', role: 'customer' };
    expect((await getFeedback(new NextRequest(`http://localhost:3000/api/inquiries/${orgInq.id}/feedback`), makeParams(orgInq.id))).status).toBe(200);
    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${orgInq.id}/feedback`, 'POST', {
      feedbackType: 'price_negotiation',
      content: '审计员不能提交',
      quoteId: orgQuote.id,
    }), makeParams(orgInq.id))).status).toBe(403);

    mockState.user = { id: 'org_buyer', email: 'buyer@org.test', name: '采购员', role: 'customer' };
    const buyerRes = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${orgInq.id}/feedback`, 'POST', {
        feedbackType: 'terms_change',
        content: '希望缩短货期到一周内',
        quoteId: orgQuote.id,
      }),
      makeParams(orgInq.id),
    );
    expect(buyerRes.status).toBe(201);
  });

  it('4. 状态、报价版本与输入校验拦截：draft/过期/终态/旧版本冲突/非法输入', async () => {
    mockState.user = { id: 'cust_1', email: 'cust1@test.com', name: '张科研', role: 'customer' };

    // 仅 draft 报价：price_negotiation 409；consultation 201 且不绑定 draft
    const { inquiry: draftInq } = await seedInquiryWithQuote({
      inquiryId: 'inq_draft',
      status: 'pending_quote',
      quoteStatus: 'draft',
    });
    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${draftInq.id}/feedback`, 'POST', {
      feedbackType: 'price_negotiation',
      content: '草稿时不可议价',
    }), makeParams(draftInq.id))).status).toBe(409);

    const consultRes = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${draftInq.id}/feedback`, 'POST', {
        feedbackType: 'consultation',
        content: '请问预计什么时候出报价？',
      }),
      makeParams(draftInq.id),
    );
    expect(consultRes.status).toBe(201);
    const consultData = await consultRes.json();
    expect(consultData.feedback.quoteId).toBeNull();
    expect(consultData.feedback.quoteVersion).toBeNull();

    // 过期报价自动结算后返回 409
    const { inquiry: expInq, quote: expQuote } = await seedInquiryWithQuote({
      inquiryId: 'inq_expired',
      status: 'quote_sent',
      quoteStatus: 'sent',
      validUntil: new Date(Date.now() - 3600_000),
    });
    const expRes = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${expInq.id}/feedback`, 'POST', {
        feedbackType: 'price_negotiation',
        content: '过期后议价',
        quoteId: expQuote.id,
      }),
      makeParams(expInq.id),
    );
    expect(expRes.status).toBe(409);
    const updatedExpInq = await prisma.inquiry.findUniqueOrThrow({ where: { id: expInq.id } });
    expect(updatedExpInq.status).toBe('quote_expired');

    // declined / closed / archived 均 409
    const { inquiry: decInq } = await seedInquiryWithQuote({ inquiryId: 'inq_dec', status: 'declined', quoteStatus: 'declined' });
    const { inquiry: clsInq } = await seedInquiryWithQuote({ inquiryId: 'inq_cls', status: 'closed', quoteStatus: 'accepted' });
    const { inquiry: arcInq } = await seedInquiryWithQuote({ inquiryId: 'inq_arc', status: 'quote_sent', archivedAt: new Date() });

    for (const targetId of [decInq.id, clsInq.id, arcInq.id]) {
      const r = await postFeedback(
        jsonReq(`http://localhost:3000/api/inquiries/${targetId}/feedback`, 'POST', {
          feedbackType: 'consultation',
          content: '终态不应允许提交',
        }),
        makeParams(targetId),
      );
      expect(r.status).toBe(409);
    }

    // 旧 superseded quoteId 返回 409 QUOTE_VERSION_CONFLICT
    const { inquiry: verInq, quote: v1 } = await seedInquiryWithQuote({
      inquiryId: 'inq_ver',
      quoteVersion: 1,
      quoteStatus: 'superseded',
    });
    await prisma.quote.create({
      data: {
        inquiryId: verInq.id,
        version: 2,
        status: 'sent',
        subtotal: 180,
        validUntil: new Date(Date.now() + 7 * 86400000),
        sentAt: new Date(),
      },
    });
    const staleRes = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${verInq.id}/feedback`, 'POST', {
        feedbackType: 'price_negotiation',
        content: '针对旧版报价的反馈',
        quoteId: v1.id,
      }),
      makeParams(verInq.id),
    );
    expect(staleRes.status).toBe(409);
    expect((await staleRes.json()).code).toBe('QUOTE_VERSION_CONFLICT');

    // 输入校验：空正文、超长正文、非法类型、幂等键冲突均 400
    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${verInq.id}/feedback`, 'POST', {
      feedbackType: 'consultation',
      content: '   ',
    }), makeParams(verInq.id))).status).toBe(400);

    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${verInq.id}/feedback`, 'POST', {
      feedbackType: 'consultation',
      content: '字'.repeat(2001),
    }), makeParams(verInq.id))).status).toBe(400);

    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${verInq.id}/feedback`, 'POST', {
      feedbackType: 'unknown_type',
      content: '非法类型',
    }), makeParams(verInq.id))).status).toBe(400);

    expect((await postFeedback(jsonReq(
      `http://localhost:3000/api/inquiries/${verInq.id}/feedback`,
      'POST',
      {
        feedbackType: 'consultation',
        content: '测试头尾键不一致',
        clientRequestId: 'key-body',
      },
      { 'Idempotency-Key': 'key-header' },
    ), makeParams(verInq.id))).status).toBe(400);
  });

  it('5. 幂等与防重：同 key 同内容返回 200 replayed 且不重复写库/通知；同 key 不同内容返回 409', async () => {
    const { inquiry, quote } = await seedInquiryWithQuote();
    mockState.user = { id: 'cust_1', email: 'cust1@test.com', name: '张科研', role: 'customer' };

    const payload = {
      feedbackType: 'price_negotiation',
      content: '希望总价优惠到 180 元',
      quoteId: quote.id,
      quoteVersion: quote.version,
      clientRequestId: 'idem-key-001',
    };

    const first = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', payload, { 'Idempotency-Key': 'idem-key-001' }),
      makeParams(inquiry.id),
    );
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const replay = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', payload, { 'Idempotency-Key': 'idem-key-001' }),
      makeParams(inquiry.id),
    );
    expect(replay.status).toBe(200);
    const replayBody = await replay.json();
    expect(replayBody.replayed).toBe(true);
    expect(replayBody.feedback.id).toBe(firstBody.feedback.id);

    // 数据库和通知均未重复写入
    expect(await prisma.inquiryFeedback.count({ where: { inquiryId: inquiry.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: 'inquiry_feedback_received' } })).toBe(1);

    // 同 key 不同内容返回 409
    const conflict = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
        ...payload,
        content: '改成另一个内容',
      }),
      makeParams(inquiry.id),
    );
    expect(conflict.status).toBe(409);
  });

  it('6. 草稿金额与内部备注零泄露：客户侧三个读接口均不返回 draft 金额、resolutionNote 和 handledByAdminEmail', async () => {
    const { inquiry, quote: sentQuote } = await seedInquiryWithQuote({
      inquiryId: 'inq_leak_check',
      quoteVersion: 1,
      quoteStatus: 'sent',
      quoteSubtotal: 200,
    });

    // 新增一版 draft 报价（包含敏感内部草稿金额 98765.43）
    const draftQuote = await prisma.quote.create({
      data: {
        inquiryId: inquiry.id,
        version: 2,
        status: 'draft',
        subtotal: 98765.43,
        items: {
          create: [
            {
              position: 0,
              name: '磷酸盐缓冲液 PBS',
              unitPrice: 98765.43,
              quantity: 1,
              lineTotal: 98765.43,
            },
          ],
        },
      },
    });

    // 写入一条已被管理员处理的反馈（含内部备注、管理员邮箱、关联草稿）
    await prisma.inquiryFeedback.create({
      data: {
        inquiryId: inquiry.id,
        quoteId: sentQuote.id,
        quoteVersion: sentQuote.version,
        actorType: 'customer',
        actorUserId: 'cust_1',
        actorEmail: 'cust1@test.com',
        actorName: '张科研',
        channel: 'website',
        feedbackType: 'price_negotiation',
        content: '希望能给个老客户价',
        handlingStatus: 'resolved',
        handledByAdminId: 'admin_1',
        handledByAdminEmail: 'secret-admin@test.com',
        handledAt: new Date(),
        resolutionNote: '内部底价不可告知客户',
        resolvedByQuoteId: draftQuote.id,
      },
    });

    mockState.user = { id: 'cust_1', email: 'cust1@test.com', name: '张科研', role: 'customer' };

    const [fbRes, detailRes, myOrdersRes] = await Promise.all([
      getFeedback(new NextRequest(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`), makeParams(inquiry.id)),
      getInquiryDetail(new NextRequest(`http://localhost:3000/api/inquiries/${inquiry.id}`), makeParams(inquiry.id)),
      getMyOrders(),
    ]);

    expect(fbRes.status).toBe(200);
    expect(detailRes.status).toBe(200);
    expect(myOrdersRes.status).toBe(200);

    const fbJson = JSON.stringify(await fbRes.json());
    const detailJson = JSON.stringify(await detailRes.json());
    const myOrdersJson = JSON.stringify(await myOrdersRes.json());

    for (const serialized of [fbJson, detailJson, myOrdersJson]) {
      expect(serialized).not.toContain('98765.43');
      expect(serialized).not.toContain('内部底价不可告知客户');
      expect(serialized).not.toContain('secret-admin@test.com');
      expect(serialized).not.toContain('resolutionNote');
      expect(serialized).not.toContain('handledByAdminEmail');
      expect(serialized).not.toContain('resolvedByQuoteId');
    }

    // 确认 detail 和 my-orders 都带上了脱敏后的 feedbackSummary
    expect(detailJson).toContain('"feedbackSummary"');
    expect(myOrdersJson).toContain('"feedbackSummary"');
  });

  it('7. 组织精细权限回归：纯 researcher 仅可读写本人创建的组织询价；纯 purchasing 可读写组织询价', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'org_researcher_a', email: 'res-a@org.test', name: '研究员A' });
    seedUser(db, { id: 'org_researcher_b', email: 'res-b@org.test', name: '研究员B' });
    seedUser(db, { id: 'org_purchaser', email: 'pur@org.test', name: '采购员' });

    db.prepare(`INSERT INTO organizations (id, name, status, owner_user_id) VALUES ('org_perm', '精细权限实验室', 'active', 'cust_1')`).run();
    db.prepare(`INSERT INTO organization_roles (id, organization_id, key, name, permissions) VALUES ('role_res', 'org_perm', 'researcher', '研究员', '["organization.inquiries.create"]')`).run();
    db.prepare(`INSERT INTO organization_roles (id, organization_id, key, name, permissions) VALUES ('role_pur', 'org_perm', 'purchasing', '采购员', '["organization.orders.create"]')`).run();
    db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, status) VALUES ('mem_res_a', 'org_perm', 'org_researcher_a', 'active')`).run();
    db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, status) VALUES ('mem_res_b', 'org_perm', 'org_researcher_b', 'active')`).run();
    db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, status) VALUES ('mem_pur', 'org_perm', 'org_purchaser', 'active')`).run();
    db.prepare(`INSERT INTO organization_role_assignments (member_id, role_id) VALUES ('mem_res_a', 'role_res')`).run();
    db.prepare(`INSERT INTO organization_role_assignments (member_id, role_id) VALUES ('mem_res_b', 'role_res')`).run();
    db.prepare(`INSERT INTO organization_role_assignments (member_id, role_id) VALUES ('mem_pur', 'role_pur')`).run();

    const { inquiry: resAInq, quote: resAQuote } = await seedInquiryWithQuote({
      inquiryId: 'inq_res_a',
      userId: 'org_researcher_a',
      email: 'res-a@org.test',
      ownerScope: 'organization',
      organizationId: 'org_perm',
    });

    // 研究员A 可以 GET 和 POST 自己创建的组织询价
    mockState.user = { id: 'org_researcher_a', email: 'res-a@org.test', name: '研究员A', role: 'customer' };
    expect((await getFeedback(new NextRequest(`http://localhost:3000/api/inquiries/${resAInq.id}/feedback`), makeParams(resAInq.id))).status).toBe(200);
    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${resAInq.id}/feedback`, 'POST', {
      feedbackType: 'price_negotiation',
      content: '研究员A就本人询价议价',
      quoteId: resAQuote.id,
    }), makeParams(resAInq.id))).status).toBe(201);

    // 同事研究员B（无 organization.records.read）对研究员A的询价 GET & POST 均 403
    mockState.user = { id: 'org_researcher_b', email: 'res-b@org.test', name: '研究员B', role: 'customer' };
    expect((await getFeedback(new NextRequest(`http://localhost:3000/api/inquiries/${resAInq.id}/feedback`), makeParams(resAInq.id))).status).toBe(403);
    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${resAInq.id}/feedback`, 'POST', {
      feedbackType: 'price_negotiation',
      content: '研究员B不应盲写同事询价',
      quoteId: resAQuote.id,
    }), makeParams(resAInq.id))).status).toBe(403);

    // 纯采购员（只有 organization.orders.create，无 organization.records.read）可 GET & POST 组织询价
    mockState.user = { id: 'org_purchaser', email: 'pur@org.test', name: '采购员', role: 'customer' };
    expect((await getFeedback(new NextRequest(`http://localhost:3000/api/inquiries/${resAInq.id}/feedback`), makeParams(resAInq.id))).status).toBe(200);
    expect((await postFeedback(jsonReq(`http://localhost:3000/api/inquiries/${resAInq.id}/feedback`, 'POST', {
      feedbackType: 'terms_change',
      content: '采购员确认交期条款',
      quoteId: resAQuote.id,
    }), makeParams(resAInq.id))).status).toBe(201);
  });

  it('8. 幂等前置与 actorUserId 隔离：报价过期/换版/询价关闭后同 key 重试仍 200 replayed；不同用户同 key 409', async () => {
    const db = getTestDb();
    seedUser(db, { id: 'org_pur_2', email: 'pur2@org.test', name: '采购员2' });
    db.prepare(`INSERT INTO organizations (id, name, status, owner_user_id) VALUES ('org_idem', '幂等实验室', 'active', 'cust_1')`).run();
    db.prepare(`INSERT INTO organization_roles (id, organization_id, key, name, permissions) VALUES ('role_idem_pur', 'org_idem', 'purchasing', '采购员', '["organization.orders.create"]')`).run();
    db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, status) VALUES ('mem_idem_1', 'org_idem', 'cust_1', 'active')`).run();
    db.prepare(`INSERT INTO organization_members (id, organization_id, user_id, status) VALUES ('mem_idem_2', 'org_idem', 'org_pur_2', 'active')`).run();
    db.prepare(`INSERT INTO organization_role_assignments (member_id, role_id) VALUES ('mem_idem_1', 'role_idem_pur')`).run();
    db.prepare(`INSERT INTO organization_role_assignments (member_id, role_id) VALUES ('mem_idem_2', 'role_idem_pur')`).run();

    const { inquiry, quote } = await seedInquiryWithQuote({
      inquiryId: 'inq_idem_replay',
      userId: 'cust_1',
      email: 'cust1@test.com',
      ownerScope: 'organization',
      organizationId: 'org_idem',
    });

    // cust_1 首次提交（不传 quoteId 的 consultation，以及传 quoteId 的 price_negotiation）
    mockState.user = { id: 'cust_1', email: 'cust1@test.com', name: '张科研', role: 'customer' };
    const firstConsult = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
        feedbackType: 'consultation',
        content: '咨询发货包装',
        clientRequestId: 'replay-consult-key',
      }),
      makeParams(inquiry.id),
    );
    expect(firstConsult.status).toBe(201);
    const firstConsultBody = await firstConsult.json();

    const firstPrice = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
        feedbackType: 'price_negotiation',
        content: '申请优惠价',
        quoteId: quote.id,
        quoteVersion: quote.version,
        clientRequestId: 'replay-price-key',
      }),
      makeParams(inquiry.id),
    );
    expect(firstPrice.status).toBe(201);
    const firstPriceBody = await firstPrice.json();

    // 不同 actorUserId（org_pur_2）使用相同 clientRequestId 和相同正文 -> 返回 409 IDEMPOTENCY_CONFLICT
    mockState.user = { id: 'org_pur_2', email: 'pur2@org.test', name: '采购员2', role: 'customer' };
    const diffActorRes = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
        feedbackType: 'consultation',
        content: '咨询发货包装',
        clientRequestId: 'replay-consult-key',
      }),
      makeParams(inquiry.id),
    );
    expect(diffActorRes.status).toBe(409);
    expect((await diffActorRes.json()).code).toBe('IDEMPOTENCY_CONFLICT');

    // 模拟期间报价被替代 + 过期 + 询价关闭
    await prisma.quote.update({
      where: { id: quote.id },
      data: { status: 'superseded', validUntil: new Date(Date.now() - 3600_000) },
    });
    await prisma.quote.create({
      data: {
        inquiryId: inquiry.id,
        version: 2,
        status: 'expired',
        subtotal: 190,
        validUntil: new Date(Date.now() - 1800_000),
      },
    });
    await prisma.inquiry.update({
      where: { id: inquiry.id },
      data: { status: 'closed' },
    });

    // 原提交人 cust_1 携带原 clientRequestId 重试，均应直接返回 200 replayed: true
    mockState.user = { id: 'cust_1', email: 'cust1@test.com', name: '张科研', role: 'customer' };
    const replayConsult = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
        feedbackType: 'consultation',
        content: '咨询发货包装',
        clientRequestId: 'replay-consult-key',
      }),
      makeParams(inquiry.id),
    );
    expect(replayConsult.status).toBe(200);
    const replayConsultBody = await replayConsult.json();
    expect(replayConsultBody.replayed).toBe(true);
    expect(replayConsultBody.feedback.id).toBe(firstConsultBody.feedback.id);

    const replayPrice = await postFeedback(
      jsonReq(`http://localhost:3000/api/inquiries/${inquiry.id}/feedback`, 'POST', {
        feedbackType: 'price_negotiation',
        content: '申请优惠价',
        quoteId: quote.id,
        quoteVersion: quote.version,
        clientRequestId: 'replay-price-key',
      }),
      makeParams(inquiry.id),
    );
    expect(replayPrice.status).toBe(200);
    const replayPriceBody = await replayPrice.json();
    expect(replayPriceBody.replayed).toBe(true);
    expect(replayPriceBody.feedback.id).toBe(firstPriceBody.feedback.id);
  });
});
