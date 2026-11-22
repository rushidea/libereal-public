import { NextRequest, NextResponse } from 'next/server';
import type { AdminPermissionKey } from '@/lib/admin-permissions';
import { getAdminPermissions, requireAdmin } from '@/lib/session';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';
import { extractStepUpToken } from '@/lib/admin-order-step-up';
import { prisma } from '@/lib/prisma';
import { applyPurchaseAction, prepareOrderPurchases, previewPurchaseAction, purchaseWorkspace, savePurchaseLine, type PurchaseActionInput } from '@/lib/purchase-orders';
import { normalizePurchaseTerms, PurchaseError, requiredText } from '@/lib/purchase-terms';

function failure(e: unknown) {
  if (e instanceof PurchaseError) return NextResponse.json({ error: e.message },{ status:e.status });
  if (e instanceof Error && e.message === '未找到原客户订单') return NextResponse.json({ error:e.message },{ status:404 });
  const code = (e as {code?:string})?.code;
  if (code === 'P2034' || code === 'P2002' || (code === 'P2010' && /unique|locked|busy/i.test(String((e as Error).message)))) {
    return NextResponse.json({ error:'采购资料被其他操作更新，请重新核对原记录' },{ status:409 });
  }
  console.error('[admin/purchases]', e instanceof Error ? e.name : 'database operation failed');
  return NextResponse.json({ error:'采购记录处理失败，请核对原单后重试' },{ status:500 });
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAdmin('purchases.read');
    if (user instanceof NextResponse) return user;
    const permissions = (await getAdminPermissions(user)).filter(p => p.startsWith('purchases.'));
    const orderId = req.nextUrl.searchParams.get('orderId')?.trim();
    if (orderId) return NextResponse.json({ permissions, workspace: await prisma.$transaction(tx => purchaseWorkspace(tx,orderId)) });
    const query = (req.nextUrl.searchParams.get('search') ?? '').trim().slice(0,200);
    const rows = await prisma.$queryRaw<{id:string; status:string; prepared:bigint; purchases:bigint}[]>`
      SELECT o.id,o.status,(SELECT COUNT(*) FROM PurchaseRequirement r WHERE r.orderId=o.id) AS prepared,
        (SELECT COUNT(*) FROM PurchaseOrder p WHERE p.orderId=o.id AND p.status<>'superseded') AS purchases
      FROM "Order" o WHERE (o.status='confirmed' AND o.archivedAt IS NULL OR EXISTS(SELECT 1 FROM PurchaseRequirement r WHERE r.orderId=o.id))
        AND (instr(lower(o.id),lower(${query}))>0 OR EXISTS(SELECT 1 FROM PurchaseOrder p WHERE p.orderId=o.id AND instr(lower(p.id),lower(${query}))>0))
      ORDER BY o.createdAt DESC,o.id LIMIT 100`;
    return NextResponse.json({ permissions, orders: rows.map(r => ({...r,prepared:Number(r.prepared),purchases:Number(r.purchases)})) });
  } catch (e) { return failure(e); }
}

const actionPermission = {
  approve:'purchases.approve',register_order:'purchases.write',record_payment:'purchases.pay',
  report_change:'purchases.write',resolve_change:'purchases.write',
} as const satisfies Record<PurchaseActionInput['action'],AdminPermissionKey>;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PurchaseError('无效的采购请求',400);
    const draft = body.action === 'prepare' || body.action === 'save_line';
    if (!draft && !Object.hasOwn(actionPermission,body.action)) throw new PurchaseError('无法识别的采购动作',400);
    const action = body.action as PurchaseActionInput['action'];
    const perm = draft ? 'purchases.write' : actionPermission[action];
    const user = await requireAdmin(perm,{ skipStepUp:true });
    if (user instanceof NextResponse) return user;
    const permissions = await getAdminPermissions(user);
    if (!permissions.includes('purchases.read')) return NextResponse.json({error:'Forbidden'},{status:403});
    const orderId = requiredText(body.orderId,'原订单编号');
    if (body.action === 'prepare') return NextResponse.json({ workspace: await prisma.$transaction(tx => prepareOrderPurchases(tx,orderId,user), { isolationLevel:'Serializable' }) });
    if (body.action === 'save_line') {
      if (!Number.isSafeInteger(body.revision)) throw new PurchaseError('请重新加载采购行版本',409);
      const terms = normalizePurchaseTerms(body.terms);
      const orderItemId = requiredText(body.orderItemId,'原订单行编号');
      return NextResponse.json({ workspace: await prisma.$transaction(tx => savePurchaseLine(tx,{orderId,orderItemId,revision:body.revision,terms},user),{isolationLevel:'Serializable'}) });
    }
    const input:PurchaseActionInput = {
      orderId, purchaseOrderId:requiredText(body.purchaseOrderId,'采购单号'), action,
      version:requiredText(body.version,'采购内容版本'), requestId:requiredText(body.requestId,'操作编号'),
      actionHash:body.actionHash,reference:body.reference, amountCents:body.amountCents, conditionReference:body.conditionReference,
      changeKind:body.changeKind,description:body.description,outcome:body.outcome,supplierReference:body.supplierReference,
      customerReference:body.customerReference,revisedTerms:body.revisedTerms,
    };
    if (body.stage === 'preview') return NextResponse.json({ preview:await prisma.$transaction(tx => previewPurchaseAction(tx,input,user)) });
    if (body.stage !== 'confirm' || !/^[a-f0-9]{64}$/.test(input.actionHash ?? '')) throw new PurchaseError('请先查看完整操作预览');
    const token = extractStepUpToken(body);
    if (!token || !user.sessionId || !await consumeSecurityStepUpGrant(token,{userId:user.id,sessionId:user.sessionId,action:'admin_sensitive'})) {
      return NextResponse.json({error:'Admin MFA required'},{status:403});
    }
    return NextResponse.json({workspace:await prisma.$transaction(tx => applyPurchaseAction(tx,input,user),{isolationLevel:'Serializable'})});
  } catch (e) { return failure(e); }
}
