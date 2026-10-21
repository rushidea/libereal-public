import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AMBIGUOUS_PRODUCT_CATALOG_NUMBER, CustomerUnavailableProductError, verifyAndPriceItems, type PriceLookupItem } from '@/lib/pricing';
import { toOrderItemCreates } from '@/lib/commerce-records';
import {
  assertVariantCheckoutStock,
  isVariantStockInsufficientError,
  reserveOrderInventory,
  VARIANT_STOCK_INSUFFICIENT,
  VARIANT_STOCK_INSUFFICIENT_MESSAGE,
} from '@/lib/inventory';
import { requireAdmin } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { adminOrderResolvedLineError, parseAdminOrderCreateCharges } from '@/lib/admin-order-create';
import { reviewCommerceLinesWithCatalog } from '@/lib/commerce-line-catalog';
import { normalizeOrderPaymentMethod } from '@/data/payment-methods';
import { orderAutoCloseAt } from '@/lib/order-auto-close';
import { initialOrderStatus } from '@/lib/order-domain';
import { isOrderIdUniqueConflict, ORDER_NUMBER_BUSY_ERROR, withAllocatedOrderNumber } from '@/data/order-number';
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

/** 后台下单，代客下单走同一接口。权限：管理员 orders.write（已配置 MFA 时包含 step-up）。费用和单价须为有限、非负、最多两位小数，数量须为正整数；目录价偏差和超量只在响应的 warnings 里提示，不拦截。不代扣客户积分。规格库存不足返回 400，不新增权限。没有规格的商品保持现有逻辑，这里不额外做商品级库存校验。 */
export async function POST(req: NextRequest) {
  const admin = await requireAdmin('orders.write');
  if (admin instanceof NextResponse) return admin;

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
      platformFee,
      transferFee,
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
    const charges = parseAdminOrderCreateCharges({ items, platformFee, transferFee });
    if (!charges.ok) {
      return NextResponse.json({ error: charges.error }, { status: 400 });
    }
    const normalizedItems = (items as Array<Record<string, unknown>>).map((item, index) => {
      const line = charges.lines[index];
      const next: Record<string, unknown> = { ...item, quantity: line.quantity };
      delete next.unitPrice;
      if (line.price === undefined) delete next.price;
      else next.price = line.price;
      return next;
    });

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
    const pricedItems: PriceLookupItem[] = normalizedItems.map((item) => ({
      productId: typeof item.productId === 'string' ? item.productId : null,
      catalogNumber: typeof item.catalogNumber === 'string' ? item.catalogNumber : null,
      brand: typeof item.brand === 'string' ? item.brand : null,
      name: typeof item.name === 'string' ? item.name : '',
      // 未传单价时用 NaN，让计价走目录价；不合法的单价已在前面返回 400。
      price: typeof item.price === 'number' ? item.price : Number.NaN,
      quantity: typeof item.quantity === 'number' ? item.quantity : undefined,
      variantId: typeof item.variantId === 'string' ? item.variantId : null,
      spec: typeof item.spec === 'string' ? item.spec : null,
      unit: typeof item.unit === 'string' ? item.unit : null,
    }));
    const manualAdjustments = Object.fromEntries(pricedItems
      .filter((item) => (item.catalogNumber || item.productId) && Number.isFinite(item.price))
      .map((item) => [item.catalogNumber || item.productId, { type: 'fixed_price' as const, value: item.price, reason: '管理员创建订单时指定价格' }]));
    const { verifiedItems, verifiedSubtotal, mismatchedCount } = await verifyAndPriceItems(pricedItems, {
      customerEmail: customer?.email ?? normalizedCustomerEmail,
      manualAdjustments,
      allowManualAdjustment: true,
      allowHazardousProducts: true,
    });
    if (mismatchedCount > 0) {
      console.warn(`[admin/orders POST] ${mismatchedCount} item(s) missing DB price`);
    }
    for (let index = 0; index < verifiedItems.length; index += 1) {
      const item = verifiedItems[index];
      const resolvedError = adminOrderResolvedLineError(index, item.name, item.unitPrice, item.quantity);
      if (resolvedError) return NextResponse.json({ error: resolvedError }, { status: 400 });
    }
    // 合理性警告只提示：不要求 confirmWarnings，也不因目录价偏差或超量拒绝建单。
    const lineReview = await reviewCommerceLinesWithCatalog(verifiedItems.map((item, index) => ({
      index,
      productId: item.productId,
      variantId: item.variantId,
      name: item.name,
      spec: item.spec,
      catalogNumber: item.catalogNumber,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
    })));
    const warnings = lineReview.warnings;
    const adjustments = [
      ...(charges.platformFee ? [{ type: 'platform_fee', label: '平台服务费', amount: charges.platformFee, createdBy: admin.id }] : []),
      ...(charges.transferFee ? [{ type: 'transfer_fee', label: '转账手续费', amount: charges.transferFee, createdBy: admin.id }] : []),
    ];
    const adjustmentTotal = adjustments.reduce((sum, item) => sum + item.amount, 0);
    const total = verifiedSubtotal + adjustmentTotal;

    const orderItems = verifiedItems.map((vi) => ({
      productId: vi.productId || null,
      name: vi.name,
      brand: null, // not in pricing util
      catalogNumber: vi.catalogNumber || null,
      price: vi.unitPrice,
      clientPrice: vi.clientPrice,
      quantity: vi.quantity,
      shippedQty: 0,
      leadTime: vi.leadTime ?? null,
      status: 'pending',
      variantId: vi.variantId ?? null,
      metadata: JSON.stringify({
        variantId: vi.variantId ?? null,
        spec: vi.spec ?? null,
        unit: vi.unit ?? null,
        stockSnapshot: {
          available: vi.available ?? null,
          stockQuantity: vi.stockQuantity ?? null,
          leadTime: vi.leadTime ?? null,
        },
      }),
      pricingSnapshot: vi.pricingSnapshot,
    }));

    const orderStatus = initialOrderStatus(normalizedPaymentMethod);
    const order = await withAllocatedOrderNumber(prisma, async (tx, orderId) => {
      await assertVariantCheckoutStock(tx, orderItems.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        variantId: item.variantId,
        metadata: item.metadata,
      })));
      const warningMetadata = warnings.map((warning) => ({
        code: warning.code,
        message: warning.message,
        index: warning.index ?? null,
      }));
      const created = await tx.order.create({
        data: {
          id: orderId,
          email: customer?.email ?? normalizedCustomerEmail,
          ...(customer ? { customerId: customer.id } : {}),
          createdByAdminId: admin.id,
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
              actorId: admin.id,
              actorEmail: admin.email,
            },
          },
          events: {
            create: {
              type: 'order_created',
              message: '管理员创建订单',
              actorId: admin.id,
              actorEmail: admin.email,
              metadata: warningMetadata.length ? JSON.stringify({ warnings: warningMetadata }) : null,
            },
          },
        },
      });
      await writeAuditLog({
        actorId: admin.id,
        actorEmail: admin.email,
        action: 'order.admin_created',
        resource: 'orders',
        targetType: 'Order',
        targetId: created.id,
        after: {
          createdByAdminId: admin.id,
          email: created.email,
          customerId: created.customerId,
          subtotal: created.subtotal,
          adjustmentTotal: created.adjustmentTotal,
          total: created.total,
          paymentMethod: created.paymentMethod,
          platformFee: charges.platformFee,
          transferFee: charges.transferFee,
        },
        metadata: warningMetadata.length ? { warnings: warningMetadata } : undefined,
      }, tx);
      await reserveOrderInventory(tx, created.id, admin.id, '后台下单预占规格库存', { variantLinesOnly: true });
      return created;
    });

    return NextResponse.json({ order, orderId: order.id, warnings });
  } catch (err) {
    if (err instanceof Error && (err.message === 'INVALID_FALLBACK_PRICE' || err.message === 'INVALID_PRICE_ADJUSTMENT')) {
      return NextResponse.json({ error: '单价必须是有限、非负、最多两位小数的数字' }, { status: 400 });
    }
    if (err instanceof Error && (err.message === 'INVALID_ITEM_QUANTITY' || err.message === 'INVALID_QUANTITY')) {
      return NextResponse.json({ error: '数量必须为正整数' }, { status: 400 });
    }
    if (err instanceof CustomerUnavailableProductError) {
      return NextResponse.json(
        { error: `${err.productName} 已下架，无法创建订单`, catalogNumber: err.catalogNumber },
        { status: 400 },
      );
    }
    if (isVariantStockInsufficientError(err)) {
      return NextResponse.json({ error: VARIANT_STOCK_INSUFFICIENT_MESSAGE, code: VARIANT_STOCK_INSUFFICIENT }, { status: 400 });
    }
    if (err instanceof Error && err.message === AMBIGUOUS_PRODUCT_CATALOG_NUMBER) {
      return NextResponse.json({ error: '部分商品需要确认品牌后再创建订单。' }, { status: 400 });
    }
    if (isOrderIdUniqueConflict(err)) {
      console.error('[admin/orders POST] order number conflict', err);
      return NextResponse.json({ error: ORDER_NUMBER_BUSY_ERROR }, { status: 503 });
    }
    console.error('[admin/orders POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
