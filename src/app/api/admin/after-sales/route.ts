import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { afterSaleAction } from '@/lib/after-sale-actions';
import { refundPosition, refundTerms } from '@/lib/after-sale-refunds';
import { saleInput, salePermission } from '@/lib/after-sale-records';
import { afterSaleAdminView, afterSaleWorkspace } from '@/lib/after-sale-workspace';
import { extractStepUpToken } from '@/lib/admin-order-step-up';
import { isPriceAdjustmentApprovalHash, pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { PurchaseError } from '@/lib/purchase-terms';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';
import { getAdminPermissions, requireAdmin } from '@/lib/session';

function failure(error: unknown) {
  if (error instanceof PurchaseError) return NextResponse.json({error:error.message},{status:error.status});
  const code=(error as {code?:string})?.code;
  if (['P2002','P2034','P2025'].includes(code ?? '')) return NextResponse.json({error:'原业务已更新，请核对后重试'},{status:409});
  if (error instanceof Error && error.message === '未找到原客户订单') return NextResponse.json({error:'找不到原订单'},{status:404});
  console.error('[after-sales]',error instanceof Error ? error.name : 'unknown');
  return NextResponse.json({error:'无法办理本次售后，请保留原凭据'},{status:500});
}
export async function GET(req: NextRequest) {
  try {
    const user=await requireAdmin('admin.access');
    if (user instanceof NextResponse) return user;
    const permissions=await getAdminPermissions(user);
    if (!['orders.read','purchases.read','finance.read'].some(key=>permissions.some(entry=>entry===key))) return NextResponse.json({error:'需要订单、采购或财务查看权限'},{status:403});
    const id=req.nextUrl.searchParams.get('orderId')?.trim();
    if (id) {
      const workspace=await prisma.$transaction(async tx=>{
        const view=await afterSaleWorkspace(tx,id);
        const screen=afterSaleAdminView(view,permissions);
        const refundDrafts=permissions.includes('finance.read') ? await Promise.all(view.cases
          .filter(row=>['awaiting_refund','refund_prepared','refund_approved'].includes(row.customerState))
          .map(async row=>({caseId:row.id,terms:refundTerms(row),position:await refundPosition(tx,view,row)}))) : [];
        return {...screen,refundDrafts};
      });
      return NextResponse.json({workspace,permissions},{headers:{'Cache-Control':'private, no-store'}});
    }
    const search=req.nextUrl.searchParams.get('search')?.trim();
    const pending=req.nextUrl.searchParams.get('pending')==='1';
    const cases=await prisma.afterSaleCase.findMany({where:{
      ...(search ? { OR:[{id:{contains:search}},{orderId:{contains:search}},{item:{name:{contains:search}}}] } : {}),
      ...(pending ? { NOT:{customerState:'closed',supplierState:{in:['resolved','no_claim']}} } : {}),
    },select:{id:true,orderId:true,quantity:true,issue:true,ownerId:true,customerState:true,supplierState:true,item:{select:{name:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100});
    const sourceSearch = search ? Prisma.sql`AND (instr(lower(p.orderId),lower(${search}))>0 OR instr(lower(i.name),lower(${search}))>0 OR instr(lower(e.reference),lower(${search}))>0)` : Prisma.empty;
    const sourceRows=await prisma.$queryRaw<{id:string;orderId:string;orderItemId:string;name:string;reference:string;remaining:bigint}[]>`
      SELECT r.id,p.orderId,l.orderItemId,i.name,e.reference,r.quantity-COALESCE(SUM(c.quantity),0) AS remaining
      FROM FulfillmentLineResolution r JOIN FulfillmentParcelLine l ON l.id=r.parcelLineId
      JOIN FulfillmentParcel p ON p.id=l.parcelId JOIN FulfillmentEvent e ON e.id=r.eventId AND e.parcelId=p.id
      JOIN OrderItem i ON i.id=l.orderItemId AND i.orderId=p.orderId LEFT JOIN AfterSaleCase c ON c.shortfallId=r.id
      WHERE e.status='applied' AND l.purchaseOrderId IS NOT NULL AND r.kind IN ('loss','shortage','return')
      ${sourceSearch} GROUP BY r.id HAVING remaining>0 ORDER BY e.occurredAt DESC,r.id LIMIT 100`;
    return NextResponse.json({cases,unassigned:sourceRows.map(item=>({...item,remaining:Number(item.remaining)})),permissions},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return failure(error); }
}

export async function POST(req: NextRequest) {
  try {
    const body=await req.json().catch(()=>null);
    if (!body || typeof body.orderId!=='string') throw new PurchaseError('请填写原订单和办理内容',400);
    const input=saleInput(body.orderId,body);
    const permission=salePermission(input);
    const user=await requireAdmin(permission,{skipStepUp:true});
    if (user instanceof NextResponse) return user;
    const permissions=await getAdminPermissions(user);
    const requiredRead=permission.startsWith('purchases.')?'purchases.read':permission.startsWith('finance.')?'finance.read':'orders.read';
    if (!permissions.includes(requiredRead) || !permissions.includes('admin.access')) return NextResponse.json({error:'缺少该业务的查看权限'},{status:403});
    const actor={id:user.id,email:user.email};
    if (body.stage==='preview') {
      return NextResponse.json({preview:await prisma.$transaction(tx=>afterSaleAction(tx,input,actor))});
    }
    if (body.stage!=='confirm'||!isPriceAdjustmentApprovalHash(body.actionHash)) throw new PurchaseError('请先核对本次完整预览');
    const token=extractStepUpToken(body);
    if (!token || !user.sessionId || !await consumeSecurityStepUpGrant(token,{userId:user.id,sessionId:user.sessionId,action:'admin_sensitive'})) {
      return NextResponse.json({error:'Admin MFA required'},{status:403});
    }
    const authorization={permission,verifiedAt:new Date().toISOString(),sessionFingerprint:pricingContentHash({userId:user.id,sessionId:user.sessionId})};
    const result=await prisma.$transaction(tx=>afterSaleAction(tx,input,actor,{hash:body.actionHash,authorization}),{isolationLevel:'Serializable'});
    return NextResponse.json({applied:true,caseId:result.caseId,eventId:result.eventId,repeated:result.repeated});
  } catch(error) { return failure(error); }
}
