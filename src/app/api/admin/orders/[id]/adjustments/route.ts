import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { calculateOrderAmounts } from '@/lib/order-domain';

const TYPES = ['discount', 'shipping', 'tax', 'platform_fee', 'transfer_fee', 'manual'];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('pricing.write');
  if (admin instanceof NextResponse) return admin;
  try {
    const { id } = await params;
    const body = await req.json();
    if (!TYPES.includes(body.type) || typeof body.label !== 'string' || !body.label.trim() || !Number.isFinite(body.amount)) {
      return NextResponse.json({ error: 'INVALID_ADJUSTMENT' }, { status: 400 });
    }
    const order = await prisma.order.findUnique({ where: { id }, include: { orderItems: true, adjustments: true } });
    if (!order) return NextResponse.json({ error: 'ORDER_NOT_FOUND' }, { status: 404 });
    if (['completed', 'cancelled'].includes(order.status)) return NextResponse.json({ error: 'ORDER_AMOUNT_LOCKED' }, { status: 409 });
    const data = { orderId: id, type: body.type, label: body.label.trim(), amount: body.amount, reason: body.reason || null, createdBy: admin.id };
    const amounts = calculateOrderAmounts(
      order.orderItems.map((item) => ({ unitPrice: item.unitPrice, quantity: item.quantity })),
      [...order.adjustments, data],
    );
    const [adjustment, updated] = await prisma.$transaction([
      prisma.orderAdjustment.create({ data }),
      prisma.order.update({ where: { id }, data: {
        ...amounts,
        events: { create: { type: 'amount_recalculated', actorId: admin.id, actorEmail: admin.email, metadata: JSON.stringify(amounts) } },
      } }),
    ]);
    return NextResponse.json({ adjustment, total: updated.total }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'INVALID_ORDER_AMOUNT') return NextResponse.json({ error: message }, { status: 400 });
    console.error('[admin order adjustment POST] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('pricing.write');
  if (admin instanceof NextResponse) return admin;
  try {
    const { id } = await params;
    const { adjustmentId } = await req.json();
    const adjustment = await prisma.orderAdjustment.findFirst({ where: { id: adjustmentId, orderId: id }, include: { order: { include: { orderItems: true, adjustments: true } } } });
    if (!adjustment) return NextResponse.json({ error: 'ADJUSTMENT_NOT_FOUND' }, { status: 404 });
    if (['completed', 'cancelled'].includes(adjustment.order.status)) return NextResponse.json({ error: 'ORDER_AMOUNT_LOCKED' }, { status: 409 });
    const amounts = calculateOrderAmounts(
      adjustment.order.orderItems.map((item) => ({ unitPrice: item.unitPrice, quantity: item.quantity })),
      adjustment.order.adjustments.filter((item) => item.id !== adjustment.id),
    );
    const [, updated] = await prisma.$transaction([
      prisma.orderAdjustment.delete({ where: { id: adjustment.id } }),
      prisma.order.update({ where: { id }, data: {
        ...amounts,
        events: { create: { type: 'amount_recalculated', actorId: admin.id, actorEmail: admin.email, metadata: JSON.stringify(amounts) } },
      } }),
    ]);
    return NextResponse.json({ success: true, total: updated.total });
  } catch (error) {
    console.error('[admin order adjustment DELETE] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
