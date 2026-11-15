import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { recordCustomerRepricingConfirmation } from '@/lib/order-catalog-repricing';

// Staff may record a response received outside koncket. Never impersonate the customer.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('inquiries.write');
  if (admin instanceof NextResponse) return admin;
  const orderAdmin = await requireAdmin('orders.write');
  if (orderAdmin instanceof NextResponse) return orderAdmin;
  const body = await req.json().catch(() => null);
  if (!body || !['quoteId', 'orderId', 'proposalHash', 'responseChannel', 'responseReference']
    .every((field) => typeof body[field] === 'string' && body[field].trim() && body[field].length <= 2000)) {
    return NextResponse.json({ error: '请提供本次报价、原订单和客户确认的渠道及记录位置' }, { status: 400 });
  }
  const { id } = await params;
  try {
    const result = await prisma.$transaction((tx) => recordCustomerRepricingConfirmation(tx, {
      inquiryId: id, quoteId: body.quoteId, orderId: body.orderId, proposalHash: body.proposalHash,
      responseChannel: body.responseChannel.trim(), responseReference: body.responseReference.trim(),
      confirmedTotal: typeof body.confirmedTotal === 'number' ? body.confirmedTotal : undefined,
      actor: { id: orderAdmin.id, email: orderAdmin.email },
    }));
    return NextResponse.json({ result }, { status: result.stage === 'awaiting_finance_review' ? 202 : 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'REPRICING_VERSION_CHANGED') return NextResponse.json({ code, error: '报价或原订单内容已变化，请刷新后重新核对和确认' }, { status: 409 });
    if (code === 'REPRICING_TOTAL_CONFIRMATION_REQUIRED') return NextResponse.json({ code, error: '请让客户核对包含原有金额调整的完整应付金额，再登记确认' }, { status: 409 });
    console.error('[quote/repricing]', error);
    return NextResponse.json({ error: '记录客户确认失败' }, { status: 500 });
  }
}
