import { NextRequest, NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import {
  applyOrderPrepaySettlement,
  parsePrepaySettlementBody,
  PrepaySettlementError,
} from '@/lib/order-prepay-settlement';

/**
 * 客户在付款前调整「管理员代接受报价」生成的未支付订单的积分和优惠券，并重算应付。
 *
 * 权限：
 * - 客户：订单所属用户（Order.customerId）。组织订单还要求 organization.orders.create。
 *   只能使用自己的个人积分、所属课题组积分，以及自己的或通用优惠券。
 * - 管理员：拒绝（403）。不能在付款前替客户选择积分或优惠券。不使用 orders.write，也不新增 MFA。
 *
 * 已支付、已取消、已关闭，以及已进入履约（已确认及之后）的订单拒绝修改。
 * 客户本人接受报价时已经选定积分的订单不走本接口。
 * 代客下单 POST /api/admin/orders 不使用本接口。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const { id } = await params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const parsed = parsePrepaySettlementBody(body, req.headers.get('idempotency-key'));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const result = await applyOrderPrepaySettlement(
      { id: user.id, role: user.role, email: user.email },
      id,
      parsed.value,
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PrepaySettlementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[prepay-settlement POST]', error);
    return NextResponse.json({ error: '订单处理失败，请稍后重试' }, { status: 500 });
  }
}
