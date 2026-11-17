import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { approveRepricingFinance, previewRepricingFinance } from '@/lib/order-catalog-repricing';

const ERRORS: Record<string, string> = {
  REPRICING_VERSION_CHANGED: '报价、客户回复或原订单内容已变化，请刷新核对后重新确认',
  CUSTOMER_REPRICING_CONFIRMATION_REQUIRED: '请先登记客户对本版完整金额的确认',
  REPRICING_PAYMENT_RECONCILIATION_REQUIRED: '原订单还有活动支付或待核对的支付结果，请先取得原交易的实际结果',
  REPRICING_CASH_RESULT_REQUIRED: '原订单收款尚不能核实，或实际收款与新金额存在现金差额，尚需核对并完成差额处理',
  REPRICING_POINTS_RECONCILIATION_REQUIRED: '原订单积分流水不符、尚未结清或已有退还记录，请先核对实际处理结果',
  INVALID_ORDER_AMOUNT: '保留原有金额调整后金额无效，请先核对原优惠和积分记录',
};
function identity(body: Record<string, unknown>, inquiryId: string) {
  if (!['quoteId', 'orderId', 'proposalHash'].every((key) => typeof body[key] === 'string' && body[key] && String(body[key]).length <= 200)) return null;
  return { inquiryId, quoteId: body.quoteId as string, orderId: body.orderId as string, proposalHash: body.proposalHash as string };
}
function rejected(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (ERRORS[code]) return NextResponse.json({ code, error: ERRORS[code] }, { status: 409 });
  console.error('[quote/repricing/finance]', error);
  return NextResponse.json({ error: '价格复核处理失败' }, { status: 500 });
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('finance.write', { skipStepUp: true });
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  const input = identity(Object.fromEntries(new URL(req.url).searchParams), id);
  if (!input) return NextResponse.json({ error: '价格复核参数无效' }, { status: 400 });
  try { return NextResponse.json({ preview: await prisma.$transaction((tx) => previewRepricingFinance(tx, input)) }); }
  catch (error) { return rejected(error); }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await req.json().catch(() => null);
  const admin = await requireAdmin('finance.write', { token: typeof body?.stepUpToken === 'string' ? body.stepUpToken : undefined, action: 'admin_sensitive' });
  if (admin instanceof NextResponse) return admin;
  const { id } = await params;
  const input = body && identity(body, id);
  if (!input || typeof body.financeApprovalHash !== 'string' || body.financeApprovalHash.length !== 64
    || body.preserveOriginalAdjustments !== true || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 2000) {
    return NextResponse.json({ error: '请核对本次金额明细并填写财务确认说明' }, { status: 400 });
  }
  try {
    return NextResponse.json({ result: await prisma.$transaction((tx) => approveRepricingFinance(tx, {
      ...input, financeApprovalHash: body.financeApprovalHash, preserveOriginalAdjustments: true,
      reason: body.reason.trim(), actor: { id: admin.id, email: admin.email },
    })) });
  } catch (error) { return rejected(error); }
}
