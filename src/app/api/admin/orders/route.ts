import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, verifyAndPriceItems } from '@/lib/pricing';
import { toOrderItemCreates } from '@/lib/commerce-records';
import { requireAdmin } from '@/lib/session';
import { normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { orderAutoCloseAt } from '@/lib/order-auto-close';
import { initialOrderStatus } from '@/lib/order-domain';
import { getAlipayPaymentSummary } from '@/data/alipay-payment';
import {
  adminOrderStatusCounts,
  buildAdminActiveOrderCountWhere,
  buildAdminActiveOrderWhere,
  parseAdminOrderListQuery,
  pendingUnpaidAlipayWhere,
} from '@/data/admin-order-list-query';

const orderListSelect = {
  id: true,
  email: true,
  subtotal: true,
  adjustmentTotal: true,
  total: true,
  status: true,
  paymentMethod: true,
  paidAt: true,
  createdAt: true,
  addressSnapshot: { select: { name: true, phone: true, institution: true } },
  paymentAttempts: {
    where: { provider: 'alipay' },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { status: true, outTradeNo: true, tradeNo: true, notifiedAt: true, paidAt: true },
  },
} satisfies Prisma.OrderSelect;

const receivableSelect = {
  id: true,
  amount: true,
  status: true,
  dueAt: true,
  paidAt: true,
} satisfies Prisma.AccountReceivableSelect;

type AdminOrderAddressSnapshot = {
  sourceAddressId: string | null;
  name: string;
  phone: string;
  address: string;
  institution: string | null;
};

async function resolveAdminOrderAddress(input: {
  addressId: unknown;
  addressName: unknown;
  addressPhone: unknown;
  addressText: unknown;
  addressInstitution: unknown;
  customerId: string | null;
}): Promise<{ snapshot: AdminOrderAddressSnapshot | null } | { error: string }> {
  const addressId = typeof input.addressId === 'string' ? input.addressId.trim() : '';
  if (addressId) {
    if (!input.customerId) {
      return { error: '未找到该客户，无法保存所选地址' };
    }
    const address = await prisma.address.findUnique({ where: { id: addressId } });
    if (!address) return { error: '所选地址不存在，请重新选择' };
    if (address.userId !== input.customerId) return { error: '所选地址不属于该客户，请重新选择' };
    return {
      snapshot: {
        sourceAddressId: address.id,
        name: address.name,
        phone: address.phone,
        address: address.address,
        institution: address.institution,
      },
    };
  }

  const name = typeof input.addressName === 'string' ? input.addressName : '';
  const phone = typeof input.addressPhone === 'string' ? input.addressPhone : '';
  const text = typeof input.addressText === 'string' ? input.addressText : '';
  if (!name && !phone && !text) return { snapshot: null };
  const institution = typeof input.addressInstitution === 'string' ? input.addressInstitution : null;
  return {
    snapshot: {
      sourceAddressId: null,
      name,
      phone,
      address: text,
      institution,
    },
  };
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin('orders.read');
  if (denied instanceof NextResponse) return denied;

  try {
    const parsed = parseAdminOrderListQuery(new URL(req.url).searchParams);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { query } = parsed;
    const where = buildAdminActiveOrderWhere(query) as Prisma.OrderWhereInput;
    const countWhere = buildAdminActiveOrderCountWhere(query.receivableOpen) as Prisma.OrderWhereInput;
    const select = query.receivableOpen
      ? { ...orderListSelect, receivable: { select: receivableSelect } }
      : orderListSelect;

    const [orders, total, statusGroups, pendingAlipayUnpaid, receivableAggregate] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select,
      }),
      prisma.order.count({ where }),
      prisma.order.groupBy({
        by: ['status'],
        where: countWhere,
        _count: { _all: true },
      }),
      prisma.order.count({
        where: {
          AND: [countWhere, pendingUnpaidAlipayWhere() as Prisma.OrderWhereInput],
        },
      }),
      query.receivableOpen
        ? prisma.accountReceivable.aggregate({
            where: { status: 'open', order: { is: { archivedAt: null } } },
            _count: { _all: true },
            _sum: { amount: true },
          })
        : Promise.resolve(null),
    ]);

    const enriched = orders.map((order) => {
      const { paymentAttempts, addressSnapshot, ...rest } = order;
      const receivable = 'receivable' in rest ? rest.receivable ?? null : null;
      const summary = { ...rest };
      if ('receivable' in summary) delete summary.receivable;
      return {
        ...summary,
        receivable,
        name: addressSnapshot?.name || order.email.split('@')[0],
        institution: addressSnapshot?.institution || null,
        department: null,
        phone: addressSnapshot?.phone || null,
        payment: getAlipayPaymentSummary(order, paymentAttempts[0]),
      };
    });

    return NextResponse.json({
      orders: enriched,
      page: query.page,
      pageSize: query.pageSize,
      total,
      statusCounts: adminOrderStatusCounts(
        statusGroups.map((group) => ({ status: group.status, count: group._count._all })),
        pendingAlipayUnpaid,
      ),
      receivableSummary: receivableAggregate
        ? { count: receivableAggregate._count._all, amount: receivableAggregate._sum.amount ?? 0 }
        : null,
    });
  } catch (err) {
    console.error('[admin/orders GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin('orders.write');
  if (denied instanceof NextResponse) return denied;

  try {
    const {
      items,
      paymentMethod,
      addressId,
      addressName,
      addressPhone,
      addressText,
      addressInstitution,
      customerEmail,
      platformFee = 0,
      transferFee = 0,
    } = await req.json();

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 });
    }
    const normalizedCustomerEmail = typeof customerEmail === 'string' ? customerEmail.trim() : '';
    if (!normalizedCustomerEmail) {
      return NextResponse.json({ error: '请选择客户' }, { status: 400 });
    }
    const normalizedPaymentMethod = normalizeOrderPaymentMethod(paymentMethod);
    if (!normalizedPaymentMethod) {
      return NextResponse.json({ error: '请选择有效的付款方式' }, { status: 400 });
    }

    const customer = await prisma.user.findUnique({
      where: { email: normalizedCustomerEmail },
      select: { id: true, email: true },
    });
    const resolvedAddress = await resolveAdminOrderAddress({
      addressId,
      addressName,
      addressPhone,
      addressText,
      addressInstitution,
      customerId: customer?.id ?? null,
    });
    if ('error' in resolvedAddress) {
      return NextResponse.json({ error: resolvedAddress.error }, { status: 400 });
    }

    // Server-side price verification (P0-1)
    const manualAdjustments = Object.fromEntries(items
      .filter((item: { catalogNumber?: string; productId?: string; price?: number }) => (item.catalogNumber || item.productId) && Number.isFinite(item.price))
      .map((item: { catalogNumber?: string; productId?: string; price: number }) => [item.catalogNumber || item.productId, { type: 'fixed_price' as const, value: item.price, reason: '管理员创建订单时指定价格' }]));
    const { verifiedItems, verifiedSubtotal, mismatchedCount } = await verifyAndPriceItems(items, {
      customerEmail: customer?.email ?? normalizedCustomerEmail,
      manualAdjustments,
      allowManualAdjustment: true,
      allowHazardousProducts: true,
    });
    if (mismatchedCount > 0) {
      console.warn(`[admin/orders POST] ${mismatchedCount} item(s) missing DB price`);
    }
    const adjustments = [
      ...(platformFee ? [{ type: 'platform_fee', label: '平台服务费', amount: Number(platformFee) }] : []),
      ...(transferFee ? [{ type: 'transfer_fee', label: '转账手续费', amount: Number(transferFee) }] : []),
    ];
    const adjustmentTotal = adjustments.reduce((sum, item) => sum + item.amount, 0);
    const total = verifiedSubtotal + adjustmentTotal;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const countToday = await prisma.order.count({
      where: { createdAt: { gte: startOfToday } },
    });
    const seq = String(countToday + 1).padStart(3, '0');
    const orderId = `ORD-${dateStr}-${seq}`;

    const orderItems = verifiedItems.map((vi) => ({
      productId: vi.productId || null,
      name: vi.name,
      brand: null, // not in pricing util
      catalogNumber: vi.catalogNumber || null,
      price: vi.unitPrice,
      clientPrice: vi.clientPrice,
      quantity: vi.quantity,
      shippedQty: 0,
      leadTime: null,
      status: 'pending',
      pricingSnapshot: vi.pricingSnapshot,
    }));

    const orderStatus = initialOrderStatus(normalizedPaymentMethod);
    const order = await prisma.order.create({
      data: {
        id: orderId,
        email: customer?.email ?? normalizedCustomerEmail,
        ...(customer ? { customerId: customer.id } : {}),
        subtotal: verifiedSubtotal,
        adjustmentTotal,
        total,
        status: orderStatus,
        autoCloseAt: orderAutoCloseAt(normalizedPaymentMethod),
        paymentMethod: normalizedPaymentMethod,
        ...(resolvedAddress.snapshot ? {
          addressSnapshot: { create: resolvedAddress.snapshot },
        } : {}),
        ...(adjustments.length ? { adjustments: { create: adjustments } } : {}),
        orderItems: {
          create: toOrderItemCreates(orderItems),
        },
        statusHistory: {
          create: {
            toStatus: orderStatus,
            reason: 'admin_order_created',
          },
        },
        events: { create: { type: 'order_created', message: '管理员创建订单' } },
      },
    });

    return NextResponse.json({ order, orderId });
  } catch (err) {
    if (err instanceof Error && err.message === AMBIGUOUS_PRODUCT_CATALOG_NUMBER) {
      return NextResponse.json({ error: '部分商品需要确认品牌后再创建订单。' }, { status: 400 });
    }
    console.error('[admin/orders POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
