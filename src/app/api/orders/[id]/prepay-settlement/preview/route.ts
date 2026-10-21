import { NextRequest, NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import {
  parsePrepaySettlementBody,
  previewOrderPrepaySettlement,
  PrepaySettlementError,
} from '@/lib/order-prepay-settlement';

/**
 * 预览客户付款前调整积分和优惠券后的应付金额。不扣积分、不核销优惠券、不改订单。
 *
 * 权限与 POST /api/orders/:id/prepay-settlement 相同：
 * - 客户：订单所属用户。组织订单还要求 organization.orders.create。
 * - 管理员：拒绝（403）。不新增 MFA。
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
  const parsed = parsePrepaySettlementBody(body, null);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  try {
    const preview = await previewOrderPrepaySettlement(
      { id: user.id, role: user.role, email: user.email },
      id,
      parsed.value,
    );
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof PrepaySettlementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[prepay-settlement preview POST]', error);
    return NextResponse.json({ error: '订单处理失败，请稍后重试' }, { status: 500 });
  }
}
