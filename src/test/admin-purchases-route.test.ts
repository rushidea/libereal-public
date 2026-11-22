// @vitest-environment node

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/admin/purchases/route';
import { ADMIN_ROLE_DEFINITIONS, type AdminRoleKey } from '@/lib/admin-permissions';
import { reserveOrderCredit } from '@/lib/customer-credit';
import { resetEphemeralStoreForTests } from '@/lib/ephemeral-store';
import { merchantAcceptanceMetadata, merchantOrderApprovalPreview, ORDER_APPROVAL_INCLUDE } from '@/lib/order-approval';
import { prisma } from '@/lib/prisma';
import type { PurchaseActionInput } from '@/lib/purchase-orders';
import { createMfaKeyRing, encryptMfaSecret } from '@/lib/security/mfa-crypto';
import { generateTotpSecret, totpCodeAt } from '@/lib/security/mfa-totp';
import { completeSecurityStepUp, startSecurityStepUp, type SecurityStepUpAction } from '@/lib/security/security-step-up';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth }));

const orderId = 'test-customer-order';
const orderItemId = 'test-customer-order-line';
const url = 'http://localhost/api/admin/purchases';
const staff = {
  merchant: 'test-merchant',
  operator: 'test-purchase-operator',
  approver: 'test-purchase-approver',
  finance: 'test-purchase-finance',
} as const;
const buyer = 'test-buyer';
const staffRole = {
  [staff.merchant]: 'order_admin',
  [staff.operator]: 'purchase_operator',
  [staff.approver]: 'purchase_approver',
  [staff.finance]: 'purchase_finance',
} as const satisfies Record<string, AdminRoleKey>;
const email = (id: string) => `${id}@example.test`;
const session = (id: string) => `session-${id}`;
const key = randomBytes(32);
const keyRing = createMfaKeyRing({ currentVersion: 1, keys: { 1: key } });
const secrets = new Map<string, string>();
const procurementTerms = {
  supplier: '合成内部供方', payee: '合成独立收款方', paymentTerms: '收到合成确认后分两次付清',
  unitPriceCents: 3673, linePayableCents: 7346, currency: 'CNY', taxBasis: 'included',
  freightTerms: '含运费', leadTime: '3个工作日', validUntil: '2031-05-08T00:00:00.000Z',
  sourceReference: 'TEST-WRITTEN-PURCHASE-QUOTE', coordinationReference: 'TEST-ORDER-DELIVERY-CHECK',
};
type ActionRequest = Omit<PurchaseActionInput, 'orderId' | 'purchaseOrderId' | 'version' | 'actionHash'>;
type Previewed = PurchaseActionInput & { actionHash: string };

function signIn(id: string, role = 'admin', sessionId = session(id)) {
  auth.mockResolvedValue({ user: { id, role, email: email(id), sessionId } });
}

function post(body: object) {
  return POST(new NextRequest(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
}

async function expectJson(response: Response, status: number) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  return body;
}

function readPurchases(id?: string) {
  return GET(new NextRequest(id ? `${url}?orderId=${encodeURIComponent(id)}` : url));
}

async function currentPurchase() {
  const result = await expectJson(await readPurchases(orderId), 200);
  const [purchase] = result.workspace.orders;
  expect(purchase).toBeDefined();
  return purchase as { id: string; version: string; status: string; totalCents: number; paidCents: number };
}

async function previewAction(request: ActionRequest): Promise<Previewed> {
  const purchase = await currentPurchase();
  const input = { ...request, orderId, purchaseOrderId: purchase.id, version: purchase.version };
  const result = await expectJson(await post({ ...input, stage: 'preview' }), 200);
  expect(result.preview).toMatchObject({ actionHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(result.preview.snapshot).toMatchObject({
    orderId, purchaseOrderId: purchase.id, version: purchase.version,
    requestId: request.requestId, operation: { action: request.action },
  });
  return { ...input, actionHash: result.preview.actionHash };
}

function confirm(input: Previewed, stepUpToken?: string) {
  return post({ ...input, stage: 'confirm', stepUpToken });
}

async function grant(userId: string, action: SecurityStepUpAction = 'admin_sensitive') {
  // An authenticator cannot reuse a TOTP step. Only the test clock advances.
  vi.setSystemTime(Date.now() + 31_000);
  const context = { userId, action, sessionId: session(userId), method: 'totp' as const };
  const challenge = await startSecurityStepUp(context);
  const secret = secrets.get(userId);
  if (!secret) throw new Error('Missing synthetic authenticator');
  const result = await completeSecurityStepUp({
    ...context,
    challengeId: challenge.challengeId,
    totpToken: challenge.challengeToken,
    code: totpCodeAt(secret, Date.now()),
  });
  if (!('grantToken' in result)) throw new Error(`Synthetic MFA grant failed: ${result.error}`);
  return result.grantToken;
}

function activity(action: string) {
  return getTestDb().prepare('SELECT actorId, amountCents FROM PurchaseActivity WHERE orderId = ? AND action = ?').all(orderId, action);
}

function seedStaff(id: keyof typeof staffRole) {
  const db = getTestDb();
  const roleKey = staffRole[id];
  const role = ADMIN_ROLE_DEFINITIONS[roleKey];
  seedUser(db, { id, role: 'admin', email: email(id) });
  db.prepare('INSERT INTO AdminRole (id,key,name,updatedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)').run(roleKey, roleKey, role.name);
  for (const permission of role.permissions) {
    const [resource, action] = permission.split('.');
    db.prepare('INSERT OR IGNORE INTO AdminPermission (id,key,resource,action,name) VALUES (?, ?, ?, ?, ?)').run(
      permission, permission, resource, action, permission,
    );
    db.prepare('INSERT INTO AdminRolePermission (roleId,permissionId) VALUES (?, ?)').run(roleKey, permission);
  }
  db.prepare('INSERT INTO AdminUserRole (userId,roleId) VALUES (?, ?)').run(id, roleKey);

  const secret = generateTotpSecret();
  secrets.set(id, secret);
  db.prepare('INSERT INTO MfaSetting (id,userId,enabled,encryptedSecret) VALUES (?, ?, 1, ?)').run(
    `auth-${id}`, id, encryptMfaSecret(secret, keyRing),
  );
}

async function seedAcceptedOrder() {
  await prisma.$transaction(async tx => {
    const order = await tx.order.create({
      data: {
        id: orderId, customerId: buyer, email: email(buyer), subtotal: 250, total: 250, status: 'pending',
        paymentMethod: 'bank_transfer',
        orderItems: { create: { id: orderItemId, position: 0, name: '合成商品', quantity: 2, unitPrice: 125 } },
      },
      include: ORDER_APPROVAL_INCLUDE,
    });
    const preview = await merchantOrderApprovalPreview(tx, order);
    if (!preview || preview.action !== 'accept_order') throw new Error('Missing synthetic acceptance preview');
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'confirmed', statusHistory: { create: {
        fromStatus: 'pending', toStatus: 'confirmed', actorId: staff.merchant, actorEmail: email(staff.merchant),
        metadata: merchantAcceptanceMetadata(preview),
      } } },
    });
    await reserveOrderCredit(tx, orderId, staff.merchant);
  });
}

async function updateTerms(overrides: object = {}) {
  const { workspace } = await expectJson(await readPurchases(orderId), 200);
  const [line] = workspace.lines;
  return expectJson(await post({
    action: 'save_line', orderId, orderItemId, revision: line.revision,
    terms: { ...procurementTerms, ...overrides },
  }), 200);
}

beforeAll(() => {
  const db = getTestDb();
  db.exec(readFileSync('prisma/migrations/20260806090000_add_mfa_security_tables/migration.sql', 'utf8'));
});
afterAll(() => { closeTestDb(); });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2031-05-01T03:00:00.000Z'));
  vi.stubEnv('REDIS_REST_URL', undefined);
  vi.stubEnv('REDIS_REST_TOKEN', undefined);
  vi.stubEnv('MFA_PHASE1_ENABLED', 'true');
  vi.stubEnv('MFA_KEY_CURRENT', '1');
  vi.stubEnv('MFA_KEY_V1', key.toString('base64'));
  vi.stubEnv('STAGING_MFA_TEST_ENABLED', 'false');
  resetEphemeralStoreForTests();
  secrets.clear();

  const db = getTestDb();
  db.exec('DELETE FROM SecurityEvent; DELETE FROM MfaChallenge; DELETE FROM MfaSetting;');
  clearAllTables(db);
  seedUser(db, { id: buyer, email: email(buyer) });
  for (const id of Object.keys(staffRole) as Array<keyof typeof staffRole>) seedStaff(id);
  await prisma.creditAccount.create({ data: { userId: buyer, baseLimit: 10000, paymentTermDays: 30 } });
  await seedAcceptedOrder();

  signIn(staff.operator);
  await expectJson(await post({ action: 'prepare', orderId }), 200);
  await updateTerms();
});

afterEach(() => {
  resetEphemeralStoreForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('admin purchase endpoint', () => {
  it('keeps cost and purchase details behind purchases.read and ignores body role claims', async () => {
    auth.mockResolvedValue(null);
    await expectJson(await readPurchases(orderId), 401);
    signIn(buyer, 'customer');
    for (const response of [
      await readPurchases(orderId),
      await post({ action: 'prepare', orderId, role: 'admin', permissions: ['purchases.read', 'purchases.write'] }),
    ]) {
      await expectJson(response, 403);
    }

    signIn(staff.merchant);
    for (const response of [await readPurchases(), await readPurchases(orderId)]) {
      const denied = await expectJson(response, 403);
      expect(denied).not.toHaveProperty('workspace');
      expect(JSON.stringify(denied)).not.toContain(procurementTerms.supplier);
      expect(JSON.stringify(denied)).not.toContain(String(procurementTerms.linePayableCents));
    }

    signIn(staff.operator);
    const allowed = await expectJson(await readPurchases(orderId), 200);
    expect(allowed.permissions).toEqual(['purchases.read', 'purchases.write']);
    expect(allowed.workspace.orders).toMatchObject([{ totalCents: 7346 }]);
    expect(allowed.workspace.lines[0].terms).toMatchObject({ supplier: procurementTerms.supplier, unitPriceCents: 3673 });

    getTestDb().prepare('DELETE FROM AdminRolePermission WHERE roleId = ? AND permissionId = ?')
      .run(staffRole[staff.operator], 'purchases.read');
    const writeOnly = await expectJson(await post({ action: 'prepare', orderId }), 403);
    expect(writeOnly).not.toHaveProperty('workspace');
  });

  it('enforces different operator, approval and finance permissions using actual role assignments', async () => {
    signIn(staff.operator);
    const purchase = await currentPurchase();
    const payload = { orderId, purchaseOrderId: purchase.id, version: purchase.version, requestId: 'test-role-enforcement', stage: 'preview' };
    const deniedApprove = await expectJson(await post({ ...payload, action: 'approve', permissions: ['purchases.approve'], role: 'purchase_approver' }), 403);
    expect(deniedApprove.requiredPermission).toBe('purchases.approve');
    const deniedPay = await expectJson(await post({ ...payload, action: 'record_payment' }), 403);
    expect(deniedPay.requiredPermission).toBe('purchases.pay');

    signIn(staff.approver);
    const deniedWrite = await expectJson(await post({ action: 'save_line', orderId, orderItemId }), 403);
    expect(deniedWrite.requiredPermission).toBe('purchases.write');
    const deniedRegister = await expectJson(await post({ ...payload, action: 'register_order' }), 403);
    expect(deniedRegister.requiredPermission).toBe('purchases.write');

    signIn(staff.finance);
    const deniedFinanceApproval = await expectJson(await post({ ...payload, action: 'approve' }), 403);
    expect(deniedFinanceApproval.requiredPermission).toBe('purchases.approve');
    expect(activity('approve')).toEqual([]);
    expect(activity('record_payment')).toEqual([]);
    expect(activity('register_order')).toEqual([]);
  });

  it('requires a real one-use MFA grant for the caller, session and action', async () => {
    signIn(staff.approver);
    const input = await previewAction({ action: 'approve', requestId: 'test-approval-grant' });
    await expectJson(await post({ ...input, stage: 'confirm', actionHash: undefined }), 409);
    await expectJson(await confirm(input), 403);
    await expectJson(await confirm(input, 'not-a-valid-test-grant'), 403);
    const wrongAction = await grant(staff.approver, 'password_change');
    await expectJson(await confirm(input, wrongAction), 403);
    const wrongUser = await grant(staff.operator);
    await expectJson(await confirm(input, wrongUser), 403);

    const oneUse = await grant(staff.approver);
    signIn(staff.approver, 'admin', 'session-different');
    await expectJson(await confirm(input, oneUse), 403);
    expect(activity('approve')).toEqual([]);

    signIn(staff.approver);
    await expectJson(await confirm(input, oneUse), 200);
    expect(await currentPurchase()).toMatchObject({ status: 'approved' });
    await expectJson(await confirm(input, oneUse), 403);
    expect(activity('approve')).toEqual([{ actorId: staff.approver, amountCents: null }]);
  });

  it('rejects approval from an earlier supplier quote and amount even with a new valid MFA grant', async () => {
    signIn(staff.approver);
    const old = await previewAction({ action: 'approve', requestId: 'test-old-approval' });

    signIn(staff.operator);
    await updateTerms({ unitPriceCents: 4000, linePayableCents: 8000, sourceReference: 'TEST-NEW-WRITTEN-QUOTE' });

    signIn(staff.approver);
    const freshGrant = await grant(staff.approver);
    await expectJson(await confirm(old, freshGrant), 409);
    expect(await currentPurchase()).toMatchObject({ status: 'draft', totalCents: 8000 });
    expect(activity('approve')).toEqual([]);
    const current = await previewAction({ action: 'approve', requestId: 'test-current-approval' });
    expect(current.version).not.toBe(old.version);
    expect(current.actionHash).not.toBe(old.actionHash);
    await expectJson(await confirm(current, freshGrant), 403);
    await expectJson(await confirm(current, await grant(staff.approver)), 200);
    expect(activity('approve')).toHaveLength(1);
  });

  it('binds the payment amount to its preview and deduplicates the same supplier receipt', async () => {
    signIn(staff.approver);
    const approval = await previewAction({ action: 'approve', requestId: 'test-payment-approval' });
    await expectJson(await confirm(approval, await grant(staff.approver)), 200);

    signIn(staff.operator);
    const placement = await previewAction({ action: 'register_order', requestId: 'test-placement', reference: 'TEST-SUPPLIER-ORDER' });
    await expectJson(await confirm(placement, await grant(staff.operator)), 200);

    signIn(staff.finance);
    const request = {
      action: 'record_payment', requestId: 'test-payment-original', reference: 'TEST-SUPPLIER-TRANSFER',
      conditionReference: 'TEST-DEPOSIT-CONDITION', amountCents: 3100,
    } as const;
    const payment = await previewAction(request);
    await expectJson(await confirm({ ...payment, amountCents: 3101 }, await grant(staff.finance)), 409);
    expect(activity('record_payment')).toEqual([]);

    const oneUse = await grant(staff.finance);
    await expectJson(await confirm(payment, oneUse), 200);
    await expectJson(await confirm(payment, oneUse), 403);
    await expectJson(await confirm(payment, await grant(staff.finance)), 200);

    const matchingReceipt = await previewAction({ ...request, requestId: 'test-payment-different-request' });
    await expectJson(await confirm(matchingReceipt, await grant(staff.finance)), 409);
    expect(activity('record_payment')).toEqual([{ actorId: staff.finance, amountCents: 3100 }]);
    expect(await currentPurchase()).toMatchObject({ totalCents: 7346, paidCents: 3100, status: 'ordered' });
  });
});
