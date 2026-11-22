// @vitest-environment node

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as noticesGET } from '@/app/api/admin/fulfillment/notices/route';
import { GET as fulfillmentGET, POST as fulfillmentPOST } from '@/app/api/admin/orders/[id]/fulfillment/route';
import { POST as nativeShipmentPOST } from '@/app/api/admin/orders/[id]/shipments/route';
import { GET as orderGET } from '@/app/api/orders/[id]/route';
import { GET as ordersGET } from '@/app/api/orders/route';
import { ADMIN_ROLE_DEFINITIONS, type AdminRoleKey } from '@/lib/admin-permissions';
import { resetEphemeralStoreForTests } from '@/lib/ephemeral-store';
import { receiveCarrierNotice } from '@/lib/fulfillment-carrier';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { createMfaKeyRing, encryptMfaSecret } from '@/lib/security/mfa-crypto';
import { generateTotpSecret, totpCodeAt } from '@/lib/security/mfa-totp';
import { completeSecurityStepUp, startSecurityStepUp, type SecurityStepUpAction } from '@/lib/security/security-step-up';
import { clearAllTables, closeTestDb, getTestDb, seedUser } from './db-helpers';

const { auth } = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock('@/lib/auth', () => ({ auth }));

const orderId = 'test-fulfillment-order';
const otherOrderId = 'test-fulfillment-other-order';
const buyer = 'test-fulfillment-buyer';
const otherBuyer = 'test-fulfillment-other-buyer';
const operator = 'test-fulfillment-operator';
const reader = 'test-fulfillment-reader';
const blocked = 'test-fulfillment-no-order-permission';
const key = randomBytes(32);
const keyRing = createMfaKeyRing({ currentVersion: 1, keys: { 1: key } });
const secrets = new Map<string, string>();
const carrier = '合成承运方';
const source = 'TEST-FULFILLMENT-SOURCE';
const publicTracking = 'TEST-PUBLIC-WAYBILL';
const inboundTracking = 'TEST-INBOUND-PRIVATE-WAYBILL';

const email = (id: string) => `${id}@example.test`;
const sessionId = (id: string) => `test-session-${id}`;
const endpoint = (id: string) => `http://localhost/api/admin/orders/${id}/fulfillment`;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function signIn(id: string, role = 'admin', session = sessionId(id)) {
  auth.mockResolvedValue({ user: { id, role, email: email(id), sessionId: session } });
}

function seedStaff(id: string, roleKey: AdminRoleKey) {
  const db = getTestDb();
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
    `mfa-${id}`, id, encryptMfaSecret(secret, keyRing),
  );
}

async function grant(userId: string, action: SecurityStepUpAction = 'admin_sensitive') {
  // Advance past the authenticator's last accepted time step.
  vi.setSystemTime(Date.now() + 31_000);
  const context = { userId, action, sessionId: sessionId(userId), method: 'totp' as const };
  const challenge = await startSecurityStepUp(context);
  const secret = secrets.get(userId);
  if (!secret) throw new Error('Missing synthetic authenticator');
  const result = await completeSecurityStepUp({
    ...context, challengeId: challenge.challengeId, totpToken: challenge.challengeToken,
    code: totpCodeAt(secret, Date.now()),
  });
  if (!('grantToken' in result)) throw new Error(`Synthetic MFA grant failed: ${result.error}`);
  return result.grantToken;
}

function evidence(requestId: string) {
  return {
    requestId, occurredAt: new Date().toISOString(), reference: `TEST-PRIVATE-EVIDENCE-${requestId}`,
    sha256: pricingContentHash({ evidence: requestId }), documentRow: 1,
  };
}

function legacyProof() {
  return {
    shipmentId: `${orderId}-shipment`, description: '已核对合成原运单和出库明细', ...evidence('test-legacy-link'),
  };
}

function read(id = orderId) {
  return fulfillmentGET(new NextRequest(endpoint(id)), params(id));
}

function queue() {
  return noticesGET(new NextRequest('http://localhost/api/admin/fulfillment/notices'));
}

function post(body: object, id = orderId) {
  return fulfillmentPOST(new NextRequest(endpoint(id), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), params(id));
}

async function expectJson(response: Response, status: number) {
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(status);
  return body;
}

async function preview(action: string, input: object) {
  const result = await expectJson(await post({ stage: 'preview', action, input }), 200);
  expect(result.preview.actionHash).toMatch(/^[0-9a-f]{64}$/);
  return result.preview as { actionHash: string; snapshot: object };
}

function confirm(action: string, input: object, actionHash: string, stepUpToken?: string, id = orderId) {
  return post({ action, input, actionHash, stepUpToken, stage: 'confirm' }, id);
}

function history() {
  return prisma.fulfillmentEvent.findMany({ where: { parcel: { orderId } }, orderBy: { occurredAt: 'asc' } });
}

async function seedHistoricalShipment(id: string, userId: string, trackingNumber: string) {
  const orderItemId = `${id}-line`;
  await prisma.order.create({
    data: {
      id, customerId: userId, email: email(userId), status: 'shipped', paymentMethod: 'bank_transfer', subtotal: 200, total: 200,
      orderItems: { create: { id: orderItemId, position: 0, name: '合成商品', unitPrice: 100, quantity: 2, shippedQty: 2, status: 'shipped' } },
    },
  });
  await prisma.shipment.create({ data: {
    id: `${id}-shipment`, orderId: id, shippedAt: new Date(Date.now() - 60_000), status: 'shipped', carrier, trackingNumber,
    note: 'TEST-PRIVATE-LEGACY-NOTE', createdBy: operator, items: { create: { orderItemId, quantity: 2 } },
  } });
}

async function seedInboundParcel(id: string) {
  return prisma.fulfillmentParcel.create({ data: {
    orderId: id, route: 'supplier_to_libereal', carrier, trackingNumber: inboundTracking, feedSource: source,
    status: 'dispatched', dispatchedAt: new Date(Date.now() - 30_000), reference: 'TEST-PRIVATE-INBOUND-REFERENCE',
    evidenceSha256: pricingContentHash({ id, field: 'inbound-proof' }), evidenceRow: 1,
    requestKey: pricingContentHash({ id, field: 'inbound-request' }), businessKey: pricingContentHash({ id, field: 'inbound-business' }),
    contentHash: pricingContentHash({ id, field: 'inbound-content' }), actorId: operator,
    lines: { create: [{ orderItemId: `${id}-line`, quantity: 1 }] },
  } });
}

beforeAll(() => {
  const db = getTestDb();
  db.exec(readFileSync('prisma/migrations/20260806090000_add_mfa_security_tables/migration.sql', 'utf8'));
  // The shared fixture already creates organizations; the customer list also queries memberships.
  const rbac = readFileSync('prisma/migrations/20260808090000_add_organization_rbac_tables/migration.sql', 'utf8');
  db.exec(rbac.replace('CREATE TABLE "organizations"', 'CREATE TABLE IF NOT EXISTS "organizations"'));
  db.exec(readFileSync('prisma/migrations/20260808110000_update_organization_membership_lifecycle/migration.sql', 'utf8'));
  db.exec(readFileSync('prisma/migrations/20260809130000_add_member_permission_overrides/migration.sql', 'utf8'));
});
afterAll(() => { closeTestDb(); });

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2031-05-01T03:00:00Z'));
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
  for (const id of [buyer, otherBuyer]) seedUser(db, { id, email: email(id) });
  seedStaff(operator, 'order_admin');
  seedStaff(reader, 'finance_staff');
  seedStaff(blocked, 'customer_admin');
  await seedHistoricalShipment(orderId, buyer, publicTracking);
  await seedHistoricalShipment(otherOrderId, otherBuyer, 'TEST-OTHER-CUSTOMER-WAYBILL');
  signIn(operator);
});

afterEach(() => {
  auth.mockReset();
  resetEphemeralStoreForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('admin fulfillment HTTP and customer shipment views', () => {
  it.each([true,false])('reconciles only the second unit after an original native shipment (automatic evidence=%s)', async witnessed => {
    await prisma.shipment.delete({where:{id:orderId+'-shipment'}});
    const itemId=orderId+'-line';
    const product=await prisma.product.create({data:{name:'合成混合旧单',catalogNumber:'TEST-MIXED-NATIVE',brand:'合成品牌',price:100,stockQuantity:3}});
    await prisma.order.update({where:{id:orderId},data:{status:'confirmed'}});
    await prisma.orderItem.update({where:{id:itemId},data:{productId:product.id,shippedQty:0,status:'confirmed'}});
    const account=await prisma.inventoryAccount.create({data:{productId:product.id,actualQuantity:5,availableQuantity:3,reservedQuantity:2}});
    const hold=await prisma.inventoryReservation.create({data:{inventoryAccountId:account.id,orderId,orderItemId:itemId,quantity:2}});
    const native=await nativeShipmentPOST(new NextRequest(endpoint(orderId).replace('fulfillment','shipments'),{method:'POST',
      body:JSON.stringify({method:'logistics',carrier,trackingNumber:'TEST-ORIGINAL-NATIVE-WAYBILL',items:[{orderItemId:itemId,quantity:1}],
        stepUpToken:await grant(operator)})}),params(orderId));
    const first=(await expectJson(native,201)).shipment;
    const firstItem=await prisma.shipmentItem.findFirstOrThrow({where:{shipmentId:first.id}});
    const originalMove=await prisma.inventoryTransaction.findFirstOrThrow({where:{orderId,reservationId:hold.id,type:'ship'}});
    expect(originalMove.quantity).toBe(-1);
    if (!witnessed) await prisma.orderEvent.updateMany({where:{orderId,type:'shipment_created'},data:{metadata:null}});
    vi.setSystemTime(Date.now()+1000);
    const oldStatus=await prisma.orderStatusHistory.create({data:{orderId,fromStatus:'partially_shipped',toStatus:'shipped',
      actorId:operator,actorEmail:email(operator),reason:'原后台人工标为发货',createdAt:new Date()}});
    await prisma.order.update({where:{id:orderId},data:{status:'shipped'}});
    const booking={...evidence('legacy-only-second-unit'),historyId:oldStatus.id,carrier,trackingNumber:'TEST-ARCHIVED-SECOND-WAYBILL',
      description:'第二件有实际运单原件，旧系统只登记状态',lines:[{orderItemId:itemId,quantity:1}]};
    const registered=await preview('link_legacy',booking);
    await expectJson(await confirm('link_legacy',booking,registered.actionHash,await grant(operator)),200);
    const stock=(await expectJson(await read(),200)).workspace.legacyInventory[0];
    expect(stock).toMatchObject({awaitingReview:1,available:witnessed?1:0,recordedOutsideReview:witnessed?0:1});
    if (witnessed) expect(stock.recognized).toMatchObject([{transactionId:originalMove.id,shipmentItemId:firstItem.id,quantity:1}]);
    else {
      const placement={...evidence('named-original-stock-allocation'),parcelId:stock.parcelId,parcelLineId:stock.parcelLineId,quantity:1,
        outcome:'allocate_recorded_movement',description:'按原始库存出库凭证逐行归入第一张运单',
        inventoryTransactionId:originalMove.id,shipmentItemId:firstItem.id};
      const allocated=await preview('reconcile_legacy_inventory',placement);
      await expectJson(await confirm('reconcile_legacy_inventory',placement,allocated.actionHash,await grant(operator)),200);
      await expectJson(await confirm('reconcile_legacy_inventory',placement,allocated.actionHash,await grant(operator)),200);
      await expectJson(await post({stage:'preview',action:'reconcile_legacy_inventory',input:{
        ...placement,...evidence('attempt-use-same-stock-movement-again'),
      }}),409);
    }
    expect(await prisma.inventoryAccount.findUnique({where:{id:account.id}})).toMatchObject({actualQuantity:4,reservedQuantity:1,shippedQuantity:1});
    const final={...evidence('check-second-old-delivery-stock'),parcelId:stock.parcelId,parcelLineId:stock.parcelLineId,
      quantity:1,outcome:'warehouse_stock_shipped',description:'第二件实际仓库出库，原库存流水只覆盖第一件'};
    const checked=await preview('reconcile_legacy_inventory',final);
    await expectJson(await confirm('reconcile_legacy_inventory',final,checked.actionHash,await grant(operator)),200);
    expect(await prisma.inventoryAccount.findUnique({where:{id:account.id}})).toMatchObject({actualQuantity:3,reservedQuantity:0,shippedQuantity:2});
    expect(await prisma.inventoryTransaction.findUnique({where:{id:originalMove.id}})).toEqual(originalMove);
    expect(await prisma.inventoryTransaction.count({where:{orderId,reservationId:hold.id,type:'ship'}})).toBe(2);
  });

  it.each(['external_supply_release','warehouse_stock_shipped'] as const)('separates historical waybill verification, receipt, and legacy stock reconciliation (%s)', async outcome => {
    await prisma.shipment.delete({where:{id:orderId+'-shipment'}});
    const itemId = orderId+'-line';
    const product = await prisma.product.create({data:{name:'合成旧单商品',catalogNumber:'TEST-ARCHIVE-SKU',brand:'合成品牌',price:100,stockQuantity:3}});
    await prisma.orderItem.update({where:{id:itemId},data:{productId:product.id,shippedQty:0,status:'confirmed'}});
    const account = await prisma.inventoryAccount.create({data:{productId:product.id,actualQuantity:5,availableQuantity:3,reservedQuantity:2}});
    const hold = await prisma.inventoryReservation.create({data:{inventoryAccountId:account.id,orderId,orderItemId:itemId,quantity:2}});
    const shipmentStatus = await prisma.orderStatusHistory.create({ data:{orderId,fromStatus:'confirmed',toStatus:'shipped',
      actorId:operator,actorEmail:email(operator),reason:'admin_status_update',createdAt:new Date(Date.now()-30_000)} });
    await prisma.creditAccount.create({data:{userId:buyer,usedAmount:200,baseLimit:2000}});
    const receivable = await prisma.accountReceivable.create({data:{orderId,userId:buyer,amount:200,confirmedAt:new Date(Date.now()-60_000)}});
    const prior = await expectJson(await read(),200);
    expect(prior.workspace.legacyBackfill).toMatchObject({history:[{id:shipmentStatus.id}],lines:[{orderItemId:itemId,shippedQty:0,available:2}]});
    const booking = { ...evidence('legacy-historical-document'),historyId:shipmentStatus.id,carrier,trackingNumber:publicTracking,
      occurredAt:new Date(Date.now()-45_000).toISOString(),description:'查验合成旧运单原件和两件出货明细',lines:[{orderItemId:itemId,quantity:2}] };
    const checked = await preview('link_legacy',booking);
    await expectJson(await confirm('link_legacy',booking,checked.actionHash),403);
    await expectJson(await confirm('link_legacy',booking,checked.actionHash,await grant(operator)),200);
    await expectJson(await confirm('link_legacy',booking,checked.actionHash,await grant(operator)),200);
    const shipment = await prisma.shipment.findFirstOrThrow({where:{orderId},include:{items:true,fulfillmentParcel:{include:{lines:true}}}});
    expect(shipment).toMatchObject({status:'shipped',deliveredAt:null,items:[{orderItemId:itemId,quantity:2}]});
    expect(await prisma.orderItem.findUnique({where:{id:itemId}})).toMatchObject({shippedQty:2});
    expect(await prisma.inventoryAccount.findUnique({where:{id:account.id}})).toEqual(account);
    const parcel = shipment.fulfillmentParcel!;
    const delivery = {...evidence('legacy-confirmed-customer-signature'),parcelId:parcel.id,kind:'customer_delivery',
      description:'查阅合成客户实收签单',lines:[{parcelLineId:parcel.lines[0].id,quantity:2}]};
    const signed = await preview('record_event',delivery);
    await expectJson(await confirm('record_event',delivery,signed.actionHash,await grant(operator)),200);
    expect(await prisma.order.findUnique({where:{id:orderId}})).toMatchObject({status:'completed',paidAt:null});
    expect((await expectJson(await read(),200)).workspace.legacyInventory).toMatchObject([{reservationId:hold.id,available:2,awaitingReview:2}]);
    expect(await prisma.inventoryAccount.findUnique({where:{id:account.id}})).toEqual(account);
    expect(await prisma.accountReceivable.findUnique({where:{orderId}})).toEqual(receivable);
    expect(await prisma.notification.count()).toBe(0);

    const reconcile = {...evidence('legacy-verified-inventory-proof'),parcelId:parcel.id,parcelLineId:parcel.lines[0].id,
      quantity:2,outcome,description:'按原运单路线和未处理库存流水核对实物'};
    const reconciliation = await preview('reconcile_legacy_inventory',reconcile);
    expect(reconciliation.snapshot).toMatchObject({hold:{reservationId:hold.id,fulfilled:0,released:0},actorId:operator});
    await expectJson(await confirm('reconcile_legacy_inventory',reconcile,reconciliation.actionHash,await grant(operator)),200);
    await expectJson(await confirm('reconcile_legacy_inventory',reconcile,reconciliation.actionHash,await grant(operator)),200);
    const external = outcome === 'external_supply_release';
    expect(await prisma.inventoryAccount.findUnique({where:{id:account.id}})).toMatchObject({actualQuantity:external?5:3,reservedQuantity:0,
      availableQuantity:external?5:3,shippedQuantity:external?0:2});
    expect(await prisma.inventoryTransaction.count({where:{orderId,reservationId:hold.id}})).toBe(1);
    expect((await expectJson(await read(),200)).workspace.legacyInventory).toEqual([]);
    expect(await prisma.accountReceivable.findUnique({where:{orderId}})).toEqual(receivable);
    expect(await prisma.creditAccount.findUnique({where:{userId:buyer}})).toMatchObject({usedAmount:200});
    expect(await prisma.notification.count()).toBe(0);
  });

  it('uses server-side read and write assignments for order details, actions, and the notice queue', async () => {
    signIn(blocked);
    await expectJson(await read(), 403);
    await expectJson(await queue(), 403);

    signIn(buyer, 'customer');
    await expectJson(await read(), 403);
    await expectJson(await queue(), 403);

    signIn(reader);
    const response = await read();
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const result = await expectJson(response, 200);
    expect(result.workspace.legacyShipments).toMatchObject([{ id: `${orderId}-shipment`, trackingNumber: publicTracking }]);
    await expectJson(await queue(), 200);
    await expectJson(await post({
      action: 'link_legacy', stage: 'preview', role: 'admin', actorId: operator, permissions: ['orders.write'],
      input: { ...legacyProof(), actorId: operator },
    }), 403);

    signIn(operator);
    await preview('link_legacy', legacyProof());
    expect(await prisma.fulfillmentParcel.count()).toBe(0);
    expect(await prisma.fulfillmentEvent.count()).toBe(0);
  });

  it('requires existing purchase approval authority for both hold-deviation lookup and review',async()=>{
    signIn(operator);
    await expectJson(await fulfillmentGET(new NextRequest(endpoint(orderId)+'?dispatchAt='+encodeURIComponent(new Date().toISOString())+'&reviewHold=1'),
      params(orderId)),403);
    await expectJson(await post({action:'dispatch',stage:'preview',input:{...evidence('hold-without-approved-role'),
      holdReview:{supplierReference:'TEST-PROOF',customerReference:'TEST-CUSTOMER-PROOF'}}}),403);
    await expectJson(await post({action:'record_event',stage:'preview',input:{...evidence('decision-without-approved-role'),
      kind:'review_dispatch_hold',lines:[{parcelLineId:'test-paused-line',incidentId:'test-issue',quantity:1,outcome:'continue'}]}}),403);
    await expectJson(await post({action:'record_event',stage:'preview',input:{...evidence('cannot-take-stock-without-stock-role'),
      kind:'review_dispatch_hold',lines:[{parcelLineId:'test-paused-line',incidentId:'test-issue',quantity:1,outcome:'release_to_stock'}]}}),403);
    expect(await prisma.fulfillmentParcel.count({where:{orderId,reference:{contains:'hold-without-approved-role'}}})).toBe(0);
  });

  it('requires a fresh one-use grant from the same authenticated session and deduplicates the same native waybill proof', async () => {
    const input = { ...legacyProof(), actorId: reader };
    const confirmation = await preview('link_legacy', input);
    expect(confirmation.snapshot).toMatchObject({ orderId, shipmentId: input.shipmentId, actorId: operator, reference: input.reference });
    expect(await prisma.fulfillmentParcel.count()).toBe(0);
    expect(await history()).toEqual([]);
    await expectJson(await post({ action: 'link_legacy', stage: 'confirm', input }), 409);
    await expectJson(await confirm('link_legacy', input, confirmation.actionHash), 403);
    await expectJson(await confirm('link_legacy', input, confirmation.actionHash, 'fake-grant'), 403);
    await expectJson(await confirm('link_legacy', input, confirmation.actionHash, await grant(operator, 'password_change')), 403);
    await expectJson(await confirm('link_legacy', input, confirmation.actionHash, await grant(reader)), 403);

    const token = await grant(operator);
    signIn(operator, 'admin', 'test-different-session');
    await expectJson(await confirm('link_legacy', input, confirmation.actionHash, token), 403);
    expect(await prisma.fulfillmentParcel.count()).toBe(0);

    signIn(operator);
    await expectJson(await confirm('link_legacy', input, confirmation.actionHash, token), 200);
    await expectJson(await confirm('link_legacy', input, confirmation.actionHash, token), 403);
    await expectJson(await confirm('link_legacy', input, confirmation.actionHash, await grant(operator)), 200);
    const retry = { ...input, requestId: 'test-retry-same-waybill-proof' };
    const retryPreview = await preview('link_legacy', retry);
    await expectJson(await confirm('link_legacy', retry, retryPreview.actionHash, await grant(operator)), 200);
    expect(await history()).toMatchObject([{ kind: 'link_legacy', actorId: operator, reference: input.reference }]);
    expect(await prisma.fulfillmentParcel.count()).toBe(1);
    expect(await prisma.shipment.count({ where: { orderId } })).toBe(1);
  });

  it('refuses cross-order waybills and stale previews after native waybill data changes', async () => {
    const input = legacyProof();
    const confirmation = await preview('link_legacy', input);
    await expectJson(await post({ stage: 'preview', action: 'link_legacy', input }, otherOrderId), 409);
    await expectJson(await confirm('link_legacy', input, confirmation.actionHash, await grant(operator), otherOrderId), 409);

    const trackingNumber = 'TEST-CORRECTED-WAYBILL';
    await prisma.shipment.update({ where: { id: input.shipmentId }, data: { trackingNumber } });
    const staleToken = await grant(operator);
    const rejected = await expectJson(await confirm('link_legacy', input, confirmation.actionHash, staleToken), 409);
    expect(rejected.error).toMatch(/重新预览/);
    expect(await prisma.fulfillmentParcel.count()).toBe(0);
    expect(await history()).toEqual([]);

    const refreshed = await preview('link_legacy', input);
    expect(refreshed.actionHash).not.toBe(confirmation.actionHash);
    expect(refreshed.snapshot).toMatchObject({ trackingNumber });
    await expectJson(await confirm('link_legacy', input, refreshed.actionHash, staleToken), 403);
    await expectJson(await confirm('link_legacy', input, refreshed.actionHash, await grant(operator)), 200);
    expect(await prisma.fulfillmentParcel.findFirstOrThrow({ where: { orderId } })).toMatchObject({ trackingNumber });
  });

  it('removes a matched notice from the staff queue and keeps internal transport and evidence out of both customer views', async () => {
    const inbound = await seedInboundParcel(orderId);
    await seedInboundParcel(otherOrderId);
    const report = {
      ...evidence('unmatched-notice'), eventId: 'test-queued-notice', kind: 'in_transit' as const, carrier,
      trackingNumber: inboundTracking, description: '合成承运进展',
    };
    const notice = await prisma.$transaction(tx => receiveCarrierNotice(tx, source, report));
    expect(notice.status).toBe('pending');
    const pending = await queue();
    expect(pending.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await expectJson(pending, 200)).toEqual({
      notices: [{ id: notice.id, source: `carrier/${source}`, kind: 'in_transit', occurredAt: report.occurredAt,
        reference: report.reference, carrier, trackingNumber: inboundTracking, description: report.description }],
      next: null,
    });

    const match = { parcelId: inbound.id, eventId: notice.id, description: '已用合成凭据核对归属', ...evidence('match-original-waybill') };
    const matching = await preview('match_notice', match);
    expect((await expectJson(await queue(), 200)).notices).toHaveLength(1);
    await expectJson(await confirm('match_notice', match, matching.actionHash, await grant(operator)), 200);
    expect(await expectJson(await queue(), 200)).toEqual({ notices: [], next: null });

    const input = legacyProof();
    const linking = await preview('link_legacy', input);
    await expectJson(await confirm('link_legacy', input, linking.actionHash, await grant(operator)), 200);
    const outward = await prisma.fulfillmentParcel.findUniqueOrThrow({
      where: { shipmentId: input.shipmentId }, include: { lines: true },
    });
    const receipt = {
      parcelId: outward.id, kind: 'customer_delivery', description: '已按合成签收联核对客户实收',
      lines: [{ parcelLineId: outward.lines[0].id, quantity: 2 }], ...evidence('confirmed-customer-receipt'),
    };
    const delivery = await preview('record_event', receipt);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: input.shipmentId } })).deliveredAt).toBeNull();
    await expectJson(await confirm('record_event', receipt, delivery.actionHash, await grant(operator)), 200);

    const privateFields = { actorId:operator,actorEmail:email(operator),metadata:JSON.stringify({route:'supplier_to_customer',
      evidence:'TEST-INTERNAL-DELIVERY-ARCHIVE'}),message:'TEST-INTERNAL-STAFF-NOTE' };
    await prisma.orderEvent.create({data:{orderId,type:'shipment_created',...privateFields}});
    await prisma.orderStatusHistory.create({data:{orderId,fromStatus:'confirmed',toStatus:'shipped',actorId:operator,
      actorEmail:email(operator),metadata:privateFields.metadata,reason:'TEST-INTERNAL-STAFF-REASON'}});
    const adminDetail = await expectJson(await orderGET(new NextRequest(`http://localhost/api/orders/${orderId}`), params(orderId)), 200);
    expect(adminDetail.events).toContainEqual(expect.objectContaining(privateFields));
    signIn(buyer, 'customer');
    const detail = await expectJson(await orderGET(new NextRequest(`http://localhost/api/orders/${orderId}`), params(orderId)), 200);
    const orders = await expectJson(await ordersGET(new NextRequest('http://localhost/api/orders')), 200);
    expect(orders.map((order: { id: string }) => order.id)).toEqual([orderId]);
    for (const order of [detail, orders[0]]) {
      expect(order.shipments).toMatchObject([{
        id: input.shipmentId, carrier, trackingNumber: publicTracking, status: 'delivered', deliveredAt: receipt.occurredAt,
        fulfillmentParcel: { status: 'delivered' }, items: [{ orderItemId: `${orderId}-line`, quantity: 2 }],
      }]);
      expect(order.shipments[0].fulfillmentParcel).toEqual({ status: 'delivered' });
      const serialized = JSON.stringify(order);
      for (const privateValue of [inboundTracking, source, report.reference, input.reference, receipt.reference, 'TEST-PRIVATE-LEGACY-NOTE',
        'TEST-INTERNAL-DELIVERY-ARCHIVE','TEST-INTERNAL-STAFF-NOTE','TEST-INTERNAL-STAFF-REASON',email(operator),operator,'supplier_to_customer']) {
        expect(serialized).not.toContain(privateValue);
      }
    }
    await expectJson(await orderGET(new NextRequest(`http://localhost/api/orders/${otherOrderId}`), params(otherOrderId)), 403);
  });
});
