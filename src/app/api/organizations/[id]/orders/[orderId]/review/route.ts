import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireActiveSession } from '@/lib/session';
import { OrganizationRbacError, organizationRbacErrorStatus, requireOrganizationPermission } from '@/lib/organization-service';
import { organizationOrderReview, submitOrganizationOrderReview } from '@/lib/organization-order-review';

type Params = { params: Promise<{ id: string; orderId: string }> };

async function handleReview(request: Request, { params }: Params) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const { id, orderId } = await params;
  try {
    await requireOrganizationPermission(user.id, id, 'organization.orders.review');
    if (request.method === 'GET') {
      const { preview } = await organizationOrderReview(prisma, id, orderId, user);
      return NextResponse.json(preview, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    const body = await request.json().catch(() => null);
    if (typeof body?.version !== 'string') {
      return NextResponse.json({ error: '请先查看本次组织审核的订单明细。' }, { status: 400 });
    }
    const result = await prisma.$transaction(
      (tx) => submitOrganizationOrderReview(tx, id, orderId, user, body.version),
      { isolationLevel: 'Serializable' },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof OrganizationRbacError) {
      return NextResponse.json({ error: error.message }, { status: organizationRbacErrorStatus(error) });
    }
    const reason = error instanceof Error ? error.message : '';
    if (reason === 'ORG_ORDER_NOT_FOUND') return NextResponse.json({ error: '找不到该组织订单。' }, { status: 404 });
    if (reason === 'ORG_ORDER_SELF_REVIEW') return NextResponse.json({ error: '订单创建者不能审核本人订单。' }, { status: 403 });
    if (reason === 'ORG_ORDER_CREATOR_UNVERIFIED') return NextResponse.json({ error: '暂时无法核实这笔订单的创建人，不能提交组织审核。', code: reason }, { status: 409 });
    if (reason === 'ORG_ORDER_REVIEW_CLOSED') return NextResponse.json({ error: '订单当前无法提交组织审核。' }, { status: 409 });
    if (reason === 'QUOTE_REPRICE_REQUIRED') return NextResponse.json({ error: '请等待原订单完成价格复核。', code: reason }, { status: 409 });
    if (reason === 'ORG_ORDER_REVIEW_CHANGED' || (error as { code?: string })?.code === 'P2034') {
      return NextResponse.json({ error: '订单已变化，请重新查看明细后审核。' }, { status: 409 });
    }
    console.error('[organization order review]', error);
    return NextResponse.json({ error: '暂时无法处理组织审核。' }, { status: 500 });
  }
}

export { handleReview as GET, handleReview as POST };
