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
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
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
  writtenSupplier: '合成内部供方', supplierConditions: '合成书面供货条件', sourceSha256: 'a'.repeat(64),
  sourceReference: 'TEST-WRITTEN-PURCHASE-QUOTE', settlementReference: 'TEST-SETTLEMENT-WRITING', settlementSha256: 'b'.repeat(64),
  coordinationReference: 'TEST-ORDER-DELIVERY-CHECK', leadTimeAssessment: 'within_agreement',
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

async function currentPurchase(target = orderId) {
  const result = await expectJson(await readPurchases(target), 200);
  const [purchase] = result.workspace.orders;
  expect(purchase).toBeDefined();
  return purchase as { id: string; version: string; status: string; totalCents: number; paidCents: number };
}

async function previewAction(request: ActionRequest, target = orderId): Promise<Previewed> {
  const purchase = await currentPurchase(target);
  const input = { ...request, orderId: target, purchaseOrderId: purchase.id, version: purchase.version };
  const result = await expectJson(await post({ ...input, stage: 'preview' }), 200);
  expect(result.preview).toMatchObject({ actionHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(result.preview.snapshot).toMatchObject({
    orderId: target, purchaseOrderId: purchase.id, version: purchase.version,
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

async function seedAcceptedOrder(id = orderId, itemId = orderItemId) {
  await prisma.$transaction(async tx => {
    const order = await tx.order.create({
      data: {
        id, customerId: buyer, email: email(buyer), subtotal: 250, total: 250, status: 'pending',
        paymentMethod: 'bank_transfer',
        orderItems: { create: { id: itemId, position: 0, name: '合成商品', quantity: 2, unitPrice: 125 } },
      },
      include: ORDER_APPROVAL_INCLUDE,
    });
    const preview = await merchantOrderApprovalPreview(tx, order);
    if (!preview || preview.action !== 'accept_order') throw new Error('Missing synthetic acceptance preview');
    await tx.order.update({
      where: { id },
      data: { status: 'confirmed', statusHistory: { create: {
        fromStatus: 'pending', toStatus: 'confirmed', actorId: staff.merchant, actorEmail: email(staff.merchant),
        metadata: merchantAcceptanceMetadata(preview),
      } } },
    });
    await reserveOrderCredit(tx, id, staff.merchant);
  });
}

async function updateTerms(overrides: object = {}) {
  const { workspace } = await expectJson(await readPurchases(orderId), 200);
  const [line] = workspace.lines;
  return expectJson(await post({
    action: 'save_line', orderId, orderItemId, revision: line.revision, checkedEvidence: true,
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
  async function startActualSupply(target: string, request: string) {
    signIn(staff.approver);
    await expectJson(await confirm(await previewAction({action:'approve',requestId:'approve-'+request},target),await grant(staff.approver)),200);
    signIn(staff.operator);
    await expectJson(await confirm(await previewAction({action:'register_order',requestId:'register-'+request,
      reference:'TEST-COMMITMENT-'+request,referenceSha256:pricingContentHash({request,proof:'commitment'}),
      occurredAt:new Date().toISOString()},target),await grant(staff.operator)),200);
  }

  async function noteChange(target:string,request:string) {
    signIn(staff.operator);
    await expectJson(await confirm(await previewAction({action:'report_change',requestId:'report-'+request,changeKind:'unavailable',
      reference:'TEST-ACTUAL-SUPPLY-CHANGE-'+request,description:'供方书面收到采购协调，核对取消或补货对象。'},target),await grant(staff.operator)),200);
  }

  it.each([false,true])('rechecks a supplier document across two orders, with both orders covered = %s', async bothCovered => {
    const otherOrder = 'TEST-DOCUMENT-COVERAGE-OTHER-ORDER';
    const otherItem = 'TEST-DOCUMENT-COVERAGE-OTHER-ITEM';
    await seedAcceptedOrder(otherOrder,otherItem);
    signIn(staff.operator);
    const prepared = await expectJson(await post({action:'prepare',orderId:otherOrder}),200);
    await expectJson(await post({action:'save_line',orderId:otherOrder,orderItemId:otherItem,revision:prepared.workspace.lines[0].revision,
      checkedEvidence:true,terms:{...procurementTerms,sourceSha256:pricingContentHash({otherOrder,proof:'terms'})}}),200);
    await startActualSupply(orderId,'first-customer-scope');
    await startActualSupply(otherOrder,'other-customer-scope');
    await noteChange(orderId,'first-customer-scope');
    await noteChange(otherOrder,'other-customer-scope');
    signIn(staff.approver);
    const first = await currentPurchase();
    const second = await currentPurchase(otherOrder);
    const scope = {orderId,purchaseOrderId:first.id,orderItemId,quantity:1};
    const otherScope = {orderId:otherOrder,purchaseOrderId:second.id,orderItemId:otherItem,quantity:1};
    const supplierSha256 = pricingContentHash('verified-supplier-row');
    const supplierDocumentScope = bothCovered ? [scope,otherScope] : [scope];
    const cancellation = (item: string, tag: string): ActionRequest => ({
      action:'resolve_change',outcome:'declined',requestId:'allocate-document-'+tag,supplierReference:'TEST-SUPPLIER-DOCUMENT-'+tag,
      supplierSha256,customerReference:'TEST-CUSTOMER-ORIGINAL-'+tag,customerSha256:pricingContentHash({tag,proof:'client'}),
      description:'按书面决定取消确实受影响的一件',confirmsFullIncidentScope: true, dispositions:[{orderItemId:item,quantity:1,outcome:'cancel',
        supplierDocumentRow:8,customerDocumentRow:13,...(item===orderItemId || bothCovered ? {supplierDocumentScope} : {})}],
    });
    const firstPreview = await previewAction(cancellation(orderItemId,'first'),orderId);
    const otherPreview = await previewAction(cancellation(otherItem,'other'),otherOrder);
    await expectJson(await confirm(firstPreview),403);
    if (bothCovered) {
      const firstGrant = await grant(staff.approver);
      const otherGrant = await grant(staff.approver);
      const concurrent = await Promise.all([confirm(firstPreview,firstGrant),confirm(otherPreview,otherGrant)]);
      expect(concurrent.map(response=>response.status).sort()).toEqual([200,409]);
      const firstWon = concurrent[0].status === 200;
      const remainingOrder = firstWon ? otherOrder : orderId;
      const remainingItem = firstWon ? otherItem : orderItemId;
      const refreshed = await previewAction(cancellation(remainingItem,firstWon?'other':'first'),remainingOrder);
      const final = await expectJson(await confirm(refreshed,await grant(staff.approver)),200);
      expect(final.workspace.activities.at(-1)?.detail.snapshot.operation.decisionDocuments).toContainEqual(expect.objectContaining({
        role:'supplier',row:8,balances:expect.arrayContaining([
          {...(firstWon?scope:otherScope),usedBefore:1,using:0,remaining:0},
          {...(firstWon?otherScope:scope),usedBefore:0,using:1,remaining:0},
        ]),
      }));
      expect(await prisma.purchaseActivity.count({where:{action:'resolve_change',orderId:{in:[orderId,otherOrder]}}})).toBe(2);
      return;
    }
    const accepted = await expectJson(await confirm(firstPreview,await grant(staff.approver)),200);
    expect(accepted.workspace.activities.at(-1)).toMatchObject({actorId:staff.approver,detail:{authorization:{permission:'purchases.approve'},
      snapshot:{operation:{decisionDocuments:expect.arrayContaining([expect.objectContaining({
        role:'supplier',sha256:supplierSha256,row:8,scopeConfirmed:true,balances:[{...scope,usedBefore:0,using:1,remaining:0}],
      })])}}}});
    const rejected = await expectJson(await confirm(otherPreview,await grant(staff.approver)),409);
    expect(rejected.error).toMatch(/不包含本次办理对象/);
    await expectJson(await post({...otherPreview,stage:'preview'}),409);
    expect(await prisma.purchaseActivity.count({where:{orderId:otherOrder,action:'resolve_change'}})).toBe(0);
  });

  it('lets an approver document a previously unquantified original row and counts the prior unit before completing the current review', async () => {
    await startActualSupply(orderId,'prior-coverage');
    await noteChange(orderId,'initial-coverage');
    signIn(staff.approver);
    const first = await currentPurchase();
    const prior = {
      action:'resolve_change' as const,outcome:'declined' as const,requestId:'use-one-known-row',
      supplierReference:'TEST-FILE-WITH-TWO-VERIFIED-UNITS',supplierSha256:pricingContentHash('two-unit-supplier-file'),
      customerReference:'TEST-FIRST-CUSTOMER-ROW',customerSha256:pricingContentHash('same-two-row-customer-file'),
      description:'本次按原件取消一件',confirmsFullIncidentScope: true, dispositions:[{orderItemId,quantity:1,outcome:'cancel' as const,supplierDocumentRow:8,customerDocumentRow:12}],
    };
    const initial = await previewAction(prior);
    const {workspace} = await expectJson(await confirm(initial,await grant(staff.approver)),200);
    const old = workspace.activities.at(-1);
    expect(old.detail.snapshot.operation.decisionDocuments[0]).toMatchObject({scopeConfirmed:false,allocations:[{orderItemId,quantity:1}]});

    await noteChange(orderId,'review-unknown-remaining-coverage');
    const next = {...prior,requestId:'fully-verified-same-row',customerReference:'TEST-SECOND-CUSTOMER-ROW',
      dispositions:[{...prior.dispositions[0],customerDocumentRow:13}]};
    const current = await currentPurchase();
    const body = {...next,orderId,purchaseOrderId:current.id,version:current.version};
    await expectJson(await post({...body,stage:'preview'}),403);
    signIn(staff.approver);
    await expectJson(await post({...body,stage:'preview'}),409);
    const scope = {orderId,purchaseOrderId:first.id,orderItemId,quantity:2};
    const reviewed = await previewAction({...next,dispositions:[{...next.dispositions[0],supplierRestoreScope:true,supplierDocumentScope:[scope]}]});
    const {workspace: completed} = await expectJson(await confirm(reviewed,await grant(staff.approver)),200);
    expect(completed.activities.find((row:{id:string})=>row.id===old.id)).toEqual(old);
    expect(completed.activities.at(-1)).toMatchObject({actorId:staff.approver,detail:{snapshot:{operation:{decisionDocuments:[
      expect.objectContaining({role:'supplier',restoredActivityIds:[old.id],balances:[{...scope,usedBefore:1,using:1,remaining:0}]}),
      expect.objectContaining({role:'customer',row:13,scopeConfirmed:false}),
    ]}}}});
  });

  it('records and resolves only the selected supply scope through the authorized preview and confirmation', async () => {
    await startActualSupply(orderId,'exact-supply-scope');
    const scope = [{orderItemId,quantity:2}];
    const portion = [{orderItemId,quantity:1}];
    signIn(staff.operator);
    const report = await previewAction({action:'report_change',requestId:'supply-two-delayed',changeKind:'delay',
      reference:'TEST-SUPPLY-TWO-DELAY',description:'两件延期，供方会分别确认供货决定。',affectedLines:scope});
    const {workspace: reported} = await expectJson(await confirm(report,await grant(staff.operator)),200);
    expect(reported.orders[0].incident).toMatchObject({scope,outstanding:scope,reportedBy:staff.operator});
    const action = {action:'resolve_change' as const,outcome:'original_terms' as const,requestId:'supply-one-confirmed',coordinationLines:portion,
      supplierReference:'TEST-SUPPLIER-CONFIRMS-ONE',customerReference:'TEST-CUSTOMER-CONFIRMS-ONE',
      supplierSha256:pricingContentHash('seller agrees the one first'),customerSha256:pricingContentHash('customer agrees the one first'),
      description:'供方书面确认一件照原合同继续，另一件仍待具体回复。',responsibility:'原供方协调人',
      decisionDocumentLines:[{orderItemId,supplierDocumentRow:6,customerDocumentRow:12}]};
    let po = await currentPurchase();
    await expectJson(await post({...action,stage:'preview',orderId,purchaseOrderId:po.id,version:po.version}),403);
    signIn(staff.approver);
    const first = await previewAction(action);
    await expectJson(await confirm({...first,coordinationLines:scope},await grant(staff.approver)),409);
    const {workspace: result} = await expectJson(await confirm(first,await grant(staff.approver)),200);
    expect(result.orders[0]).toMatchObject({status:'on_hold',incident:{scope,outstanding:portion,lastReviewedBy:staff.approver,
      responsibility:'原供方协调人'}});
    expect(result.activities.at(-1)).toMatchObject({actorId:staff.approver,detail:{authorization:{permission:'purchases.approve'},
      snapshot:{operation:{incidentProgress:{handled:portion,outstanding:portion},decisionDocuments:[
        {role:'supplier',row:6,allocations:[{orderItemId,quantity:1}]},{role:'customer',row:12,allocations:[{orderItemId,quantity:1}]},
      ]}}}});
    await expectJson(await confirm(first,await grant(staff.approver)),200);
    expect(activity('resolve_change')).toHaveLength(1);
    po = await currentPurchase();
    await expectJson(await post({...action,requestId:'cannot-use-larger-quantity',coordinationLines:scope,
      stage:'preview',orderId,purchaseOrderId:po.id,version:po.version}),409);
  });

  it('keeps numbered continuation evidence bound to its documented purpose and normal approval permission', async () => {
    await startActualSupply(orderId,'numbered-continue-original');
    await noteChange(orderId,'numbered-continuation-review');
    signIn(staff.approver);
    const digest = {supplierSha256:pricingContentHash('original-continue-supplier-only'),
      customerSha256:pricingContentHash('original-continue-customer-only')};
    const common = {action:'resolve_change' as const,supplierReference:'TEST-ORIGINAL-SUPPLIER-CONTINUE',
      customerReference:'TEST-ORIGINAL-CUSTOMER-CONTINUE',description:'两件原商品按书面约定继续。',...digest};
    const lines = {orderItemId,supplierDocumentRow:8,customerDocumentRow:12};
    const consent = await previewAction({...common,outcome:'original_terms',requestId:'continue-with-form-rows',decisionDocumentLines:[lines],
      affectedLines:[{orderItemId,quantity:2}]});
    await expectJson(await confirm(consent),403);
    const {workspace} = await expectJson(await confirm(consent,await grant(staff.approver)),200);
    expect(workspace.activities.at(-1)).toMatchObject({actorId:staff.approver,detail:{authorization:{permission:'purchases.approve'},
      snapshot:{operation:{decisionDocuments:[
        {role:'supplier',row:8,authority:{purpose:'continue_contract'},allocations:[{orderItemId,quantity:2}]},
        {role:'customer',row:12,authority:{purpose:'continue_contract'}},
      ]}}}});
    await noteChange(orderId,'do-not-reuse-original-purpose');
    const po = await currentPurchase();
    const wrong = {...common,outcome:'declined',requestId:'reuse-continue-as-cancel',orderId,purchaseOrderId:po.id,version:po.version,
      confirmsFullIncidentScope: true, dispositions:[{...lines,outcome:'cancel',quantity:1}],stage:'preview'};
    await expectJson(await post(wrong),403);
    signIn(staff.approver);
    const rejected = await expectJson(await post(wrong),409);
    expect(rejected.error).toMatch(/商业决定、供方或实质条件已变化/);
    expect(await prisma.purchaseActivity.count({where:{orderId,action:'resolve_change'}})).toBe(1);
  });

  it('locates the prior use from an older unnumbered approval without treating a confirmed whole-file use as unlocated', async () => {
    await startActualSupply(orderId,'old-location');
    await noteChange(orderId,'old-commercial-change');
    signIn(staff.approver);
    const written = {
      action:'resolve_change' as const,outcome:'declined' as const,requestId:'old-unnumbered-approval',
      supplierReference:'TEST-LEGACY-ORIGINAL-SUPPLIER-FILE',supplierSha256:pricingContentHash('legacy-supplier-two-written-rows'),
      customerReference:'TEST-LEGACY-CUSTOMER-FIRST',customerSha256:pricingContentHash('legacy-first-customer'),
      description:'原书面决定办理一件',confirmsFullIncidentScope: true, dispositions:[{orderItemId,quantity:1,outcome:'cancel' as const}],
    };
    const initial = await previewAction(written);
    await expectJson(await confirm(initial,await grant(staff.approver)),200);
    const saved = await prisma.purchaseActivity.findFirstOrThrow({where:{orderId,action:'resolve_change'}});
    await noteChange(orderId,'old-location-followup');
    signIn(staff.approver);
    const po = await currentPurchase();
    const next = {...written,requestId:'complete-with-verified-old-location',orderId,purchaseOrderId:po.id,version:po.version,stage:'preview',
      customerReference:'TEST-NEW-CUSTOMER-ALLOWS-SECOND',customerSha256:pricingContentHash('new-customer-second-only')};
    const locate = {activityId:saved.id,orderItemId,row:8,quantity:1};
    const line = {...written.dispositions[0],supplierDocumentRow:9,supplierLegacyLocations:[locate]};
    await expectJson(await post({...next,dispositions:[line]}),409);

    // Match the persisted shape from before commercial document accounting was introduced.
    const archived = JSON.parse(saved.detail);
    delete archived.snapshot.operation.decisionDocuments;
    const oldBytes = JSON.stringify(archived);
    await prisma.purchaseActivity.update({where:{id:saved.id},data:{detail:oldBytes}});
    const unresolved = await expectJson(await post({...next,dispositions:[{...line,supplierLegacyLocations:undefined}]}),409);
    expect(unresolved.error).toMatch(/未定位的旧批准/);
    const badQty = await expectJson(await post({...next,dispositions:[{...line,supplierLegacyLocations:[{...locate,quantity:2}]}]}),409);
    expect(badQty.error).toMatch(/旧批准实际占用量/);
    const oldScope = {orderId,purchaseOrderId:po.id,orderItemId,quantity:1};
    const spent = await expectJson(await post({...next,dispositions:[{...line,supplierDocumentRow:8,supplierDocumentScope:[oldScope],
      supplierRestoreScope:true}]}),409);
    expect(spent.error).toMatch(/超过原件核准范围/);
    const prepared = await previewAction({...written,...next,dispositions:[line]});
    await expectJson(await confirm(prepared),403);
    const {workspace} = await expectJson(await confirm(prepared,await grant(staff.approver)),200);
    expect(workspace.activities.at(-1)).toMatchObject({actorId:staff.approver,detail:{authorization:{permission:'purchases.approve'},
      snapshot:{operation:{decisionDocuments:[expect.objectContaining({role:'supplier',row:9,legacyLocations:[locate]}),
        expect.objectContaining({role:'customer'})]}}}});
    expect(await prisma.purchaseActivity.findUnique({where:{id:saved.id}})).toEqual({...saved,detail:oldBytes});
    await expectJson(await confirm(prepared,await grant(staff.approver)),200);
    expect(await prisma.purchaseActivity.count({where:{orderId,action:'resolve_change'}})).toBe(2);
  });

  it('keeps shipment session details out of new and historical responses while preserving the original audit bytes', async () => {
    signIn(staff.approver);
    const approval = await previewAction({ action: 'approve', requestId: 'approve-minimal-shipment-snapshot' });
    await expectJson(await confirm(approval, await grant(staff.approver)), 200);
    signIn(staff.operator);
    const registration = await previewAction({ action: 'register_order', requestId: 'register-before-shipping', reference: 'TEST-PREVIOUS-SUPPLIER-ACK',
      occurredAt: new Date().toISOString(), referenceSha256: 'b'.repeat(64) });
    await expectJson(await confirm(registration, await grant(staff.operator)), 200);
    await prisma.$transaction(async tx => {
      await tx.shipment.create({ data: { id: 'TEST-SESSION-SHIPMENT', orderId, status: 'shipped', shippedAt: new Date(),
        items: { create: { id: 'TEST-SESSION-SHIPMENT-ITEM', orderItemId, quantity: 1 } } } });
      await tx.orderItem.update({ where: { id: orderItemId }, data: { shippedQty: 1, status: 'partially_shipped' } });
      await tx.order.update({ where: { id: orderId }, data: { status: 'partially_shipped' } });
    });
    const { workspace } = await expectJson(await readPurchases(orderId), 200);
    const evidence = { action: 'attribute_purchase_shipment', orderId, version: workspace.fulfillment.version,
      requestId: 'minimal-actor-shipment', targetId: 'TEST-SESSION-SHIPMENT-ITEM', sources: [{ purchaseOrderId: registration.purchaseOrderId, quantity: 1 }],
      reference: 'TEST-SHIPMENT-FILE', sha256: 'd'.repeat(64), description: '核对实际发出的商品数量。' };
    await expectJson(await post({ ...evidence, stage: 'preview' }), 403);
    signIn(staff.approver);
    const { preview } = await expectJson(await post({ ...evidence, stage: 'preview' }), 200);
    const actor = { id: staff.approver, email: email(staff.approver) };
    expect(preview.snapshot.actor).toEqual(actor);
    await expectJson(await post({ ...evidence, stage: 'confirm', actionHash: preview.actionHash }), 403);
    await expectJson(await post({ ...evidence, stage: 'confirm', actionHash: preview.actionHash, stepUpToken: await grant(staff.approver) }), 200);
    const row = await prisma.purchaseActivity.findFirstOrThrow({ where: { orderId, action: 'attribute_purchase_shipment' } });
    const stored = JSON.parse(row.detail);
    expect(stored.snapshot.actor).toEqual(actor);
    expect(stored.authorization).toMatchObject({ permission: 'purchases.approve', action: 'admin_sensitive',
      sessionFingerprint: pricingContentHash({ userId: staff.approver, sessionId: session(staff.approver) }) });
    const original = JSON.stringify({ ...stored, snapshot: { ...stored.snapshot,
      actor: { ...actor, role: 'admin', sessionId: 'synthetic-historical-session-marker' } } });
    await prisma.purchaseActivity.update({ where: { id: row.id }, data: { detail: original } });
    const result = await expectJson(await readPurchases(orderId), 200);
    expect(result.workspace.activities.find((entry: { id: string }) => entry.id === row.id).detail.snapshot.actor).toEqual(actor);
    expect(JSON.stringify(result)).not.toContain('synthetic-historical-session-marker');
    expect(await prisma.purchaseActivity.findUnique({ where: { id: row.id } })).toMatchObject({ detail: original });
  });

  it('requires an explicit finance approval of a bank original before its amount can be allocated', async () => {
    signIn(staff.approver);
    const before = await expectJson(await readPurchases(orderId), 200);
    const proof = { action: 'verify_bank_receipt', requestId: 'verify-actual-bank-original', orderId,
      version: before.workspace.startReview.version, bankTrace: 'TEST-BANK-RECEIPT-ORIGINAL', receivingAccount: 'TEST-COMPANY-ACCOUNT',
      payer: '合成付款人', documentKind: 'single_receipt', receivedCents: 15000, receiptTotalCents: 15000,
      occurredAt: new Date().toISOString(), reference: 'TEST-BANK-SLIP', sha256: 'd'.repeat(64), description: '核对实际收款及归属。' };
    await expectJson(await post({ ...proof, stage: 'preview' }), 403);
    const db = getTestDb();
    db.prepare("INSERT OR IGNORE INTO AdminPermission (id,key,resource,action,name) VALUES ('finance.write','finance.write','finance','write','finance.write')").run();
    db.prepare('INSERT INTO AdminRolePermission (roleId,permissionId) VALUES (?,?)').run(staffRole[staff.finance], 'finance.write');
    signIn(staff.finance);
    const manualPlatform = { ...proof, action: 'record_customer_receipt', requestId: 'unverified-platform', receiptKind: 'platform_receipt',
      transactionReference: 'TEST-UNKNOWN-PLATFORM-TRANSFER', allocationReference: 'TEST-UNVERIFIED', amountCents: 15000 };
    await expectJson(await post({ ...manualPlatform, stage: 'preview' }), 409);
    const { preview } = await expectJson(await post({ ...proof, stage: 'preview' }), 200);
    await expectJson(await post({ ...proof, stage: 'confirm', actionHash: preview.actionHash }), 403);
    const { workspace } = await expectJson(await post({ ...proof, stage: 'confirm', actionHash: preview.actionHash, stepUpToken: await grant(staff.finance) }), 200);
    expect(workspace.startReview.payment.receivedCents).toBe(0);
    const [bank] = workspace.startReview.bankReceipts;
    expect(bank).toMatchObject({ actorId: staff.finance, bank: { bankTrace: proof.bankTrace, receiptTotalCents: 15000 } });
    const allocate = { action: 'record_customer_receipt', orderId, version: workspace.startReview.version, requestId: 'allocate-confirmed-proof', bankReceiptId: bank.id,
      allocationReference: 'TEST-EXACT-ALLOCATION', amountCents: 15000, reference: 'TEST-ALLOCATION-SHEET', sha256: 'e'.repeat(64), description: '复核本单分摊。' };
    const allocation = await expectJson(await post({ ...allocate, stage: 'preview' }), 200);
    await expectJson(await post({ ...allocate, stage: 'confirm', amountCents: 14999, actionHash: allocation.preview.actionHash, stepUpToken: await grant(staff.finance) }), 409);
    const final = await expectJson(await post({ ...allocate, stage: 'confirm', actionHash: allocation.preview.actionHash, stepUpToken: await grant(staff.finance) }), 200);
    expect(final.workspace.startReview.payment.receivedCents).toBe(15000);
    expect(activity('verify_bank_receipt')).toHaveLength(1);
    expect(activity('record_customer_receipt')).toEqual([{ actorId: staff.finance, amountCents: 15000 }]);
  });

  it('lists and prepares historical partially shipped orders with outstanding lines only', async () => {
    const partial = 'TEST-PARTIALLY-SHIPPED';
    const complete = 'TEST-SHIPPED-COMPLETELY';
    await seedAcceptedOrder(partial, `${partial}-line`);
    await seedAcceptedOrder(complete, `${complete}-line`);
    await prisma.$transaction([
      prisma.order.updateMany({ where: { id: { in: [partial, complete] } }, data: { status: 'partially_shipped' } }),
      prisma.orderItem.update({ where: { id: `${partial}-line` }, data: { shippedQty: 1 } }),
      prisma.orderItem.update({ where: { id: `${complete}-line` }, data: { shippedQty: 2 } }),
    ]);
    signIn(staff.operator);
    const { orders } = await expectJson(await readPurchases(), 200);
    expect(orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: partial, prepared: 0 })]));
    expect(orders).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: complete })]));
    const result = await expectJson(await post({ action: 'prepare', orderId: partial }), 200);
    expect(result.workspace).toMatchObject({ canPrepare: false, lines: [{ orderItemId: `${partial}-line`, source: { quantity: 1 } }] });
    const fulfilled = await expectJson(await post({ action: 'prepare', orderId: complete }), 200);
    expect(fulfilled.workspace).toMatchObject({ canPrepare: false, lines: [] });
  });

  it('requires a separate purchase approver and a fresh MFA grant for the exact remaining payable and deposit allocation', async () => {
    signIn(staff.approver);
    const initial = await previewAction({ action: 'approve', requestId: 'approve-before-deposit' });
    await expectJson(await confirm(initial, await grant(staff.approver)), 200);
    signIn(staff.finance);
    const deposit = await previewAction({ action: 'record_payment', requestId: 'deposit-before-hold', amountCents: 900,
      reference: 'TEST-DATED-DEPOSIT', conditionReference: 'TEST-DEPOSIT-DUE' });
    await expectJson(await confirm(deposit, await grant(staff.finance)), 200);
    signIn(staff.operator);
    const held = await previewAction({ action: 'report_change', requestId: 'hold-one-line', changeKind: 'unavailable', reference: 'TEST-SHORTAGE', description: '原采购中一件暂时无法供货。' });
    await expectJson(await confirm(held, await grant(staff.operator)), 200);
    signIn(staff.approver);
    const resolution = await previewAction({ action: 'resolve_change', requestId: 'cancel-one-unit', outcome: 'declined',
      supplierReference: 'TEST-SUPPLIER-CANCEL-ONE', supplierSha256: 'c'.repeat(64), customerReference: 'TEST-CUSTOMER-CANCEL-ONE', customerSha256: 'd'.repeat(64),
      description: '合成双方书面同意取消一件。', refundFollowup: '财务单独核对未抵扣的定金。', confirmsFullIncidentScope: true, dispositions: [{ orderItemId, quantity: 1, outcome: 'cancel' }] });
    await expectJson(await confirm(resolution, await grant(staff.approver)), 200);
    const po = await currentPurchase();
    const remainder: ActionRequest = { action: 'approve_remaining', requestId: 'approve-only-one-unit', reference: 'TEST-REMAINING-AP', referenceSha256: 'e'.repeat(64),
      description: '复核不受影响的一件及定金归属。', remainingLines: [{ orderItemId, payableCents: 3673 }], appliedPaidCents: 500 };
    signIn(staff.operator);
    await expectJson(await post({ ...remainder, stage: 'preview', orderId, purchaseOrderId: po.id, version: po.version }), 403);
    signIn(staff.approver);
    const previewed = await previewAction(remainder);
    await expectJson(await confirm(previewed), 403);
    await expectJson(await confirm({ ...previewed, appliedPaidCents: 501 }, await grant(staff.approver)), 409);
    const { workspace } = await expectJson(await confirm(previewed, await grant(staff.approver)), 200);
    expect(workspace.orders[0]).toMatchObject({ id: po.id, totalCents: 7346, paidCents: 900, dueCents: 3173, needsRemainingReview: false,
      ledger: expect.arrayContaining([expect.objectContaining({ action: 'approve_remaining', detail: expect.objectContaining({
        authorization: expect.objectContaining({ permission: 'purchases.approve' }),
      }) })]),
    });
    expect(activity('record_payment')).toHaveLength(1);
  });
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
    await updateTerms({ unitPriceCents: 4000, linePayableCents: 8000, sourceReference: 'TEST-NEW-WRITTEN-QUOTE', sourceSha256: 'f'.repeat(64) });

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

  it('requires both actual order authority and one-use MFA for historical provenance without replaying order acceptance', async () => {
    const id = 'test-legacy-merchant-order';
    const original = await prisma.$transaction(async tx => {
      const order = await tx.order.create({ data: {
        id, customerId: buyer, email: email(buyer), subtotal: 125, total: 125, status: 'confirmed', paymentMethod: 'bank_transfer',
        orderItems: { create: { id: 'test-legacy-merchant-line', position: 0, name: '合成历史商品', quantity: 1, unitPrice: 125 } },
      } });
      await reserveOrderCredit(tx, id, staff.merchant);
      return order;
    });

    signIn(staff.operator);
    const before = await expectJson(await readPurchases(id), 200);
    expect(before.workspace.startReview.canVerifyAcceptance).toBe(true);
    const request = { action: 'verify_acceptance', orderId: id, version: before.workspace.startReview.version,
      requestId: 'history-proof', reference: 'TEST-MERCHANT-ARCHIVE', sha256: 'b'.repeat(64), originalActor: staff.merchant,
      authorityReference: 'TEST-DATED-HISTORIC-ROLE', occurredAt: original.createdAt.toISOString(), description: '核对原接单书面记录' };
    const denied = await expectJson(await post({ ...request, stage: 'preview', permissions: ['orders.write'] }), 403);
    expect(denied.requiredPermission).toBe('orders.write');

    getTestDb().prepare('INSERT INTO AdminRolePermission (roleId,permissionId) VALUES (?,?)').run(staffRole[staff.merchant], 'purchases.read');
    signIn(staff.merchant);
    const { preview } = await expectJson(await post({ ...request, stage: 'preview' }), 200);
    expect(preview.snapshot.review.orderTerms).toMatchObject({ orderId: id, total: 125, lines: [{ quantity: 1, unitPrice: 125 }] });
    const apply = { ...request, stage: 'confirm', actionHash: preview.actionHash };
    await expectJson(await post(apply), 403);
    const token = await grant(staff.merchant);
    const approved = await expectJson(await post({ ...apply, stepUpToken: token }), 200);
    expect(approved.workspace.lines).toHaveLength(1);
    expect(approved.workspace.startReview.acceptance.origin).toBe('reviewed_archive');
    expect(approved.workspace.activities.find((row: { action: string }) => row.action === 'verify_acceptance').detail.authorization)
      .toMatchObject({ action: 'admin_sensitive', permission: 'orders.write', sessionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await expectJson(await post({ ...apply, stepUpToken: token }), 403);
    await expectJson(await post({ ...apply, stepUpToken: await grant(staff.merchant) }), 200);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: id } })).toBe(0);
    expect(await prisma.creditTransaction.count({ where: { orderId: id } })).toBe(1);
    expect(getTestDb().prepare("SELECT COUNT(*) AS count FROM PurchaseActivity WHERE orderId = ? AND action = 'verify_acceptance'").get(id))
      .toEqual({ count: 1 });
  });

  it('binds the payment amount to its preview and deduplicates the same supplier receipt', async () => {
    signIn(staff.approver);
    const approval = await previewAction({ action: 'approve', requestId: 'test-payment-approval' });
    await expectJson(await confirm(approval, await grant(staff.approver)), 200);

    signIn(staff.operator);
    const placement = await previewAction({ action: 'register_order', requestId: 'test-placement', reference: 'TEST-SUPPLIER-ORDER',
      occurredAt: new Date().toISOString(), referenceSha256: 'd'.repeat(64) });
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

    signIn(staff.operator);
    const shortage = await previewAction({ action: 'report_change', requestId: 'test-supplier-shortage',
      changeKind: 'unavailable', reference: 'TEST-SUPPLIER-SHORTAGE', description: '合成原供方书面确认无法供应。' });
    await expectJson(await confirm(shortage, await grant(staff.operator)), 200);
    const held = await currentPurchase();
    const cancellation: ActionRequest = {
      action: 'resolve_change', requestId: 'test-cancel-paid-unavailable', outcome: 'declined',
      supplierReference: 'TEST-SUPPLIER-CANCELLATION', supplierSha256: 'a'.repeat(64),
      customerReference: 'TEST-CUSTOMER-CANCELLATION', customerSha256: 'b'.repeat(64),
      description: '合成双方取消订单行的供应。', refundFollowup: '采购财务核对原款退回凭据。',
      dispositions: [{ orderItemId, quantity: 2, outcome: 'cancel' }],
    };
    await expectJson(await post({ ...cancellation, stage: 'preview', orderId, purchaseOrderId: held.id, version: held.version,
      permissions: ['purchases.approve'] }), 403);
    signIn(staff.approver);
    const resolution = await previewAction(cancellation);
    const cancelled = await expectJson(await confirm(resolution, await grant(staff.approver)), 200);
    expect(cancelled.workspace.orders).toHaveLength(1);
    expect(cancelled.workspace.orders[0]).toMatchObject({ id: held.id, totalCents: 7346, paidCents: 3100, orderedBefore: true });
    expect(activity('record_payment')).toHaveLength(1);
    expect(activity('resolve_change')).toEqual([{ actorId: staff.approver, amountCents: null }]);
    expect(cancelled.workspace.orders[0].ledger.at(-1).detail.snapshot.operation.refund.status).toBe('pending_review');
  });
});
