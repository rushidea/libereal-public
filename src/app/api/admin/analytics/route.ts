import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, getAdminPermissions } from '@/lib/session';
import { formatOrderPaymentMethod, normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { INACTIVE_ORDER_STATUSES, ORDER_STATUS_LABELS } from '@/lib/order-domain';

export const dynamic = 'force-dynamic';

// 待处理项超过该小时数视为"超时"，用于工作台红色预警（48 小时，与自动关闭阈值一致）
const PENDING_SLA_HOURS = 48;

// 订单状态显示名（用于数据洞察环形图）
const ORDER_STATUS_DISPLAY_LABELS: Record<string, string> = {
  ...ORDER_STATUS_LABELS,
  pending: '待处理',
  refunded: '已退款',
};

function overdueDaysOf(dueAt: Date | null, now: Date): number {
  if (!dueAt) return -1;
  return Math.floor((now.getTime() - dueAt.getTime()) / 86400000);
}

// 统一上海时区（+8，与订单编号 orderDateInShanghai 一致），避免进程时区影响「今日」切日
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;

function shanghaiDateKey(d: Date): string {
  const s = new Date(d.getTime() + SHANGHAI_OFFSET_MS);
  return `${s.getUTCFullYear()}-${String(s.getUTCMonth() + 1).padStart(2, '0')}-${String(s.getUTCDate()).padStart(2, '0')}`;
}

function shanghaiStartOfDay(d: Date): Date {
  // 上海时区的"当日零点"（UTC 时刻）
  const shifted = Math.floor((d.getTime() + SHANGHAI_OFFSET_MS) / 86400000) * 86400000 - SHANGHAI_OFFSET_MS;
  return new Date(shifted);
}

export async function GET(_req: NextRequest) {
  const admin = await requireAdmin('admin.access');
  if (admin instanceof NextResponse) return admin;

  // 字段级权限裁剪：敏感数据按权限决定是否返回（前端隐藏只是展示层，接口侧也要守）
  const adminPermissions = await getAdminPermissions(admin);
  const hasFinance = adminPermissions.includes('finance.read');
  const hasInquiries = adminPermissions.includes('inquiries.read');
  const hasOrders = adminPermissions.includes('orders.read');
  const hasCustomers = adminPermissions.includes('customers.read');
  const hasContent = adminPermissions.includes('content.read');
  const hasOrganizations = adminPermissions.includes('organizations.read');
  const hasAudit = adminPermissions.includes('audit.read');

  try {
    const now = new Date();
    // 自动关闭已由独立定时任务 /api/cron/auto-close 负责（autoCloseAt 索引查询），本接口不再触发扫描

    const startOfToday = shanghaiStartOfDay(now); // 上海时区"今日零点"，与订单编号 ORD-YYYYMMDD 一致
    // 上海时区"本月 1 号零点"（与营业额日口径一致，避免进程时区导致月/日口径错开）
    const shanghaiNow = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
    const startOfMonth = new Date(Date.UTC(shanghaiNow.getUTCFullYear(), shanghaiNow.getUTCMonth(), 1) - SHANGHAI_OFFSET_MS);
    const slaThreshold = new Date(now.getTime() - PENDING_SLA_HOURS * 60 * 60 * 1000);
    const weekAgo = shanghaiStartOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
    const monthAgo = shanghaiStartOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
    const ninetyDaysAgo = shanghaiStartOfDay(new Date(now.getTime() - 89 * 24 * 60 * 60 * 1000));

    // 近 7 天 + 近 30 天营业额序列（净额口径）：新增订单总额 − 取消或关闭订单总额
    // 以 OrderStatusHistory(toStatus in cancelled/closed) 为准，不受归档或编辑刷新 updatedAt 影响
    const [revenueWeekRows, cancelledWeekHistories, revenueMonthRows, revenueMonthOrderCounts, cancelledMonthHistories] = await Promise.all([
      prisma.order.groupBy({
        by: ['createdAt'],
        _sum: { total: true },
        where: { createdAt: { gte: weekAgo }, archivedAt: null },
      }),
      prisma.orderStatusHistory.findMany({
        where: { toStatus: { in: [...INACTIVE_ORDER_STATUSES] }, createdAt: { gte: weekAgo } },
        select: { orderId: true, createdAt: true },
      }),
      prisma.order.groupBy({
        by: ['createdAt'],
        _sum: { total: true },
        where: { createdAt: { gte: monthAgo }, archivedAt: null },
      }),
      prisma.order.groupBy({
        by: ['createdAt'],
        _count: { _all: true },
        where: { createdAt: { gte: monthAgo }, archivedAt: null },
      }),
      prisma.orderStatusHistory.findMany({
        where: { toStatus: { in: [...INACTIVE_ORDER_STATUSES] }, createdAt: { gte: monthAgo } },
        select: { orderId: true, createdAt: true },
      }),
    ]);
    const cancelledWeekOrderIds = [...new Set(cancelledWeekHistories.map((h) => h.orderId))];
    const cancelledWeekRows = cancelledWeekOrderIds.length
      ? await prisma.order.findMany({
          // 取消侧与新增侧口径一致：仅未归档订单计入扣减（归档订单不参与当日/近7天净额）
          where: { id: { in: cancelledWeekOrderIds }, archivedAt: null },
          select: { id: true, total: true },
        })
      : [];
    const cancelledTotalById = new Map(cancelledWeekRows.map((o) => [o.id, o.total ?? 0]));
    // 同一订单若有多条 cancelled 历史（同状态重复 PATCH 等），只按订单扣减一次
    const cancelledWeekByDay: Record<string, number> = {};
    const seenCancelledOrder = new Set<string>();
    for (const h of cancelledWeekHistories) {
      if (seenCancelledOrder.has(h.orderId)) continue;
      seenCancelledOrder.add(h.orderId);
      const key = shanghaiDateKey(new Date(h.createdAt));
      cancelledWeekByDay[key] = (cancelledWeekByDay[key] ?? 0) + (cancelledTotalById.get(h.orderId) ?? 0);
    }

    // 近 30 天取消（同样按订单去重，避免同单重复扣减）
    const cancelledMonthOrderIds = [...new Set(cancelledMonthHistories.map((h) => h.orderId))];
    const cancelledMonthRows = cancelledMonthOrderIds.length
      ? await prisma.order.findMany({
          // 与新增侧口径一致：仅未归档订单计入扣减
          where: { id: { in: cancelledMonthOrderIds }, archivedAt: null },
          select: { id: true, total: true },
        })
      : [];
    const cancelledMonthTotalById = new Map(cancelledMonthRows.map((o) => [o.id, o.total ?? 0]));
    const cancelledMonthByDay: Record<string, number> = {};
    const seenCancelledMonthOrder = new Set<string>();
    for (const h of cancelledMonthHistories) {
      if (seenCancelledMonthOrder.has(h.orderId)) continue;
      seenCancelledMonthOrder.add(h.orderId);
      const key = shanghaiDateKey(new Date(h.createdAt));
      cancelledMonthByDay[key] = (cancelledMonthByDay[key] ?? 0) + (cancelledMonthTotalById.get(h.orderId) ?? 0);
    }

    // 订单状态分布（含全部未归档订单，环形图展示占比）
    const orderStatusRows = await prisma.order.groupBy({
      by: ['status'],
      _count: { _all: true },
      where: { archivedAt: null },
    });

    // 最近动态：审计日志 + 订单事件合并取最近 10 条（仅 audit.read 权限可见，无权限不查询不返回）
    const [auditRows, orderEventRows] = hasAudit
      ? await Promise.all([
          prisma.auditLog.findMany({
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { id: true, action: true, resource: true, actorEmail: true, createdAt: true },
          }),
          prisma.orderEvent.findMany({
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { id: true, type: true, message: true, actorEmail: true, createdAt: true },
          }),
        ])
      : [[], []];

    const [
      pendingOrders,
      overdueOrders,
      pendingInquiries,
      overdueInquiries,
      newUsers,
      pendingCommunity,
      pendingOrganizations,
      revenueTodayAgg,
      newCustomersMonth,
      receivableAgg,
      receivableOverdueCount,
      paymentMethodOrders,
      funnelInquiries,
      funnelQuoted,
      funnelOrdered,
      funnelCompleted,
    ] = await Promise.all([
      prisma.order.count({ where: { status: 'pending', archivedAt: null } }),
      prisma.order.count({
        where: { status: 'pending', archivedAt: null, createdAt: { lt: slaThreshold } },
      }),
      prisma.inquiry.count({
        // 历史数据曾用中文状态「待确认」，新代码用枚举 pending_quote，两侧都兼容
        where: { status: { in: ['pending_quote', '待确认', '待人工审核'] }, archivedAt: null },
      }),
      prisma.inquiry.count({
        where: { status: { in: ['pending_quote', '待确认', '待人工审核'] }, archivedAt: null, createdAt: { lt: slaThreshold } },
      }),
      prisma.user.count({ where: { isNewUser: true } }),
      prisma.userCreatedRecipe.count({ where: { status: 'pending' } }),
      prisma.organization.count({ where: { status: 'pending' } }),
      prisma.order.aggregate({
        _sum: { total: true },
        where: { createdAt: { gte: startOfToday }, archivedAt: null },
      }),
      prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
      // 待收款：status=open 且订单未归档的应收款（与活跃订单待收款视图口径一致）
      prisma.accountReceivable.aggregate({
        _sum: { amount: true },
        _count: { _all: true },
        where: { status: 'open', order: { archivedAt: null } },
      }),
      // 已过 dueAt 仍未收款的笔数（逾期，同样限定未归档）
      prisma.accountReceivable.count({
        where: { status: 'open', order: { archivedAt: null }, dueAt: { lt: now } },
      }),
      // 支付方式分布：近 90 天订单（未归档）—— 取原始值，JS 内 normalize 归并
      prisma.order.findMany({
        where: { createdAt: { gte: ninetyDaysAgo }, archivedAt: null },
        select: { paymentMethod: true, total: true },
      }),
      // 询价漏斗：近 30 天询价总数、已报价数
      prisma.inquiry.count({ where: { createdAt: { gte: monthAgo }, archivedAt: null } }),
      prisma.inquiry.count({ where: { createdAt: { gte: monthAgo }, archivedAt: null, status: { in: ['quote_sent', 'closed', '已报价', '已完成'] } } }),
      // 近 30 天询价关联订单数（已下单）+ 成交订单数
      prisma.order.count({ where: { inquiryId: { not: null }, createdAt: { gte: monthAgo }, archivedAt: null, status: { notIn: [...INACTIVE_ORDER_STATUSES] } } }),
      prisma.order.count({ where: { inquiryId: { not: null }, createdAt: { gte: monthAgo }, archivedAt: null, status: { in: ['completed', 'shipped', 'partially_shipped', 'confirmed'] } } }),
    ]);

    // 今日营业额 = 今日新增订单总额 − 今日取消订单总额（含昨天创建今天取消的），最小为 0
    // 取消以 OrderStatusHistory 为准（cancelled 终态），与近 7 天口径一致
    const revenueTodayCreated = revenueTodayAgg._sum.total ?? 0;
    const todayKey = shanghaiDateKey(startOfToday);
    const cancelledToday = Math.round((cancelledWeekByDay[todayKey] ?? 0) * 100) / 100;
    const revenueToday = Math.max(0, Math.round((revenueTodayCreated - cancelledToday) * 100) / 100);

    // 组装近 7 天序列（净额：当天新增 − 当天取消，补零保证 7 个点，按上海时区切日）
    const revenueByDay: Record<string, number> = {};
    for (const row of revenueWeekRows) {
      const key = shanghaiDateKey(new Date(row.createdAt));
      revenueByDay[key] = (revenueByDay[key] ?? 0) + (row._sum.total ?? 0);
    }
    const revenueWeek: { date: string; label: string; amount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = shanghaiDateKey(d);
      const s = new Date(d.getTime() + SHANGHAI_OFFSET_MS);
      revenueWeek.push({
        date: key,
        label: `${s.getUTCMonth() + 1}/${s.getUTCDate()}`,
        amount: Math.max(0, Math.round(((revenueByDay[key] ?? 0) - (cancelledWeekByDay[key] ?? 0)) * 100) / 100),
      });
    }

    // 订单状态分布
    const orderStatus: { status: string; label: string; count: number }[] = orderStatusRows
      .map((row) => ({
        status: row.status,
        label: ORDER_STATUS_DISPLAY_LABELS[row.status] ?? row.status,
        count: row._count._all,
      }))
      .sort((a, b) => b.count - a.count);

    // 近 30 天营业额 + 订单数（净额口径，补零 30 个点，按上海时区切日）
    const monthRevenueByDay: Record<string, number> = {};
    const monthCountByDay: Record<string, number> = {};
    for (const row of revenueMonthRows) {
      const key = shanghaiDateKey(new Date(row.createdAt));
      monthRevenueByDay[key] = (monthRevenueByDay[key] ?? 0) + (row._sum.total ?? 0);
    }
    for (const row of revenueMonthOrderCounts) {
      const key = shanghaiDateKey(new Date(row.createdAt));
      monthCountByDay[key] = (monthCountByDay[key] ?? 0) + row._count._all;
    }
    const revenue30d: { date: string; label: string; revenue: number; orderCount: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const key = shanghaiDateKey(d);
      const s = new Date(d.getTime() + SHANGHAI_OFFSET_MS);
      revenue30d.push({
        date: key,
        label: `${s.getUTCMonth() + 1}/${s.getUTCDate()}`,
        revenue: Math.max(0, Math.round(((monthRevenueByDay[key] ?? 0) - (cancelledMonthByDay[key] ?? 0)) * 100) / 100),
        orderCount: monthCountByDay[key] ?? 0,
      });
    }

    // 支付方式分布（近 90 天）：按 normalize 后的规范值归并（alipay/zfb → 支付宝；微信/银行卡等旧别名归并）
    const paymentMethodMap = new Map<string, { label: string; amount: number; count: number }>();
    for (const o of paymentMethodOrders) {
      const raw = o.paymentMethod ?? '';
      const normalized = normalizeOrderPaymentMethod(raw);
      // normalize 未覆盖的旧值（微信扫码/微信支付/银行卡）按 format 的 label 归并
      const key = normalized
        ?? (raw.toLowerCase().includes('weixin') || raw.includes('微信') ? 'weixin'
            : raw.toLowerCase().includes('card') || raw.includes('银行卡') ? 'card'
            : raw || 'unknown');
      const label = o.paymentMethod ? formatOrderPaymentMethod(o.paymentMethod) : '未指定';
      const cur = paymentMethodMap.get(key) ?? { label, amount: 0, count: 0 };
      cur.amount += o.total ?? 0;
      cur.count += 1;
      paymentMethodMap.set(key, cur);
    }
    const paymentMethod = [...paymentMethodMap.entries()]
      .map(([method, v]) => ({ method, label: v.label, amount: Math.round(v.amount * 100) / 100, count: v.count }))
      .sort((a, b) => b.amount - a.amount);

    // 询价转化漏斗（近 30 天）
    const inquiryFunnel = {
      inquiries: funnelInquiries,
      quoted: funnelQuoted,
      ordered: funnelOrdered,
      completed: funnelCompleted,
      quotedRate: funnelInquiries > 0 ? Math.round((funnelQuoted / funnelInquiries) * 1000) / 10 : 0,
      orderedRate: funnelQuoted > 0 ? Math.round((funnelOrdered / funnelQuoted) * 1000) / 10 : 0,
      completedRate: funnelOrdered > 0 ? Math.round((funnelCompleted / funnelOrdered) * 1000) / 10 : 0,
    };

    // 待收款账期分段（open 且订单未归档）
    // 口径：未起账期（dueAt 空）单列；账期内 = 未逾期（overdueDays<=0，含刚到期不足 24h 的）；逾期按天数 0-30/31-60/61-90/90+ 分段
    // 注意 overdueDaysOf 向下取整：dueAt 刚过但不足 24h 时 = 0，必须归入账期内，否则会从所有分段消失
    const agingBuckets = [
      { key: 'not_started', label: '未起账期', test: (r: { dueAt: Date | null }) => !r.dueAt },
      { key: 'current', label: '账期内', test: (r: { dueAt: Date | null }) => Boolean(r.dueAt && overdueDaysOf(r.dueAt, now) <= 0) },
      { key: 'overdue-0-30', label: '逾期 0-30 天', test: (r: { dueAt: Date | null }) => overdueDaysOf(r.dueAt, now) >= 1 && overdueDaysOf(r.dueAt, now) <= 30 },
      { key: 'overdue-31-60', label: '逾期 31-60 天', test: (r: { dueAt: Date | null }) => overdueDaysOf(r.dueAt, now) >= 31 && overdueDaysOf(r.dueAt, now) <= 60 },
      { key: 'overdue-61-90', label: '逾期 61-90 天', test: (r: { dueAt: Date | null }) => overdueDaysOf(r.dueAt, now) >= 61 && overdueDaysOf(r.dueAt, now) <= 90 },
      { key: 'overdue-90+', label: '逾期 90 天以上', test: (r: { dueAt: Date | null }) => overdueDaysOf(r.dueAt, now) > 90 },
    ];
    const openReceivables = await prisma.accountReceivable.findMany({
      where: { status: 'open', order: { archivedAt: null } },
      select: { amount: true, dueAt: true },
    });
    const receivableAging = agingBuckets.map((bucket) => {
      const matched = openReceivables.filter(bucket.test);
      return {
        key: bucket.key,
        label: bucket.label,
        amount: Math.round(matched.reduce((s, r) => s + r.amount, 0) * 100) / 100,
        count: matched.length,
      };
    });
    const receivableAgingTotal = receivableAging.reduce((s, b) => s + b.amount, 0);

    // 最近动态：审计 + 订单事件合并，按时间倒序（无 audit.read 权限时为 [])
    const activity = hasAudit
      ? [
          ...auditRows.map((a) => ({
            id: `audit:${a.id}`,
            kind: a.resource === 'payments' ? 'payment' : 'audit',
            action: a.action,
            title: a.action.includes('payment') ? '支付创建' : a.action,
            actorEmail: a.actorEmail ?? null,
            message: a.resource,
            createdAt: a.createdAt,
          })),
          ...orderEventRows.map((e) => ({
            id: `order:${e.id}`,
            kind: 'order',
            action: e.type,
            title: e.message ?? e.type,
            actorEmail: e.actorEmail ?? null,
            message: e.type,
            createdAt: e.createdAt,
          })),
        ]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 10)
      : [];

    return NextResponse.json({
      todo: {
        orders: hasOrders ? pendingOrders : undefined,
        inquiries: hasInquiries ? pendingInquiries : undefined,
        users: hasCustomers ? newUsers : undefined,
        community: hasContent ? pendingCommunity : undefined,
        organizations: hasOrganizations ? pendingOrganizations : undefined,
        overdueOrders: hasOrders ? overdueOrders : undefined,
        overdueInquiries: hasInquiries ? overdueInquiries : undefined,
      },
      kpi: {
        revenueToday: hasOrders ? revenueToday : undefined,
        cancelledToday: hasOrders ? cancelledToday : undefined,
        newCustomersMonth: hasCustomers ? newCustomersMonth : undefined,
        pendingOrders: hasOrders ? pendingOrders : undefined,
        pendingInquiries: hasInquiries ? pendingInquiries : undefined,
      },
      insights: {
        revenueWeek: hasOrders ? revenueWeek : undefined,
        orderStatus: hasOrders ? orderStatus : undefined,
        revenue30d: hasOrders ? revenue30d : undefined,
        ...(hasFinance ? { paymentMethod, receivableAging, receivableAgingTotal } : {}),
        ...(hasInquiries ? { inquiryFunnel } : {}),
      },
      ...(hasFinance
        ? {
            receivable: {
              count: receivableAgg._count._all,
              totalAmount: Math.round((receivableAgg._sum.amount ?? 0) * 100) / 100,
              overdueCount: receivableOverdueCount,
            },
          }
        : {}),
      ...(hasAudit ? { activity } : {}),
      generatedAt: now.toISOString(),
    });
  } catch (err) {
    console.error('[admin/analytics GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
