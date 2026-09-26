import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession, requireAdmin } from '@/lib/session';
import { orderItemView, toOrderItemCreates } from '@/lib/commerce-records';
import { canAccessOrganizationRecord } from '@/lib/organization-record-access';
import { requireOrganizationPermission } from '@/lib/organization-service';
import { orderAutoCloseAt } from '@/lib/order-auto-close';
import { initialOrderStatus } from '@/lib/order-domain';

interface OrderItem {
  productId?: string | null;
  name: string;
  price: number;
  quantity: number;
  shippedQty: number;
  leadTime?: string | null;
  status: string;
  pricingSnapshot?: string | null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  if (activeUser.role === 'admin') {
    const admin = await requireAdmin('orders.write');
    if (admin instanceof NextResponse) return admin;
  }
  const session = { user: activeUser };

  try {
    const { itemIndices, quantities } = await req.json();
    if (!Array.isArray(itemIndices) || itemIndices.length === 0) {
      return NextResponse.json({ error: 'itemIndices must be a non-empty array' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id as string },
      select: { id: true, role: true, email: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const isAdmin = user.role === 'admin';

    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      include: {
        quotes: {
          where: { status: 'sent' },
          orderBy: { version: 'desc' },
          take: 1,
          include: { items: { orderBy: { position: 'asc' } } },
        },
      },
    });
    if (!inquiry) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }

    if (!isAdmin) {
      if (inquiry.ownerScope === 'organization') {
        if (!inquiry.organizationId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        try {
          await requireOrganizationPermission(user.id, inquiry.organizationId, 'organization.orders.create');
        } catch {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      } else if (inquiry.email !== user.email) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const quote = inquiry.quotes[0];
    if (!quote) {
      return NextResponse.json({ error: 'Quote not sent yet' }, { status: 400 });
    }
    if (quote.validUntil && quote.validUntil < new Date()) {
      await prisma.quote.update({ where: { id: quote.id }, data: { status: 'expired' } });
      return NextResponse.json({ error: 'Quote has expired' }, { status: 400 });
    }

    try {
      const orderItems: OrderItem[] = [];
      const accepted: Array<{ quoteItemId: string; quantity: number }> = [];
      for (const idx of itemIndices) {
        const item = quote.items[idx];
        if (!item || !item.available || item.orderedQty >= item.quantity) continue;
        const remaining = item.quantity - item.orderedQty;
        let qty = remaining;
        if (quantities && typeof quantities === 'object') {
          const overrideQty = parseInt(quantities[idx as string] as string, 10);
          if (!isNaN(overrideQty) && overrideQty > 0) qty = Math.min(overrideQty, remaining);
        }

        orderItems.push({
          productId: item.productId || null,
          name: item.name,
          price: item.unitPrice,
          quantity: qty,
          shippedQty: 0,
          leadTime: item.leadTime || null,
          status: 'pending',
          pricingSnapshot: item.pricingSnapshot,
        });
        accepted.push({ quoteItemId: item.id, quantity: qty });
      }

      if (orderItems.length === 0) {
        return NextResponse.json({ error: 'No valid items to order' }, { status: 400 });
      }

      const subtotal = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

      const now = new Date();
      const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
      const startOfToday = new Date(now);
      startOfToday.setHours(0, 0, 0, 0);
      const countToday = await prisma.order.count({
        where: { createdAt: { gte: startOfToday } },
      });
      const seq = String(countToday + 1).padStart(3, '0');
      const orderId = `ORD-${dateStr}-${seq}`;

      const postOrderQuantities = new Map(quote.items.map((item) => [item.id, item.orderedQty]));
      for (const item of accepted) postOrderQuantities.set(item.quoteItemId, (postOrderQuantities.get(item.quoteItemId) ?? 0) + item.quantity);
      const allOrdered = quote.items.every((item) => !item.available || (postOrderQuantities.get(item.id) ?? 0) >= item.quantity);

      const orderStatus = initialOrderStatus(inquiry.paymentMethod);
      await prisma.$transaction(async (tx) => {
        await tx.order.create({ data: {
          id: orderId,
          inquiryId: id,
          email: inquiry.email,
          customerId: inquiry.userId,
          organizationId: inquiry.organizationId,
          ownerScope: inquiry.ownerScope,
          subtotal,
          total: subtotal,
          status: orderStatus,
          autoCloseAt: orderAutoCloseAt(inquiry.paymentMethod),
          paymentMethod: inquiry.paymentMethod,
          orderItems: {
            create: toOrderItemCreates(orderItems as unknown as Array<Record<string, unknown>>),
          },
          statusHistory: {
            create: {
              toStatus: orderStatus,
              actorId: session.user.id as string,
              actorEmail: user.email,
              reason: 'inquiry_items_confirmed',
            },
          },
          events: { create: {
            type: 'order_created',
            actorId: session.user.id as string,
            actorEmail: user.email,
            message: '客户确认报价商品并生成订单',
          } },
        } });
        for (const item of accepted) {
          await tx.quoteItem.update({ where: { id: item.quoteItemId }, data: { orderedQty: { increment: item.quantity } } });
        }
        await tx.quoteConfirmation.create({
          data: {
            quoteId: quote.id,
            userId: session.user.id as string,
            email: user.email,
            action: allOrdered ? 'accept' : 'partial_accept',
            details: JSON.stringify({ orderId, items: accepted }),
            ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip'),
            userAgent: req.headers.get('user-agent'),
          },
        });
        if (allOrdered) {
          await tx.quote.update({ where: { id: quote.id }, data: { status: 'accepted', acceptedAt: new Date() } });
          await tx.inquiry.update({ where: { id }, data: { status: 'closed' } });
        }
      });

      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: { orderItems: { orderBy: { position: 'asc' } } },
      });
      return NextResponse.json({
        order: order ? { ...order, items: order.orderItems.map(orderItemView), orderItems: undefined } : null,
        orderId,
        allOrdered,
      });
    } catch (e) {
      console.error('[confirm-items parse error]', e);
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: 'Failed to process order', detail: message }, { status: 500 });
    }
  } catch (err) {
    console.error('[confirm-items POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const activeUser = await requireActiveSession();
  if (activeUser instanceof NextResponse) return activeUser;
  if (activeUser.role === 'admin') {
    const admin = await requireAdmin('orders.read');
    if (admin instanceof NextResponse) return admin;
  }
  const session = { user: activeUser };

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id as string },
      select: { id: true, role: true, email: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    const isAdmin = user.role === 'admin';

    const inquiry = await prisma.inquiry.findUnique({
      where: { id },
      include: { quotes: { orderBy: { version: 'desc' }, take: 1 } },
    });
    if (!inquiry) {
      return NextResponse.json({ error: 'Inquiry not found' }, { status: 404 });
    }
    if (!isAdmin) {
      const allowed = inquiry.ownerScope === 'organization'
        ? Boolean(inquiry.organizationId) && await canAccessOrganizationRecord(user.id, inquiry.organizationId as string)
        : inquiry.email === user.email;
      if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const orders = await prisma.order.findMany({
      where: { inquiryId: id },
      orderBy: { createdAt: 'desc' },
      include: { orderItems: { orderBy: { position: 'asc' } } },
    });

    return NextResponse.json({
      orders: orders.map(({ orderItems, ...order }) => ({
        ...order,
        items: orderItems.map(orderItemView),
      })),
      inquiryStatus: inquiry.status,
      quoteStatus: inquiry.quotes[0]?.status ?? null,
    });
  } catch (err) {
    console.error('[confirm-items GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
