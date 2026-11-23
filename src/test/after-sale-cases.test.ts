import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as orderGET, PATCH as orderPATCH } from '@/app/api/admin/orders/[id]/route';
import { afterSaleAction } from '@/lib/after-sale-actions';
import { salePermission, type SaleInput } from '@/lib/after-sale-records';
import { afterSaleAdminView, afterSaleCustomerView, afterSaleWorkspace } from '@/lib/after-sale-workspace';
import { dispatchParcel, recordParcelEvent } from '@/lib/fulfillment-parcels';
import { receiveInventoryBatch } from '@/lib/inventory';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { applyPurchaseAction, previewPurchaseAction, purchaseWorkspace, savePurchaseLine } from '@/lib/purchase-orders';
import type { PurchaseTerms } from '@/lib/purchase-terms';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

const merchant = { id: 'office-merchant', email: 'office-merchant@example.invalid' };
const operator = { id: 'office-after-sale', email: 'office-after-sale@example.invalid' };
const procurement = { id: 'office-procurement', email: 'office-procurement@example.invalid' };
const customer = { id: 'office-customer', email: 'office-customer@example.invalid' };
const orderId = 'AFTER-SALE-OFFICE-ORDER';
const itemId = 'AFTER-SALE-FOLDER-LINE';
const otherOrderId = 'AFTER-SALE-OTHER-ORDER';
const otherItemId = 'AFTER-SALE-OTHER-LINE';
const productId = 'office-folder';
const description = '合成 A4 文件夹业务凭据';

vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'office-merchant', email: 'office-merchant@example.invalid', role: 'admin', sessionId: 'office-session' },
  }),
}));
vi.mock('@/lib/admin-mfa-settings', () => ({
  requiresAdminMfaForPermission: async () => false,
  isAdminMfaScenarioEnabled: async () => false,
}));

function occurredAt() {
  vi.setSystemTime(Date.now() + 1000);
  return new Date().toISOString();
}

function proof(reference: string) {
  return { reference, sha256: pricingContentHash({ reference }), documentRow: 1, occurredAt: occurredAt() };
}

function saleInput(action: SaleInput['action'], requestId: string, data: SaleInput['data'] = {}, caseId = ''): SaleInput {
  return { orderId, caseId, action, requestId, data: { ...proof(requestId), note: description, ...data } };
}

function preview(input: SaleInput, actor = operator, requester = false) {
  return prisma.$transaction(tx => afterSaleAction(tx, input, actor, undefined, requester));
}

function confirm(input: SaleInput, hash: string, actor = operator, permission = salePermission(input)) {
  return prisma.$transaction(tx => afterSaleAction(tx, input, actor, {
    hash, authorization: { permission, sessionFingerprint: pricingContentHash({ id: actor.id }), verifiedAt: occurredAt() },
  }), { isolationLevel: 'Serializable' });
}

async function record(input: SaleInput, actor = operator) {
  const draft = await preview(input, actor);
  return confirm(input, draft.actionHash, actor);
}

function readWorkspace() {
  return prisma.$transaction(tx => afterSaleWorkspace(tx, orderId));
}

async function acceptOrder() {
  const url = 'http://localhost/api/admin/orders/' + orderId;
  const params = Promise.resolve({ id: orderId });
  const read = await orderGET(new NextRequest(url), { params });
  expect(read.status).toBe(200);
  const { order } = await read.json();
  const result = await orderPATCH(new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'confirmed', action: 'accept_order', approvalVersion: order.approvalPreview.version }),
  }), { params });
  expect(result.status, JSON.stringify(await result.json())).toBe(200);
}

type PurchaseInput = Omit<Parameters<typeof previewPurchaseAction>[1], 'orderId' | 'purchaseOrderId' | 'version'>;

function purchaseAction(purchaseOrderId: string, input: PurchaseInput) {
  return prisma.$transaction(async tx => {
    const purchase = (await purchaseWorkspace(tx, orderId)).orders.find(row => row.id === purchaseOrderId);
    if (!purchase) throw new Error('缺少合成办公用品采购单');
    const action = { ...input, orderId, purchaseOrderId, version: purchase.version };
    const draft = await previewPurchaseAction(tx, action, procurement);
    return applyPurchaseAction(tx, { ...action, actionHash: draft.actionHash }, procurement);
  });
}

async function registerSupplierOrder() {
  const terms: PurchaseTerms = {
    supplier: '合成办公供方', writtenSupplier: '合成办公供方', payee: '合成供方账号',
    paymentTerms: '按书面条件结算', unitPriceCents: 1375, linePayableCents: 2750,
    currency: 'CNY', taxBasis: 'included', freightTerms: '含运费', supplierConditions: description,
    leadTime: '3 个工作日', validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
    sourceReference: 'OFFICE-SUPPLIER-QUOTE', sourceSha256: pricingContentHash('OFFICE-SUPPLIER-QUOTE'),
    settlementReference: 'OFFICE-SUPPLIER-TERMS', settlementSha256: pricingContentHash('OFFICE-SUPPLIER-TERMS'),
    coordinationReference: 'OFFICE-SUPPLIER-COORDINATION', leadTimeAssessment: 'within_agreement',
  };
  const purchaseOrderId = await prisma.$transaction(async tx => {
    const source = (await purchaseWorkspace(tx, orderId)).lines.find(row => row.orderItemId === itemId);
    if (!source) throw new Error('缺少原办公用品订单行');
    await savePurchaseLine(tx, { orderId, orderItemId: itemId, revision: source.revision, terms, checkedEvidence: true }, operator);
    return (await purchaseWorkspace(tx, orderId)).orders[0].id;
  });
  await purchaseAction(purchaseOrderId, { action: 'approve', requestId: 'approve-office-supplier' });
  const placed = proof('OFFICE-ORDER-RECEIPT');
  await purchaseAction(purchaseOrderId, { action: 'register_order', requestId: 'register-office-supplier',
    reference: placed.reference, referenceSha256: placed.sha256, occurredAt: placed.occurredAt });
  return purchaseOrderId;
}

type Leg = 'supplier_to_customer' | 'supplier_to_libereal' | 'libereal_to_customer';

function dispatch(purchaseOrderId: string, reference: string, route: Leg, source: { resendApprovalId?: string; resendShortfallId?: string; sourceReceiptId?: string; afterSaleApprovalId?: string } = {}) {
  const input = { ...proof(reference), requestId: reference, route, trackingNumber: reference,
    carrier: '合成承运人', lines: [{ purchaseOrderId, orderItemId: itemId, quantity: 1, ...source }] };
  return prisma.$transaction(tx => dispatchParcel(tx, orderId, input, operator));
}

function parcelEvent(parcelId: string, reference: string, kind: string, lines: Record<string, unknown>[], extra = {}) {
  const input = { ...proof(reference), ...extra, requestId: reference, kind, description, lines };
  return prisma.$transaction(tx => recordParcelEvent(tx, orderId, parcelId, input, operator));
}

async function legacyShortfall() {
  await acceptOrder();
  const purchaseOrderId = await registerSupplierOrder();
  const original = await dispatch(purchaseOrderId, 'OFFICE-ORIGINAL-TRACK', 'supplier_to_libereal');
  const agreement = {
    supplierReference: 'OFFICE-SUPPLIER-DECISION', supplierSha256: pricingContentHash('OFFICE-SUPPLIER-DECISION'),
    customerReference: 'OFFICE-CUSTOMER-DECISION', customerSha256: pricingContentHash('OFFICE-CUSTOMER-DECISION'),
    description,
  };
  await parcelEvent(original.id, 'OFFICE-TRANSIT-LOSS', 'confirm_shortfall',
    [{ parcelLineId: original.lines[0].id, quantity: 1, outcome: 'loss' }], agreement);
  const loss = (await readWorkspace()).shortfalls[0];
  expect(loss).toMatchObject({ orderItemId: itemId, purchaseOrderId, quantity: 1, claimed: 0, reference: 'OFFICE-TRANSIT-LOSS' });
  await purchaseAction(purchaseOrderId, { action: 'report_change', requestId: 'report-office-loss', changeKind: 'other',
    reference: loss.reference, description });
  const decided = await purchaseAction(purchaseOrderId, { action: 'resolve_change', outcome: 'shortfall', requestId: 'approve-office-free-resend',
    ...agreement, confirmsFullIncidentScope: true, dispositions: [{ orderItemId: itemId, quantity: 1, outcome: 'cancel',
      shortfallId: loss.resolutionId, shortfallDecision: 'free_resend' }] });
  const [approval] = decided.fulfillment.freeResends;
  expect(approval).toMatchObject({ shortfallId: loss.resolutionId, dispatched: 0, available: 1 });
  const report = { orderItemId: itemId, quantity: 1, issue: 'shortage', channel: 'fulfillment', shortfallId: loss.resolutionId,
    occurredAt: loss.occurredAt, reference: loss.reference, sha256: loss.sha256, documentRow: loss.documentRow };
  return { purchaseOrderId, original, approval, report };
}

afterAll(() => closeTestDb());

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date());
  const db = getTestDb();
  clearAllTables(db);
  for (const actor of [merchant, operator, procurement]) seedAdmin(db, actor.id, actor.email);
  seedUser(db, customer);
  await prisma.creditAccount.create({ data: { userId: customer.id, baseLimit: 10000, paymentTermDays: 30 } });
  await prisma.product.create({ data: { id: productId, name: '合成 A4 文件夹', catalogNumber: 'OFFICE-FOLDER',
    brand: '合成办公品牌', price: 100, stockQuantity: -1 } });
  await prisma.$transaction(tx => receiveInventoryBatch(tx, { productId, batchNumber: 'OFFICE-EXISTING-LOT', quantity: 8, actorId: operator.id }));
  await prisma.order.create({ data: {
    id: orderId, customerId: customer.id, email: customer.email, status: 'pending', paymentMethod: 'bank_transfer', subtotal: 200, total: 200,
    orderItems: { create: { id: itemId, position: 0, productId, catalogNumber: 'OFFICE-FOLDER', name: '合成 A4 文件夹', unitPrice: 100, quantity: 2 } },
  } });
  await prisma.order.create({ data: {
    id: otherOrderId, customerId: customer.id, email: customer.email, status: 'pending', subtotal: 40, total: 40,
    orderItems: { create: { id: otherItemId, position: 0, name: '合成另一单标签纸', unitPrice: 40, quantity: 1 } },
  } });
});
afterEach(() => vi.useRealTimers());

describe('售后沿用原订单和短失事实', () => {
  async function signedOriginalPair() {
    await acceptOrder();
    const purchaseOrderId=await registerSupplierOrder();
    const first=await dispatch(purchaseOrderId,'OFFICE-ORIGINAL-FIRST','supplier_to_customer');
    const second=await dispatch(purchaseOrderId,'OFFICE-ORIGINAL-SECOND','supplier_to_customer');
    await parcelEvent(first.id,'OFFICE-FIRST-SIGNATURE','customer_delivery',[{parcelLineId:first.lines[0].id,quantity:1}]);
    await parcelEvent(second.id,'OFFICE-SECOND-SIGNATURE','customer_delivery',[{parcelLineId:second.lines[0].id,quantity:1}]);
    return {purchaseOrderId,first,second};
  }

  it.each(['supplier_to_customer','supplier_to_libereal'] as const)('免退质量换货从真实供货到实际签收（%s）',async route=>{
    const {purchaseOrderId,first}=await signedOriginalPair();
    const firstId=first.lines[0].id;
    const originalMoney=await prisma.accountReceivable.findUniqueOrThrow({where:{orderId}});
    const open=await record(saleInput('open','open-quality-case',{orderItemId:itemId,quantity:1,issue:'quality',channel:'email',originalParcelLineId:firstId}));
    const caseId=open.caseId!;
    await record(saleInput('claim','own-quality-case',{},caseId));
    await expect(preview(saleInput('agreement','bad-early-quality-decision',{remedy:'exchange',customerDecision:'免退换货',returnRequirement:'waived'},caseId)))
      .rejects.toThrow('技术意见');
    await record(saleInput('technical','actual-brand-conclusion',{authority:'brand',party:'合成办公品牌',contact:'具名产品顾问'},caseId));
    await record(saleInput('agreement','customer-free-exchange-no-return',{remedy:'exchange',customerDecision:'合成原件指明原包裹、原货、免费换货且免退',returnRequirement:'waived'},caseId));
    const approve=saleInput('approve_exchange','supplier-free-exchange-contract',{supplier:'合成办公供方',freeOfCharge:true,returnRequirement:'waived'},caseId);
    await expect(preview({...approve,data:{...approve.data,returnRequirement:'required'}},procurement)).rejects.toThrow('与客户一致');
    const intended=await preview(approve,procurement);
    await expect(confirm(approve,intended.actionHash,procurement,'purchases.write')).rejects.toThrow('权限');
    const accepted=await confirm(approve,intended.actionHash,procurement);
    const id=accepted.eventId!;
    let customer=await dispatch(purchaseOrderId,'OFFICE-EXCHANGE-DISPATCH',route,{afterSaleApprovalId:id});
    expect(customer.lines[0].afterSaleApprovalId).toBe(id);
    if(route==='supplier_to_libereal'){
      await parcelEvent(customer.id,'OFFICE-EXCHANGE-AT-WAREHOUSE','warehouse_receipt',
        [{parcelLineId:customer.lines[0].id,quantity:1,batchNumber:'OFFICE-EXCHANGE-LOT'}]);
      const stock=await prisma.fulfillmentReceipt.findFirstOrThrow({where:{parcelLineId:customer.lines[0].id}});
      customer=await dispatch(purchaseOrderId,'OFFICE-EXCHANGE-FORWARD','libereal_to_customer',{sourceReceiptId:stock.id});
      expect(customer.lines[0].afterSaleApprovalId).toBe(id);
    }
    const received=(parcelLineId:string)=>saleInput('physical','approved-exchange-delivered',{result:'delivery',quantity:1,parcelLineId},caseId);
    await expect(preview(received(firstId))).rejects.toThrow('补件');
    await expect(preview(received(customer.lines[0].id))).rejects.toThrow('客户实际签收');
    await parcelEvent(customer.id,'OFFICE-EXCHANGE-CUSTOMER-SIGNATURE','customer_delivery',[{parcelLineId:customer.lines[0].id,quantity:1}]);
    expect((await record(received(customer.lines[0].id))).snapshot).toMatchObject({nextState:'awaiting_close',
      operation:{afterSaleApprovalId:id,parcelLineId:customer.lines[0].id}});
    expect(await prisma.order.findUniqueOrThrow({where:{id:orderId}})).toMatchObject({status:'completed'});
    expect(await prisma.orderItem.findUniqueOrThrow({where:{id:itemId}})).toMatchObject({shippedQty:2});
    expect(await prisma.shipmentItem.count({where:{orderItemId:itemId}})).toBe(2);
    expect(await prisma.accountReceivable.findUniqueOrThrow({where:{orderId}})).toEqual(originalMoney);
  });

  it('仅用原指定包裹的真实已退商品另议退款，晚录旧决定留痕但不生效',async()=>{
    const {first,second}=await signedOriginalPair();
    const open=await record(saleInput('open','open-pinned-return',{orderItemId:itemId,quantity:1,issue:'return',channel:'email',originalParcelLineId:first.lines[0].id}));
    await record(saleInput('claim','claim-pinned-return',{},open.caseId!));
    const old=proof('original-older-message');
    const earlier=await record(saleInput('agreement','written-return-choice',{remedy:'return',customerDecision:'客户同意退回第一包对应商品'},open.caseId!));
    for(const parcel of [second,first]) await parcelEvent(parcel.id,'ACTUAL-RETURN-'+parcel.id,'confirm_shortfall',
      [{parcelLineId:parcel.lines[0].id,quantity:1,outcome:'return'}], {
        supplierReference:'OFFICE-IGINAL-ACTUAL-RETURN-SUPPLIER',supplierSha256:pricingContentHash('OFFICE-IGINAL-ACTUAL-RETURN-SUPPLIER'),
        customerReference:'OFFICE-ORIGINAL-ACTUAL-RETURN-CUSTOMER',customerSha256:pricingContentHash('OFFICE-ORIGINAL-ACTUAL-RETURN-CUSTOMER'),
      });
    const result=async (parcelLineId:string)=>saleInput('physical','attribute-return-'+parcelLineId,{result:'return',quantity:1,parcelLineId,
      resolutionId:(await prisma.fulfillmentLineResolution.findFirstOrThrow({where:{parcelLineId,kind:'return'}})).id},open.caseId!);
    await expect(preview(await result(second.lines[0].id))).rejects.toThrow('本案指定');
    const returned=await record(await result(first.lines[0].id));
    const newTerms={remedy:'refund',amountCents:3000,recipient:'合成客户',destination:'核实合成账号',method:'bank',
      customerDecision:'客户书面同意仅按原退回的一件核对退款',revisesAgreementId:earlier.eventId};
    expect((await record(saleInput('agreement','new-terms-after-actual-return',newTerms,open.caseId!))).snapshot).toMatchObject({
      nextState:'awaiting_refund',operation:{refundQuantity:1,originalReturns:[returned.eventId]}});
    const backfill=await record(saleInput('agreement','late-earlier-irrelevant-message',{...old,remedy:'keep',customerDecision:'旧来函请暂留商品'},open.caseId!));
    expect(backfill.snapshot).toMatchObject({nextState:'awaiting_refund',operation:{historical:true}});
    expect(await prisma.afterSaleEvent.count({where:{caseId:open.caseId!,action:'physical'}})).toBe(1);
    expect(await prisma.afterSaleEvent.count({where:{caseId:open.caseId!,action:'refund_result'}})).toBe(0);
  });

  it('一份批准下同一货号的两条短失各用实际归属，旧运单缺项时可具名补核',async()=>{
    await acceptOrder();
    const purchaseOrderId=await registerSupplierOrder();
    const terms={
      supplierReference:'SUPPLIER-TWO-SEPARATE-LOSS-LINES',supplierSha256:pricingContentHash('SUPPLIER-TWO-SEPARATE-LOSS-LINES'),
      customerReference:'CUSTOMER-TWO-SEPARATE-LOSS-LINES',customerSha256:pricingContentHash('CUSTOMER-TWO-SEPARATE-LOSS-LINES'),description,
    };
    for(const tag of ['A','B']){
      const sent=await dispatch(purchaseOrderId,'OFFICE-SEPARATE-PARCEL-'+tag,'supplier_to_libereal');
      await parcelEvent(sent.id,'OFFICE-REAL-LOSS-'+tag,'confirm_shortfall',[{parcelLineId:sent.lines[0].id,quantity:1,outcome:'loss'}],terms);
    }
    const losses=(await readWorkspace()).shortfalls;
    await purchaseAction(purchaseOrderId,{action:'report_change',requestId:'two-confirmed-real-losses',changeKind:'other',reference:'OFFICE-TWO-LOSSES',description});
    const approved=await purchaseAction(purchaseOrderId,{action:'resolve_change',requestId:'approve-one-document-two-goods-sources',
      outcome:'shortfall',confirmsFullIncidentScope:true,...terms,
      dispositions:losses.map((loss,index)=>({orderItemId:itemId,quantity:1,outcome:'cancel',shortfallId:loss.resolutionId,
        shortfallDecision:'free_resend',supplierDocumentRow:index+1,customerDocumentRow:index+1}))});
    const approvalId=approved.fulfillment.freeResends[0].approvalId;
    expect(approved.fulfillment.freeResends).toHaveLength(2);
    await expect(dispatch(purchaseOrderId,'OFFICE-FREE-AMBIGUOUS-BAD','supplier_to_customer',{resendApprovalId:approvalId})).rejects.toThrow('实际短失');
    const second=await dispatch(purchaseOrderId,'OFFICE-SECOND-ASSIGNED-RESEND','supplier_to_customer',{
      resendApprovalId:approvalId,resendShortfallId:losses[1].resolutionId});
    // This is the pre-change dispatch shape, with the original verified movement intact.
    const event=second.events.find(item=>item.kind==='dispatch')!;
    const historical=JSON.parse(event.details);
    delete historical.lines[0].resendShortfallId;
    await prisma.fulfillmentEvent.update({where:{id:event.id},data:{details:JSON.stringify(historical)}});
    await parcelEvent(second.id,'OFFICE-SECOND-RESEND-SIGNED','customer_delivery',[{parcelLineId:second.lines[0].id,quantity:1}]);
    const cases=[];
    for(const loss of losses){
      const opened=await record(saleInput('open','open-real-loss-'+loss.resolutionId,{orderItemId:itemId,quantity:1,issue:'shortage',
        channel:'fulfillment',shortfallId:loss.resolutionId,occurredAt:loss.occurredAt,reference:loss.reference,sha256:loss.sha256,documentRow:loss.documentRow}));
      await record(saleInput('claim','own-real-loss-'+loss.resolutionId,{},opened.caseId!));
      cases.push(opened.caseId!);
    }
    const delivery=(caseId:string)=>saleInput('physical','link-signed-piece-'+caseId,{result:'delivery',quantity:1,parcelLineId:second.lines[0].id,
      resendApprovalId:approvalId},caseId);
    await expect(preview(delivery(cases[1]))).rejects.toThrow('归行');
    const verify=(caseId:string)=>saleInput('attribute_resend','assign-real-piece-'+caseId,
      {parcelLineId:second.lines[0].id,approvalId,quantity:1},caseId);
    await record(verify(cases[1]),procurement);
    await expect(preview(verify(cases[0]),procurement)).rejects.toThrow('尚未核对的实际件数');
    await expect(preview(delivery(cases[0]))).rejects.toThrow('归行');
    expect((await record(delivery(cases[1]))).snapshot).toMatchObject({nextState:'awaiting_close'});
    const first=await dispatch(purchaseOrderId,'OFFICE-FIRST-FINALLY-SENT','supplier_to_customer',{
      resendApprovalId:approvalId,resendShortfallId:losses[0].resolutionId});
    expect(first.lines[0].quantity).toBe(1);
    expect((await readWorkspace()).shortfalls.map(loss=>loss.approved[0].dispatched)).toEqual([1,1]);
  });

  it('用已单独批准的真实有偿补采购和客户签收接续旧短失',async()=>{
    await acceptOrder();
    const purchaseOrderId=await registerSupplierOrder();
    const original=await dispatch(purchaseOrderId,'OFFICE-PARCEL-PRECEDING-PAID-REPLACEMENT','supplier_to_customer');
    const docs={
      supplierReference:'SUPPLIER-PAID-REPLACEMENT-DECISION',supplierSha256:pricingContentHash('SUPPLIER-PAID-REPLACEMENT-DECISION'),
      customerReference:'CUSTOMER-PAID-REPLACEMENT-DECISION',customerSha256:pricingContentHash('CUSTOMER-PAID-REPLACEMENT-DECISION'),description,
    };
    await parcelEvent(original.id,'OFFICE-SOURCE-LOSS','confirm_shortfall',[{parcelLineId:original.lines[0].id,quantity:1,outcome:'loss'}],docs);
    const loss=(await readWorkspace()).shortfalls[0];
    await purchaseAction(purchaseOrderId,{action:'report_change',requestId:'case-new-purchase-reported',changeKind:'other',reference:loss.reference,description});
    const current=(await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId))).orders.find(row=>row.id===purchaseOrderId)!;
    const terms={...current.lines[0].terms,unitPriceCents:1600,linePayableCents:1600,sourceReference:'REPLACEMENT-OFFICE-NEW-QUOTE',
      sourceSha256:pricingContentHash('REPLACEMENT-OFFICE-NEW-QUOTE'),settlementReference:'REPLACEMENT-OFFICE-NEW-SETTLEMENT',
      settlementSha256:pricingContentHash('REPLACEMENT-OFFICE-NEW-SETTLEMENT')};
    const prepared=await purchaseAction(purchaseOrderId,{action:'resolve_change',requestId:'case-new-purchase-agreed',
      outcome:'shortfall',confirmsFullIncidentScope:true,...docs,dispositions:[{orderItemId:itemId,quantity:1,outcome:'replace',
        shortfallId:loss.resolutionId,shortfallDecision:'new_purchase',replacement:{name:'合成采购替换件',brand:'合成办公品牌',
          catalogNumber:'OFFICE-PAID-REPLACEMENT',spec:'A4',unit:'件',terms}}]});
    const replacement=prepared.orders.find(row=>row.lines.some(line=>line.fromPurchaseOrderId===purchaseOrderId))!;
    const opened=await record(saleInput('open','open-proved-paid-replacement-case',{orderItemId:itemId,quantity:1,issue:'shortage',
      channel:'fulfillment',shortfallId:loss.resolutionId,occurredAt:loss.occurredAt,reference:loss.reference,sha256:loss.sha256,documentRow:loss.documentRow}));
    await record(saleInput('claim','claim-proved-paid-replacement-case',{},opened.caseId!));
    const agreed=saleInput('agreement','link-customer-confirmed-paid-replacement',{remedy:'resend',customerDecision:'书面确认由独立采购行补发',
      replacementPurchaseOrderId:replacement.id},opened.caseId!);
    await expect(preview(agreed)).rejects.toThrow('已有实际批准');
    await purchaseAction(replacement.id,{action:'approve',requestId:'approve-case-new-purchase-separately'});
    const placed=proof('OFFICE-NEW-REPLACEMENT-ORDER');
    await purchaseAction(replacement.id,{action:'register_order',requestId:'place-case-new-replacement',reference:placed.reference,
      referenceSha256:placed.sha256,occurredAt:placed.occurredAt});
    const decision=await record(agreed);
    expect(decision.snapshot).toMatchObject({operation:{replacement:{purchaseOrderId:replacement.id,shortfallId:loss.resolutionId}}});
    const shipped=await dispatch(replacement.id,'OFFICE-PAID-REPLACEMENT-WAYBILL','supplier_to_customer');
    await parcelEvent(shipped.id,'OFFICE-PAID-REPLACEMENT-SIGNATURE','customer_delivery',[{parcelLineId:shipped.lines[0].id,quantity:1}]);
    const physical=(parcelLineId:string)=>saleInput('physical','verify-actual-paid-replacement',{result:'delivery',quantity:1,parcelLineId},opened.caseId!);
    await expect(preview(physical(original.lines[0].id))).rejects.toThrow('归行');
    const result=await record(physical(shipped.lines[0].id));
    expect(result.snapshot).toMatchObject({nextState:'awaiting_close',operation:{replacement:{purchaseOrderId:replacement.id}}});
    const after=await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId));
    expect(after.orders.find(row=>row.id===purchaseOrderId)).toMatchObject({totalCents:2750,paidCents:0});
    expect(after.orders.find(row=>row.id===replacement.id)).toMatchObject({totalCents:1600,paidCents:0});
  });

  it('绑定旧短失的一件、实际补发签收及仍独立跟进的供方记录', async () => {
    const { purchaseOrderId, original, approval, report } = await legacyShortfall();
    const before = await prisma.accountReceivable.findUniqueOrThrow({ where: { orderId } });
    const prior = await prisma.purchaseActivity.findUniqueOrThrow({ where: { id: approval.approvalId } });
    await expect(preview(saleInput('open', 'wrong-order-line', { ...report, orderItemId: otherItemId }))).rejects.toThrow('原订单');
    await expect(preview(saleInput('open', 'too-many-units', { ...report, quantity: 2 }))).rejects.toThrow('短失');
    await expect(preview(saleInput('open', 'wrong-evidence-row', { ...report, documentRow: 2 }))).rejects.toThrow('凭据');
    const open = saleInput('open', 'open-original-shortage', { ...report, relatedCents: 10000 });
    const draft = await preview(open);
    expect(draft.snapshot).toMatchObject({ orderId, scopeQuantity: 1, item: { id: itemId, unitPrice: 100, quantity: 2 },
      proof: { reference: report.reference, sha256: report.sha256, documentRow: report.documentRow } });
    expect(await prisma.afterSaleCase.count()).toBe(0);
    await expect(confirm(open, draft.actionHash, operator, 'finance.write')).rejects.toThrow('权限');
    const created = await confirm(open, draft.actionHash);
    const caseId = created.caseId!;
    expect(await confirm(open, draft.actionHash)).toMatchObject({ caseId, eventId: created.eventId, repeated: true });
    await expect(confirm({ ...open, data: { ...open.data, relatedCents: 11000 } }, draft.actionHash)).rejects.toThrow('已用于其他内容');
    await expect(preview(saleInput('open', 'another-report-for-same-shortfall', { ...report, channel: 'handoff',
      ...proof('INDEPENDENT-REPORT-SAME-SHORTFALL') }))).rejects.toThrow('已关联足量');

    const claimed = await record(saleInput('claim', 'accept-original-shortfall-handoff', {}, caseId));
    expect(claimed.snapshot).toMatchObject({ nextState: 'awaiting_fulfillment', operation: { originalApprovals: [approval.approvalId] } });
    const supplier = await record(saleInput('supplier', 'supplier-investigation', {
      outcome: 'following', purchaseOrderId, supplier: '合成办公供方',
    }, caseId), procurement);
    expect(supplier.snapshot).toMatchObject({ nextState: 'awaiting_fulfillment', nextSupplierState: 'following' });
    const physical = (requestId: string, parcelLineId: string, units = 1) => saleInput('physical', requestId, {
      parcelLineId, result: 'delivery', quantity: units, resendApprovalId: approval.approvalId,
    }, caseId);
    await expect(preview(physical('try-original-inbound-waybill', original.lines[0].id))).rejects.toThrow('对客包裹');

    const duplicateSource = { ...proof('SAME-APPROVAL-TWICE-IN-ONE-PACKAGE'), requestId:'same-origin-twice', route:'supplier_to_customer',
      lines:[{ purchaseOrderId,orderItemId:itemId,quantity:1,resendApprovalId:approval.approvalId },
        { purchaseOrderId,orderItemId:itemId,quantity:1,resendApprovalId:approval.approvalId,resendShortfallId:report.shortfallId }] };
    await expect(prisma.$transaction(tx=>dispatchParcel(tx,orderId,duplicateSource,operator))).rejects.toThrow('重复消耗');
    const replacement = await dispatch(purchaseOrderId, 'OFFICE-REPLACEMENT-INBOUND', 'supplier_to_libereal', { resendApprovalId: approval.approvalId });
    await parcelEvent(replacement.id, 'OFFICE-ACTUAL-WAREHOUSE-RECEIPT', 'warehouse_receipt',
      [{ parcelLineId: replacement.lines[0].id, quantity: 1, batchNumber: 'OFFICE-SPECIFIC-REPLACEMENT-LOT' }]);
    const receipt = await prisma.fulfillmentReceipt.findFirstOrThrow({ where: { parcelLineId: replacement.lines[0].id } });
    await expect(preview(physical('warehouse-receipt-is-not-customer-delivery', replacement.lines[0].id))).rejects.toThrow('对客包裹');
    await expect(dispatch(purchaseOrderId, 'OFFICE-DUPLICATE-SUPPLIER-SEND', 'supplier_to_customer',
      { resendApprovalId: approval.approvalId })).rejects.toThrow(/重发|补发/);

    const forwarded = await dispatch(purchaseOrderId, 'OFFICE-REPLACEMENT-FORWARD', 'libereal_to_customer', { sourceReceiptId: receipt.id });
    await expect(preview(physical('before-customer-signature', forwarded.lines[0].id))).rejects.toThrow('尚无足量');
    await parcelEvent(forwarded.id, 'OFFICE-ACTUAL-CUSTOMER-RECEIPT', 'customer_delivery',
      [{ parcelLineId: forwarded.lines[0].id, quantity: 1 }]);
    await expect(preview(physical('too-much-on-replacement-waybill', forwarded.lines[0].id, 2))).rejects.toThrow('尚未办理的数量');
    const actual = physical('settle-replacement-delivery', forwarded.lines[0].id);
    const done = await record(actual);
    expect(done.snapshot).toMatchObject({ nextState: 'awaiting_close', operation: { remedy: 'resend', result: 'delivery',
      quantity: 1, parcelLineId: forwarded.lines[0].id, resendApprovalId: approval.approvalId } });
    expect(await confirm(actual, done.actionHash)).toMatchObject({ eventId: done.eventId, repeated: true });
    await expect(preview(physical('duplicate-signed-delivery', forwarded.lines[0].id))).rejects.toThrow(/实际|书面决定/);
    await record(saleInput('close', 'close-customer-side-only', {}, caseId));
    expect((await readWorkspace()).cases[0]).toMatchObject({ id: caseId, customerState: 'closed', supplierState: 'following', ownerId: operator.id });
    expect(await prisma.afterSaleEvent.count({ where: { caseId, action: 'physical' } })).toBe(1);
    expect(await prisma.fulfillmentParcel.count({ where: { orderId } })).toBe(3);
    expect(await prisma.purchaseActivity.findUniqueOrThrow({ where: { id: prior.id } })).toEqual(prior);
    expect(await prisma.accountReceivable.findUniqueOrThrow({ where: { orderId } })).toEqual(before);
    expect(await prisma.customerCashPosting.count({ where: { orderId } })).toBe(0);
  });

  it('拒绝过时预览、保留第一笔经办和独立供方状态，并限制可见内容', async () => {
    const { purchaseOrderId, report } = await legacyShortfall();
    const open = await record(saleInput('open', 'open-followup', report));
    const caseId = open.caseId!;
    const claim = saleInput('claim', 'claim-office-followup', {}, caseId);
    const draft = await preview(claim);
    const stale = saleInput('claim', 'stale-other-owner', {}, caseId);
    const staleDraft = await preview(stale, procurement);
    await confirm(claim, draft.actionHash);
    await expect(confirm(stale, staleDraft.actionHash, procurement)).rejects.toThrow('重新预览');
    await expect(preview(saleInput('claim', 'customer-cannot-assign-owner', {}, caseId), customer, true)).rejects.toThrow('客户仅可');
    const unrelatedAt = occurredAt();
    const wrongPurchase = await prisma.purchaseOrder.create({ data: {
      id: 'AFTER-SALE-OTHER-PURCHASE', orderId: otherOrderId, status: 'draft', groupKey: 'unrelated', createdAt: unrelatedAt, updatedAt: unrelatedAt,
    } });
    const supplier = (which: string) => saleInput('supplier', 'track-side-independently-' + which, {
      outcome: 'following', purchaseOrderId: which, supplier: '合成办公供方',
    }, caseId);
    await expect(preview(supplier(wrongPurchase.id), procurement)).rejects.toThrow('不属于原售后商品行');
    const supply = supplier(purchaseOrderId);
    await expect(confirm(supply, (await preview(supply, procurement)).actionHash, procurement, 'orders.write')).rejects.toThrow('权限');
    const saved = await record(supply, procurement);
    const view = await readWorkspace();
    expect(view.cases[0]).toMatchObject({ ownerId: operator.id, revision: 3, supplierState: 'following' });
    expect(afterSaleAdminView(view, ['orders.read']).cases[0].events).toContainEqual(expect.objectContaining({
      id: saved.eventId, reference: null, operation: null,
    }));
    expect(afterSaleAdminView(view, ['orders.read', 'purchases.read']).cases[0].events).toContainEqual(expect.objectContaining({
      id: saved.eventId, operation: expect.objectContaining({ purchaseOrderId, outcome: 'following' }),
    }));
    expect(await prisma.$transaction(tx => afterSaleCustomerView(tx, orderId))).toEqual([{
      id: caseId, orderItemId: itemId, quantity: 1, issue: 'shortage', customerState: 'awaiting_fulfillment',
      reportedAt: new Date(report.occurredAt),
    }]);
  });

  it('只有积分退回比例、应收仍开时无法准备退款，任何实际结果均要先有当版人工批准', async () => {
    await prisma.order.update({ where: { id: orderId }, data: { pointsRefundedCash: 100 } });
    await acceptOrder();
    const opened = await record(saleInput('open', 'open-money-source-check', {
      orderItemId: itemId, quantity: 1, issue: 'other', channel: 'email',
    }));
    const caseId = opened.caseId!;
    await record(saleInput('claim', 'assign-money-source-check', {}, caseId));
    await record(saleInput('agreement', 'customer-terms-for-preview-only', { remedy: 'refund', amountCents: 10000, method: 'bank',
      recipient: '合成买方', destination: '合成回款渠道末四位', customerDecision: '合成负例，仅核对准备条件' }, caseId));
    const prepare = saleInput('prepare_refund', 'unpaid-order-refund-precheck', { historyReview: '只有积分比例累计，没有原实收凭据' }, caseId);
    expect(salePermission(prepare)).toBe('finance.write');
    expect(salePermission(saleInput('supplier', 'separate-supplier-right', { outcome: 'financial_result' }, caseId))).toBe('purchases.pay');
    await expect(preview(prepare)).rejects.toThrow('超过已核实的剩余实收款');
    await expect(preview(saleInput('refund_result', 'no-approved-refund', {
      result: 'pending', referenceNo: 'LOCAL-NEGATIVE-ONLY',
    }, caseId))).rejects.toThrow('先取得本版退款批准');
    expect(await prisma.customerCashPosting.count({ where: { orderId } })).toBe(0);
    expect(await prisma.afterSaleEvent.count({ where: { caseId, action: { contains: 'refund' } } })).toBe(0);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ paidAt: null, pointsRefundedCash: 100 });
    expect(await prisma.accountReceivable.findUniqueOrThrow({ where: { orderId } })).toMatchObject({ status: 'open', amount: 200 });
  });
});
