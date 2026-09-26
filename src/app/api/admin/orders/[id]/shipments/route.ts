import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { assertOrderTransition, fulfillmentStatus, validateShipmentItems } from '@/lib/order-domain';
import { shipOrderInventory } from '@/lib/inventory';
import { startOrderReceivableTerm } from '@/lib/customer-credit';
import { isPostDeliveryPaymentMethod } from '@/data/payment-methods';

const METHODS = ['logistics', 'self_pickup', 'dedicated_delivery'];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('orders.write');
  if (admin instanceof NextResponse) return admin;

  try {
    const { id } = await params;
    const body = await req.json();
    if (!METHODS.includes(body.method)) return NextResponse.json({ error: 'INVALID_SHIPMENT_METHOD' }, { status: 400 });
    if (body.method === 'logistics' && (!body.carrier || !body.trackingNumber)) {
      return NextResponse.json({ error: '物流公司和运单号不能为空' }, { status: 400 });
    }
    if (body.method === 'self_pickup' && !body.pickupPoint) {
      return NextResponse.json({ error: '自提点不能为空' }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { orderItems: { orderBy: { position: 'asc' } } },
      });
      if (!order) throw new Error('ORDER_NOT_FOUND');
      if (!['confirmed', 'partially_shipped'].includes(order.status)) throw new Error('ORDER_NOT_SHIPPABLE');

      const shipmentItems = validateShipmentItems(order.orderItems, Array.isArray(body.items) ? body.items : []);
      const nextItems = order.orderItems.map((item) => ({
        ...item,
        shippedQty: item.shippedQty + (shipmentItems.find((line) => line.orderItemId === item.id)?.quantity || 0),
      }));
      const nextStatus = fulfillmentStatus(nextItems);
      assertOrderTransition(order.status, nextStatus);
      const shippedAt = new Date();

      const shipment = await tx.shipment.create({ data: {
        orderId: id,
        method: body.method,
        status: 'shipped',
        carrier: body.carrier || null,
        trackingNumber: body.trackingNumber || null,
        pickupPoint: body.pickupPoint || null,
        contactName: body.contactName || null,
        contactPhone: body.contactPhone || null,
        note: body.note || null,
        shippedAt,
        createdBy: admin.id,
        items: { create: shipmentItems },
      } });

      for (const item of shipmentItems) {
        await shipOrderInventory(tx, id, item.orderItemId, item.quantity, admin.id);
        await tx.orderItem.update({
          where: { id: item.orderItemId },
          data: { shippedQty: { increment: item.quantity }, status: nextItems.find((row) => row.id === item.orderItemId)?.shippedQty === order.orderItems.find((row) => row.id === item.orderItemId)?.quantity ? 'shipped' : 'partially_shipped' },
        });
      }
      await tx.order.update({ where: { id }, data: {
        status: nextStatus,
        ...(nextStatus !== order.status ? { statusHistory: { create: {
          fromStatus: order.status,
          toStatus: nextStatus,
          actorId: admin.id,
          actorEmail: admin.email,
          reason: 'shipment_created',
        } } } : {}),
        events: { create: {
          type: 'shipment_created',
          actorId: admin.id,
          actorEmail: admin.email,
          message: `发货单 ${shipment.id} 已创建`,
          metadata: JSON.stringify({ shipmentId: shipment.id, method: body.method, items: shipmentItems }),
        } },
      } });
      if (nextStatus === 'shipped' && isPostDeliveryPaymentMethod(order.paymentMethod)) {
        await startOrderReceivableTerm(tx, id, shippedAt);
      }
      return { shipment, orderEmail: order.email, status: nextStatus };
    });

    const shippingText = result.shipment.trackingNumber
      ? `订单 ${id} 已发货，${result.shipment.carrier || '物流'}，运单号：${result.shipment.trackingNumber}`
      : `订单 ${id} 已安排发货`;
    await prisma.notification.create({ data: {
      email: result.orderEmail,
      role: 'customer',
      type: 'shipping_notification',
      title: '发货通知',
      content: shippingText,
      linkUrl: `/account/orders/${id}`,
      metadata: JSON.stringify({ orderId: id, shipmentId: result.shipment.id }),
    } });

    return NextResponse.json({ shipment: result.shipment, orderStatus: result.status }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'INTERNAL_ERROR';
    if (message === 'ORDER_NOT_FOUND') return NextResponse.json({ error: message }, { status: 404 });
    if (['ORDER_NOT_SHIPPABLE', 'INVALID_ORDER_TRANSITION'].includes(message)) return NextResponse.json({ error: message }, { status: 409 });
    if (['INVENTORY_RESERVATION_NOT_ACTIVE', 'INVENTORY_RESERVATION_EXCEEDED', 'INSUFFICIENT_ACTUAL_INVENTORY', 'INSUFFICIENT_AVAILABLE_INVENTORY'].includes(message)) return NextResponse.json({ error: message }, { status: 409 });
    if (['SHIPMENT_ITEMS_REQUIRED', 'INVALID_SHIPMENT_QUANTITY', 'ORDER_ITEM_NOT_FOUND', 'SHIPMENT_QUANTITY_EXCEEDED'].includes(message)) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    console.error('[admin order shipment POST] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
