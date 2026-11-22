import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getAdminPermissions } from '@/lib/session';
import { consumeAdminOrderStepUp, extractStepUpToken } from '@/lib/admin-order-step-up';
import { prisma } from '@/lib/prisma';
import { dispatchParcel, fulfillmentWorkspace, previewDispatchParcel, previewParcelEvent, recordParcelEvent } from '@/lib/fulfillment-parcels';
import { reviewCarrierMatch } from '@/lib/fulfillment-carrier';
import { linkLegacyShipment } from '@/lib/fulfillment-legacy';
import { reviewLegacyInventory } from '@/lib/fulfillment-legacy-stock';
import { inputObject } from '@/lib/fulfillment-records';
import { PurchaseError, purchaseTimestamp, requiredText } from '@/lib/purchase-terms';
import { isPriceAdjustmentApprovalHash } from '@/lib/pricing-adjustment-approval';

type Context = { params: Promise<{ id: string }> };

function failure(error: unknown) {
  if (error instanceof PurchaseError) return NextResponse.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : '';
  if (['SHIPMENT_QUANTITY_EXCEEDED','SHIPMENT_ITEMS_REQUIRED','INVALID_SHIPMENT_QUANTITY','ORDER_ITEM_NOT_FOUND'].includes(message)) {
    return NextResponse.json({ error: '请核对原订单行和已经发出或在途的数量' }, { status: 409 });
  }
  if (['P2002','P2034','P2025'].includes((error as { code?: string })?.code ?? '') ||
    /INVENTORY_RELEASE_CONFLICT|INVENTORY_RESERVATION_|INSUFFICIENT_|实收|批次的可转发数量/.test(message)) {
    return NextResponse.json({ error: '库存、包裹或来源记录已变化，请刷新后重新核对' }, { status: 409 });
  }
  console.error('[order fulfillment]', error instanceof Error ? error.name : 'request failed');
  return NextResponse.json({ error: '物流记录暂时无法处理' }, { status: 500 });
}

export async function GET(req: NextRequest, { params }: Context) {
  const user = await requireAdmin('orders.read');
  if (user instanceof NextResponse) return user;
  try {
    const { id } = await params;
    const actual = req.nextUrl.searchParams.get('dispatchAt');
    const dispatchedAt = actual===null ? undefined : Date.parse(purchaseTimestamp(actual,'实际发运时间'));
    if (dispatchedAt!==undefined && dispatchedAt>Date.now()) throw new PurchaseError('实际发运时间不能晚于今天的登记时间',400);
    const workspace = await prisma.$transaction(tx => fulfillmentWorkspace(tx,id,dispatchedAt));
    const permissions = await getAdminPermissions(user);
    return NextResponse.json({ workspace, capabilities: { warehouse: permissions.includes('inventory.write'),
      shortfall: permissions.includes('purchases.approve') } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return failure(error); }
}

export async function POST(req: NextRequest, { params }: Context) {
  const user = await requireAdmin('orders.write', { skipStepUp: true });
  if (user instanceof NextResponse) return user;
  const permissions = await getAdminPermissions(user);
  if (!permissions.includes('orders.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const { id } = await params;
    const body = inputObject(await req.json().catch(() => null));
    const action = requiredText(body.action, '物流操作');
    const input = inputObject(body.input);
    const actor = { id: user.id, email: user.email };
    if (!['dispatch','record_event','link_legacy','match_notice','reconcile_legacy_inventory'].includes(action)) throw new PurchaseError('无法识别物流操作',400);
    if (action === 'reconcile_legacy_inventory' && !permissions.includes('inventory.write')) throw new PurchaseError('历史库存须由有库存权限的经办人核对',403);
    if (action === 'record_event') {
      const shortfall = input.kind === 'confirm_shortfall';
      const stock = input.kind === 'warehouse_receipt' || input.kind === 'dispose_receipt'
        || (shortfall && Array.isArray(input.lines) && input.lines.some(line => line?.receiptId));
      if (stock && !permissions.includes('inventory.write')) throw new PurchaseError('办理本仓实物须有库存经办权限',403);
      if (shortfall && !permissions.includes('purchases.approve')) throw new PurchaseError('确认可补发的实际短失或退回须有采购审批权限',403);
    }
    const parcelId = action === 'record_event' ? requiredText(input.parcelId,'包裹编号') : '';
    if (body.stage === 'preview') {
      const preview = await prisma.$transaction(async tx => {
        if (action === 'dispatch') return previewDispatchParcel(tx,id,input,actor);
        if (action === 'record_event') return previewParcelEvent(tx,id,parcelId,input,actor);
        if (action === 'link_legacy') return linkLegacyShipment(tx,id,input,actor);
        if (action === 'reconcile_legacy_inventory') return reviewLegacyInventory(tx,id,input,actor);
        return reviewCarrierMatch(tx,id,input,actor);
      });
      return NextResponse.json({ preview });
    }
    const hash = body.actionHash;
    if (body.stage !== 'confirm' || !isPriceAdjustmentApprovalHash(hash)) throw new PurchaseError('请先预览本次实际办理内容');
    const token = extractStepUpToken(body);
    if (!token) return NextResponse.json({ error: 'Admin MFA required' }, { status: 403 });
    const denied = await consumeAdminOrderStepUp(user,token);
    if (denied) return denied;
    await prisma.$transaction(async tx => {
      if (action === 'dispatch') await dispatchParcel(tx,id,input,actor,hash);
      else if (action === 'record_event') await recordParcelEvent(tx,id,parcelId,input,actor,hash);
      else if (action === 'link_legacy') await linkLegacyShipment(tx,id,input,actor,hash);
      else if (action === 'reconcile_legacy_inventory') await reviewLegacyInventory(tx,id,input,actor,hash);
      else await reviewCarrierMatch(tx,id,input,actor,hash);
    }, { isolationLevel: 'Serializable' });
    return NextResponse.json({ applied: true });
  } catch (error) { return failure(error); }
}
