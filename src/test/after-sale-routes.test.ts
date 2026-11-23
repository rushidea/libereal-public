// @vitest-environment node

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as alipayNotify } from '@/app/api/payments/alipay/notify/route';
import { applyFinanceAction, previewFinanceAction, type FinanceInput } from '@/lib/finance-actions';
import { financeWorkspace } from '@/lib/finance-workspace';
import { GET as adminGET, POST as adminPOST } from '@/app/api/admin/after-sales/route';
import { GET as customerGET, POST as customerPOST } from '@/app/api/orders/[id]/after-sales/route';
import { ADMIN_ROLE_DEFINITIONS, type AdminRoleKey } from '@/lib/admin-permissions';
import type { SaleInput } from '@/lib/after-sale-records';
import { reserveOrderCredit } from '@/lib/customer-credit';
import { resetEphemeralStoreForTests } from '@/lib/ephemeral-store';
import { merchantAcceptanceMetadata, merchantOrderApprovalPreview, ORDER_APPROVAL_INCLUDE } from '@/lib/order-approval';
import { applyPurchaseAction, prepareOrderPurchases, previewPurchaseAction, purchaseWorkspace, savePurchaseLine } from '@/lib/purchase-orders';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { createMfaKeyRing, encryptMfaSecret } from '@/lib/security/mfa-crypto';
import { generateTotpSecret, totpCodeAt } from '@/lib/security/mfa-totp';
import { completeSecurityStepUp, startSecurityStepUp } from '@/lib/security/security-step-up';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/alipay', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/alipay')>(),
  getAlipaySdk: () => ({ config: { appId: 'office-test-app', sellerId: 'office-test-shop' }, sdk: { checkNotifySign: () => true } }),
}));

const owner = 'after-sale-owner';
const outsider = 'after-sale-other-customer';
const orgReader = 'after-sale-organization-reader';
const clerk = 'after-sale-order-staff';
const procurement = 'after-sale-purchase-staff';
const purchaseFinance = 'after-sale-vendor-accounts';
const finance = 'after-sale-customer-accounts';
const personalOrder = 'OFFICE-PERSONAL-AFTER-SALE';
const orgOrder = 'OFFICE-ORGANIZATION-AFTER-SALE';
const destination = '仅合成退款去向 4521';
const payee = '仅合成原客户收款方';
const key = randomBytes(32);
const keyRing = createMfaKeyRing({ currentVersion: 1, keys: { 1: key } });
const secrets = new Map<string, string>();
const adminUrl = 'http://localhost/api/admin/after-sales';

const email = (id: string) => id + '@example.invalid';
const line = (id: string) => id + '-line';
const session = (id: string) => 'session-' + id;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const memberUrl = (id: string) => 'http://localhost/api/orders/' + id + '/after-sales';

function signIn(id: string, role = 'customer', sessionId = session(id)) {
  auth.mockResolvedValue({ user: { id, role, email: email(id), sessionId } });
}

function seedStaff(id: string, role: AdminRoleKey) {
  const db = getTestDb();
  seedUser(db, { id, role: 'admin', email: email(id) });
  db.prepare('INSERT INTO AdminRole (id,key,name,updatedAt) VALUES (?,?,?,CURRENT_TIMESTAMP)').run(role, role, role);
  for (const permission of ADMIN_ROLE_DEFINITIONS[role].permissions) {
    const [resource, action] = permission.split('.');
    db.prepare('INSERT OR IGNORE INTO AdminPermission (id,key,resource,action,name) VALUES (?,?,?,?,?)')
      .run(permission, permission, resource, action, permission);
    db.prepare('INSERT INTO AdminRolePermission (roleId,permissionId) VALUES (?,?)').run(role, permission);
  }
  db.prepare('INSERT INTO AdminUserRole (userId,roleId) VALUES (?,?)').run(id, role);
  const secret = generateTotpSecret();
  secrets.set(id, secret);
  db.prepare('INSERT INTO MfaSetting (id,userId,enabled,encryptedSecret) VALUES (?,?,1,?)')
    .run('mfa-' + id, id, encryptMfaSecret(secret, keyRing));
}

async function grant(id: string, sessionId = session(id)) {
  vi.setSystemTime(Date.now() + 31_000);
  const secret = secrets.get(id);
  if (!secret) throw new Error('缺少本机合成身份验证器');
  const context = { userId: id, sessionId, action: 'admin_sensitive' as const, method: 'totp' as const };
  const challenge = await startSecurityStepUp(context);
  const completed = await completeSecurityStepUp({ ...context, challengeId: challenge.challengeId,
    totpToken: challenge.challengeToken, code: totpCodeAt(secret, Date.now()) });
  if (!('grantToken' in completed)) throw new Error('合成 TOTP 未完成：' + completed.error);
  return completed.grantToken;
}

function post(url: string, body: object) {
  return new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function expectJson(response: Response | Promise<Response>, status: number) {
  const result = await response;
  const data = await result.json();
  expect(result.status, JSON.stringify(data)).toBe(status);
  return data;
}

function memberInput(id: string, requestId: string, fields: object = {}) {
  return { requestId, orderItemId: line(id), issue: 'shortage', quantity: 1,
    note: '合成客户报告一件办公用品未到', occurredAt: new Date().toISOString(), ...fields };
}

function memberReport(id: string, body: object) {
  return customerPOST(post(memberUrl(id), body), params(id));
}

function memberRead(id: string) {
  return customerGET(new NextRequest(memberUrl(id)), params(id));
}

function adminRead(id = personalOrder) {
  return adminGET(new NextRequest(adminUrl + '?orderId=' + encodeURIComponent(id)));
}

function action(kind: SaleInput['action'], requestId: string, caseId: string, fields: object = {}):
  { orderId: string; requestId: string; caseId: string; action: SaleInput['action']; data: Record<string, unknown> } {
  return { orderId: personalOrder, requestId, caseId, action: kind, data: {
    reference: 'local-proof/' + requestId, sha256: pricingContentHash({ requestId }), occurredAt: new Date().toISOString(),
    documentRow: 1, note: '合成办公用品处理依据', ...fields,
  } };
}

type RequestBody = ReturnType<typeof action>;

function preview(body: RequestBody) {
  return adminPOST(post(adminUrl, { ...body, stage: 'preview' }));
}

function confirm(body: RequestBody, actionHash: string, stepUpToken?: string) {
  return adminPOST(post(adminUrl, { ...body, stage: 'confirm', actionHash, stepUpToken }));
}

async function record(id: string, body: RequestBody) {
  const { preview: draft } = await expectJson(preview(body), 200);
  return expectJson(confirm(body, draft.actionHash, await grant(id)), 200);
}

async function seedOrder(id: string, customerId: string, organizationId?: string) {
  await prisma.order.create({ data: {
    id, organizationId, ownerScope: organizationId ? 'organization' : 'personal', customerId, email: email(customerId),
    status: 'pending', paymentMethod: 'bank_transfer', subtotal: 200, total: 200,
    orderItems: { create: { id: line(id), position: 0, name: '合成办公 A4 文件夹', quantity: 2, unitPrice: 100 } },
  } });
}

async function acceptOriginalOrder(orderId = personalOrder) {
  await prisma.$transaction(async tx => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_APPROVAL_INCLUDE });
    const draft = await merchantOrderApprovalPreview(tx, order);
    if (draft?.action !== 'accept_order') throw new Error('缺少原订单接单预览');
    await tx.order.update({ where: { id: orderId }, data: {
      status: 'confirmed', statusHistory: { create: { fromStatus: 'pending', toStatus: 'confirmed', actorId: clerk,
        actorEmail: email(clerk), metadata: merchantAcceptanceMetadata(draft) } },
    } });
    await reserveOrderCredit(tx, orderId, clerk);
  });
}

async function financeRecord(kind:FinanceInput['action'],orderId:string,slug:string,data:Record<string,unknown>) {
  vi.setSystemTime(Date.now()+1000);
  const actor={id:finance,email:email(finance)};
  return prisma.$transaction(async tx=>{
    const evidence={reference:slug,sha256:pricingContentHash(slug),occurredAt:new Date().toISOString(),description:'合成实际票款原件'};
    const workspace=await financeWorkspace(tx,orderId);
    const input:FinanceInput={orderId,action:kind,requestId:orderId+'-'+slug,version:workspace.version,data:{...evidence,...data}};
    const draft=await previewFinanceAction(tx,input,actor);
    const eventId=await applyFinanceAction(tx,input,actor,draft.actionHash,{permission:'finance.write',action:'admin_sensitive',
      sessionFingerprint:pricingContentHash(actor),verifiedAt:new Date().toISOString()});
    return {eventId,evidence,workspace:await financeWorkspace(tx,orderId)};
  });
}

function migration(folder: string) {
  return readFileSync('prisma/migrations/' + folder + '/migration.sql', 'utf8');
}

beforeAll(() => {
  const db = getTestDb();
  db.exec(migration('20260806090000_add_mfa_security_tables'));
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='organization_members'").get()) {
    // The shared fixture already provides the final organizations table.
    db.exec(migration('20260808090000_add_organization_rbac_tables').replace(
      'CREATE TABLE "organizations"', 'CREATE TABLE IF NOT EXISTS "organizations"',
    ));
    db.exec(migration('20260808110000_update_organization_membership_lifecycle'));
    db.exec(migration('20260809130000_add_member_permission_overrides'));
  }

});

afterAll(() => closeTestDb());

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T07:00:00.000Z'));
  vi.stubEnv('REDIS_REST_URL', undefined);
  vi.stubEnv('REDIS_REST_TOKEN', undefined);
  vi.stubEnv('MFA_PHASE1_ENABLED', 'true');
  vi.stubEnv('MFA_KEY_CURRENT', '1');
  vi.stubEnv('MFA_KEY_V1', key.toString('base64'));
  vi.stubEnv('STAGING_MFA_TEST_ENABLED', 'false');
  resetEphemeralStoreForTests();
  secrets.clear();
  const db = getTestDb();
  db.exec(' DELETE FROM SecurityEvent; DELETE FROM MfaChallenge; DELETE FROM MfaSetting;');
  clearAllTables(db);
  for (const id of [owner, outsider, orgReader]) seedUser(db, { id, email: email(id) });
  seedStaff(clerk, 'order_admin');
  seedStaff(procurement, 'purchase_operator');
  seedStaff(purchaseFinance, 'purchase_finance');
  seedStaff(finance, 'finance_staff');
  await prisma.creditAccount.create({ data: { userId: owner, baseLimit: 10000, paymentTermDays: 30 } });
  await seedOrder(personalOrder, owner);
});

afterEach(() => {
  auth.mockReset();
  resetEphemeralStoreForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('售后正常 HTTP 入口、真实权限和单次身份确认', () => {
  it.each(['cancelled','unpaid'] as const)('原渠道确有实收但未接单时仍能由财务核对准备，保持原交易（%s）',async status=>{
    if(status==='unpaid'){
      const product=await prisma.product.create({data:{id:'office-unavailable',name:'合成缺货文件夹',catalogNumber:'OFFICE-UNAVAILABLE',brand:'合成办公品牌',stockQuantity:0,price:100}});
      await prisma.orderItem.update({where:{id:line(personalOrder)},data:{productId:product.id}});
    }
    await prisma.order.update({where:{id:personalOrder},data:{status,paymentMethod:'alipay'}});
    const outTradeNo='OFFICE-ORIGINAL-B4-ATTEMPT';
    const tradeNo='OFFICE-ORIGINAL-B4-TRADE';
    const attempt=await prisma.paymentAttempt.create({data:{orderId:personalOrder,provider:'alipay',outTradeNo,amount:200}});
    const form=new URLSearchParams({app_id:'office-test-app',seller_id:'office-test-shop',out_trade_no:outTradeNo,
      trade_no:tradeNo,total_amount:'200.00',trade_status:'TRADE_SUCCESS'});
    const callback=await alipayNotify(new Request('http://localhost/api/payments/alipay/notify',{method:'POST',body:form}));
    expect(await callback.text()).toBe('success');
    const actual=await prisma.paymentAttempt.findUniqueOrThrow({where:{id:attempt.id}});
    expect(actual.status).toBe(status==='cancelled'?'rejected_order_cancelled':'paid_stock_shortfall_reconciliation_required');
    signIn(clerk,'admin');
    const opened=await record(clerk,action('open','open-confirmed-actual-unposted-b4-receipt','',{
      orderItemId:line(personalOrder),channel:'email',issue:'cancellation',quantity:2}));
    const id=opened.caseId;
    await record(clerk,action('claim','claim-actual-gateway-case',id));
    const decision=await record(clerk,action('agreement','customer-original-channel-decision',id,{
      remedy:'refund',amountCents:20000,recipient:payee,destination,method:'alipay',customerDecision:'原款核实后按己方原交易另行准备'}));
    const prepare=action('prepare_refund','prepare-verified-original-funds',id,{historyReview:'已核对原款、积分及外部退款'});
    signIn(finance,'admin');
    await expectJson(preview(prepare),409);
    const source=action('review_refund_source','review-exact-original',id,{paymentId:attempt.id,originalTradeNo:tradeNo,customerKey:owner});
    await expectJson(preview({...source,data:{...source.data,customerKey:outsider}}),409);
    const verified=await record(finance,source);
    const prepared=await record(finance,prepare);
    const expected=await expectJson(preview(action('approve_refund','preview-not-execute-real-refund',id)),200);
    expect(expected.preview.snapshot.operation).toMatchObject({preparedId:prepared.eventId,position:{originalAcceptance:null,paidCents:20000,
      verifiedPayment:{paymentId:attempt.id,tradeNo,amountCents:20000}}});
    const workspace=await prisma.$transaction(tx=>financeWorkspace(tx,personalOrder));
    expect(workspace.latePayments[0]).toMatchObject({id:attempt.id,refund:{reviewId:verified.eventId,paidCents:0,receivedCents:20000}});
    expect(await prisma.order.findUniqueOrThrow({where:{id:personalOrder}})).toMatchObject({status,paidAt:null});
    expect(await prisma.paymentAttempt.findUniqueOrThrow({where:{id:attempt.id}})).toEqual(actual);
    expect(await prisma.customerCashPosting.count({where:{orderId:personalOrder}})).toBe(0);
    expect(await prisma.afterSaleEvent.count({where:{caseId:id,action:'refund_result'}})).toBe(0);
    if(status==='cancelled'){
      const approval=await record(finance, action('approve_refund','synthetic-authorize-only',id));
      const actualApproval=await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:approval.eventId}});
      vi.setSystemTime(Math.max(Date.now(),actualApproval.createdAt.getTime())+3*60000);
      const failed=await record(finance,action('refund_result','synthetic-processor-declines',id,{
        result:'failed',referenceNo:'OFFICE-DENIED-INSTRUCTION',method:'alipay',recipient:payee,destination}));
      const stop=await record(finance,action('stop_refund','actual-denial-confirmation-from-channel',id,{
        result:'failed',referenceNo:'OFFICE-DENIED-INSTRUCTION',confirmStopped:true}));
      signIn(clerk,'admin');
      const withdrawal=action('agreement','customer-accepts-withdrawing-unpaid-balance',id,{
        remedy:'refund_withdraw',customerDecision:'原渠道指令已终止，书面确认取消未实际退款的余额',revisesAgreementId:decision.eventId});
      const requested=(await expectJson(preview(withdrawal),200)).preview.snapshot.operation;
      expect(requested).toMatchObject({originalRefundStopId:stop.eventId,remedy:'refund_withdraw'});
      expect(requested).not.toHaveProperty('previouslyRefundedCents');
      const accepted=await record(clerk,withdrawal);
      signIn(finance,'admin');
      const recordForFinance=(await expectJson(adminRead(),200)).workspace.cases[0].events.find((event:{id:string})=>event.id===accepted.eventId);
      expect(recordForFinance.operation).toMatchObject({originalRefundStopId:stop.eventId,releasedCents:20000,previouslyRefundedCents:0});
      expect(await prisma.afterSaleCase.findUniqueOrThrow({where:{id}})).toMatchObject({customerState:'awaiting_close'});
      expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:failed.eventId}})).detail).operation)
        .toMatchObject({result:'failed',amountCents:0});
      expect((await prisma.$transaction(tx=>financeWorkspace(tx,personalOrder))).latePayments[0].refund).toBeNull();
      expect(await prisma.paymentAttempt.findUniqueOrThrow({where:{id:attempt.id}})).toEqual(actual);
    }

  });

  it.each(['cancelled','unpaid'] as const)('验签旧价原款按真实100元办理，未接单的现价80元不截减（%s）',async status=>{
    await prisma.order.update({where:{id:personalOrder},data:{status,paymentMethod:'alipay',total:80,subtotal:80}});
    await prisma.orderItem.update({where:{id:line(personalOrder)},data:{quantity:1,unitPrice:80}});
    const outTradeNo='OFFICE-VERIFIED-PRECEDING-PRICE-100';
    const tradeNo='OFFICE-REAL-EARLIER-100-RECEIPT';
    const seed=await prisma.paymentAttempt.create({data:{orderId:personalOrder,provider:'alipay',outTradeNo,amount:100}});
    const gateway=new URLSearchParams({app_id:'office-test-app',seller_id:'office-test-shop',out_trade_no:outTradeNo,
      trade_no:tradeNo,total_amount:'100.00',trade_status:'TRADE_SUCCESS'});
    expect(await (await alipayNotify(new Request('http://localhost/api/payments/alipay/notify',{method:'POST',body:gateway}))).text()).toBe('success');
    const actual=await prisma.paymentAttempt.findUniqueOrThrow({where:{id:seed.id}});
    expect(actual.status).toBe('rejected_amount_mismatch');
    signIn(clerk,'admin');
    const {caseId}=await record(clerk,action('open','reported-verified-preceding-price','',{
      orderItemId:line(personalOrder),quantity:1,issue:'cancellation',channel:'email'}));
    await record(clerk,action('claim','claim-actual-original-amount',caseId));
    const decision=action('agreement','written-authorization-for-real-old-trade',caseId,{
      remedy:'refund',amountCents:10000,recipient:payee,destination,method:'alipay',customerDecision:'按验签原流水100元退至书面确认账户'});
    const entered=(await expectJson(preview(decision),200)).preview.snapshot.operation;
    expect(entered).toEqual({remedy:'refund',amountCents:10000,recipient:payee,destination,method:'alipay',quantity:1});
    const confirmed=await record(clerk,decision);
    expect(Object.keys(confirmed).sort()).toEqual(['applied','caseId','eventId','repeated']);
    expect((await expectJson(adminRead(),200)).workspace.cases[0].events.find((item:{id:string})=>item.id===confirmed.eventId).operation).toBeNull();
    await expectJson(preview(action('approve_refund','unauthorized-ordinary-order-clerk',caseId)),403);
    signIn(finance,'admin');
    const preparation=action('prepare_refund','actual-preceding-trade-prepared',caseId,{historyReview:'核实旧价、原到账总额、未作销货、未重复支付'});
    await expectJson(preview(preparation),409);
    const verify=action('review_refund_source','review-verified-100',caseId,{paymentId:actual.id,originalTradeNo:tradeNo,customerKey:owner});
    await expectJson(preview({...verify,data:{...verify.data,originalTradeNo:'某个不同流水'}}),409);
    await record(finance,verify);
    const approvedView=await record(finance,preparation);
    expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:approvedView.eventId}})).detail).operation.position).toMatchObject({
      independentReceipt:true,paidCents:10000,caseGoodsCents:8000,originalPaymentId:actual.id,originalAcceptance:null});
    const approve=action('approve_refund','approve-local-terms-not-send-any-transfer',caseId);
    const draft=await expectJson(preview(approve),200);
    await expectJson(confirm(approve,draft.preview.actionHash),403);
    const approved=await record(finance,approve);
    const persisted=await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:approved.eventId}});
    vi.setSystemTime(Math.max(Date.now(),persisted.createdAt.getTime())+31_000);
    const response=action('refund_result','preview-local-receipt-not-booked',caseId,
      {result:'paid',amountCents:10000,referenceNo:'OFFICE-SIMULATED-RETURN-RECEIPT',recipient:payee,destination,method:'alipay'});
    expect((await expectJson(preview(response),200)).preview.snapshot.operation).toMatchObject({
      approvalId:approved.eventId,sourcePaymentId:actual.id,amountCents:10000});
    await expectJson(preview({...response,data:{...response.data,amountCents:10001}}),409);
    expect(await prisma.afterSaleEvent.count({where:{caseId,action:'refund_result'}})).toBe(0);
    expect(await prisma.order.findUniqueOrThrow({where:{id:personalOrder}})).toMatchObject({status,total:80,paidAt:null});
    expect(await prisma.customerCashPosting.count({where:{orderId:personalOrder}})).toBe(0);
  });

  it.each(['held', 'separate'] as const)('原付款的预留可具名解除并保留销货款与额外验签流水（%s）', async kind => {
    const product = await prisma.product.create({data:{id:'office-release-product',name:'合成文件夹',catalogNumber:'OFFICE-RELEASE-FOLDER',
      brand:'合成办公品牌',stockQuantity:kind==='held'?0:5,price:100}});
    await prisma.orderItem.update({where:{id:line(personalOrder)},data:{productId:product.id}});
    await prisma.order.update({where:{id:personalOrder},data:{status:'unpaid',paymentMethod:'alipay',autoCloseAt:new Date(Date.now()+86400000)}});
    async function receive(label:string,status?:string,amount=200) {
      const outTradeNo='OFFICE-SIGNED-ATTEMPT-'+label;
      const tradeNo='OFFICE-SIGNED-TRADE-'+label;
      const attempt=await prisma.paymentAttempt.create({data:{orderId:personalOrder,provider:'alipay',outTradeNo,amount,status}});
      const form=new URLSearchParams({app_id:'office-test-app',seller_id:'office-test-shop',out_trade_no:outTradeNo,
        trade_no:tradeNo,total_amount:amount.toFixed(2),trade_status:'TRADE_SUCCESS'});
      expect(await (await alipayNotify(new Request('http://localhost/api/payments/alipay/notify',{method:'POST',body:form}))).text()).toBe('success');
      return prisma.paymentAttempt.findUniqueOrThrow({where:{id:attempt.id}});
    }
    const original=await receive('ORIGINAL');
    expect(original.status).toBe(kind==='held'?'paid_stock_shortfall_reconciliation_required':'paid');
    if(kind==='separate') await acceptOriginalOrder();
    const selected=kind==='held'?original:await receive('OLDER-INDEPENDENT','superseded',300);
    if(kind==='separate') expect(selected.status).toBe('paid_superseded_reconciliation_required');
    const cashBefore=await prisma.customerCashPosting.findMany({where:{orderId:personalOrder}});
    const view=()=>prisma.$transaction(tx=>financeWorkspace(tx,personalOrder));
    signIn(finance,'admin');
    expect((await expectJson(adminRead(),200)).workspace.refundSources.map((item:{id:string})=>item.id)).toEqual([selected.id]);
    const b4Actor={id:finance,email:email(finance)};
    async function originalFinance(actionName:FinanceInput['action'], label:string) {
      vi.setSystemTime(Date.now()+31_000);
      return prisma.$transaction(async tx=>{
        const view=await financeWorkspace(tx,personalOrder);
        const input:FinanceInput={orderId:personalOrder,action:actionName,requestId:label,version:view.version,
          data:{sourceId:selected.id,reference:label,occurredAt:new Date().toISOString(),sha256:pricingContentHash(label),description:'合成到账按原流水接续'}};
        const draft=await previewFinanceAction(tx,input,b4Actor);
        return applyFinanceAction(tx,input,b4Actor,draft.actionHash,{permission:'finance.write',action:'admin_sensitive',
          sessionFingerprint:pricingContentHash(b4Actor),verifiedAt:new Date().toISOString()});
      });
    }
    const claim=await originalFinance('review_payment_case','OFFICE-ORIGINAL-B4-CLAIM');
    signIn(clerk,'admin');
    const {caseId}=await record(clerk,action('open','receipt-only-local-case','',{orderItemId:line(personalOrder),channel:'email',issue:'other',quantity:2}));
    await record(clerk,action('claim','receipt-only-local-claim',caseId));
    const decision=await record(clerk,action('agreement','early-consent-for-review',caseId,{remedy:'refund',customerDecision:'原书证仅同意核对所选实收',
      amountCents:kind==='held'?20000:25000,recipient:payee,destination,method:'alipay'}));
    signIn(finance,'admin');
    const source=(payment:typeof original)=>action('review_refund_source','link-original-source-'+payment.id,caseId,{
      paymentId:payment.id,originalTradeNo:payment.tradeNo,customerKey:owner});
    if(kind==='separate') await expectJson(preview(source(original)),409);
    if(kind==='separate'){
      const ordinary=action('prepare_refund','ordinary-sale-cannot-borrow-another-trade',caseId,{historyReview:'只核对原销售款'});
      expect((await expectJson(preview(ordinary),409)).error).toContain('剩余实收款');
    }
    const reserved=await record(finance,source(selected));
    expect((await view()).latePayments[0]).toMatchObject({id:selected.id,review:{claimId:claim},refund:{reviewId:reserved.eventId,paidCents:0}});
    if(kind==='separate') {
      const prepared=await record(finance,action('prepare_refund','prepare-only-extra-not-original',caseId,{historyReview:'原销货款已独立入账，不动原销售流水'}));
      expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:prepared.eventId}})).detail).operation.position)
        .toMatchObject({paidCents:30000,caseGoodsCents:20000,independentReceipt:true,originalPaymentId:selected.id});
    }
    signIn(clerk,'admin');
    const retain=await record(clerk,action('agreement','later-written-continue-original-sale',caseId,{remedy:'keep',
      customerDecision:'客户书面要求保留原单，尚未发出任何退款指令',revisesAgreementId:decision.eventId}));
    await expectJson(preview(action('close','cannot-close-while-original-money-held',caseId)),409);
    expect((await view()).latePayments[0].refund).not.toBeNull();
    const release=action('release_refund_source','named-release-precise-hold',caseId,{reviewId:reserved.eventId,confirmUnsent:true});
    await expectJson(preview(release),403);
    signIn(finance,'admin');
    const done=await record(finance,release);
    expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:done.eventId}})).detail).operation)
      .toMatchObject({reviewId:reserved.eventId,agreementId:retain.eventId,b4ClaimId:claim,originalPayment:{paymentId:selected.id,tradeNo:selected.tradeNo}});
    expect((await view()).latePayments[0]).toMatchObject({id:selected.id,review:{claimId:claim},refund:null});
    expect(await prisma.afterSaleEvent.count({where:{caseId,action:{in:['refund_result','approve_refund']}}})).toBe(0);
    expect(await prisma.customerCashPosting.findMany({where:{orderId:personalOrder}})).toEqual(cashBefore);
    if(kind==='held') {
      await prisma.product.update({where:{id:product.id},data:{stockQuantity:5}});
      await originalFinance('resume_alipay_payment','OFFICE-B4-CONTINUE-SAME-RECEIPT');
      expect((await view()).nativePaymentId).toBe(original.id);
      expect(await prisma.paymentAttempt.count({where:{orderId:personalOrder}})).toBe(1);
    } else {
      expect((await view()).nativePaymentId).toBe(original.id);
      expect(await prisma.paymentAttempt.findUniqueOrThrow({where:{id:selected.id}})).toEqual(selected);
    }
  });

  it('同一整票在第二单用原红冲回执，逐商品金额封顶并跟到实际替代票', async()=>{
    const other = 'OFFICE-SAME-CUSTOMER-SECOND-ORDER';
    const secondItem=other+'-stapler';
    await seedOrder(other,owner);
    await prisma.orderItem.create({data:{id:secondItem,orderId:other,position:1,name:'合成订书机',quantity:1,unitPrice:50}});
    await prisma.order.update({where:{id:other},data:{subtotal:0,total:0}});
    await acceptOriginalOrder();
    await acceptOriginalOrder(other);
    const parties={issuer:'合成统一开票方',recipient:'合成同一客户'};
    const arrange={...parties,side:'customer',trigger:'accepted'};
    const a=(await financeRecord('create_plan',personalOrder,'OFFICE-A-ORIGINAL-PLAN',{...arrange,grossCents:2000})).workspace.invoicePlans[0];
    const bRoot=await financeRecord('verify_customer_invoice_scope',other,'OFFICE-B-BASE-SCOPE',{...parties,grossCents:6000,invoiceLineIds:[line(other),secondItem]});
    const bSpecific=await financeRecord('verify_customer_invoice_scope',other,'OFFICE-B-ONLY-STAPLER',{...parties,grossCents:4000,
      invoiceScopeBasisId:bRoot.eventId,invoiceLines:[{orderItemId:secondItem,quantity:1}]});
    const b=(await financeRecord('create_plan',other,'OFFICE-B-ORIGINAL-PLAN',{...arrange,grossCents:5000,invoiceScopeId:bRoot.eventId})).workspace.invoicePlans[0];
    const portions=[{invoiceScopeId:bRoot.eventId,amountCents:1000,lines:[{orderItemId:line(other),quantity:1}]},
      {invoiceScopeId:bSpecific.eventId,amountCents:4000,lines:[{orderItemId:secondItem,quantity:1}]}];
    await financeRecord('verify_invoice_coverage',other,'OFFICE-EXACT-TWO-GOODS-PORTIONS',{planId:b.id,portions});
    const issuedAt=new Date().toISOString();
    const same={...parties,number:'OFFICE-SHARED-ACROSS-ORDERS-70',grossCents:7000,issuedAt};
    const aPosted=await financeRecord('record_invoice',personalOrder,'OFFICE-SAME-A-B-DOCUMENT',{...same,planId:a.id,amountCents:2000});
    const bPosted=await financeRecord('record_invoice',other,'OFFICE-SAME-A-B-DOCUMENT',{...same,planId:b.id,amountCents:5000,portions});
    const aPart=aPosted.workspace.invoicePlans[0].allocations[0];
    const bPart=bPosted.workspace.invoicePlans[0].allocations[0];
    expect(aPart.invoiceId).toBe(bPart.invoiceId);
    const sale=(id:string, kind:SaleInput['action'], slug:string, caseId:string, data:object={})=>
      ({...action(kind,slug,caseId,data),orderId:id});
    async function open(id:string,item:string,slug:string) {
      vi.setSystemTime(Date.now()+3_600_000);
      const {caseId}=await record(clerk,sale(id,'open','open-'+slug,'',{orderItemId:item,issue:'invoice',channel:'email',quantity:1}));
      await record(clerk,sale(id,'claim','claim-'+slug,caseId));
      return caseId as string;
    }
    signIn(clerk,'admin');
    const caseA=await open(personalOrder,line(personalOrder),'invoice-case-a');
    const caseSmall=await open(other,line(other),'invoice-line-first-case');
    const caseTooMuch=await open(other,line(other),'invoice-line-second-case');
    const caseStapler=await open(other,secondItem,'invoice-line-stapler-reissue');
    async function agree(id:string,c:string,slug:string,allocationId:string,amountCents:number,redo=false) {
      vi.setSystemTime(Date.now()+3_600_000);
      return record(clerk,sale(id,'agreement',slug,c,{remedy:'invoice',customerDecision:'本次按商品和明确金额处理原票',
        invoiceAllocationId:allocationId,amountCents,invoiceOutcome:redo?'reissue':'voided',...(redo?{replacementAmountCents:amountCents}:{})}));
    }
    await agree(personalOrder,caseA,'agree-shared-A',aPart.id,2000);
    await agree(other,caseSmall,'agree-first-share-B',bPart.id,700);
    await agree(other,caseTooMuch,'agree-repeat-share-B',bPart.id,600);
    await agree(other,caseStapler,'agree-stapler-void-and-reissue',bPart.id,4000,true);
    await financeRecord('open_correction',personalOrder,'OFFICE-A-ORIGINAL-START-VOID',{invoiceId:aPart.invoiceId});
    const red=await financeRecord('resolve_correction',personalOrder,'OFFICE-A-ORIGINAL-WHOLE-RED-RECEIPT',{invoiceId:aPart.invoiceId,outcome:'voided'});
    signIn(finance,'admin');
    expect((await expectJson(adminRead(other),200)).workspace.invoiceChoices).toEqual(expect.arrayContaining([
      expect.objectContaining({id:bPart.id,correction:expect.objectContaining({id:red.eventId,orderId:personalOrder,outcome:'voided',
        reference:red.evidence.reference,sha256:red.evidence.sha256,occurredAt:red.evidence.occurredAt})}),
    ]));
    const use=(id:string,caseId:string)=>sale(id,'invoice_outcome','use-the-same-original-red-'+caseId,caseId,
      {...red.evidence,financeEventId:red.eventId});
    await record(finance,use(personalOrder,caseA));
    const applied=await record(finance,use(other,caseSmall));
    expect(Object.keys(applied).sort()).toEqual(['applied','caseId','eventId','repeated']);
    expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:applied.eventId}})).detail).operation)
      .toMatchObject({financeOrderId:personalOrder,financeEventId:red.eventId,allocationId:bPart.id,scope:{lineLimitCents:1000},amountCents:700});
    expect((await expectJson(preview(use(other,caseTooMuch)),409)).error).toContain('商品行');
    await record(finance,use(other,caseStapler));
    expect(await prisma.afterSaleCase.findUniqueOrThrow({where:{id:caseStapler}})).toMatchObject({customerState:'awaiting_invoice_reissue'});
    signIn(clerk,'admin');
    await expectJson(preview(sale(other,'close','before-actual-issue',caseStapler)),409);

    signIn(finance,'admin');
    const replacement=await financeRecord('record_invoice',other,'OFFICE-ACTUAL-REISSUED-STAPLER',{
      ...parties,number:'OFFICE-REISSUE-40',planId:b.id,grossCents:4000,amountCents:4000,portions:[portions[1]],
      issuedAt:new Date().toISOString(),correctionEventId:red.eventId});
    const replacementPart=replacement.workspace.invoicePlans.find(row=>row.id===b.id)!.allocations.find(row=>row.number==='OFFICE-REISSUE-40')!;
    const confirmReissue=(invoiceAllocationId:string)=>sale(other,'invoice_reissue','confirm-actual-reissue-allocation',caseStapler,{invoiceAllocationId});
    await expectJson(preview(confirmReissue(bPart.id)),409);
    const issued=await record(finance,confirmReissue(replacementPart.id));
    expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:issued.eventId}})).detail).operation)
      .toMatchObject({originalInvoiceId:aPart.invoiceId,replacementEventId:replacement.eventId,number:'OFFICE-REISSUE-40',
        financeEventId:red.eventId,linkedAtIssuance:true,amountCents:4000,scope:{lineLimitCents:4000}});
    expect(await prisma.afterSaleCase.findUniqueOrThrow({where:{id:caseStapler}})).toMatchObject({customerState:'awaiting_close'});
    expect(await prisma.financeInvoice.count()).toBe(2);
    expect(await prisma.customerCashPosting.count()).toBe(0);
  });

  it('旧票只记录合计时，须先具名核对原件，另一商品的分摊不会被借用',async()=>{
    const other=line(personalOrder)+'-labels';
    await prisma.orderItem.create({data:{orderId:personalOrder,id:other,position:1,name:'合成标签',quantity:1,unitPrice:30}});
    await prisma.order.update({where:{id:personalOrder},data:{subtotal:230,total:230}});
    await acceptOriginalOrder();
    const parties={issuer:'合成旧票出票方',recipient:'合成旧票客户'};
    const plan=(await financeRecord('create_plan',personalOrder,'OFFICE-OLD-INVOICE-PLANNED',{...parties,side:'customer',trigger:'accepted',grossCents:4500})).workspace.invoicePlans[0];
    const original=await financeRecord('record_invoice',personalOrder,'OFFICE-EARLIER-NO-LINE-AMOUNTS',{...parties,planId:plan.id,
      amountCents:4500,grossCents:4500,issuedAt:new Date().toISOString(),number:'ARCHIVED-OFFICE-4500'});
    const part=original.workspace.invoicePlans[0].allocations[0];
    async function note(itemId:string,amountCents:number,slug:string) {
      vi.setSystemTime(Date.now()+3_600_000);
      signIn(clerk,'admin');
      const {caseId}=await record(clerk,action('open','open-'+slug,'',{orderItemId:itemId,quantity:1,issue:'invoice',channel:'email'}));
      await record(clerk,action('claim','claim-'+slug,caseId));
      await record(clerk,action('agreement','agree-'+slug,caseId,{remedy:'invoice',invoiceAllocationId:part.id,
        amountCents,invoiceOutcome:'voided',customerDecision:'仅按原票与实际金额办理'}));
      return caseId as string;
    }
    const first=await note(line(personalOrder),2600,'first-authentic-case');
    const second=await note(other,1900,'second-authentic-case');
    await financeRecord('open_correction',personalOrder,'OFFICE-OLD-INVOICE-BEGIN-CORRECTION',{invoiceId:part.invoiceId});
    const correction=await financeRecord('resolve_correction',personalOrder,'OFFICE-ORIGINAL-RED-BOOKED',{invoiceId:part.invoiceId,outcome:'voided'});
    signIn(finance,'admin');
    const resolve=(caseId:string)=>action('invoice_outcome','recognize-corrected-amount-'+caseId,caseId,{...correction.evidence,financeEventId:correction.eventId});
    expect((await expectJson(preview(resolve(first)),409)).error).toContain('凭原件核对');
    const verify=(caseId:string,amountCents:number)=>action('verify_invoice_line','original-line-paper-'+caseId,caseId,{invoiceAllocationId:part.id,amountCents});
    const firstReview=await record(finance,verify(first,2600));
    await record(finance,resolve(first));
    await expectJson(preview(verify(second,2500)),409);
    expect((await expectJson(preview(resolve(second)),409)).error).toContain('凭原件核对');
    const secondReview=await record(finance,verify(second,1900));
    await record(finance,resolve(second));
    const events=await prisma.afterSaleEvent.findMany({where:{action:'invoice_outcome'}});
    expect(events.map(event=>JSON.parse(event.detail).operation.scope.reviewId)).toEqual(expect.arrayContaining([firstReview.eventId,secondReview.eventId]));
    expect(await prisma.financeInvoiceAllocation.findUniqueOrThrow({where:{id:part.id}})).toMatchObject({amountCents:BigInt(4500)});
  });

  it.each(['amend','withdraw'] as const)('不同的实办回执各有金额上限，原票红冲后继续处理尚未重开的决定（%s）',async next=>{
    await acceptOriginalOrder();
    const parties={issuer:'合成改票出票方',recipient:'合成收票方'};
    const plan=(await financeRecord('create_plan',personalOrder,'OFFICE-CORRECTION-VERSION-PLAN',
      {...parties,side:'customer',trigger:'accepted',grossCents:10000})).workspace.invoicePlans[0];
    const booked=await financeRecord('record_invoice',personalOrder,'OFFICE-PREVIOUS-INVOICE-100',
      {...parties,planId:plan.id,grossCents:10000,amountCents:10000,number:'OFFICE-RETAIN-THEN-VOID',issuedAt:new Date().toISOString()});
    const part=booked.workspace.invoicePlans[0].allocations[0];
    async function startCase(tag:string) {
      vi.setSystemTime(Date.now()+3_600_000);
      signIn(clerk,'admin');
      const {caseId}=await record(clerk,action('open','open-'+tag,'',{orderItemId:line(personalOrder),quantity:1,issue:'invoice',channel:'email'}));
      await record(clerk,action('claim','claim-'+tag,caseId));
      const agreed=await record(clerk,action('agreement','agree-retain-'+tag,caseId,{remedy:'invoice',invoiceAllocationId:part.id,
        amountCents:10000,invoiceOutcome:'retained',customerDecision:'此版书面核对原票全额保留'}));
      return {caseId:caseId as string,agreementId:agreed.eventId};
    }
    const primary=await startCase('first-original-retained');
    const overlap=await startCase('second-attempt-same-receipt');
    async function resolve(outcome:'retained'|'voided') {
      await financeRecord('open_correction',personalOrder,'OFFICE-NEW-CLAIM-'+outcome,{invoiceId:part.invoiceId});
      return financeRecord('resolve_correction',personalOrder,'OFFICE-ACTUAL-RECEIPT-'+outcome,{invoiceId:part.invoiceId,outcome});
    }
    function link(caseId:string,actual:Awaited<ReturnType<typeof resolve>>) {
      return action('invoice_outcome','attach-actual-receipt-'+actual.eventId+'-'+caseId,caseId,{...actual.evidence,financeEventId:actual.eventId});
    }
    const retained=await resolve('retained');
    signIn(finance,'admin');
    await record(finance,link(primary.caseId,retained));
    expect((await expectJson(preview(link(overlap.caseId,retained)),409)).error).toContain('原金额不足');
    signIn(clerk,'admin');
    const redDecision=await record(clerk,action('agreement','new-written-void-and-reissue',primary.caseId,{
      revisesAgreementId:primary.agreementId,remedy:'invoice',invoiceAllocationId:part.id,amountCents:10000,
      invoiceOutcome:'reissue',replacementAmountCents:10000,customerDecision:'客户变更为红冲后另开'}));
    const red=await resolve('voided');
    signIn(finance,'admin');
    const savedRed=await record(finance,link(primary.caseId,red));
    signIn(clerk,'admin');
    const revising=action('agreement','new-undelivered-reissue-decision',primary.caseId,{revisesAgreementId:redDecision.eventId,remedy:'invoice',
      invoiceAllocationId:part.id,invoiceOutcome:next==='amend'?'reissue':'voided',...(next==='amend'?{replacementAmountCents:6000}:{}),
      customerDecision:next==='amend'?'客户书面调整尚未开出的替代票至60元':'客户书面撤回尚未开出的替代票'});
    await expectJson(preview({...revising,data:{...revising.data,amountCents:6000}}),409);
    const revised=await record(clerk,revising);
    const recordedRights=JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:revised.eventId}})).detail).operation.invoice;
    expect(recordedRights).toMatchObject({allocationId:part.id,correctionId:savedRed.eventId,amountCents:10000,
      replacementAmountCents:next==='amend'?6000:null});
    expect(await prisma.afterSaleEvent.count({where:{caseId:primary.caseId,action:'invoice_outcome'}})).toBe(2);
    if(next==='amend'){
      const replacement=await financeRecord('record_invoice',personalOrder,'OFFICE-ISSUED-REAL-REPLACEMENT-60',{
        ...parties,number:'LATER-ACTUAL-60',planId:plan.id,grossCents:6000,amountCents:6000,issuedAt:new Date().toISOString(),correctionEventId:red.eventId});
      const actual= replacement.workspace.invoicePlans[0].allocations.find(item=>item.number==='LATER-ACTUAL-60')!;
      const tooLate=action('agreement','cannot-withdraw-actually-issued-invoice',primary.caseId,{revisesAgreementId:revised.eventId,remedy:'invoice',
        invoiceOutcome:'voided',customerDecision:'原重开已经真实签发，不能直接改回',invoiceAllocationId:part.id});
      expect((await expectJson(preview(tooLate),409)).error).toContain('实际重开票');
      signIn(finance,'admin');
      const linkNew=await record(finance,action('invoice_reissue','link-after-valid-amendment',primary.caseId,{invoiceAllocationId:actual.id}));
      expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:linkNew.eventId}})).detail).operation)
        .toMatchObject({correctionId:savedRed.eventId,financeEventId:red.eventId,amountCents:6000});
    } else {
      expect(await prisma.financeInvoice.count()).toBe(1);
      expect(await prisma.afterSaleEvent.count({where:{caseId:primary.caseId,action:'invoice_reissue'}})).toBe(0);
    }
    expect(await prisma.afterSaleCase.findUniqueOrThrow({where:{id:primary.caseId}})).toMatchObject({customerState:'awaiting_close'});
    expect(await prisma.customerCashPosting.count()).toBe(0);
  });

  async function correctedInvoice() {
    await acceptOriginalOrder();
    const parties={issuer:'合成续开出票方',recipient:'合成办公收票方'};
    const plan=(await financeRecord('create_plan',personalOrder,'OFFICE-ORIGINAL-PLAN-100',
      {...parties,side:'customer',trigger:'accepted',grossCents:10000})).workspace.invoicePlans[0];
    async function issue(slug:string,amountCents:number,correctionEventId?:string) {
      const actual=await financeRecord('record_invoice',personalOrder,slug,{...parties,planId:plan.id,
        amountCents,grossCents:amountCents,number:slug,issuedAt:new Date().toISOString(),...(correctionEventId?{correctionEventId}:{})});
      return actual.workspace.invoicePlans[0].allocations.find(row=>row.number===slug)!;
    }
    const original=await issue('OFFICE-ORIGINAL-INVOICE-100',10000);
    async function begin(slug:string,amount:number) {
      vi.setSystemTime(Date.now()+3_600_000);
      signIn(clerk,'admin');
      const {caseId}=await record(clerk,action('open','open-'+slug,'',{orderItemId:line(personalOrder),issue:'invoice',quantity:1,channel:'email'}));
      await record(clerk,action('claim','claim-'+slug,caseId));
      const agreed=await record(clerk,action('agreement','agree-actual-replacement-'+slug,caseId,{remedy:'invoice',invoiceAllocationId:original.id,
        invoiceOutcome:'reissue',amountCents:amount,replacementAmountCents:amount,customerDecision:'明确同意原票红冲后按真实票据重开'}));
      return {id:caseId as string,agreementId:agreed.eventId};
    }
    async function correct(cases:{id:string}[]) {
      await financeRecord('open_correction',personalOrder,'OFFICE-REISSUE-RED-REQUEST',{invoiceId:original.invoiceId});
      const red=await financeRecord('resolve_correction',personalOrder,'OFFICE-REISSUE-RED-ACTUAL-RECEIPT',{invoiceId:original.invoiceId,outcome:'voided'});
      signIn(finance,'admin');
      vi.setSystemTime(Date.now()+3_600_000);
      for(const item of cases) await record(finance,action('invoice_outcome','link-red-'+item.id,item.id,{...red.evidence,financeEventId:red.eventId}));
      return red.eventId as string;
    }
    return {original,begin,correct,issue};
  }

  it.each(['unchanged','amend-before-entry','amend-after-entry','withdraw-before-entry'] as const)(
    '一案两张替代票保留实办金额，已签发60元仍按原票面接续（%s）',async sequence=>{
      const {original,begin,correct,issue}=await correctedInvoice();
      const current=await begin('two-replacement-invoices',10000);
      const red=await correct([current]);
      const first=await issue('OFFICE-EXISTING-REPLACEMENT-60',6000,red);
      const attach=(tag:string,allocationId:string,amountCents:number)=>
        action('invoice_reissue',tag,current.id,{invoiceAllocationId:allocationId,amountCents});
      const firstInput=attach('link-original-actual-60',first.id,6000);
      if(sequence==='unchanged'||sequence==='amend-after-entry'){
        vi.setSystemTime(Date.now()+3_600_000);
        const firstResult=await record(finance,firstInput);
        expect(await prisma.afterSaleCase.findUniqueOrThrow({where:{id:current.id}})).toMatchObject({customerState:'awaiting_invoice_reissue'});
        expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:firstResult.eventId}})).detail).operation)
          .toMatchObject({amountCents:6000,remainingCents:4000});
        expect((await record(finance,{...firstInput,requestId:'retry-first-replacement'}))).toMatchObject({eventId:firstResult.eventId,repeated:true});
      }
      const withdrawing=sequence==='withdraw-before-entry';
      if(sequence!=='unchanged'){
        signIn(clerk,'admin');
        const revised=await record(clerk,action('agreement','new-agreement-only-unissued-amount',current.id,{
          remedy:'invoice',revisesAgreementId:current.agreementId,invoiceAllocationId:original.id,
          invoiceOutcome:withdrawing?'voided':'reissue',...(withdrawing?{}:{replacementAmountCents:3000}),
          customerDecision:'已开60元保留，仅调整或撤回尚未签发部分'}));
        expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:revised.eventId}})).detail).operation.invoice).toMatchObject({
          replacementIssuedCents:6000,replacementRecordedCents:sequence==='amend-after-entry'?6000:0,
          replacementRemainingCents:withdrawing?0:3000,replacementAmountCents:withdrawing?6000:9000,
          replacementIssuedParts:[{allocationId:first.id,amountCents:6000}],
        });
      }
      signIn(finance,'admin');
      vi.setSystemTime(Date.now()+3_600_000);
      let secondPart=null;
      if(!withdrawing){
        const count=sequence==='unchanged'?4000:3000;
        const second=await issue('OFFICE-SECOND-ACTUAL-REPLACEMENT',count,red);
        secondPart={allocationId:second.id,amountCents:count};
        const excess=attach('incorrectly-grow-second-replacement',second.id,count+1);
        await expectJson(preview(excess),409);
        await record(finance,attach('link-second-actual-replacement',second.id,count));
      }
      if(sequence==='amend-before-entry'||withdrawing) await record(finance,firstInput);
      expect(await prisma.afterSaleCase.findUniqueOrThrow({where:{id:current.id}})).toMatchObject({customerState:'awaiting_close'});
      const results=await prisma.afterSaleEvent.findMany({where:{caseId:current.id,action:'invoice_reissue'}});
      expect(results.map(row=>JSON.parse(row.detail).operation)).toEqual(expect.arrayContaining([
        expect.objectContaining({allocationId:first.id,amountCents:6000,financeEventId:red,number:first.number}),
        ...(secondPart?[expect.objectContaining(secondPart)]:[]),
      ]));
      expect(results).toHaveLength(withdrawing?1:2);
      expect(await prisma.customerCashPosting.count()).toBe(0);
    });

  it('多个案件同用一张实际替代票，争议先凭原件逐案回填且总额防重',async()=>{
    const {original,begin,correct,issue}=await correctedInvoice();
    const a=await begin('two-shares-case-a',5000);
    const b=await begin('two-shares-case-b',5000);
    const red=await correct([a,b]);
    const printed=await issue('OFFICE-ONE-PROVEN-REPLACEMENT-60',6000,red);
    signIn(clerk,'admin');
    const amendment=action('agreement','only-modify-remaining-after-manual-attribution',a.id,{
      remedy:'invoice',revisesAgreementId:a.agreementId,invoiceAllocationId:original.id,invoiceOutcome:'reissue',
      replacementAmountCents:1000,customerDecision:'原件核对两案份额，客户仅改明细A尚未签发的金额'});
    expect((await expectJson(preview(amendment),409)).error).toContain('逐案核对');
    signIn(finance,'admin');
    const attach=(id:string,tag:string,amountCents:number)=>action('invoice_reissue',tag,id,{invoiceAllocationId:printed.id,amountCents});
    await record(finance,attach(a.id,'actual-share-a-30',3000));
    expect((await expectJson(preview(attach(b.id,'cannot-use-shared-31',3100)),409)).error).toContain('原金额不足');
    await record(finance,attach(b.id,'actual-share-b-30',3000));
    signIn(clerk,'admin');
    const saved=await record(clerk,amendment);
    expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:saved.eventId}})).detail).operation.invoice).toMatchObject({
      replacementIssuedCents:3000,replacementRecordedCents:3000,replacementAmountCents:4000,replacementRemainingCents:1000});
    expect(await prisma.afterSaleEvent.count({where:{action:'invoice_reissue'}})).toBe(2);
    expect(await prisma.afterSaleCase.findUniqueOrThrow({where:{id:b.id}})).toMatchObject({customerState:'awaiting_invoice_reissue'});
  });

  it.each([false,true])('B4 的共同金额按原件范围分别使用，不能借同票另一组（重叠范围 %s）',async overlap=>{
    const items=[line(personalOrder),'OFFICE-INVOICE-B','OFFICE-INVOICE-C','OFFICE-INVOICE-D'];
    for(const [position,id] of items.entries()) if(position) await prisma.orderItem.create({
      data:{id,orderId:personalOrder,position,name:'合成文具 '+id,quantity:1,unitPrice:20}});
    await prisma.order.update({where:{id:personalOrder},data:{subtotal:0,total:0}});
    await acceptOriginalOrder();
    const parties={issuer:'合成分组开票方',recipient:'合成分组受票方'};
    const base=await financeRecord('verify_customer_invoice_scope',personalOrder,'OFFICE-INITIAL-INVOICE-GOODS',{
      ...parties,grossCents:10000,invoiceLineIds:items});
    const samePaper={reference:'同一合成原件两行明确两组份额',sha256:pricingContentHash('OFFICE-SAME-STATEMENT-TWO-DISTINCT-ROWS')};
    const groups=[{items:items.slice(0,2),amountCents:1000},{items:items.slice(overlap?1:2),amountCents:9000}];
    const portions=[];
    for(const [index, group] of groups.entries()){
      const lines=group.items.map(orderItemId=>({orderItemId,quantity:1}));
      const source=await financeRecord('verify_customer_invoice_scope',personalOrder,'OFFICE-SCOPE-GROUP-'+index,{
        ...parties,...samePaper,documentRow:index+1,invoiceScopeBasisId:base.eventId,grossCents:group.amountCents,invoiceLines:lines});
      portions.push({invoiceScopeId:source.eventId,amountCents:group.amountCents,lines});
    }
    const plan=(await financeRecord('create_plan',personalOrder,'OFFICE-SHARED-SCOPE-PLAN',{...parties,side:'customer',trigger:'accepted',
      invoiceScopeId:base.eventId,grossCents:10000})).workspace.invoicePlans[0];
    await financeRecord('verify_invoice_coverage',personalOrder,'OFFICE-ORIGINAL-TWO-GROUPS',{planId:plan.id,portions});
    const booked=await financeRecord('record_invoice',personalOrder,'OFFICE-ACTUAL-INVOICE-TWO-GROUPS',{
      ...parties,planId:plan.id,number:'OFFICE-GROUPED-100',grossCents:10000,amountCents:10000,issuedAt:new Date().toISOString(),portions});
    const part=booked.workspace.invoicePlans[0].allocations[0];
    const amounts=[1000,1000,3000,overlap?5000:6000];
    const cases: string[]=[];
    for(const [index,itemId] of items.entries()){
      vi.setSystemTime(Date.now()+3_600_000);
      signIn(clerk,'admin');
      const {caseId}=await record(clerk,action('open','grouped-case-'+index,'',{orderItemId:itemId,quantity:1,issue:'invoice',channel:'email'}));
      await record(clerk,action('claim','claim-group-'+index,caseId));
      await record(clerk,action('agreement','agree-group-'+index,caseId,{remedy:'invoice',invoiceAllocationId:part.id,
        amountCents:amounts[index],invoiceOutcome:'voided',customerDecision:'书面确认本商品按实际原件分摊办理'}));
      cases.push(caseId as string);
    }
    await financeRecord('open_correction',personalOrder,'OFFICE-GROUP-RED-REQUEST',{invoiceId:part.invoiceId});
    const red=await financeRecord('resolve_correction',personalOrder,'OFFICE-GROUP-RED-RECEIPT',{invoiceId:part.invoiceId,outcome:'voided'});
    const verify=(index:number,scopeId?:string)=>action('verify_invoice_line','review-exact-group-case-'+index,cases[index],{
      invoiceAllocationId:part.id,amountCents:amounts[index],...(scopeId?{portionAmounts:[{scopeId,amountCents:amounts[index]}]}:{})});
    const finish=(index:number)=>action('invoice_outcome','finish-exact-group-case-'+index,cases[index],{...red.evidence,financeEventId:red.eventId});
    signIn(finance,'admin');
    vi.setSystemTime(Date.now()+3_600_000);
    await record(finance,verify(0));
    await record(finance,finish(0));
    expect((await expectJson(preview(verify(1,portions[0].invoiceScopeId)),409)).error).toContain('具体分摊');
    await expectJson(preview(verify(1)),409);
    if(overlap){
      vi.setSystemTime(Date.now()+3_600_000);
      await record(finance,verify(1,portions[1].invoiceScopeId));
      await record(finance,finish(1));
    }
    for (const index of [2,3]){
      vi.setSystemTime(Date.now()+3_600_000);
      await record(finance,verify(index));
      await record(finance,finish(index));
    }
    if(!overlap) await expectJson(preview(finish(1)),409);
    const uses=await prisma.afterSaleEvent.findMany({where:{action:'invoice_outcome'}});
    expect(uses.reduce((sum,event)=>sum+JSON.parse(event.detail).operation.amountCents,0)).toBe(10000);
    expect(uses.every(event=>JSON.parse(event.detail).operation.financeEventId===red.eventId)).toBe(true);
    const financialView=(await expectJson(adminRead(),200)).workspace;
    expect(financialView.invoiceChoices[0]).toMatchObject({amountCents:10000,
      linePortions:expect.arrayContaining(portions.map(source=>expect.objectContaining({invoiceScopeId:source.invoiceScopeId,amountCents:source.amountCents})))});
    signIn(clerk,'admin');
    const orderView=(await expectJson(adminRead(),200)).workspace;
    expect(orderView.invoiceChoices[0]).toMatchObject({amountCents:null,correction:null,linePortions:[]});
    expect(orderView.cases[0].events.find((event:{action:string})=>event.action==='invoice_outcome').operation)
      .not.toHaveProperty('amountCents');
    getTestDb().prepare("DELETE FROM AdminRolePermission WHERE roleId='order_admin' AND permissionId='orders.write'").run();
    const readOnly=(await expectJson(adminRead(),200)).workspace;
    expect(readOnly.invoiceChoices).toEqual(orderView.invoiceChoices);
    await expectJson(preview(action('add_evidence','read-only-orders-cannot-write',cases[0],{channel:'email'})),403);
  });

  it('发票售后只承认书面决定指定的原票分摊及实际一致的更正',async()=>{
    await acceptOriginalOrder();
    const actor={id:finance,email:email(finance)};
    async function financial(kind:FinanceInput['action'],slug:string,data:Record<string,unknown>){
      vi.setSystemTime(Date.now()+1000);
      return prisma.$transaction(async tx=>{
        const evidence={reference:slug,sha256:pricingContentHash(slug),occurredAt:new Date().toISOString(),description:'合成发票处理按原件'};
        const view=await financeWorkspace(tx,personalOrder);
        const input:FinanceInput={action:kind,requestId:slug,orderId:personalOrder,version:view.version,data:{...evidence,...data}};
        const checked=await previewFinanceAction(tx,input,actor);
        const id=await applyFinanceAction(tx,input,actor,checked.actionHash,
          {permission:'finance.write',action:'admin_sensitive',sessionFingerprint:pricingContentHash(actor),verifiedAt:new Date().toISOString()});
        return {id,evidence,workspace:await financeWorkspace(tx,personalOrder)};
      });
    }
    const booked=[];
    for(const [marker,cents] of [['ORIGINAL-A',2000],['OTHER-B',3000]] as const){
      const parties={issuer:'合成开票方',recipient:'合成客户受票方'};
      const arrange=(await financial('create_plan','PLAN-'+marker,{...parties,side:'customer',trigger:'accepted',grossCents:cents})).workspace;
      const planId=arrange.invoicePlans.find(plan=>plan.reference==='PLAN-'+marker)!.id;
      const saved=(await financial('record_invoice','ACTUAL-'+marker,{...parties,planId,number:marker,
        issuedAt:new Date().toISOString(),grossCents:cents,amountCents:cents})).workspace;
      booked.push(saved.invoicePlans.find(plan=>plan.id===planId)!.allocations[0]);
    }
    signIn(clerk,'admin');
    const opened=await record(clerk,action('open','open-invoice-only-case','',{orderItemId:line(personalOrder),channel:'email',issue:'invoice',quantity:1}));
    await record(clerk,action('claim','claim-specific-invoice',opened.caseId));
    await record(clerk,action('agreement','customer-void-original-specific',opened.caseId,{remedy:'invoice',
      invoiceAllocationId:booked[0].id,amountCents:2000,invoiceOutcome:'voided',customerDecision:'明确书面同意只对原票 A 办理红冲'}));
    const correct=async (invoiceId:string,result:'retained'|'voided',slug:string)=>{
      await financial('open_correction','OPEN-'+slug,{invoiceId});
      return financial('resolve_correction','RESOLVE-'+slug,{invoiceId,outcome:result});
    };
    const different=await correct(booked[1].invoiceId,'voided','WRONG-INVOICE');
    const wrong=await correct(booked[0].invoiceId,'retained','WRONG-RESULT');
    const acceptResult=(result:Awaited<ReturnType<typeof correct>>,slug:string)=>action('invoice_outcome','LINK-'+slug,opened.caseId,
      {...result.evidence,financeEventId:result.id});
    signIn(finance,'admin');
    await expectJson(preview(acceptResult(different,'OTHER-INVOICE')),409);
    await expectJson(preview(acceptResult(wrong,'OTHER-RESULT')),409);
    const matching=await correct(booked[0].invoiceId,'voided','RIGHT-INVOICE-AND-RESULT');
    const applied=await record(finance,acceptResult(matching,'RIGHT-INVOICE'));
    expect(await prisma.afterSaleCase.findUniqueOrThrow({where:{id:opened.caseId}})).toMatchObject({customerState:'awaiting_close'});
    expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:applied.eventId}})).detail).operation)
      .toMatchObject({invoiceId:booked[0].invoiceId,allocationId:booked[0].id,financeEventId:matching.id,result:'voided',amountCents:2000});
    expect(await prisma.customerCashPosting.count({where:{orderId:personalOrder}})).toBe(0);
  });

  it('个人订单仅归原客户，客户端自报角色及办理动作没有效力，重复申请只保留原记录', async () => {
    auth.mockResolvedValue(null);
    const request = memberInput(personalOrder, 'customer-original-request', {
      role: 'admin', action: 'supplier', ownerId: outsider, customerState: 'closed',
    });
    await expectJson(memberReport(personalOrder, request), 401);
    signIn(outsider);
    await expectJson(memberRead(personalOrder), 404);
    await expectJson(memberReport(personalOrder, request), 404);
    signIn(owner);
    await expectJson(adminPOST(post(adminUrl, { ...action('open', 'self-declared-admin', ''), role: 'admin', stage: 'preview' })), 403);
    signIn(owner, 'admin');
    await expectJson(preview(action('open', 'claim-admin-with-no-stored-permissions', '')), 403);
    signIn(owner);
    const created = await expectJson(memberReport(personalOrder, request), 200);
    expect(created).toMatchObject({ id: expect.any(String), repeated: false });
    expect(await expectJson(memberReport(personalOrder, request), 200)).toEqual({ id: created.id, repeated: true });
    await expectJson(memberReport(personalOrder, { ...request, note: '同编号试图改写原说明' }), 409);
    const saved = await prisma.afterSaleCase.findUniqueOrThrow({ where: { id: created.id }, include: { events: true } });
    expect(saved).toMatchObject({ orderId: personalOrder, orderItemId: line(personalOrder), quantity: 1,
      channel: 'account', createdBy: owner, customerState: 'reported', ownerId: null, events: [{ action: 'open', actorId: owner }] });
    const response = await memberRead(personalOrder);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect((await expectJson(response, 200)).cases).toEqual([{ id: created.id, orderItemId: line(personalOrder),
      quantity: 1, issue: 'shortage', customerState: 'reported', reportedAt: request.occurredAt }]);
  });

  it('当前组织权限限定归属，其他组织和失去原组织权限的建单人不能读写', async () => {
    const originalOrg = 'OFFICE-ORGANIZATION-A';
    const otherOrg = 'OFFICE-ORGANIZATION-B';
    await prisma.organization.createMany({ data: [
      { id: originalOrg, name: '合成办公组织甲', ownerUserId: owner, status: 'active' },
      { id: otherOrg, name: '合成办公组织乙', ownerUserId: outsider, status: 'active' },
    ] });
    async function grantOrganizationRead(id: string, organizationId: string) {
      const role = await prisma.organizationRole.upsert({ where: { organizationId_key: { organizationId, key: 'viewer' } },
        create: { organizationId, key: 'viewer', name: '订单查看', permissions: JSON.stringify(['organization.records.read']) }, update: {} });
      return prisma.organizationMember.create({ data: { userId: id, organizationId, status: 'active',
        roleAssignments: { create: { roleId: role.id } } } });
    }
    const originalMember = await grantOrganizationRead(owner, originalOrg);
    await grantOrganizationRead(orgReader, originalOrg);
    await grantOrganizationRead(outsider, otherOrg);
    await seedOrder(orgOrder, owner, originalOrg);
    signIn(outsider);
    await expectJson(memberRead(orgOrder), 404);
    await expectJson(memberReport(orgOrder, memberInput(orgOrder, 'cross-organization')), 404);
    signIn(orgReader);
    await expectJson(memberReport(orgOrder, memberInput(orgOrder, 'cross-order-line', { orderItemId: line(personalOrder) })), 409);
    const created = await expectJson(memberReport(orgOrder, memberInput(orgOrder, 'authorized-organization-member')), 200);
    expect((await expectJson(memberRead(orgOrder), 200)).cases).toHaveLength(1);
    expect(await prisma.afterSaleCase.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({ orderId: orgOrder, createdBy: orgReader });
    await prisma.organizationMember.update({ where: { id: originalMember.id }, data: { status: 'removed' } });
    signIn(owner);
    await expectJson(memberRead(orgOrder), 404);
    await expectJson(memberReport(orgOrder, memberInput(orgOrder, 'former-organization-order-creator')), 404);
    expect(await prisma.afterSaleCase.count()).toBe(1);
  });

  it('无写入预览、无令牌及错会话被拒，真实 TOTP 只可用一次，旧预览不覆盖已接手的事项', async () => {
    signIn(owner);
    const { id } = await expectJson(memberReport(personalOrder, memberInput(personalOrder, 'case-for-mfa')), 200);
    signIn(clerk, 'admin');
    const stale = action('claim', 'stale-claim', id);
    const current = action('claim', 'current-claim', id);
    const { preview: oldDraft } = await expectJson(preview(stale), 200);
    const { preview: currentDraft } = await expectJson(preview(current), 200);
    expect(currentDraft.snapshot).toMatchObject({ caseId: id, revision: 1, actor: clerk, owner: null });
    expect(await prisma.afterSaleEvent.count()).toBe(1);
    await expectJson(confirm(current, currentDraft.actionHash), 403);
    await expectJson(confirm(current, currentDraft.actionHash, await grant(clerk, 'different-session')), 403);
    const token = await grant(clerk);
    const applied = await expectJson(confirm(current, currentDraft.actionHash, token), 200);
    const row = await prisma.afterSaleEvent.findUniqueOrThrow({ where: { id: applied.eventId } });
    expect(JSON.parse(row.detail).authorization).toMatchObject({ permission: 'orders.write',
      sessionFingerprint: pricingContentHash({ userId: clerk, sessionId: session(clerk) }) });
    await expectJson(confirm(current, currentDraft.actionHash, token), 403);
    expect((await expectJson(confirm(stale, oldDraft.actionHash, await grant(clerk)), 409)).error).toContain('重新预览');
    expect(await expectJson(confirm(current, currentDraft.actionHash, await grant(clerk)), 200)).toMatchObject({
      caseId: id, eventId: applied.eventId, repeated: true,
    });
    expect(await prisma.afterSaleEvent.count()).toBe(2);
    expect(await prisma.afterSaleCase.findUniqueOrThrow({ where: { id } })).toMatchObject({ revision: 2, ownerId: clerk });
  });

  it('购销票款使用各自权限，客户只见状态，退款条件只向财务可见', async () => {
    await acceptOriginalOrder();
    const purchaseOrderId = await prisma.$transaction(async tx => {
      const operator = { id: procurement, email: email(procurement) };
      await prepareOrderPurchases(tx, personalOrder, operator);
      const source = (await purchaseWorkspace(tx, personalOrder)).lines[0];
      const terms = {
        supplier:'合成办公供方', writtenSupplier:'合成办公供方', payee:'合成办公供方账户', paymentTerms:'合成书面结算条件',
        unitPriceCents:3000,linePayableCents:6000,currency:'CNY',taxBasis:'included',freightTerms:'含运费',
        leadTime:'三个工作日', validUntil:new Date(Date.now()+86400000).toISOString(),supplierConditions:'本地验证供货',
        sourceReference:'OFFICE-QUOTE',sourceSha256:pricingContentHash('OFFICE-QUOTE'),
        settlementReference:'OFFICE-SETTLEMENT',settlementSha256:pricingContentHash('OFFICE-SETTLEMENT'),
        coordinationReference:'OFFICE-COORDINATION',leadTimeAssessment:'within_agreement',
      } as const;
      await savePurchaseLine(tx,{orderId:personalOrder,orderItemId:source.orderItemId,revision:source.revision,terms,checkedEvidence:true},operator);
      const id=(await purchaseWorkspace(tx,personalOrder)).orders[0].id;
      for(const procedure of [
        {action:'approve',requestId:'test-purchase-approval'},
        {action:'register_order',requestId:'test-real-order-reference',reference:'OFFICE-ORDERED',referenceSha256:pricingContentHash('OFFICE-ORDERED'),
          occurredAt:new Date().toISOString()},
      ] as const){
        const version=(await purchaseWorkspace(tx,personalOrder)).orders.find(row=>row.id===id)!.version;
        const input={...procedure,orderId:personalOrder,purchaseOrderId:id,version};
        const checked=await previewPurchaseAction(tx,input,operator);
        await applyPurchaseAction(tx,{...input,actionHash:checked.actionHash},operator);
      }
      return id;
    });
    signIn(owner);
    const { id } = await expectJson(memberReport(personalOrder, memberInput(personalOrder, 'case-for-permissions')), 200);
    signIn(clerk, 'admin');
    await record(clerk, action('claim', 'claim-for-separate-roles', id));
    const customerDecision = await record(clerk, action('agreement', 'real-input-shape-no-money', id, {
      remedy: 'refund', amountCents: 10000, recipient: payee, destination, method: 'bank',
      customerDecision: '仅用于本地权限和可见性检查的合成条件',
    }));
    const supplier = action('supplier', 'supplier-follow-up-only', id, { outcome: 'following', purchaseOrderId, supplier: '合成办公供方' });
    const supplierMoney = action('supplier', 'supplier-payment-body-not-written', id, {
      outcome: 'financial_result', purchaseOrderId, supplier: '合成办公供方', amountCents: 900, method: '抵扣', destination: '合成明细抵扣书证', referenceNo: 'UNIT-INPUT-ONLY',
    });
    const prepare = action('prepare_refund', 'refund-negative-no-settled-cash', id, { historyReview: '该合成原单没有实收款' });

    signIn(procurement, 'admin');
    await expectJson(preview(prepare), 403);
    await expectJson(preview(supplierMoney), 403);
    const supplierRecord = await record(procurement, supplier);
    const purchaseView = (await expectJson(adminRead(), 200)).workspace;
    expect(purchaseView.refundDrafts).toEqual([]);
    expect(JSON.stringify(purchaseView)).not.toContain(destination);
    expect(JSON.stringify(purchaseView)).not.toContain(payee);
    expect(purchaseView.cases[0].events).toContainEqual(expect.objectContaining({
      id: customerDecision.eventId, action: 'agreement', reference: null, operation: null,
    }));
    expect(purchaseView.cases[0].events).toContainEqual(expect.objectContaining({
      id: supplierRecord.eventId, operation: expect.objectContaining({ outcome: 'following', purchaseOrderId }),
    }));

    signIn(purchaseFinance, 'admin');
    await expectJson(preview(prepare), 403);
    await expectJson(preview(supplierMoney), 200);

    signIn(finance, 'admin');
    await expectJson(preview(supplier), 403);
    await expectJson(preview(supplierMoney), 403);
    const financeView = (await expectJson(adminRead(), 200)).workspace;
    expect(financeView.refundDrafts).toEqual([expect.objectContaining({
      caseId: id, terms: expect.objectContaining({ amountCents: 10000, recipient: payee, destination, method: 'bank', agreementId: customerDecision.eventId }),
      position: expect.objectContaining({ paidCents: 0, caseGoodsCents: 10000, recordedCents: 0, originalAcceptance: expect.any(String) }),
    })]);
    expect((await expectJson(preview(prepare), 409)).error).toContain('剩余实收款');
    signIn(owner);
    const ownerView = await expectJson(memberRead(personalOrder), 200);
    expect(ownerView.cases).toEqual([{ id, orderItemId: line(personalOrder), issue: 'shortage', quantity: 1,
      customerState: 'awaiting_refund', reportedAt: expect.any(String) }]);
    expect(await prisma.afterSaleEvent.count({ where: { caseId: id, action: { contains: 'refund' } } })).toBe(0);
    expect(await prisma.customerCashPosting.count()).toBe(0);
    expect(await prisma.accountReceivable.findUniqueOrThrow({ where: { orderId: personalOrder } })).toMatchObject({ amount: 200, status: 'open' });
  });
});
