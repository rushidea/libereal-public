import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as orderGET, PATCH as orderPATCH } from '@/app/api/admin/orders/[id]/route';
import { afterSaleAction } from '@/lib/after-sale-actions';
import { salePermission, type SaleInput } from '@/lib/after-sale-records';
import { afterSaleAdminView, afterSaleCustomerView, afterSaleQueue, afterSaleWorkspace } from '@/lib/after-sale-workspace';
import { saleSnapshotFor } from '@/lib/after-sale-visibility';
import { confirmedCustomerDelivery } from '@/lib/fulfillment-accounting';
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

async function registerSupplierOrder(unitPriceCents=1375) {
  const terms: PurchaseTerms = {
    supplier: '合成办公供方', writtenSupplier: '合成办公供方', payee: '合成供方账号',
    paymentTerms: '按书面条件结算', unitPriceCents, linePayableCents: unitPriceCents*2,
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
  async function signedOriginalPair(unitPriceCents?:number) {
    await acceptOrder();
    const purchaseOrderId=await registerSupplierOrder(unitPriceCents);
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

  it.each([true,false])('同一供方原件一行明确列两包时分别审批，并可具名补足首笔未录的完整范围（%s）',async upfront=>{
    const {purchaseOrderId,first,second}=await signedOriginalPair();
    const parcels=[first.lines[0].id,second.lines[0].id];
    const opened=await record(saleInput('open','one-supplier-original-paper-two-parcels',{
      orderItemId:itemId,quantity:2,issue:'quality',channel:'email'}));
    const caseId=opened.caseId!;
    await record(saleInput('claim','claim-two-package-issue',{},caseId));
    for(const [index,parcelLineId] of parcels.entries()) {
      await record(saleInput('bind_original_parcel','verify-original-supplier-parcel-'+index,{parcelLineId,quantity:1},caseId));
    }
    await record(saleInput('technical','two-original-packages-same-defect',{authority:'brand',party:'合成办公品牌',contact:'具名产品顾问'},caseId));
    await record(saleInput('agreement','two-proven-originals-may-be-exchanged',{
      remedy:'exchange',returnRequirement:'waived',customerDecision:'双方核实两包各一件免退换货'},caseId));
    const letter={...proof('ONE-TWO-PARCEL-SUPPLIER-PAPER'),documentRow:3};
    const scope=parcels.map(parcelLineId=>({parcelLineId,quantity:1}));
    const approve=(index:number, shares?:typeof scope)=>saleInput('approve_exchange','approve-separate-part-'+index,{
      ...letter,parcelLineId:parcels[index],quantity:1,supplier:'合成办公供方',freeOfCharge:true,returnRequirement:'waived',
      ...(shares?{supplierDocumentShares:shares}:{})},caseId);
    const partA=approve(0,upfront?scope:undefined);
    const firstSaved=await record(partA,procurement);
    expect(await record({...partA,requestId:'repeated-same-paper-first-piece'},procurement))
      .toMatchObject({eventId:firstSaved.eventId,repeated:true});
    await expect(preview(approve(1,[{parcelLineId:parcels[1],quantity:1}]),procurement)).rejects.toThrow('书证');
    if(!upfront) await expect(preview(approve(1),procurement)).rejects.toThrow('包裹份额');
    await expect(preview({...approve(1),data:{...approve(1).data,quantity:2}},procurement)).rejects.toThrow('尚未批准');
    const secondSaved=await record(approve(1,upfront?undefined:scope),procurement);
    expect(secondSaved.snapshot).toMatchObject({operation:{quantity:1,originalParcelLineId:parcels[1],supplierDocumentShares:expect.arrayContaining(scope.map(part=>({...part,caseId})))}});
    for(const [index,id] of [firstSaved.eventId!,secondSaved.eventId!].entries()){
      const parcel=await dispatch(purchaseOrderId,'SIGNED-EXCHANGE-SHARE-'+index,'supplier_to_customer',{afterSaleApprovalId:id});
      await parcelEvent(parcel.id,'DELIVERY-SHARE-'+index,'customer_delivery',[{parcelLineId:parcel.lines[0].id,quantity:1}]);
      const accepted=await record(saleInput('physical','record-delivered-exchange-share-'+index,{
        parcelLineId:parcel.lines[0].id,quantity:1,result:'delivery'},caseId));
      expect(accepted.snapshot).toMatchObject({nextState:index===0?'awaiting_fulfillment':'awaiting_close'});
    }
    expect(await prisma.afterSaleEvent.count({where:{caseId,action:'approve_exchange',sha256:letter.sha256,documentRow:3}})).toBe(2);
    expect(await prisma.shipmentItem.count({where:{orderItemId:itemId}})).toBe(2);
    expect(await prisma.afterSaleEvent.count({where:{caseId,action:'refund_result'}})).toBe(0);
  });

  it('同一行供方原件覆盖同单的两案和两包，分别批准并防止扩展来源',async()=>{
    const {purchaseOrderId,first,second}=await signedOriginalPair();
    const documentSubjects: { caseId:string; parcelLineId:string; quantity:number }[]=[];
    for(const [index,parcel] of [first,second].entries()){
      const parcelLineId=parcel.lines[0].id;
      const opened=await record(saleInput('open','supplier-letter-cross-case-'+index,{
        orderItemId:itemId,quantity:1,issue:'return',channel:'email',originalParcelLineId:parcelLineId}));
      const caseId=opened.caseId!;
      await record(saleInput('claim','take-cross-cases-'+index,{},caseId));
      await record(saleInput('agreement','separate-customer-decision-for-each-case-'+index,{
        remedy:'exchange',returnRequirement:'waived',customerDecision:'本案原包裹的一件获书面确认免费换货'},caseId));
      documentSubjects.push({caseId,parcelLineId,quantity:1});
    }
    const supplierPaper={...proof('ONE-VERIFIED-SUPPLIER-DOCUMENT-FOR-TWO-CASES'),documentRow:8};
    const approve=(index:number,includeScope=false)=>saleInput('approve_exchange','shared-supplier-line-case-'+index,{
      ...supplierPaper,...{parcelLineId:documentSubjects[index].parcelLineId,quantity:1},supplier:'合成办公供方',
      returnRequirement:'waived',freeOfCharge:true,...(includeScope?{supplierDocumentShares:documentSubjects}:{})},documentSubjects[index].caseId);
    const firstInput=approve(0,true);
    const a=await record(firstInput,procurement);
    const cross=approve(1);
    await expect(preview({...cross,data:{...cross.data,supplierDocumentShares:[...documentSubjects,{...documentSubjects[1],caseId:'another-unknown-case'}]}},
      procurement)).rejects.toThrow('案件');
    const b=await record(cross,procurement);
    expect(b.snapshot).toMatchObject({operation:{supplierDocumentShares:expect.arrayContaining(documentSubjects),quantity:1}});
    expect((await record({...cross,requestId:'retry-same-request-for-case-b'},procurement))).toMatchObject({eventId:b.eventId,repeated:true});
    for(const [index,approval] of [a,b].entries()){
      const done=await dispatch(purchaseOrderId,'ACTUAL-CROSS-CASE-REPLACEMENT-'+index,'supplier_to_customer',{afterSaleApprovalId:approval.eventId!});
      await parcelEvent(done.id,'SIGNED-ACTUAL-CROSS-CASE-'+index,'customer_delivery',[{parcelLineId:done.lines[0].id,quantity:1}]);
      expect((await record(saleInput('physical','finish-actual-cross-case-'+index,{result:'delivery',quantity:1,
        parcelLineId:done.lines[0].id},documentSubjects[index].caseId))).snapshot).toMatchObject({nextState:'awaiting_close'});
    }
    expect(await prisma.afterSaleEvent.count({where:{action:'approve_exchange',sha256:supplierPaper.sha256,documentRow:8}})).toBe(2);
  });

  it('同案同笔供方真实抵扣按所列两包分30和20元，按总金额和原份额防重',async()=>{
    const {purchaseOrderId,first,second}=await signedOriginalPair(4000);
    const cases=await record(saleInput('open','covered-by-one-supplier-offset',{
      orderItemId:itemId,quantity:2,issue:'other',channel:'handoff'}));
    const caseId=cases.caseId!;
    await record(saleInput('claim','operator-takes-one-offset',{},caseId));
    const originals=[first.lines[0].id,second.lines[0].id];
    for(const [index,parcelLineId] of originals.entries()){
      await record(saleInput('bind_original_parcel','scope-of-the-real-offset-'+index,{parcelLineId,quantity:1},caseId));
    }
    const paper={...proof('SYNTHETIC-ACTUAL-OFFICE-SUPPLIER-OFFSET-50'),documentRow:4};
    const allocate=(index:number,amountCents:number,allocationReference:string)=>saleInput('supplier','supplier-offset-'+index+'-'+amountCents+'-'+allocationReference,{
      ...paper,outcome:'financial_result',purchaseOrderId,originalParcelLineId:originals[index],supplier:'合成办公供方',
      method:'offset',destination:'合成原供方对账单',referenceNo:'SYNTHETIC-OFFSET-TRACE-1',transferTotalCents:5000,allocationReference,amountCents},caseId);
    const buyBefore=(await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId))).orders.find(item=>item.id===purchaseOrderId);
    const firstEntry=allocate(0,3000,'原回执归运单甲30');
    const saved=await record(firstEntry,procurement);
    expect(saved.snapshot).toMatchObject({nextSupplierState:'following',operation:{transfer:{unallocatedAfterCents:2000}}});
    expect((await record({...firstEntry,requestId:'same-supplier-offset-retry'},procurement))).toMatchObject({eventId:saved.eventId,repeated:true});
    await expect(preview(allocate(0,2000,'改标签冒称另一份'),procurement)).rejects.toThrow('原包裹份额');
    await expect(preview(allocate(1,2100,'真实总额以外不能分'),procurement)).rejects.toThrow('真实交易总额');
    await expect(preview(allocate(1,2000,'原回执归运单甲30'),procurement)).rejects.toThrow('分摊依据已登记');
    const secondEntry=await record(allocate(1,2000,'原回执归运单乙20'),procurement);
    expect(secondEntry.snapshot).toMatchObject({nextSupplierState:'resolved',operation:{
      originalParcelLineId:originals[1],amountCents:2000,transfer:{allocatedBeforeCents:3000,unallocatedAfterCents:0}}});
    const savedTransfers=await prisma.afterSaleEvent.findMany({where:{caseId,action:'supplier',sha256:paper.sha256}});
    expect(savedTransfers).toHaveLength(2);
    expect(savedTransfers.every(event=>event.actorId===procurement.id)).toBe(true);
    const buyAfter=(await prisma.$transaction(tx=>purchaseWorkspace(tx,orderId))).orders.find(item=>item.id===purchaseOrderId);
    expect(buyAfter).toMatchObject({totalCents:buyBefore?.totalCents,paidCents:buyBefore?.paidCents,dueCents:buyBefore?.dueCents});
  });

  it('同一包裹两件均已签收，两案各具名认领一件后同一笔实款分30与20元',async()=>{
    await acceptOrder();
    const purchaseOrderId=await registerSupplierOrder(4000);
    const box=await prisma.$transaction(tx=>dispatchParcel(tx,orderId,{
      ...proof('ONE-REAL-PACKAGE-TWO-OFFICE-FOLDERS'),requestId:'dispatch-one-box-two-goods',route:'supplier_to_customer',
      trackingNumber:'ACTUAL-WAYBILL-2',carrier:'合成承运人',lines:[{purchaseOrderId,orderItemId:itemId,quantity:2}],
    },operator));
    const parcelLineId=box.lines[0].id;
    await parcelEvent(box.id,'SIGN-TWO-ON-SAME-LINE','customer_delivery',[{parcelLineId,quantity:2}]);
    const subjects:{caseId:string;evidenceId:string}[]=[];
    for(const tag of ['A','B']){
      const created=await record(saleInput('open','case-tied-to-a-share-'+tag,{orderItemId:itemId,quantity:1,issue:'other',channel:'handoff'}));
      const caseId=created.caseId!;
      await record(saleInput('claim','claim-one-physical-piece-'+tag,{},caseId));
      const named=await record(saleInput('bind_original_parcel','signed-original-share-proof-'+tag,{parcelLineId,quantity:1},caseId));
      subjects.push({caseId,evidenceId:named.eventId!});
    }
    const third=await record(saleInput('open','third-unassigned-case',{orderItemId:itemId,quantity:1,issue:'other',channel:'handoff'}));
    await record(saleInput('claim','take-third-unassigned-case',{},third.caseId!));
    await expect(preview(saleInput('bind_original_parcel','try-claiming-physical-piece-three',{parcelLineId,quantity:1},third.caseId!)))
      .rejects.toThrow('实际已签收');
    const receipt={...proof('SAME-REAL-SYNTHETIC-SUPPLIER-RECEIPT-50'),documentRow:7};
    const attribute=(caseId:string,key:string,amountCents:number)=>saleInput('supplier',key,{
      ...receipt,purchaseOrderId,originalParcelLineId:parcelLineId,supplier:'合成办公供方',outcome:'financial_result',
      destination:'合成供方实付到账账户',method:'bank',referenceNo:'SYNTHETIC-BANK-TRANSFER-50',
      amountCents,transferTotalCents:5000,allocationReference:key,
    },caseId);
    const first=attribute(subjects[0].caseId,'original-evidence-allocation-a-30',3000);
    const a=await record(first,procurement);
    expect(a.snapshot).toMatchObject({operation:{transfer:{unallocatedAfterCents:2000,supplierScope:{parcelClaim:{
      caseId:subjects[0].caseId,quantity:1,evidenceEventIds:[subjects[0].evidenceId]}}}}});
    await expect(preview(attribute(subjects[0].caseId,'new-label-does-not-create-another-share',2000),procurement)).rejects.toThrow('原包裹份额');
    await expect(preview(attribute(subjects[1].caseId,'over-actual-50',2001),procurement)).rejects.toThrow('真实交易总额');
    const lastInput=attribute(subjects[1].caseId,'original-evidence-allocation-b-20',2000);
    const last=await record(lastInput,procurement);
    expect(last.snapshot).toMatchObject({operation:{transfer:{allocatedBeforeCents:3000,unallocatedAfterCents:0,supplierScope:{
      orderId,purchaseOrderId,originalParcelLineId:parcelLineId,parcelClaim:{caseId:subjects[1].caseId,quantity:1,evidenceEventIds:[subjects[1].evidenceId]}}}}});
    expect((await record({...lastInput,requestId:'repeated-valid-second-portion'},procurement))).toMatchObject({eventId:last.eventId,repeated:true});
    await expect(preview(attribute(third.caseId!,'no-third-recognized-parcel-share',1),procurement)).rejects.toThrow('原包裹份额');
    expect(await prisma.afterSaleEvent.count({where:{action:'supplier',sha256:receipt.sha256}})).toBe(2);
    expect(await prisma.afterSaleEvent.count({where:{action:'refund_result'}})).toBe(0);
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

  it('一案两批原件按签收和书证逐份关联，截止各自的真实退回数量', async()=>{
    const {first,second}=await signedOriginalPair();
    const two=await record(saleInput('open','open-one-case-two-original-boxes',{orderItemId:itemId,quantity:2,issue:'return',channel:'email'}));
    const caseId=two.caseId!;
    await record(saleInput('claim','own-two-box-case',{},caseId));
    await record(saleInput('agreement','return-the-two-known-boxes',{remedy:'return',customerDecision:'书面同意分别退回甲乙两包各一件'},caseId));
    for(const parcel of [first,second]) await parcelEvent(parcel.id,'ACTUAL-ORIGINAL-RETURN-'+parcel.id,'confirm_shortfall',
      [{parcelLineId:parcel.lines[0].id,quantity:1,outcome:'return'}],{
        supplierReference:'OFFICE-PREVIOUS-RETURN-AUTHORITY',supplierSha256:pricingContentHash('two original parcels acknowledged'),
        customerReference:'OFFICE-RETURN-A-AND-B',customerSha256:pricingContentHash('customer acknowledges returning two original parcels')});
    const confirmation=async (p:typeof first)=>saleInput('physical','verify-actual-return-'+p.id,{result:'return',quantity:1,parcelLineId:p.lines[0].id,
      resolutionId:(await prisma.fulfillmentLineResolution.findFirstOrThrow({where:{parcelLineId:p.lines[0].id,kind:'return'}})).id},caseId);
    await expect(preview(await confirmation(second))).rejects.toThrow('本案指定');
    const link=(p:typeof first,q=1)=>saleInput('bind_original_parcel','paper-maps-'+p.id+'-'+q,{parcelLineId:p.lines[0].id,quantity:q},caseId);
    await expect(preview(link(first,2))).rejects.toThrow('实际已签收');
    const firstLink=link(first);
    await record(firstLink);
    expect((await record(firstLink)).repeated).toBe(true);
    expect((await record(await confirmation(first))).snapshot).toMatchObject({nextState:'awaiting_fulfillment'});
    await expect(preview(await confirmation(second))).rejects.toThrow('本案指定');
    await record(link(second));
    expect((await record(await confirmation(second))).snapshot).toMatchObject({nextState:'awaiting_close'});
    expect(await prisma.afterSaleCase.findUniqueOrThrow({where:{id:caseId}})).toMatchObject({quantity:2,sourceReference:'open-one-case-two-original-boxes'});
    expect((await readWorkspace()).cases[0].events.filter(event=>event.action==='physical')).toHaveLength(2);
    expect(await prisma.afterSaleEvent.count({where:{caseId,action:'refund_result'}})).toBe(0);
  });

  it.each(['supplier_to_customer','supplier_to_libereal'] as const)('同箱逐行区分普通交货和已准换件，在仓转发也只记一次（%s）',async route=>{
    await acceptOrder();
    const purchaseOrderId=await registerSupplierOrder();
    const first=await dispatch(purchaseOrderId,'FIRST-ORDINARY-PARCEL-BEFORE-MIX','supplier_to_customer');
    await parcelEvent(first.id,'FIRST-CUSTOMER-ACTUAL-SIGNED','customer_delivery',[{parcelLineId:first.lines[0].id,quantity:1}]);
    const originalMoney=await prisma.accountReceivable.findUniqueOrThrow({where:{orderId}});
    const opened=await record(saleInput('open','one-of-two-needs-free-exchange',{orderItemId:itemId,quantity:1,issue:'quality',
      channel:'email',originalParcelLineId:first.lines[0].id}));
    const caseId=opened.caseId!;
    await record(saleInput('claim','own-mixed-case',{},caseId));
    await record(saleInput('technical','received-original-defect',{authority:'brand',party:'合成办公品牌',contact:'具名产品顾问'},caseId));
    await record(saleInput('agreement','both-accepted-waived-return-and-free-exchange',{remedy:'exchange',customerDecision:'本案只涉及先签的甲件，双方同意免退换货',
      returnRequirement:'waived'},caseId));
    const granted=await record(saleInput('approve_exchange','operator-approved-mixed-exchange',{supplier:'合成办公供方',
      freeOfCharge:true,returnRequirement:'waived'},caseId),procurement);
    const goods={purchaseOrderId,orderItemId:itemId,quantity:1};
    const request={...proof('ONE-REAL-MIXED-WAYBILL'),requestId:'ONE-MIXED-PARCEL',route,trackingNumber:'REAL-MIXED-OFFICE-WAYBILL',
      carrier:'合成承运人',lines:[goods,{...goods,afterSaleApprovalId:granted.eventId!}]};
    const send=(input:unknown)=>prisma.$transaction(tx=>dispatchParcel(tx,orderId,input,operator));
    const mixed=await send(request);
    expect((await send(request)).id).toBe(mixed.id);
    expect(mixed.lines.map(line=>line.afterSaleApprovalId).sort()).toContain(granted.eventId);
    let customerParcel=mixed;
    if(route==='supplier_to_libereal'){
      await parcelEvent(mixed.id,'MIXED-COMMERCIAL-WAREHOUSE-BATCHES','warehouse_receipt',mixed.lines.map((line,i)=>({
        parcelLineId:line.id,quantity:1,batchNumber:'MIXED-ACTUAL-GOODS-LOT-'+i})));
      const batches=await prisma.fulfillmentReceipt.findMany({where:{parcelLineId:{in:mixed.lines.map(line=>line.id)}}});
      expect(batches).toHaveLength(2);
      customerParcel=await send({...proof('REAL-MIXED-FORWARD-WAYBILL'),route:'libereal_to_customer',
        requestId:'REAL-MIXED-FORWARD',carrier:'合成仓库承运人',trackingNumber:'REAL-MIXED-FORWARD',
        lines:batches.map(receipt=>({...goods,sourceReceiptId:receipt.id}))});
      expect(await prisma.fulfillmentReceipt.count({where:{id:{in:batches.map(batch=>batch.id)},forwardedQuantity:1}})).toBe(2);
    }
    expect(customerParcel.lines).toHaveLength(2);
    expect(await prisma.shipmentItem.findMany({where:{shipmentId:customerParcel.shipmentId!}})).toMatchObject([{orderItemId:itemId,quantity:1}]);
    const regular=customerParcel.lines.find(line=>!line.afterSaleApprovalId)!;
    const exchange=customerParcel.lines.find(line=>line.afterSaleApprovalId===granted.eventId)!;
    const settle=saleInput('physical','settle-mixed-exchange-actual-signature',{result:'delivery',parcelLineId:exchange.id,quantity:1},caseId);
    await parcelEvent(customerParcel.id,'MIXED-ONLY-ORIGINAL-FIRST-SIGNATURE','customer_delivery',[{parcelLineId:regular.id,quantity:1}]);
    expect(await prisma.$transaction(tx=>confirmedCustomerDelivery(tx,orderId))).toBe(true);
    await expect(preview(settle)).rejects.toThrow('客户实际签收');
    await parcelEvent(customerParcel.id,'MIXED-EXCHANGE-LATER-SIGNATURE','customer_delivery',[{parcelLineId:exchange.id,quantity:1}]);
    expect((await record({...settle,data:{...settle.data,occurredAt:occurredAt()}})).snapshot).toMatchObject({nextState:'awaiting_close'});
    expect(await prisma.orderItem.findUniqueOrThrow({where:{id:itemId}})).toMatchObject({shippedQty:2});
    expect(await prisma.inventoryReservation.findUniqueOrThrow({where:{orderItemId:itemId}})).toMatchObject({releasedQuantity:2});
    expect(await prisma.accountReceivable.findUniqueOrThrow({where:{orderId}})).toEqual(originalMoney);
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
    const terms={...current.lines[0].terms,supplier:'合成独立补件供方',writtenSupplier:'合成独立补件供方',
      payee:'合成独立补件原收款方',unitPriceCents:1600,linePayableCents:1600,sourceReference:'REPLACEMENT-OFFICE-NEW-QUOTE',
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
    const unfiltered=await preview(agreed);
    expect(unfiltered.snapshot).toMatchObject({operation:{replacement:{quantity:1,payableCents:1600,supplier:'合成独立补件供方'}}});
    const orderPreview=saleSnapshotFor(unfiltered.snapshot,['orders.read','orders.write']);
    expect(orderPreview.operation).toMatchObject({replacement:{purchaseOrderId:replacement.id,quantity:1}});
    expect(JSON.stringify(orderPreview)).not.toContain('payableCents');
    expect(JSON.stringify(orderPreview)).not.toContain('合成独立补件供方');
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
    const workspaceAfter=await readWorkspace();
    for (const rights of [['orders.read'],['orders.read','orders.write']]) {
      const details=afterSaleAdminView(workspaceAfter,rights);
      expect(details.replacements[0]).toMatchObject({purchaseOrderId:replacement.id,quantity:1,payableCents:null,supplier:null});
      const records=details.cases[0].events.filter(event=>event.action==='agreement'||event.action==='physical');
      expect(records).toHaveLength(2);
      expect(JSON.stringify(records)).not.toContain('payableCents');
      expect(JSON.stringify(records)).not.toContain('合成独立补件供方');
    }
    expect(afterSaleAdminView(workspaceAfter,['purchases.read']).replacements[0]).toMatchObject({payableCents:1600});

    const retained=await dispatch(purchaseOrderId,'ORIGINAL-OTHER-PIECE-ORDINARY','supplier_to_customer');
    await parcelEvent(retained.id,'ORDINARY-OTHER-PIECE-SIGNED','customer_delivery',[{parcelLineId:retained.lines[0].id,quantity:1}]);
    const claim=await record(saleInput('open','new-two-supplier-goods-case',{
      orderItemId:itemId,quantity:2,issue:'other',channel:'email'}));
    const caseId=claim.caseId!;
    await record(saleInput('claim','customer-desk-owns-two-supplier-case',{},caseId));
    for(const [index,parcel] of [retained,shipped].entries()) {
      await record(saleInput('bind_original_parcel','verified-parcel-with-real-supplier-'+index,
        {parcelLineId:parcel.lines[0].id,quantity:1},caseId));
    }
    const supplierUpdate=(id:string,parcelLineId:string,supplier:string,outcome:string)=>saleInput('supplier','supplier-progress-'+id+'-'+parcelLineId+'-'+outcome,{
      purchaseOrderId:id,originalParcelLineId:parcelLineId,supplier,outcome},caseId);
    await record(supplierUpdate(purchaseOrderId,retained.lines[0].id,'合成办公供方','resolved'),procurement);
    const progress=await record(supplierUpdate(replacement.id,shipped.lines[0].id,'合成独立补件供方','following'),procurement);
    expect(progress.snapshot).toMatchObject({nextSupplierState:'following'});
    await expect(preview(supplierUpdate(replacement.id,retained.lines[0].id,'合成独立补件供方','resolved'),procurement))
      .rejects.toThrow('原包裹');
    await record(saleInput('agreement','customer-keeps-both-physical-goods',{remedy:'keep',customerDecision:'客户事项已完，另一家供方仍待跟进'},caseId));
    await record(saleInput('close','customer-side-only-finished',{},caseId));
    const pending=()=>prisma.$transaction(tx=>afterSaleQueue(tx,caseId,true));
    expect((await pending())[0]).toMatchObject({id:caseId,customerState:'closed',supplierState:'following'});
    const detail=afterSaleAdminView(await readWorkspace(),['purchases.read']).cases.find(item=>item.id===caseId)!;
    expect(detail.supplierScopes).toEqual(expect.arrayContaining([
      expect.objectContaining({purchaseOrderId,quantity:1,state:'resolved',ownerId:procurement.id}),
      expect.objectContaining({purchaseOrderId:replacement.id,quantity:1,state:'following',ownerId:procurement.id}),
    ]));
    const finished={...supplierUpdate(replacement.id,shipped.lines[0].id,'合成独立补件供方','resolved'),requestId:'second-supplier-actual-result',
      data:{...supplierUpdate(replacement.id,shipped.lines[0].id,'合成独立补件供方','resolved').data,...proof('separate-other-supplier-final-receipt')}};
    expect((await record(finished,procurement)).snapshot).toMatchObject({nextState:'closed',nextSupplierState:'resolved'});
    expect(await pending()).toEqual([]);
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
