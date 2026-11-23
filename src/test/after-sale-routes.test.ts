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

async function acceptOriginalOrder() {
  await prisma.$transaction(async tx => {
    const order = await tx.order.findUniqueOrThrow({ where: { id: personalOrder }, include: ORDER_APPROVAL_INCLUDE });
    const draft = await merchantOrderApprovalPreview(tx, order);
    if (draft?.action !== 'accept_order') throw new Error('缺少原订单接单预览');
    await tx.order.update({ where: { id: personalOrder }, data: {
      status: 'confirmed', statusHistory: { create: { fromStatus: 'pending', toStatus: 'confirmed', actorId: clerk,
        actorEmail: email(clerk), metadata: merchantAcceptanceMetadata(draft) } },
    } });
    await reserveOrderCredit(tx, personalOrder, clerk);
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
      expect((await expectJson(preview(withdrawal),200)).preview.snapshot.operation).toMatchObject({
        originalRefundStopId:stop.eventId,releasedCents:20000,previouslyRefundedCents:0});
      await record(clerk,withdrawal);
      expect(await prisma.afterSaleCase.findUniqueOrThrow({where:{id}})).toMatchObject({customerState:'awaiting_close'});
      expect(JSON.parse((await prisma.afterSaleEvent.findUniqueOrThrow({where:{id:failed.eventId}})).detail).operation)
        .toMatchObject({result:'failed',amountCents:0});
      expect((await prisma.$transaction(tx=>financeWorkspace(tx,personalOrder))).latePayments[0].refund).toBeNull();
      expect(await prisma.paymentAttempt.findUniqueOrThrow({where:{id:attempt.id}})).toEqual(actual);
    }

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
