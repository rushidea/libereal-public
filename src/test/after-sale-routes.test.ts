// @vitest-environment node

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as adminGET, POST as adminPOST } from '@/app/api/admin/after-sales/route';
import { GET as customerGET, POST as customerPOST } from '@/app/api/orders/[id]/after-sales/route';
import { ADMIN_ROLE_DEFINITIONS, type AdminRoleKey } from '@/lib/admin-permissions';
import type { SaleInput } from '@/lib/after-sale-records';
import { reserveOrderCredit } from '@/lib/customer-credit';
import { resetEphemeralStoreForTests } from '@/lib/ephemeral-store';
import { merchantAcceptanceMetadata, merchantOrderApprovalPreview, ORDER_APPROVAL_INCLUDE } from '@/lib/order-approval';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { createMfaKeyRing, encryptMfaSecret } from '@/lib/security/mfa-crypto';
import { generateTotpSecret, totpCodeAt } from '@/lib/security/mfa-totp';
import { completeSecurityStepUp, startSecurityStepUp } from '@/lib/security/security-step-up';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth }));

const owner = 'after-sale-owner';
const outsider = 'after-sale-other-customer';
const orgReader = 'after-sale-organization-reader';
const clerk = 'after-sale-order-staff';
const procurement = 'after-sale-purchase-staff';
const purchaseFinance = 'after-sale-vendor-accounts';
const finance = 'after-sale-customer-accounts';
const personalOrder = 'OFFICE-PERSONAL-AFTER-SALE';
const orgOrder = 'OFFICE-ORGANIZATION-AFTER-SALE';
const purchaseOrderId = 'OFFICE-ORIGINAL-PO';
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

function action(kind: SaleInput['action'], requestId: string, caseId: string, fields: object = {}) {
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
    const now = new Date().toISOString();
    await prisma.purchaseOrder.create({ data: {
      id: purchaseOrderId, orderId: personalOrder, status: 'ordered', groupKey: 'office-supplier', createdAt: now, updatedAt: now,
    } });
    await prisma.purchaseRequirement.create({ data: {
      orderId: personalOrder, orderItemId: line(personalOrder), purchaseOrderId, ownerId: procurement,
      source: '{}', terms: '{}', createdAt: now, updatedAt: now,
    } });
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
      outcome: 'financial_result', purchaseOrderId, supplier: '合成办公供方', amountCents: 900, method: '抵扣', referenceNo: 'UNIT-INPUT-ONLY',
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
