import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, verifyAndPriceItems } from '@/lib/pricing';
import { orderItemView, toOrderItemCreates } from '@/lib/commerce-records';
import { requireAdmin } from '@/lib/session';
import { normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { orderAutoCloseAt } from '@/lib/order-auto-close';
import { initialOrderStatus } from '@/lib/order-domain';
import { getAlipayPaymentSummary } from '@/data/alipay-payment';

export async function GET(req: NextRequest) {
  const denied = await requireAdmin('orders.read');
  if (denied instanceof NextResponse) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status');
    const receivable = searchParams.get('receivable') === 'open';

    const where: { archivedAt: null; status?: string; receivable?: { is: { status: string } } } = { archivedAt: null };
    if (status) where.status = status;
    // 待收款视图：仅显示已建应收款且未收款的订单（对公转账/锐竞/喀斯玛确认后自动建应收款）
    if (receivable) where.receivable = { is: { status: 'open' } };

    const orders = await prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        orderItems: { orderBy: { position: 'asc' } },
        addressSnapshot: true,
        adjustments: { orderBy: { createdAt: 'asc' } },
        shipments: { orderBy: { createdAt: 'desc' }, include: { items: true } },
        events: { orderBy: { createdAt: 'asc' } },
        paymentAttempts: { where: { provider: 'alipay' }, orderBy: { createdAt: 'desc' }, take: 1 },
        // 待收款视图携带应收款金额，供页面汇总（与 analytics 口径一致）
        ...(receivable ? { receivable: { select: { id: true, amount: true, status: true, dueAt: true, paidAt: true } } } : {}),
      },
    });

    // Add derived display fields
    const enriched = orders.map(({ paymentAttempts, receivable: recv, ...o }) => ({
      ...o,
      receivable: recv ?? null,
      items: o.orderItems.map(orderItemView),
      orderItems: undefined,
      name: o.addressSnapshot?.name || o.email.split('@')[0],
      institution: o.addressSnapshot?.institution || null,
      department: null,
      phone: o.addressSnapshot?.phone || null,
      payment: getAlipayPaymentSummary(o, paymentAttempts[0]),
    }));

    return NextResponse.json({ orders: enriched });
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
    if (!customerEmail) {
      return NextResponse.json({ error: 'customerEmail is required' }, { status: 400 });
    }
    const normalizedPaymentMethod = normalizeOrderPaymentMethod(paymentMethod);
    if (!normalizedPaymentMethod) {
      return NextResponse.json({ error: '请选择有效的付款方式' }, { status: 400 });
    }

    // Server-side price verification (P0-1)
    const manualAdjustments = Object.fromEntries(items
      .filter((item: { catalogNumber?: string; productId?: string; price?: number }) => (item.catalogNumber || item.productId) && Number.isFinite(item.price))
      .map((item: { catalogNumber?: string; productId?: string; price: number }) => [item.catalogNumber || item.productId, { type: 'fixed_price' as const, value: item.price, reason: '管理员创建订单时指定价格' }]));
    const { verifiedItems, verifiedSubtotal, mismatchedCount } = await verifyAndPriceItems(items, {
      customerEmail,
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
        email: customerEmail,
        subtotal: verifiedSubtotal,
        adjustmentTotal,
        total,
        status: orderStatus,
        autoCloseAt: orderAutoCloseAt(normalizedPaymentMethod),
        paymentMethod: normalizedPaymentMethod,
        ...(addressName || addressPhone || addressText ? {
          addressSnapshot: { create: {
            sourceAddressId: addressId || null,
            name: addressName || '',
            phone: addressPhone || '',
            address: addressText || '',
            institution: addressInstitution || null,
          } },
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
