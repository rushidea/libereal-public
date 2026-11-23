// @vitest-environment node

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/admin/purchases/route';
import { GET as financeGET, POST as financePOST } from '@/app/api/admin/finance/route';
import { POST as alipayNotify } from '@/app/api/payments/alipay/notify/route';
import { POST as creditReview } from '@/app/api/cron/credit-review/route';
import { ADMIN_ROLE_DEFINITIONS, type AdminRoleKey } from '@/lib/admin-permissions';
import { releaseOrderReceivableOnCancellation, reserveOrderCredit } from '@/lib/customer-credit';
import { resetEphemeralStoreForTests } from '@/lib/ephemeral-store';
import { merchantAcceptanceMetadata, merchantOrderApprovalPreview, ORDER_APPROVAL_INCLUDE } from '@/lib/order-approval';
import { prisma } from '@/lib/prisma';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import type { PurchaseActionInput } from '@/lib/purchase-orders';
import { createMfaKeyRing, encryptMfaSecret } from '@/lib/security/mfa-crypto';
import { generateTotpSecret, totpCodeAt } from '@/lib/security/mfa-totp';
import { completeSecurityStepUp, startSecurityStepUp, type SecurityStepUpAction } from '@/lib/security/security-step-up';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';
import { supplierPaymentProof } from './supplier-payment-proof';

vi.mock('@/lib/alipay', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/alipay')>(),
  getAlipaySdk: () => ({ config: { appId: '9021000000000000', sellerId: '2088000000000000' }, sdk: { checkNotifySign: () => true } }),
}));

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
  accountant: 'office-financial-accountant',
} as const;
const buyer = 'test-buyer';
const staffRole = {
  [staff.merchant]: 'order_admin',
  [staff.operator]: 'purchase_operator',
  [staff.approver]: 'purchase_approver',
  [staff.finance]: 'purchase_finance',
  [staff.accountant]: 'finance_staff',
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
  return purchase as { id: string; version: string; status: string; totalCents: number; paidCents: number; lines: Array<{ terms: { payee: string | null } }> };
}

async function previewAction(request: ActionRequest, target = orderId): Promise<Previewed> {
  const purchase = await currentPurchase(target);
  const evidence = request.action === 'record_payment' && !request.paymentIssueId
    ? supplierPaymentProof(request.reference ?? request.requestId, purchase.lines[0].terms.payee) : {};
  const input = { ...evidence, ...request, orderId: target, purchaseOrderId: purchase.id, version: purchase.version };
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

  it('requires authorized MFA to clarify an old active supply event independently of any commercial settlement', async () => {
    await startActualSupply(orderId,'review-only-facts');
    await noteChange(orderId,'old-no-structured-scope');
    const {workspace:before} = await expectJson(await readPurchases(orderId),200);
    const [purchase] = before.orders;
    const [incident] = purchase.incidents;
    expect(incident.outstanding).toBeNull();
    const request = {action:'review_change_scope' as const,incidentId:incident.id,requestId:'keep-actual-affected-one-pending',
      reference:'TEST-VERIFIED-OLD-SUPPLY-NOTICE',description:'原件仅列一件未发货，商务处理仍待双方确认。',
      affectedLines:[{orderItemId,quantity:1,source:{kind:'unshipped' as const}}]};
    await expectJson(await post({...request,stage:'preview',orderId,purchaseOrderId:purchase.id,version:purchase.version}),403);
    signIn(staff.approver);
    const first = await previewAction(request);
    await expectJson(await confirm(first),403);
    await expectJson(await confirm({...first,incidentId:'other-supply-event-id'},await grant(staff.approver)),409);
    const {workspace:after} = await expectJson(await confirm(first,await grant(staff.approver)),200);
    const [updated] = after.orders;
    expect(updated).toMatchObject({status:'on_hold',totalCents:purchase.totalCents,paidCents:purchase.paidCents,
      incidents:[{id:incident.id,outstanding:request.affectedLines,factReview:{actorId:staff.approver,reference:request.reference}}]});
    expect(activity('resolve_change')).toEqual([]);
    await expectJson(await confirm(first,await grant(staff.approver)),200);
    expect(activity('review_change_scope')).toEqual([{actorId:staff.approver,amountCents:null}]);
    expect(after.activities.find((row:{id:string})=>row.id===incident.id)).toEqual(before.activities.at(-1));
    await noteChange(orderId,'late-copy-of-same-notice');
    signIn(staff.approver);
    const {workspace:two} = await expectJson(await readPurchases(orderId),200);
    const late = two.orders[0].incidents[1];
    const duplicate = await previewAction({action:'review_change_scope',reviewResult:'duplicate',relatedIncidentId:incident.id,incidentId:late.id,
      requestId:'same-effect-only-one',reference:'TEST-REPEATED-SENDER-DOCUMENT',description:'这份送达仅转述原通知，无独立范围。'});
    const {workspace:linked} = await expectJson(await confirm(duplicate,await grant(staff.approver)),200);
    expect(linked.orders[0]).toMatchObject({status:'on_hold',incidents:[{id:incident.id,outstanding:request.affectedLines}],
      incidentHistory:[{id:incident.id,status:'open'},{id:late.id,status:'duplicate',linkedTo:incident.id}]});
    expect(activity('resolve_change')).toEqual([]);
  });

  it('binds distinct buyer originals for a one-unit withdrawal and the independent retained quote under the actual MFA confirmation', async () => {
    await startActualSupply(orderId,'real-original-before-split');
    await noteChange(orderId,'supplier-initially-cannot-supply-two');
    const digest=(content:string)=>createHash('sha256').update(Buffer.from(content,'utf8')).digest('hex');
    signIn(staff.approver);
    const party='合成替代原供方';
    const draftTerms={...procurementTerms,currency:'CNY' as const,taxBasis:'included' as const,leadTimeAssessment:'within_agreement' as const,
      supplier:party,writtenSupplier:party,payee:'合成替代收款人',
      sourceReference:'TEST-ORIGINAL-TWO-QUOTE',sourceSha256:digest('原供方报价两件，每件 36.73，总额 73.46'),
      settlementSha256:digest('合成结算书证，合成替代收款人，按上述实际条件')};
    const proposal=await previewAction({action:'resolve_change',outcome:'replacement',requestId:'actual-two-item-alternative',
      supplierReference:'TEST-ORIGINAL-SUPPLIER-WITHDRAWAL',supplierSha256:digest('原供方撤回2件'),
      customerReference:'TEST-ORIGINAL-BUYER-CONFIRMS-TWO',customerSha256:digest('客户原件同意两件旧报价'),
      description:'两个均已有原替代书证。',dispositions:[{orderItemId,quantity:2,outcome:'replace',replacement:{
        name:'合成替代草稿',brand:'合成品牌',catalogNumber:'TEST-DUAL-BUYER-QUOTE',spec:'合成规格',unit:'件',terms:draftTerms,
      }}]});
    const {workspace:prepared}=await expectJson(await confirm(proposal,await grant(staff.approver)),200);
    let draft=prepared.orders.find((row:{id:string})=>row.id!==proposal.purchaseOrderId);
    async function previewDraft(input:ActionRequest) {
      const payload={...input,orderId,purchaseOrderId:draft.id,version:draft.version};
      const {preview}=await expectJson(await post({...payload,stage:'preview'}),200);
      return {...payload,actionHash:preview.actionHash};
    }
    signIn(staff.operator);
    const scope=[{orderItemId,quantity:1,source:{kind:'unshipped' as const}}];
    const notice=await previewDraft({action:'report_change',changeKind:'other',requestId:'only-one-now-withdrawn',
      reference:'TEST-ONE-ONLY-CUSTOMER-NOTICE',description:'一件撤回。另一件的新价格另有客户文件。',affectedLines:scope});
    const {workspace:held}=await expectJson(await confirm(notice,await grant(staff.operator)),200);
    draft=held.orders.find((row:{id:string})=>row.id===draft.id);
    const buyerWithdrawal=digest('合成客户书面决定，撤回原第二件。此文件只授权撤回这一件。');
    const buyerKept={reference:'TEST-INDEPENDENT-ACCEPTANCE-OF-KEPT-ONE',
      sha256:digest('另一份合成客户书面原件，留存另一件，实际报价 41.20。')};
    const oneQuote={...draftTerms,sourceReference:'TEST-ACTUAL-ONE-SUPPLIER-QUOTE',
      sourceSha256:digest('另发合成供方报价原件一份，仅一件，单价及合计 41.20'),unitPriceCents:4120,linePayableCents:4120};
    const action={action:'resolve_change' as const,outcome:'declined' as const,incidentId:draft.incidents[0].id,
      requestId:'confirm-two-provably-distinct-files',supplierReference:'TEST-ONLY-ONE-DRAFT-RETAINED',
      customerReference:'TEST-ACTUAL-DISTINCT-WITHDRAWAL',customerSha256:buyerWithdrawal,
      description:'双方各自证实撤回一件和留存一件的新报价。',coordinationLines:scope,
      decisionDocumentLines:[{orderItemId,customerDocumentRow:1}],
      retainedDraftTerms:[{orderItemId,terms:oneQuote,customerDocumentRow:1,customerDecision:buyerKept}]};
    await expectJson(await post({...action,stage:'preview',orderId,purchaseOrderId:draft.id,version:draft.version,
      retainedDraftTerms:[{...action.retainedDraftTerms[0],customerDecision:{...buyerKept,sha256:buyerWithdrawal}}]}),409);
    const confirmed=await previewDraft(action);
    await expectJson(await confirm(confirmed),403);
    await expectJson(await confirm({...confirmed,retainedDraftTerms:[{...confirmed.retainedDraftTerms![0],
      customerDecision:{...buyerKept,sha256:digest('预览之后加入的另一份文件')}}]},await grant(staff.operator)),409);
    const {workspace:applied}=await expectJson(await confirm(confirmed,await grant(staff.operator)),200);
    expect(applied.orders.find((row:{id:string})=>row.id===draft.id)).toMatchObject({status:'draft',paidCents:0,totalCents:4120,
      remaining:[{orderItemId,quantity:1}]});
    expect(applied.activities.at(-1).detail.snapshot.operation.decisionDocuments).toMatchObject([
      {role:'customer',sha256:buyerWithdrawal,row:1,authority:{purpose:'decline_preparation'},allocations:[{orderItemId,quantity:1}]},
      {role:'customer',sha256:buyerKept.sha256,reference:buyerKept.reference,row:1,authority:{purpose:'reconfirm_terms'},
        allocations:[{orderItemId,quantity:1}]},
    ]);
    expect(applied.activities.at(-1).detail.snapshot.operation.draftAllocations[0].retained.terms.sourceSha256).toBe(oneQuote.sourceSha256);
    draft=applied.orders.find((row:{id:string})=>row.id===draft.id);
    vi.setSystemTime(Date.now()+10*60*1000);
    const another=await previewDraft({...notice,requestId:'review-another-factual-change'});
    const {workspace:anotherHold}=await expectJson(await confirm(another,await grant(staff.operator)),200);
    draft=anotherHold.orders.find((row:{id:string})=>row.id===draft.id);
    const reuse=await expectJson(await post({...action,orderId,purchaseOrderId:draft.id,version:draft.version,stage:'preview',
      requestId:'cannot-use-retained-paper-to-withdraw',incidentId:draft.incidents[0].id,retainedDraftTerms:undefined,customerSha256:buyerKept.sha256}),409);
    expect(reuse.error).toMatch(/商业决定、供方或实质条件已变化/);
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
    const beforeRemainderApproval = new Date().toISOString();
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
    signIn(staff.finance);
    const historicalPayment = {
      action: 'record_payment', requestId: 'older-than-remainder-approval', amountCents: 100,
      reference: '合成银行回单 旧合同期间', conditionReference: 'TEST-BEFORE-REMAINDER',
      ...supplierPaymentProof('PRE-REMAINDER-APPROVAL-TRACE', procurementTerms.payee, beforeRemainderApproval),
    } as const;
    const preRevisionPayment = await expectJson(await post({
      ...historicalPayment, orderId, purchaseOrderId: po.id, version: workspace.orders[0].version, stage: 'preview',
    }), 409);
    expect(preRevisionPayment.error).toContain('付款发生时');
    expect(activity('record_payment')).toHaveLength(1);
    const reported = await expectJson(await confirm(await previewAction({ ...historicalPayment,
      action: 'record_payment_exception', requestId: 'statement-actual-pre-remainder-payment',
      description: '银行回单为变更前的额外实际付款，需核准旧归属。' }), await grant(staff.finance)), 200);
    const [issue] = reported.workspace.orders[0].paymentExceptions;
    const apply = await previewAction({ action: 'record_payment', requestId: 'recognize-before-remainder-payment',
      paymentIssueId: issue.id, conditionReference: '旧批准中在当时已满足的预付款条件' });
    const result = await expectJson(await confirm(apply, await grant(staff.finance)), 200);
    expect(result.workspace.orders[0]).toMatchObject({ totalCents: 7346, paidCents: 1000, needsRemainingReview: true, dueCents: null,
      paymentExceptions: [{ id: issue.id, pending: false }] });
    expect(result.workspace.orders[0].ledger.at(-1)).toMatchObject({ action: 'record_payment', detail: { snapshot: { operation: {
      paymentIssueId: issue.id, approvalId: workspace.orders[0].ledger.find((row: { action: string }) => row.action === 'approve').id,
      needsRemainingRecheck: true } } } });
    expect(activity('record_payment')).toHaveLength(2);
    signIn(staff.approver);
    const revised = await previewAction({ ...remainder, requestId: 'review-remainder-including-actual-original-payment', appliedPaidCents: 600 });
    const reevaluated = await expectJson(await confirm(revised, await grant(staff.approver)), 200);
    expect(reevaluated.workspace.orders[0]).toMatchObject({ paidCents: 1000, dueCents: 3073, needsRemainingReview: false });
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
    const matchingReceipt = await previewAction({ ...request, requestId: 'test-payment-different-request' });
    await expectJson(await confirm({ ...payment, amountCents: 3101 }, await grant(staff.finance)), 409);
    expect(activity('record_payment')).toEqual([]);

    const oneUse = await grant(staff.finance);
    await expectJson(await confirm(payment, oneUse), 200);
    await expectJson(await confirm(payment, oneUse), 403);
    await expectJson(await confirm(payment, await grant(staff.finance)), 200);

    await expectJson(await confirm(matchingReceipt, await grant(staff.finance)), 409);
    await expectJson(await post({ ...payment, version: (await currentPurchase()).version, actionHash: undefined,
      requestId: 'renamed-payment-receipt', reference: 'alternate name of original voucher', stage: 'preview' }), 409);
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

  describe('commercial finance', () => {
    const endpoint = 'http://localhost/api/admin/finance';
    function financeRead(id = orderId) {
      return financeGET(new NextRequest(endpoint + '?orderId=' + encodeURIComponent(id)));
    }
    function financeAttention() {
      return financeGET(new NextRequest(endpoint + '?attention=1'));
    }
    function financePost(input: object) {
      return financePOST(new NextRequest(endpoint, { method: 'POST', body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' } }));
    }
    function paper(ref: string) {
      return { reference: ref, sha256: pricingContentHash({ original: ref }), description: '已核对办公室用品本地演练原件 ' + ref };
    }
    async function financePreview(action: string, data: object, id = orderId) {
      const { workspace } = await expectJson(await financeRead(id), 200);
      const input = { orderId: id, action, requestId: randomUUID(), version: workspace.version, data };
      const { preview } = await expectJson(await financePost({ ...input, stage: 'preview' }), 200);
      return { input, preview };
    }
    async function finish(checked: Awaited<ReturnType<typeof financePreview>>) {
      // These separate bookkeeping visits use normal MFA and its real rate-limit rules.
      vi.setSystemTime(Date.now() + 3 * 60_000);
      return expectJson(await financePost({ ...checked.input, stage: 'confirm', actionHash: checked.preview.actionHash,
        stepUpToken: await grant(staff.accountant) }), 200);
    }
    async function record(action: string, data: object, id = orderId) {
      return (await finish(await financePreview(action, data, id))).workspace;
    }
    async function bank(trace: string, total: number, id = orderId, occurredAt = new Date().toISOString()) {
      const view = await record('verify_bank_receipt', { ...paper('bank-' + trace), documentKind: 'single_receipt', payer: 'Office buyer',
        bankTrace: trace, receiptTotalCents: total, receivingAccount: 'Office settlement account', occurredAt }, id);
      return view.banks.find((entry: { bankTrace: string }) => entry.bankTrace === trace).id as string;
    }
    function allocation(id: string, amount: number, ref: string) {
      return { ...paper(ref), bankReceiptId: id, amountCents: amount, allocationReference: ref };
    }

    it('settles two orders from two actual bank transactions across finance and purchasing with partial credit release', async () => {
      const other = 'office-second-order';
      await seedAcceptedOrder(other, 'office-second-line');
      signIn(staff.operator);
      await expectJson(await financeRead(), 403);
      await expectJson(await financePost({ action: 'verify_bank_receipt', role: 'finance_staff', data: {} }), 403);
      signIn(staff.accountant);
      await expectJson(await readPurchases(orderId), 403);
      const bankOne = await bank('OFFICE-TRANSFER-1', 30000);
      const bankTwo = await bank('OFFICE-TRANSFER-2', 20000, other);
      expect((await expectJson(await financeRead(), 200)).workspace.receivable.outstandingCents).toBe(25000);
      const first = await financePreview('record_customer_receipt', allocation(bankOne, 8000, 'office-allocation-A'));
      expect(first.preview.snapshot.operation.accounting).toMatchObject({ releaseCents: 8000, remainingCents: 17000, accountUsedAfter: 420 });
      const confirmData = { ...first.input, stage: 'confirm', actionHash: first.preview.actionHash };
      await expectJson(await financePost(confirmData), 403);
      await expectJson(await financePost({ ...confirmData, data: { ...first.input.data, amountCents: 7900 }, stepUpToken: await grant(staff.accountant) }), 409);
      const part = await finish(first);
      expect(part.workspace).toMatchObject({ orderId, status: 'confirmed', paidAt: null, settlementCents: 8000,
        receivable: { outstandingCents: 17000, status: 'open' } });
      expect((await finish(first)).eventId).toBe(part.eventId);
      expect(await prisma.customerCashPosting.count({ where: { orderId } })).toBe(1);
      await expect(prisma.$transaction(tx => releaseOrderReceivableOnCancellation(tx, orderId, staff.accountant))).rejects.toThrow('PAID_ORDER_REFUND_REQUIRED');
      signIn(staff.operator);
      expect((await expectJson(await readPurchases(orderId), 200)).workspace.eligibility.eligible).toBe(true);
      signIn(staff.accountant);
      const otherView = (await expectJson(await financeRead(other), 200)).workspace;
      await expectJson(await financePost({ action: 'record_customer_receipt', orderId: other, requestId: randomUUID(), version: otherView.version,
        stage: 'preview', data: allocation(bankOne, 22001, 'over-receipt') }), 409);
      await record('record_customer_receipt', allocation(bankOne, 22000, 'office-allocation-B'), other);
      const paid = await record('record_customer_receipt', allocation(bankTwo, 17000, 'office-allocation-C'));
      expect(paid).toMatchObject({ status: 'confirmed', settlementCents: 25000, receivable: { outstandingCents: 0, status: 'paid' } });
      const second = await record('record_customer_receipt', allocation(bankTwo, 3000, 'office-allocation-D'), other);
      expect(second.receivable).toMatchObject({ status: 'paid', outstandingCents: 0 });
      expect(await prisma.creditAccount.findUniqueOrThrow({ where: { userId: buyer } })).toMatchObject({ usedAmount: 0 });
      expect(await prisma.customerCashPosting.count()).toBe(4);
      expect(await prisma.creditTransaction.count({ where: { type: 'release' } })).toBe(4);
    });

    it('retains a backdated bank payment date while the other overdue order still controls credit and the tier review uses today', async () => {
      const other = 'office-later-overdue-order';
      await seedAcceptedOrder(other, 'office-later-overdue-line');
      const recordedToday = Date.now();
      const originalPaidAt = new Date(recordedToday - 3 * 365 * 86400000);
      await prisma.accountReceivable.update({ where: { orderId: other },
        data: { status: 'overdue', dueAt: new Date(recordedToday - 100 * 86400000) } });
      await prisma.creditAccount.update({ where: { userId: buyer }, data: { status: 'overdue_hold', statusSource: 'system' } });
      await prisma.user.update({ where: { id: buyer }, data: { tier: 'synthetic-previous-tier' } });
      await prisma.order.create({ data: { id: 'office-recent-settled-order', customerId: buyer, email: email(buyer),
        subtotal: 1500, total: 1500, status: 'completed', paidAt: new Date(recordedToday - 14 * 86400000) } });

      signIn(staff.accountant);
      const receipt = await bank('OLD-OFFICE-TRANSFER', 25000, orderId, originalPaidAt.toISOString());
      await record('record_customer_receipt', allocation(receipt, 25000, 'office-old-order-allocation'));
      expect(await prisma.order.findUnique({ where: { id: orderId }, select: { paidAt: true } })).toEqual({ paidAt: originalPaidAt });
      expect(await prisma.accountReceivable.findUnique({ where: { orderId } })).toMatchObject({ status: 'paid', paidAt: originalPaidAt });
      expect(await prisma.creditAccount.findUnique({ where: { userId: buyer } }))
        .toMatchObject({ status: 'overdue_hold', statusSource: 'system', usedAmount: 250 });
      const review = await prisma.userTierHistory.findFirstOrThrow({ where: { userId: buyer } });
      expect(review.rollingSpend).toBe(1500);
      expect(review.calculationTo.getTime()).toBeGreaterThanOrEqual(recordedToday);
    });

    it('stores the original bank receipt before historical acceptance and enforces the same posting proof in both workspaces', async () => {
      const id = 'office-bank-with-unverified-legacy-acceptance';
      const legacy = await prisma.order.create({ data: { id, customerId: buyer, email: email(buyer), subtotal: 125, total: 125,
        status: 'confirmed', paymentMethod: 'bank_transfer',
        orderItems: { create: { id: 'office-legacy-receipt-line', position: 0, name: 'Office supplies', quantity: 1, unitPrice: 125 } } } });
      await prisma.$transaction(tx => reserveOrderCredit(tx, id, staff.merchant));
      signIn(staff.accountant);
      const sourceId = await bank('OFFICE-WRITTEN-RECEIPT', 12500, id);
      const data = allocation(sourceId, 12500, 'office-legacy-allocation');
      const finance = (await expectJson(await financeRead(id), 200)).workspace;
      expect(finance).toMatchObject({ acceptanceId: null, banks: [{ id: sourceId, availableCents: 12500 }] });
      await expectJson(await financePost({ orderId: id, requestId: randomUUID(), action: 'record_customer_receipt',
        version: finance.version, data, stage: 'preview' }), 409);
      signIn(staff.operator);
      const prior = await expectJson(await readPurchases(id), 200);
      const allowPurchaseRead = getTestDb().prepare('INSERT INTO AdminRolePermission (roleId,permissionId) VALUES (?,?)');
      allowPurchaseRead.run(staffRole[staff.accountant], 'purchases.read');
      allowPurchaseRead.run(staffRole[staff.merchant], 'purchases.read');
      signIn(staff.accountant);
      const purchaseInput = { orderId: id, requestId: 'legacy-purchase-allocation', action: 'record_customer_receipt',
        version: prior.workspace.startReview.version, ...data };
      const blocked = await expectJson(await post({ ...purchaseInput, stage: 'preview' }), 409);
      expect(blocked.error).toContain('平台接单依据');
      expect(await prisma.customerCashPosting.count({ where: { orderId: id } })).toBe(0);

      signIn(staff.merchant);
      const verify = { ...paper('original-office-acceptance'), action: 'verify_acceptance', orderId: id,
        requestId: 'written-legacy-acceptance-proof', version: prior.workspace.startReview.version,
        occurredAt: legacy.createdAt.toISOString(), originalActor: staff.merchant, authorityReference: 'Office archive of merchant acceptance' };
      const check = await expectJson(await post({ ...verify, stage: 'preview' }), 200);
      const accepted = await expectJson(await post({ ...verify, stage: 'confirm', actionHash: check.preview.actionHash, stepUpToken: await grant(staff.merchant) }), 200);
      signIn(staff.accountant);
      await expectJson(await post({ ...purchaseInput, version: accepted.workspace.startReview.version, stage: 'preview' }), 200);
      const confirmed = await record('record_customer_receipt', data, id);
      expect(confirmed).toMatchObject({ settlementCents: 12500, receivable: { status: 'paid', outstandingCents: 0 } });
      expect(await prisma.customerCashPosting.count({ where: { orderId: id } })).toBe(1);
    });

    it('holds an anomalous legacy amount internally until finance verifies the original obligation, then collects and posts it without inventing credit', async () => {
      const id = 'office-legacy-face-unknown';
      const oldAt = new Date(Date.now() - 150 * 86400000);
      const dueAt = new Date(Date.now() - 100 * 86400000);
      await prisma.order.create({ data: { id, customerId: buyer, email: email(buyer), subtotal: 0, total: 0, createdAt: oldAt,
        status: 'confirmed', paymentMethod: 'bank_transfer',
        orderItems: { create: { id: 'office-legacy-amount-line', position: 0, name: 'Office supplies archive', quantity: 1, unitPrice: 120.5 } } } });
      const ar = await prisma.accountReceivable.create({ data: { orderId: id, userId: buyer, amount: 120.5, dueAt, confirmedAt: oldAt } });
      const allowance = await prisma.creditAccount.findUniqueOrThrow({ where: { userId: buyer } });
      vi.stubEnv('CRON_SECRET', 'local-office-credit-review');
      const runReview = () => creditReview(new NextRequest('http://localhost/api/cron/credit-review', {
        method: 'POST', headers: { 'x-cron-secret': 'local-office-credit-review' },
      }));
      expect(await expectJson(await runReview(), 200)).toMatchObject({ reminded: 0, suspended: 0 });
      expect(await prisma.creditAccount.findUnique({ where: { id: allowance.id } })).toMatchObject({ status: 'active', usedAmount: allowance.usedAmount });
      expect(await prisma.accountReceivable.findUnique({ where: { id: ar.id } })).toMatchObject({ status: 'open', reminderCount: 0 });

      signIn(staff.operator);
      const before = await expectJson(await readPurchases(id), 200);
      getTestDb().prepare('INSERT INTO AdminRolePermission (roleId,permissionId) VALUES (?,?)').run(staffRole[staff.merchant], 'purchases.read');
      signIn(staff.merchant);
      const merchantProof = { ...paper('legacy-office-acceptance-original'), action: 'verify_acceptance', orderId: id,
        requestId: 'legacy-office-acceptance', version: before.workspace.startReview.version, occurredAt: oldAt.toISOString(),
        originalActor: staff.merchant, authorityReference: 'Historical signed order acceptance' };
      const accepted = await expectJson(await post({ ...merchantProof, stage: 'preview' }), 200);
      await expectJson(await post({ ...merchantProof, stage: 'confirm', actionHash: accepted.preview.actionHash, stepUpToken: await grant(staff.merchant) }), 200);

      signIn(staff.accountant);
      const sourceId = await bank('OFFICE-REAL-120-50', 12050, id);
      const legacy = (await expectJson(await financeRead(id), 200)).workspace;
      expect(legacy).toMatchObject({ principalCents: 0, postingPrincipal: null, receivable: { outstandingCents: 12050, needsPrincipalReview: true } });
      const cash = allocation(sourceId, 12050, 'legacy-office-exact-cash');
      await expectJson(await financePost({ orderId: id, requestId: randomUUID(), action: 'record_customer_receipt',
        stage: 'preview', version: legacy.version, data: cash }), 409);
      const evidence = { ...paper('legacy-office-written-amount-120-50'), amountCents: 12050, occurredAt: oldAt.toISOString() };
      await expectJson(await financePost({ orderId: id, requestId: randomUUID(), action: 'verify_receivable_principal',
        stage: 'preview', version: legacy.version, data: { ...evidence, amountCents: 12051 } }), 409);
      const proved = await financePreview('verify_receivable_principal', evidence, id);
      expect(proved.preview.snapshot.operation).toMatchObject({ receivableId: ar.id, amountCents: 12050, orderFaceCents: 0, debtorId: buyer });
      await expectJson(await financePost({ ...proved.input, stage: 'confirm', actionHash: proved.preview.actionHash }), 403);
      const verified = await finish(proved);
      expect(verified.workspace).toMatchObject({ principalCents: 0, postingPrincipal: { cents: 12050, reviewId: verified.eventId },
        settlementCents: 0, receivable: { status: 'open', needsPrincipalReview: false } });
      expect(await expectJson(await runReview(), 200)).toMatchObject({ reminded: 1 });
      expect(await prisma.notification.findFirstOrThrow({ where: { type: 'account_payable_reminder' } }))
        .toMatchObject({ content: expect.stringContaining('¥120.50') });

      await prisma.accountReceivable.update({ where: { orderId }, data: { dueAt } });
      const posting = await financePreview('record_customer_receipt', cash, id);
      expect(posting.preview.snapshot.operation.accounting).toMatchObject({ releaseCents: 0, creditReservationUnverified: true });
      expect((await finish(posting)).workspace).toMatchObject({ principalCents: 0, settlementCents: 12050, receivable: { status: 'paid' } });
      expect(await prisma.order.findUnique({ where: { id } })).toMatchObject({ total: 0, paidAt: expect.any(Date) });
      expect(await prisma.creditAccount.findUnique({ where: { id: allowance.id } }))
        .toMatchObject({ status: 'overdue_hold', usedAmount: allowance.usedAmount });
      vi.unstubAllEnvs();
    });

    it('binds original invoices, parties and a cross-order correction to all affected allocations without recording cash', async () => {
      const other = 'invoice-second-office-order';
      await seedAcceptedOrder(other, 'invoice-second-office-line');
      signIn(staff.accountant);
      const parties = { issuer: 'Office seller', recipient: 'Office buyer' };
      const plan = { action: 'create_plan', side: 'customer', trigger: 'accepted', ...parties };
      const planA = (await record('create_plan', { ...plan, ...paper('customer-invoice-A'), grossCents: 10000 })).invoicePlans[0];
      const planB = (await record('create_plan', { ...plan, ...paper('customer-invoice-B'), grossCents: 15000 }, other)).invoicePlans[0];
      const doc = { ...paper('one-original-invoice'), ...parties, number: 'OFFICE-INV-2026-01', grossCents: 25000, issuedAt: new Date().toISOString() };
      const a = await record('record_invoice', { ...doc, planId: planA.id, amountCents: 10000 });
      const invoiceId = a.invoicePlans[0].allocations[0].invoiceId;
      const beforeSecond = await financePreview('open_correction', { ...paper('open-correction'), invoiceId, occurredAt: new Date().toISOString() });
      await record('record_invoice', { ...doc, planId: planB.id, amountCents: 15000 }, other);
      await expectJson(await financePost({ ...beforeSecond.input, stage: 'confirm', actionHash: beforeSecond.preview.actionHash,
        stepUpToken: await grant(staff.accountant) }), 409);
      const opened = await financePreview('open_correction', { ...paper('open-correction'), invoiceId, occurredAt: new Date().toISOString() });
      expect(opened.preview.snapshot.operation.affected).toHaveLength(2);
      await finish(opened);
      const voided = await record('resolve_correction', { ...paper('actual-original-void-document'), invoiceId, outcome: 'voided',
        occurredAt: new Date().toISOString() });
      expect(voided.invoicePlans[0]).toMatchObject({ usedCents: 0, allocations: [{ status: 'voided', number: doc.number }] });
      expect((await expectJson(await financeRead(other), 200)).workspace.invoicePlans[0].usedCents).toBe(0);
      expect(await prisma.financeInvoice.count()).toBe(1);
      expect(await prisma.customerCashPosting.count()).toBe(0);
      expect(await prisma.creditAccount.findUniqueOrThrow({ where: { userId: buyer } })).toMatchObject({ usedAmount: 500 });
      const reissue = await record('record_invoice', { ...doc, ...paper('actual-new-invoice'), number: 'OFFICE-INV-2026-02',
        grossCents: 10000, amountCents: 10000, planId: planA.id, issuedAt: new Date().toISOString() });
      expect(reissue.invoicePlans[0].allocations).toHaveLength(2);
      expect(reissue.receivable).toMatchObject({ outstandingCents: 25000, status: 'open' });
    });

    it('keeps a customer invoice conditional on actual delivery and restores an old term from merchant acceptance only', async () => {
      signIn(staff.accountant);
      await prisma.accountReceivable.update({ where: { orderId }, data: { termStartedAt: null, dueAt: null } });
      const restored = await record('restore_term', paper('original-merchant-history'));
      expect(restored.receivable.termStartedAt).toBe(restored.acceptedAt);
      expect(Date.parse(restored.receivable.dueAt) - Date.parse(restored.acceptedAt)).toBe(30 * 86400000);
      const other = await record('set_term', { ...paper('individually-agreed-dates'), startedAt: restored.acceptedAt, days: 45 });
      expect(other.receivable.terms).toBe(45);
      const plan = await record('create_plan', { ...paper('invoice-on-delivery'), side: 'customer',
        issuer: 'Office seller', recipient: 'Office buyer', trigger: 'delivered', grossCents: 25000 });
      await expectJson(await financePost({ action: 'record_invoice', orderId, version: plan.version, requestId: randomUUID(), stage: 'preview',
        data: { ...paper('invoice-without-customer-receipt'), planId: plan.invoicePlans[0].id, issuer: 'Office seller', recipient: 'Office buyer',
          number: 'NOT-ISSUED', issuedAt: new Date().toISOString(), amountCents: 25000, grossCents: 25000 } }), 409);
      expect(await prisma.financeInvoice.count()).toBe(0);
    });

    it('refreshes both credit and purchase eligibility on a written term change, keeping prior reminders and manual holds', async () => {
      const reminderAt = new Date(Date.now() - 10 * 86400000);
      const dueAt = new Date(Date.now() - 100 * 86400000);
      await prisma.accountReceivable.update({ where: { orderId }, data: { status: 'overdue', dueAt, lastReminderAt: reminderAt, reminderCount: 2 } });
      await prisma.creditAccount.update({ where: { userId: buyer }, data: { status: 'overdue_hold', statusSource: 'system' } });
      signIn(staff.accountant);
      const extension = { ...paper('office-written-credit-extension'), startedAt: new Date().toISOString(), days: 30 };
      expect((await record('set_term', extension)).receivable).toMatchObject({ status: 'open', terms: 30 });
      expect(await prisma.accountReceivable.findUnique({ where: { orderId } }))
        .toMatchObject({ status: 'open', lastReminderAt: reminderAt, reminderCount: 2 });
      expect(await prisma.creditAccount.findUnique({ where: { userId: buyer } })).toMatchObject({ status: 'active' });
      expect(await prisma.purchaseRequirement.count({ where: { orderId } })).toBe(1);

      const expired = await record('set_term', { ...paper('office-term-return-to-original'), startedAt: dueAt.toISOString(), days: 0 });
      expect(expired.receivable.status).toBe('overdue');
      expect(await prisma.creditAccount.findUnique({ where: { userId: buyer } })).toMatchObject({ status: 'overdue_hold' });
      await prisma.creditAccount.update({ where: { userId: buyer }, data: { status: 'paused', statusSource: 'manual' } });
      expect((await record('set_term', { ...extension, ...paper('office-second-written-credit-extension') })).receivable.status).toBe('open');
      expect(await prisma.creditAccount.findUnique({ where: { userId: buyer } })).toMatchObject({ status: 'paused', statusSource: 'manual' });
    });

    it('changes only the unissued portion and preserves cross-order allocations even during correction', async () => {
      const other = 'office-other-invoice-order';
      await seedAcceptedOrder(other, 'office-other-invoice-item');
      signIn(staff.accountant);
      const setup = { side: 'customer', grossCents: 10000, trigger: 'accepted', issuer: 'Office seller', recipient: 'Office buyer' };
      const plan = (await record('create_plan', { ...setup, ...paper('first-office-invoice-plan') })).invoicePlans[0];
      const otherPlan = (await record('create_plan', { ...setup, ...paper('other-office-invoice-plan') }, other)).invoicePlans[0];
      const bill = { ...paper('office-original-cross-order-invoice'), issuer: setup.issuer, recipient: setup.recipient,
        number: 'OFFICE-ORIGINAL-CROSS-ORDER', issuedAt: new Date().toISOString(), grossCents: 6000, amountCents: 3000 };
      const first = await record('record_invoice', { ...bill, planId: plan.id });
      await record('record_invoice', { ...bill, planId: otherPlan.id }, other);
      const invoiceId = first.invoicePlans[0].allocations[0].invoiceId;
      const open = await record('open_correction', { ...paper('cross-order-correction-application'), invoiceId, occurredAt: new Date().toISOString() });
      expect(open.invoicePlans[0]).toMatchObject({ usedCents: 3000, remainingCents: 7000, allocations: [{ status: 'correction_pending' }] });
      const change = { ...paper('office-change-for-part-of-unissued'), planId: plan.id, trigger: 'manual', occurredAt: new Date().toISOString() };
      await expectJson(await financePost({ orderId, action: 'amend_plan', requestId: randomUUID(), version: open.version, stage: 'preview',
        data: { ...change, amountCents: 7001 } }), 409);
      const changed = await record('amend_plan', { ...change, amountCents: 4000 });
      const amended = changed.invoicePlans.find((row: { id: string }) => row.id !== plan.id);
      expect(amended).toMatchObject({ grossCents: 4000, remainingCents: 4000, trigger: 'manual' });
      expect(changed.invoicePlans.find((row: { id: string }) => row.id === plan.id)).toMatchObject({ grossCents: 10000, usedCents: 3000, remainingCents: 3000 });
      await expectJson(await financePost({ orderId, action: 'amend_plan', requestId: randomUUID(), version: changed.version, stage: 'preview',
        data: { ...change, amountCents: 1000 } }), 409);
      const stopped = await record('close_plan', { ...paper('office-no-use-for-remaining-original-slice'), planId: plan.id, occurredAt: new Date().toISOString() });
      expect(stopped.invoicePlans.find((row: { id: string }) => row.id === plan.id)).toMatchObject({ grossCents: 10000,
        usedCents: 3000, remainingCents: 0, closed: true, allocations: [{ invoiceId, status: 'correction_pending' }] });
      expect((await expectJson(await financeRead(other), 200)).workspace.invoicePlans[0])
        .toMatchObject({ grossCents: 10000, remainingCents: 7000, allocations: [{ invoiceId, amountCents: 3000 }] });
      const earlier = new Date(Date.parse(change.occurredAt) - 60000).toISOString();
      await record('confirm_condition', { ...paper('office-new-condition-verified'), planId: amended.id, occurredAt: earlier });
      const withManual = (await expectJson(await financeRead(), 200)).workspace;
      await expectJson(await financePost({ orderId, action: 'record_invoice', requestId: randomUUID(), version: withManual.version, stage: 'preview',
        data: { ...bill, ...paper('older-invoice-on-new-terms'), planId: amended.id, number: 'BEFORE-NEW-TERMS',
          grossCents: 4000, amountCents: 4000, issuedAt: earlier } }), 409);
      const secondChange = { ...paper('office-explicit-effective-time'), planId: amended.id, amountCents: 1000, trigger: 'accepted',
        occurredAt: new Date().toISOString(), effectiveAt: change.occurredAt };
      await expectJson(await financePost({ orderId, action: 'amend_plan', requestId: randomUUID(), version: withManual.version,
        stage: 'preview', data: secondChange }), 400);
      const revisedAgain = await record('amend_plan', { ...secondChange, retroactiveReference: 'Signed change item 2 states effective date' });
      const next = revisedAgain.invoicePlans.find((row: { id: string }) => row.id !== plan.id && row.id !== amended.id);
      expect(next).toMatchObject({ amendedFromPlanId: amended.id, effectiveAt: change.occurredAt, grossCents: 1000 });
      await record('record_invoice', { ...bill, ...paper('separate-retroactive-clause-invoice'), planId: next.id,
        number: 'OFFICE-SECOND-REVISION', grossCents: 1000, amountCents: 1000, issuedAt: change.occurredAt });
      const updated = await record('record_invoice', { ...bill, ...paper('office-new-actual-invoice'), planId: amended.id,
        number: 'OFFICE-REVISED-PART', grossCents: 3000, amountCents: 3000, issuedAt: change.occurredAt });
      expect(updated.invoicePlans.find((row: { id: string }) => row.id === amended.id)).toMatchObject({ usedCents: 3000, remainingCents: 0 });
      expect(await prisma.financeInvoiceAllocation.count({ where: { invoiceId } })).toBe(2);
    });

    it('keeps a late verified Alipay receipt pending through named evidence updates and rejects an unsupported financial closure', async () => {
      const lateOrder = 'office-alipay-mismatch';
      await prisma.order.create({ data: { id: lateOrder, email: email(buyer), customerId: buyer, subtotal: 250, total: 250,
        status: 'unpaid', paymentMethod: 'alipay' } });
      const trade = await prisma.paymentAttempt.create({ data: { orderId: lateOrder, provider: 'alipay',
        outTradeNo: 'OFFICE-ORIGINAL-PAY', tradeNo: 'OFFICE-VERIFIED-PROVIDER-PAY', status: 'rejected_amount_mismatch',
        amount: 240, notifiedAt: new Date() } });
      signIn(staff.accountant);
      expect((await expectJson(await financeGET(new NextRequest(endpoint)), 200)).orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: lateOrder })]));

      const initial = (await expectJson(await financeRead(lateOrder), 200)).workspace;
      expect(initial.latePayments).toMatchObject([{ id: trade.id, review: null }]);
      await expectJson(await financePost({ action: 'update_payment_case', orderId: lateOrder, version: initial.version,
        requestId: randomUUID(), stage: 'preview', data: { ...paper('unclaimed-provider-result'), sourceId: trade.id,
          occurredAt: new Date().toISOString(), outcome: 'awaiting_authorized_disposition' } }), 409);
      const claim = await financePreview('review_payment_case', { ...paper('original-payment-notice'), sourceId: trade.id, occurredAt: new Date().toISOString() }, lateOrder);
      expect(claim.preview.snapshot.operation).toMatchObject({ ownerId: staff.accountant, source: {
        id: trade.id, kind: 'alipay', amountCents: 24000, outTradeNo: trade.outTradeNo, tradeNo: trade.tradeNo,
      } });
      const claimed = await finish(claim);
      const alleged = { ...paper('unsupported-refund-assertion'), sourceId: trade.id, occurredAt: new Date().toISOString(), outcome: 'refunded' };
      for (const action of ['resolve_payment_case', 'update_payment_case']) {
        await expectJson(await financePost({ action, orderId: lateOrder, version: claimed.workspace.version,
          requestId: randomUUID(), stage: 'preview', data: alleged }), 400);
      }
      await expectJson(await financePost({ action: 'resume_alipay_payment', orderId: lateOrder, version: claimed.workspace.version,
        requestId: randomUUID(), stage: 'preview', data: alleged }), 409);
      const progress = await financePreview('update_payment_case', { ...paper('gateway-reply-pending-authorized-disposition'),
        sourceId: trade.id, occurredAt: new Date().toISOString(), outcome: 'awaiting_authorized_disposition' }, lateOrder);
      expect(progress.preview.snapshot.operation).toMatchObject({ claimId: claimed.eventId, ownerId: staff.accountant, source: {
        id: trade.id, kind: 'alipay', tradeNo: trade.tradeNo,
      } });
      const pending = await finish(progress);
      expect((await finish(progress)).eventId).toBe(pending.eventId);
      expect(pending.workspace).toMatchObject({ paidAt: null, settlementCents: 0, latePayments: [{ id: trade.id, review: {
        ownerId: staff.accountant, claimId: claimed.eventId, lastRecord: { action: 'update_payment_case', actorId: staff.accountant },
      } }] });
      expect(await prisma.customerCashPosting.count({ where: { orderId: lateOrder } })).toBe(0);
      expect(await prisma.paymentAttempt.findUnique({ where: { id: trade.id } })).toMatchObject({
        status: 'rejected_amount_mismatch', tradeNo: trade.tradeNo, amount: 240,
      });
      expect(await prisma.financeEvent.count({ where: { orderId: lateOrder } })).toBe(2);
    });

    it('resumes the same signed Alipay receipt after stock recovers without a second provider callback', async () => {
      const id = 'office-alipay-stock-held';
      const productId = 'office-alipay-item-stock';
      await prisma.product.create({ data: { id: productId, catalogNumber: 'SYNTHETIC-OFFICE-ITEM', name: 'Office file', brand: 'Synthetic Office',
        price: 40, stockQuantity: 0 } });
      await prisma.order.create({ data: { id, customerId: buyer, email: email(buyer), subtotal: 40, total: 40, status: 'unpaid', paymentMethod: 'alipay',
        orderItems: { create: { position: 0, productId, name: 'Office file', quantity: 1, unitPrice: 40 } } } });
      await prisma.paymentAttempt.create({ data: { orderId: id, provider: 'alipay', outTradeNo: 'LP-OFFICE-STOCK-HOLD', amount: 40, status: 'redirected' } });
      const callback = await alipayNotify(new Request('https://example.test/api/payments/alipay/notify', { method: 'POST',
        body: new URLSearchParams({ app_id: '9021000000000000', seller_id: '2088000000000000', sign_type: 'RSA2', sign: 'signed-fixture',
          out_trade_no: 'LP-OFFICE-STOCK-HOLD', total_amount: '40.00', trade_no: 'OFFICE-ALIPAY-ORIGINAL', trade_status: 'TRADE_SUCCESS' }) }));
      expect(await callback.text()).toBe('success');
      const before = await prisma.paymentAttempt.findUniqueOrThrow({ where: { outTradeNo: 'LP-OFFICE-STOCK-HOLD' } });
      expect(before).toMatchObject({ status: 'paid_stock_shortfall_reconciliation_required', tradeNo: 'OFFICE-ALIPAY-ORIGINAL', notifiedAt: expect.any(Date) });
      signIn(staff.accountant);
      const previewBefore = await financePreview('resume_alipay_payment', { ...paper('inventory-verification-for-original-callback'), sourceId: before.id }, id);
      const signedBody = { ...previewBefore.input, stage: 'confirm', actionHash: previewBefore.preview.actionHash };
      await expectJson(await financePost(signedBody), 403);
      await expectJson(await financePost({ ...signedBody, stepUpToken: await grant(staff.accountant) }), 409);
      expect(await prisma.paymentAttempt.findUnique({ where: { id: before.id } })).toEqual(before);
      await prisma.product.update({ where: { id: productId }, data: { stockQuantity: 2 } });
      const completed = await finish(previewBefore);
      expect((await finish(previewBefore)).eventId).toBe(completed.eventId);
      expect(completed.workspace).toMatchObject({ status: 'pending', nativePaymentId: before.id, settlementCents: 4000,
        paidAt: before.notifiedAt!.toISOString(), latePayments: [] });
      expect(await prisma.paymentAttempt.count({ where: { orderId: id } })).toBe(1);
      expect(await prisma.orderEvent.count({ where: { orderId: id, type: 'payment_received' } })).toBe(1);
      expect(await prisma.inventoryReservation.count({ where: { orderId: id } })).toBe(1);
    });

    it('chases the supplier invoice and matches it against the approved purchase and separately registered deposit', async () => {
      await startActualSupply(orderId, 'finance-voucher');
      signIn(staff.finance);
      const payable = await previewAction({ action: 'record_payment', requestId: 'actual-office-deposit', amountCents: 900,
        reference: 'office-deposit-9', conditionReference: 'Office supplier accepted split payment' });
      await expectJson(await confirm(payable, await grant(staff.finance)), 200);
      signIn(staff.accountant);
      const po = (await expectJson(await financeRead(), 200)).workspace.purchases[0];
      expect(po).toMatchObject({ originalCents: 7346, paidCents: 900, dueCents: 6446 });
      const first = await record('create_plan', { ...paper('supplier-invoice-request'), side: 'supplier', purchaseOrderId: po.id,
        trigger: 'accepted', issuer: procurementTerms.supplier, recipient: 'Office seller', grossCents: 7346 });
      const planId = first.invoicePlans[0].id;
      const discrepancy = await record('reconcile_supplier', { ...paper('invoice-difference'), purchaseOrderId: po.id, outcome: 'followup' });
      expect(discrepancy.purchases[0]).toMatchObject({ reconciled: false, supplierFollowup: { actorId: staff.accountant } });
      const nextReview = new Date(Date.now() + 86400000);
      const traced = await record('chase_invoice', { ...paper('manual-follow-up'), planId, occurredAt: new Date().toISOString(),
        nextReviewAt: nextReview.toISOString() });
      expect(traced.invoicePlans[0].lastFollowup.actorId).toBe(staff.accountant);
      let attention = (await expectJson(await financeAttention(), 200)).orders;
      expect(attention).toMatchObject([{ id: orderId, attention: { supplierDifferences: 1, invoiceFollowups: 0 } }]);
      vi.setSystemTime(nextReview);
      attention = (await expectJson(await financeAttention(), 200)).orders;
      expect(attention).toMatchObject([{ id: orderId, attention: { supplierDifferences: 1, invoiceFollowups: 1 } }]);
      const actual = await record('record_invoice', { ...paper('original-supplier-invoice'), planId, issuer: procurementTerms.supplier,
        recipient: 'Office seller', number: 'OFFICE-SUPPLIER-1', issuedAt: new Date().toISOString(), grossCents: 7346, amountCents: 7346 });
      expect(actual.purchases[0]).toMatchObject({ paidCents: 900, dueCents: 6446, pendingInvoiceCents: 0, reconciled: false });
      expect((await expectJson(await financeAttention(), 200)).orders)
        .toMatchObject([{ id: orderId, attention: { supplierDifferences: 1, invoiceFollowups: 0 } }]);
      const matched = await record('reconcile_supplier', { ...paper('three-way-reconciliation'), purchaseOrderId: po.id, outcome: 'matched' });
      expect(matched.purchases[0]).toMatchObject({ paidCents: 900, dueCents: 6446, reconciled: true,
        payments: [{ reference: 'office-deposit-9', amountCents: 900 }], invoices: [{ amountCents: 7346, status: 'recorded' }] });
      expect(matched.cashCents).toBe(0);
      expect((await expectJson(await financeAttention(), 200)).orders).toEqual([]);
    });

    it('uses proved supplier payment dates for paid-in-full and can amend the unreceived supplier invoice balance', async () => {
      await startActualSupply(orderId, 'historic-office-payment');
      signIn(staff.finance);
      const original = await currentPurchase();
      vi.setSystemTime(Date.now() + 3 * 86400000);
      const oldReceiptAt = new Date(Date.now() - 2 * 86400000).toISOString();
      const tailReceiptAt = new Date(Date.now() - 86400000).toISOString();
      const recorded = new Date(Date.now() - 3600000).toISOString();
      const legacyId = 'office-old-deposit-activity';
      const legacyReference = 'OLD-OFFICE-VOUCHER';
      const oldOperation = { action: 'record_payment', reference: legacyReference, amountCents: 900, conditionReference: 'Office deposit due' };
      const detail = JSON.stringify({ snapshot: { orderId, purchaseOrderId: original.id, lines: original.lines, operation: oldOperation } });
      await prisma.purchaseActivity.create({ data: { id: legacyId, orderId, purchaseOrderId: original.id, actorId: staff.finance,
        action: oldOperation.action, amountCents: BigInt(900), detail, createdAt: recorded } });
      const tail = await previewAction({ action: 'record_payment', requestId: 'actual-tail-bank-voucher', amountCents: 6446,
        ...supplierPaymentProof('TAIL-OFFICE-BANK-TRACE', procurementTerms.payee, tailReceiptAt),
        reference: 'TAIL-OFFICE-VOUCHER', conditionReference: 'Office contract tail due' });
      await expectJson(await confirm(tail, await grant(staff.finance)), 200);
      signIn(staff.accountant);
      const afterTail = (await expectJson(await financeRead(), 200)).workspace.purchases[0];
      expect(afterTail).toMatchObject({ paidCents: 7346, dueCents: 0, paidInFullAt: null,
        payments: [{ id: legacyId, recordedAt: recorded, occurredAt: null }, { occurredAt: tailReceiptAt, amountCents: 6446 }] });
      const plan = (await record('create_plan', { ...paper('office-supplier-invoice-after-actual-full-payment'), purchaseOrderId: original.id,
        side: 'supplier', trigger: 'paid', issuer: procurementTerms.supplier, recipient: 'Office seller', grossCents: 7346 })).invoicePlans[0];
      const issuedAt = new Date(Date.parse(tailReceiptAt) + 60000).toISOString();
      const invoice = { ...paper('office-confirmed-bank-then-supplier-invoice'), planId: plan.id, issuer: procurementTerms.supplier,
        recipient: 'Office seller', number: 'OFFICE-SUPPLIER-PAID-FULL', issuedAt, grossCents: 3000, amountCents: 3000 };
      const beforeReview = (await expectJson(await financeRead(), 200)).workspace;
      await expectJson(await financePost({ orderId, action: 'record_invoice', requestId: randomUUID(), version: beforeReview.version,
        stage: 'preview', data: invoice }), 409);

      const review = { action: 'review_payment_time', requestId: 'review-original-office-deposit-time',
        sourcePaymentId: legacyId, amountCents: 900, reference: 'OFFICE-ARCHIVE-OF-ORIGINAL-BANK-PROOF',
        description: '核对银行原流水与合成原定金的实际日期。',
        ...supplierPaymentProof('LEGACY-OFFICE-BANK-TRACE', procurementTerms.payee, oldReceiptAt) } as const;
      signIn(staff.operator);
      await expectJson(await post({ ...review, stage: 'preview', orderId, purchaseOrderId: original.id, version: original.version }), 403);
      signIn(staff.finance);
      const check = await previewAction(review);
      await expectJson(await confirm(check, 'invalid-local-step-up'), 403);
      await expectJson(await confirm(check, await grant(staff.finance)), 200);
      expect(await prisma.purchaseActivity.findUnique({ where: { id: legacyId }, select: { detail: true } })).toEqual({ detail });
      expect(await prisma.purchaseActivity.count({ where: { purchaseOrderId: original.id, action: 'record_payment' } })).toBe(2);
      signIn(staff.accountant);
      const booked = await record('record_invoice', invoice);
      expect(booked.purchases[0]).toMatchObject({ paidCents: 7346, dueCents: 0, paidInFullAt: tailReceiptAt,
        payments: [{ id: legacyId, recordedAt: recorded, occurredAt: oldReceiptAt, reviewedBy: staff.finance }, { occurredAt: tailReceiptAt }] });
      const changed = await record('amend_plan', { ...paper('office-supplier-changed-remainder'), planId: plan.id,
        amountCents: 4346, trigger: 'manual', occurredAt: new Date().toISOString() });
      expect(changed.invoicePlans).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: plan.id, grossCents: 7346, usedCents: 3000, remainingCents: 0 }),
        expect.objectContaining({ side: 'supplier', purchaseOrderId: original.id, trigger: 'manual', grossCents: 4346, remainingCents: 4346 }),
      ]));
    });

    it('keeps early supplier transfers under named review and uses distinct bank statement rows only once', async () => {
      const tooEarly = new Date(Date.now() - 86400000).toISOString();
      await startActualSupply(orderId, 'office-payment-approval-timing');
      signIn(staff.finance);
      const payee = procurementTerms.payee;
      const ordinary = { action: 'record_payment', reference: 'wrong-early-office-transfer', requestId: 'early-transfer',
        amountCents: 600, conditionReference: 'Office supply conditions',
        ...supplierPaymentProof('EARLY-OFFICE-TRACE', payee, tooEarly) } as const;
      const previewRequest = async (request: object, status: number) => {
        const po = await currentPurchase();
        return expectJson(await post({ ...request, orderId, purchaseOrderId: po.id, version: po.version, stage: 'preview' }), status);
      };
      const bookPurchase = async (request: ActionRequest) => {
        vi.setSystemTime(Date.now() + 3 * 60_000);
        return expectJson(await confirm(await previewAction(request), await grant(staff.finance)), 200);
      };
      expect((await previewRequest(ordinary, 409)).error).toContain('付款发生时');
      const issue = await bookPurchase({ ...ordinary, action: 'record_payment_exception',
        requestId: 'office-real-early-payment-awaiting-check', description: '银行原件显示此笔发生在采购批准前，财务核实归属。' });
      const [pending] = issue.workspace.orders[0].paymentExceptions;
      expect(pending).toMatchObject({ pending: true, ownerId: staff.finance, original: { amountCents: 600, approvalAtPaymentId: null } });
      expect(activity('record_payment')).toEqual([]);
      await previewRequest({ ...ordinary, occurredAt: new Date().toISOString() }, 409);
      const recordedResult = await bookPurchase({ action: 'review_payment_exception', paymentIssueId: pending.id,
        requestId: 'office-payment-check-reports-no-effective-authority', paymentIssueOutcome: 'no_effective_approval',
        reference: 'bank-trace-confirmed-no-matching-authority', referenceSha256: pricingContentHash('office-no-approval-result'),
        description: '原书证确认付款当日无采购批准，这笔转账按另行传阅的凭证保留。' });
      expect(recordedResult.workspace.orders[0].paymentExceptions[0]).toMatchObject({ pending: false,
        ownerId: staff.finance, review: { actorId: staff.finance, operation: { outcome: 'no_effective_approval' } } });
      expect((await previewRequest({ ...ordinary, occurredAt: new Date().toISOString() }, 409)).error).toContain('原银行流水');

      const po = await currentPurchase();
      const oldAt = new Date().toISOString();
      const legacyId = 'OFFICE-ALREADY-RECORDED-900';
      const legacyTrace = 'ORIGINAL-OFFICE-BANK-TRACE';
      const original = JSON.stringify({ snapshot: { orderId, purchaseOrderId: po.id, lines: po.lines, operation: {
        action: 'record_payment', reference: legacyTrace, amountCents: 900, conditionReference: 'Original deposit' } } });
      await prisma.purchaseActivity.create({ data: { id: legacyId, orderId, purchaseOrderId: po.id, actorId: staff.finance,
        action: 'record_payment', amountCents: BigInt(900), detail: original, createdAt: oldAt } });
      const retry = { ...ordinary, ...supplierPaymentProof(legacyTrace, payee), reference: 'renamed office voucher',
        requestId: 'same-old-deposit-bank-trace' };
      expect((await previewRequest(retry, 409)).error).toContain('原银行流水');
      const reviewed = await bookPurchase({ action: 'review_payment_time', sourcePaymentId: legacyId, amountCents: 900,
        requestId: 'office-verifies-known-deposit-date', reference: 'old office deposit evidence',
        ...supplierPaymentProof(legacyTrace, payee, oldAt), description: '以原银行流水和日期核对已记原定金。' });
      expect(reviewed.workspace.orders[0]).toMatchObject({ paidCents: 900, payments: [{ id: legacyId, occurredAt: oldAt }] });
      expect(await prisma.purchaseActivity.findUnique({ where: { id: legacyId }, select: { detail: true } })).toEqual({ detail: original });

      const statement = (row: number, bankTrace: string) => ({ ...ordinary, amountCents: 1000,
        requestId: 'office-statement-' + row + bankTrace, reference: 'same office bank statement', bankTrace,
        occurredAt: new Date().toISOString(), referenceSha256: pricingContentHash('office-bank-statement-with-two-rows'),
        paymentDocumentKind: 'statement', paymentStatementRow: row });
      await bookPurchase(statement(3, 'OFFICE-BANK-ROW-3'));
      await bookPurchase(statement(8, 'OFFICE-BANK-ROW-8'));
      await previewRequest(statement(3, 'OFFICE-ROW-3-ALIAS'), 409);
      await previewRequest(statement(9, 'OFFICE-BANK-ROW-8'), 409);
      expect(await currentPurchase()).toMatchObject({ paidCents: 2900, totalCents: 7346 });
    });

    it('routes the actual bank transfer to the identified purchase and uses its original approved balance once', async () => {
      const target = 'office-transfer-target-order';
      const item = 'office-transfer-target-item';
      await seedAcceptedOrder(target, item);
      signIn(staff.operator);
      const prepared = await expectJson(await post({ action: 'prepare', orderId: target }), 200);
      await expectJson(await post({ action: 'save_line', orderId: target, orderItemId: item, revision: prepared.workspace.lines[0].revision,
        checkedEvidence: true, terms: { ...procurementTerms, sourceSha256: pricingContentHash('original quote target order') } }), 200);
      await startActualSupply(target, 'office-routed-bank-payment');
      signIn(staff.finance);
      const receiver = await currentPurchase(target);
      const original = {
        reference: '实际转账合成原回单', amountCents: 600,
        ...supplierPaymentProof('OFFICE-BANK-ROUTED-TRACE', procurementTerms.payee, new Date().toISOString()),
      };
      const sourceCase = await previewAction({ ...original, action: 'record_payment_exception', requestId: 'routed-payment-original-review',
        description: '保存原银行转账，待核对原件所列的采购单。' });
      const reported = await expectJson(await confirm(sourceCase, await grant(staff.finance)), 200);
      const originalPurchase = reported.workspace.orders[0];
      const [issue] = originalPurchase.paymentExceptions;
      const forward = await previewAction({ action: 'review_payment_exception', requestId: 'transfer-to-identified-purchase',
        paymentIssueId: issue.id, paymentIssueOutcome: 'outside_purchase', paymentIssueTargetPurchaseOrderId: receiver.id,
        reference: '银行与供应商共同核实的原采购单', referenceSha256: pricingContentHash('identified receiver and purchase'),
        description: '已核对原回单归属到指定采购单，原单不冲，交目标采购经办核对付款条件。' });
      await expectJson(await confirm(forward, await grant(staff.finance)), 200);
      const destination = await expectJson(await readPurchases(target), 200);
      expect(destination.workspace.orders[0].paymentExceptions).toMatchObject([{ id: issue.id, pending: true, incoming: true,
        purchaseOrderId: originalPurchase.id, original: { amountCents: 600, paymentEvidence: { bankTrace: original.bankTrace } } }]);
      const parameters = { paymentIssueId: issue.id, action: 'record_payment',
        conditionReference: '目标原批准中已满足的订购付款条件', requestId: 'apply-identified-original-trace' } as const;
      const apply = await previewAction(parameters, target);
      await expectJson(await confirm(apply), 403);
      await expectJson(await confirm({ ...apply, amountCents: 601 }, await grant(staff.finance)), 409);
      const booked = await expectJson(await confirm(apply, await grant(staff.finance)), 200);
      await expectJson(await confirm(apply, await grant(staff.finance)), 200);
      expect(booked.workspace.orders[0]).toMatchObject({ id: receiver.id, paidCents: 600, dueCents: 6746,
        paymentExceptions: [{ id: issue.id, pending: false, postingId: expect.any(String) }],
        payments: [{ amountCents: 600, occurredAt: original.occurredAt, bankTrace: original.bankTrace }] });
      expect(booked.workspace.orders[0].ledger.at(-1)).toMatchObject({ action: 'record_payment', detail: { snapshot: { operation: {
        paymentIssueId: issue.id, transferReviewId: expect.any(String), reviewedFrom: originalPurchase.id,
        approvalId: destination.workspace.orders[0].ledger.find((row: { action: string }) => row.action === 'approve').id } } } });
      const refreshedOrigin = await currentPurchase();
      expect(refreshedOrigin.paidCents).toBe(0);
      const refreshedTarget = await currentPurchase(target);
      await expectJson(await post({ ...parameters, ...original, paymentIssueId: undefined, requestId: 'try-same-trace-as-new',
        orderId: target, purchaseOrderId: refreshedTarget.id, version: refreshedTarget.version, stage: 'preview' }), 409);
      expect(await prisma.purchaseActivity.count({ where: { action: 'record_payment' } })).toBe(1);
    });
  });
});
