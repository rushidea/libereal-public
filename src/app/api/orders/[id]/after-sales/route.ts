import { NextRequest, NextResponse } from 'next/server';
import { afterSaleAction } from '@/lib/after-sale-actions';
import { afterSaleCustomerView } from '@/lib/after-sale-workspace';
import { afterSaleIssues, hasChoice } from '@/lib/after-sale-options';
import { saleInput } from '@/lib/after-sale-records';
import { customerCanReadOrder } from '@/lib/customer-order-access';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';
import { requireActiveSession } from '@/lib/session';

type Context = { params: Promise<{ id: string }> };
async function access(id: string) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const order = await prisma.order.findUnique({ where: {id}, select: { ownerScope: true, organizationId: true, customerId: true, email: true } });
  if (!order || !await customerCanReadOrder(user.id, order)) return NextResponse.json({ error: '找不到可访问的订单' },{status:404});
  return user;
}
function failure(error: unknown) {
  if (error instanceof PurchaseError) return NextResponse.json({error:error.message},{status:error.status});
  if (['P2034','P2002'].includes((error as {code?:string})?.code ?? '')) return NextResponse.json({error:'记录已更新，请从订单查看原请求'},{status:409});
  console.error('[customer after-sales]', error instanceof Error ? error.name : 'unknown');
  return NextResponse.json({error:'暂时无法读取售后，请稍后重试'},{status:500});
}
export async function GET(_req: NextRequest, {params}: Context) {
  try {
    const {id}=await params; const user=await access(id);
    if (user instanceof NextResponse) return user;
    return NextResponse.json({ cases: await afterSaleCustomerView(prisma,id) },{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) { return failure(error); }
}
export async function POST(req: NextRequest, {params}: Context) {
  try {
    const {id}=await params; const user=await access(id);
    if (user instanceof NextResponse) return user;
    const body=await req.json().catch(() => null);
    if (!body || !hasChoice(afterSaleIssues,body.issue)) throw new PurchaseError('请选择售后问题',400);
    const requestId=requiredText(body.requestId,'提交编号');
    const reportedAt=purchaseTimestamp(body.occurredAt,'报告时间');
    const accepted={orderItemId:requiredText(body.orderItemId,'原商品行'),quantity:body.quantity,issue:body.issue,note:requiredText(body.note,'具体情况')};
    const evidence=pricingContentHash({orderId:id,userId:user.id,requestId,reportedAt,...accepted});
    const input=saleInput(id,{action:'open',requestId,data:{...accepted,channel:'account',occurredAt:reportedAt,reference:'客户订单页 '+requestId,sha256:evidence,documentRow:1}});
    const actor={id:user.id,email:user.email};
    const result=await prisma.$transaction(async tx => {
      const preview=await afterSaleAction(tx,input,actor,undefined,true);
      return afterSaleAction(tx,input,actor,{hash:preview.actionHash},true);
    },{isolationLevel:'Serializable'});
    return NextResponse.json({id:result.caseId,repeated:result.repeated});
  } catch(error) { return failure(error); }
}
