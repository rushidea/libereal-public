import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { extractStepUpToken } from '@/lib/admin-order-step-up';
import { applyFinanceAction, financeActions, previewFinanceAction, type FinanceInput } from '@/lib/finance-actions';
import { financeAttention, financeWorkspace } from '@/lib/finance-workspace';
import { legacyAlipayReconciliationStatuses } from '@/lib/payment-concurrency';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { PurchaseError, requiredText } from '@/lib/purchase-terms';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';
import { getAdminPermissions, requireAdmin } from '@/lib/session';

function failure(error: unknown) {
  if (error instanceof PurchaseError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.message === '未找到原客户订单') return NextResponse.json({ error: error.message }, { status: 404 });
  const code = (error as { code?: string })?.code;
  if (code === 'P2002' || code === 'P2034' || (code === 'P2010' && /unique|locked|busy/i.test(String(error)))) {
    return NextResponse.json({ error: '账务已由另一项操作更新，请重新核对' }, { status: 409 });
  }
  console.error('[admin/finance]', error instanceof Error ? error.name : 'database operation failed');
  return NextResponse.json({ error: '读取或登记账务失败，请保留原始凭据后重试' }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAdmin('finance.read');
    if (user instanceof NextResponse) return user;
    const permissions = await getAdminPermissions(user);
    const canWrite = permissions.includes('finance.write');
    const orderId = req.nextUrl.searchParams.get('orderId')?.trim();
    if (orderId) {
      const workspace = await prisma.$transaction(tx => financeWorkspace(tx, orderId));
      return NextResponse.json({ workspace, canWrite });
    }
    const search = (req.nextUrl.searchParams.get('search') ?? '').trim().slice(0, 200);
    const orders = await prisma.$transaction(async tx => {
      const attention = req.nextUrl.searchParams.get('attention') === '1' ? await financeAttention(tx, new Date()) : null;
      if (attention?.size === 0) return [];
      const byAttention = attention ? Prisma.sql`AND o.id IN (${Prisma.join([...attention.keys()])})` : Prisma.empty;
      const rows = await tx.$queryRaw<Array<{ id: string; status: string; amount: number; receivableStatus: string | null; supplierCount: bigint }>>`
        SELECT o.id,o.status,o.total AS amount,r.status AS receivableStatus,
          (SELECT COUNT(*) FROM PurchaseOrder p WHERE p.orderId=o.id AND p.status<>'superseded') AS supplierCount
        FROM "Order" o LEFT JOIN AccountReceivable r ON r.orderId=o.id
        WHERE (r.id IS NOT NULL OR o.status IN ('confirmed','partially_shipped','shipped','completed') OR o.paidAt IS NOT NULL
          OR EXISTS (SELECT 1 FROM PaymentAttempt a WHERE a.orderId=o.id AND a.provider='alipay'
            AND (a.status LIKE '%reconciliation_required' OR a.status IN (${Prisma.join(legacyAlipayReconciliationStatuses)})))
          OR EXISTS (SELECT 1 FROM FinanceEvent f WHERE f.orderId=o.id))
        ${byAttention}
        AND (instr(lower(o.id),lower(${search}))>0 OR instr(lower(o.email),lower(${search}))>0
          OR EXISTS (SELECT 1 FROM PurchaseOrder p WHERE p.orderId=o.id AND instr(lower(p.id),lower(${search}))>0)
          OR EXISTS (SELECT 1 FROM FinanceInvoicePlan p JOIN FinanceInvoiceAllocation a ON a.planId=p.id
            JOIN FinanceInvoice i ON i.id=a.invoiceId WHERE p.orderId=o.id AND instr(lower(i.number),lower(${search}))>0))
        ORDER BY o.createdAt DESC,o.id LIMIT 100`;
      return rows.map(row => ({ ...row, supplierCount: Number(row.supplierCount), attention: attention?.get(row.id) ?? null }));
    });
    return NextResponse.json({ canWrite, orders });
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAdmin('finance.write', { skipStepUp: true });
    if (user instanceof NextResponse) return user;
    if (!(await getAdminPermissions(user)).includes('finance.read')) return NextResponse.json({ error: '需要财务查看权限' }, { status: 403 });
    const body = await req.json().catch(() => null);
    if (!body || !financeActions.includes(body.action) || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      throw new PurchaseError('请选择财务事项并填写依据', 400);
    }
    const input: FinanceInput = { orderId: requiredText(body.orderId, '原客户订单'), requestId: requiredText(body.requestId, '操作编号'),
      version: requiredText(body.version, '财务记录版本'), action: body.action, data: body.data };
    const actor = { id: user.id, email: user.email };
    if (body.stage === 'preview') {
      return NextResponse.json({ preview: await prisma.$transaction(tx => previewFinanceAction(tx, input, actor)) });
    }
    if (body.stage !== 'confirm' || typeof body.actionHash !== 'string' || !/^[0-9a-f]{64}$/.test(body.actionHash)) {
      throw new PurchaseError('请先核对本次业务的完整预览');
    }
    const token = extractStepUpToken(body);
    if (!token || !user.sessionId || !await consumeSecurityStepUpGrant(token, { userId: user.id, sessionId: user.sessionId, action: 'admin_sensitive' })) {
      return NextResponse.json({ error: 'Admin MFA required' }, { status: 403 });
    }
    const authorization = { permission: 'finance.write' as const, action: 'admin_sensitive' as const,
      sessionFingerprint: pricingContentHash({ userId: user.id, sessionId: user.sessionId }), verifiedAt: new Date().toISOString() };
    const result = await prisma.$transaction(async tx => {
      const eventId = await applyFinanceAction(tx, input, actor, body.actionHash, authorization);
      return { eventId, workspace: await financeWorkspace(tx, input.orderId), canWrite: true };
    }, { isolationLevel: 'Serializable' });
    return NextResponse.json(result);
  } catch (error) { return failure(error); }
}
