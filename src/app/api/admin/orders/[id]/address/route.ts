import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('orders.write');
  if (admin instanceof NextResponse) return admin;
  try {
    const { id } = await params;
    const body = await req.json();
    if (![body.name, body.phone, body.address].every((value) => typeof value === 'string' && value.trim())) {
      return NextResponse.json({ error: '收货人、电话和地址不能为空' }, { status: 400 });
    }
    const order = await prisma.order.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!order) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
    if (['completed', 'cancelled'].includes(order.status)) return NextResponse.json({ error: 'ORDER_ADDRESS_LOCKED' }, { status: 409 });

    const addressSnapshot = await prisma.$transaction(async (tx) => {
      const snapshot = await tx.orderAddressSnapshot.upsert({
        where: { orderId: id },
        create: { orderId: id, name: body.name.trim(), phone: body.phone.trim(), address: body.address.trim(), institution: body.institution?.trim() || null },
        update: { name: body.name.trim(), phone: body.phone.trim(), address: body.address.trim(), institution: body.institution?.trim() || null },
      });
      await tx.orderEvent.create({ data: {
        orderId: id, type: 'address_updated', actorId: admin.id, actorEmail: admin.email, message: '收货地址已更新',
      } });
      return snapshot;
    });
    return NextResponse.json({ addressSnapshot });
  } catch (error) {
    console.error('[admin order address PATCH] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
