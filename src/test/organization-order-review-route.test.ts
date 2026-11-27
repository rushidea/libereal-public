import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { OrganizationRbacError, requireOrganizationPermission } from '@/lib/organization-service';
import { GET as historyGET } from '@/app/api/organizations/[id]/history/route';
import { GET as reviewGET, POST as reviewPOST } from '@/app/api/organizations/[id]/orders/[orderId]/review/route';
import { GET as orderGET, PATCH as orderPATCH } from '@/app/api/orders/[id]/route';
import { POST as shipmentPOST } from '@/app/api/admin/orders/[id]/shipments/route';
import { clearAllTables, closeTestDb, getTestDb, seedAdmin, seedUser } from './db-helpers';

const { auth, organizationPermission } = vi.hoisted(() => ({
  auth: vi.fn(),
  organizationPermission: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ auth }));
vi.mock('@/lib/admin-mfa-settings', () => ({
  requiresAdminMfaForPermission: async () => false,
}));
vi.mock('@/lib/organization-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/organization-service')>()),
  requireOrganizationPermission: organizationPermission,
  listOrganizationIdsForPermission: async () => [orgId],
}));

const orderId = 'test-org-order';
const orgId = 'test-org';
const buyerId = 'test-buyer';
const managerId = 'test-manager';
const adminId = 'test-platform-admin';
const approvalType = 'organization_order_approved';

function signIn(id: string, role: 'customer' | 'admin' = 'customer') {
  auth.mockResolvedValue({ user: { id, email: `${id}@example.test`, role, sessionId: `session-${id}` } });
}

function jsonRequest(url: string, method: 'PATCH' | 'POST', body: object) {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function preview(id = orgId) {
  return reviewGET(new Request(`http://localhost/api/organizations/${id}/orders/${orderId}/review`), {
    params: Promise.resolve({ id, orderId }),
  });
}

async function previewVersion() {
  const response = await preview();
  expect(response.status).toBe(200);
  return (await response.json()).version as string;
}

function approve(body: object, id = orgId) {
  return reviewPOST(jsonRequest(`http://localhost/api/organizations/${id}/orders/${orderId}/review`, 'POST', body), {
    params: Promise.resolve({ id, orderId }),
  });
}

function patchOrder(body: object) {
  return orderPATCH(jsonRequest(`http://localhost/api/orders/${orderId}`, 'PATCH', body), {
    params: Promise.resolve({ id: orderId }),
  });
}

async function readHistory() {
  const response = await historyGET(new Request(`http://localhost/api/organizations/${orgId}/history`), {
    params: Promise.resolve({ id: orgId }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function expectOrderPendingWithoutMerchantEffects() {
  expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: 'pending', quoteSent: false });
  expect(await prisma.creditAccount.findUniqueOrThrow({ where: { userId: buyerId } })).toMatchObject({ usedAmount: 0 });
  expect(await prisma.accountReceivable.count()).toBe(0);
  expect(await prisma.creditTransaction.count()).toBe(0);
  expect(await prisma.inventoryReservation.count()).toBe(0);
  expect(await prisma.shipment.count()).toBe(0);
  expect(await prisma.orderStatusHistory.count({ where: { toStatus: 'confirmed' } })).toBe(0);
  expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.backgroundTask.count()).toBe(0);
}

describe('organization order review and merchant acceptance', () => {
  beforeAll(() => { getTestDb(); });
  afterAll(() => { closeTestDb(); });

  beforeEach(async () => {
    vi.clearAllMocks();
    signIn(managerId);
    organizationPermission.mockResolvedValue({
      organization: { name: '合成采购组织' },
      roleAssignments: [{ role: { permissions: JSON.stringify(['organization.orders.review', 'organization.records.read']) } }],
      permissionOverrides: [],
    });
    const db = getTestDb();
    clearAllTables(db);
    seedAdmin(db, adminId, `${adminId}@example.test`);
    seedUser(db, { id: buyerId, email: `${buyerId}@example.test` });
    seedUser(db, { id: managerId, email: `${managerId}@example.test` });
    await prisma.organization.create({
      data: { id: orgId, name: '合成采购组织', ownerUserId: buyerId, status: 'active' },
    });
    await prisma.product.create({
      data: { id: 'test-product', name: '合成商品', catalogNumber: 'TEST-SKU', brand: '合成品牌', price: 50, stockQuantity: 10 },
    });
    await prisma.creditAccount.create({ data: { userId: buyerId, baseLimit: 1000 } });
    await prisma.order.create({
      data: {
        id: orderId, customerId: buyerId, email: `${buyerId}@example.test`, organizationId: orgId,
        ownerScope: 'organization', subtotal: 100, adjustmentTotal: 5, total: 105, paymentMethod: 'bank_transfer',
        adjustments: { create: { type: 'platform_fee', label: '测试费用', amount: 5 } },
        addressSnapshot: { create: { name: '测试收件人', phone: '00000000000', address: '测试地址' } },
        orderItems: { create: { id: 'test-line', position: 0, productId: 'test-product', name: '合成商品',
          catalogNumber: 'TEST-SKU', quantity: 2, unitPrice: 50, leadTime: '测试货期',
          pricingSnapshot: JSON.stringify({ supplierCost: 'SYNTHETIC-PRIVATE-COST', customerSupplyConditions: '合成供货条件' }),
        } },
        statusHistory: { create: { toStatus: 'pending', actorId: buyerId, reason: 'inquiry_items_confirmed' } },
        events: { create: { type: 'order_created', actorId: buyerId } },
      },
    });
  });

  it('requires preview when an authorized reviewer uses the old confirmation button', async () => {
    const response = await patchOrder({ status: 'confirmed' });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'ORG_ORDER_REVIEW_PREVIEW_REQUIRED' });
    expect(requireOrganizationPermission).toHaveBeenCalledWith(managerId, orgId, 'organization.orders.review');
    expect(await prisma.orderEvent.count({ where: { type: approvalType } })).toBe(0);
    await expectOrderPendingWithoutMerchantEffects();
  });

  it('binds displayed terms to one approval and preserves the pending order on reread and retry', async () => {
    const response = await preview();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      orderId, organizationId: orgId, reviewed: false, subtotal: 100, total: 105,
      paymentMethod: 'bank_transfer', recipient: { name: '测试收件人', address: '测试地址' },
      adjustments: [{ label: '测试费用', amount: 5 }],
      lines: [{ id: 'test-line', name: '合成商品', catalogNumber: 'TEST-SKU', quantity: 2, unitPrice: 50, leadTime: '测试货期' }],
    });
    expect(body.version).toMatch(/^[a-f0-9]{64}$/);
    expect((await approve({})).status).toBe(400);

    for (const submission of [await approve({ version: body.version }), await approve({ version: body.version })]) {
      expect(submission.status).toBe(200);
      await expect(submission.json()).resolves.toEqual({
        orderId, status: 'pending', organizationReviewed: true, version: body.version,
      });
    }
    expect(await prisma.orderEvent.findMany({ where: { orderId, type: approvalType } })).toEqual([
      expect.objectContaining({ type: approvalType, actorId: managerId, actorEmail: `${managerId}@example.test` }),
    ]);
    const recorded = await prisma.orderEvent.findFirstOrThrow({ where: { orderId, type: approvalType } });
    const { version, reviewed, ...snapshot } = body;
    expect(reviewed).toBe(false);
    expect(JSON.parse(recorded.metadata!)).toEqual({ schema: 2, organizationId: orgId, creatorId: buyerId, version, snapshot });
    expect(recorded.metadata).not.toContain('SYNTHETIC-PRIVATE-COST');
    expect(snapshot.lines[0].conditions).toBe('合成供货条件');
    await expect((await preview()).json()).resolves.toMatchObject({ reviewed: true, version: body.version });
    expect((await readHistory()).orders).toEqual([
      expect.objectContaining({ id: orderId, status: 'pending', organizationReview: 'current', canReview: true }),
    ]);

    signIn(adminId, 'admin');
    const shipment = await shipmentPOST(jsonRequest(`http://localhost/api/admin/orders/${orderId}/shipments`, 'POST', {
      method: 'self_pickup', pickupPoint: '测试自提点', items: [{ orderItemId: 'test-line', quantity: 1 }],
    }), { params: Promise.resolve({ id: orderId }) });
    expect(shipment.status).toBe(409);
    await expect(shipment.json()).resolves.toEqual({ error: 'ORDER_NOT_SHIPPABLE' });
    await expectOrderPendingWithoutMerchantEffects();
  });

  it('requires organization permission again on submission, even for a platform administrator', async () => {
    const version = await previewVersion();
    organizationPermission.mockRejectedValue(new OrganizationRbacError('PERMISSION_DENIED', '组织权限不足'));

    expect((await patchOrder({ status: 'confirmed' })).status).toBe(403);
    signIn(adminId, 'admin');
    expect((await preview()).status).toBe(403);
    expect((await approve({ version })).status).toBe(403);
    expect(requireOrganizationPermission).toHaveBeenCalledWith(adminId, orgId, 'organization.orders.review');
    expect(await prisma.orderEvent.count({ where: { type: approvalType } })).toBe(0);
    await expectOrderPendingWithoutMerchantEffects();
  });

  it.each([{ customerId: buyerId }, { customerId: null }])('rejects a buyer approving their own order (%o)', async ({ customerId }) => {
    await prisma.order.update({ where: { id: orderId }, data: { customerId } });
    const version = await previewVersion();
    signIn(buyerId);

    expect((await preview()).status).toBe(403);
    expect((await approve({ version })).status).toBe(403);
    expect(await prisma.orderEvent.count({ where: { type: approvalType } })).toBe(0);
  });

  it.each([
    { actorId: managerId, role: 'customer' },
    { actorId: adminId, role: 'admin' },
  ] as const)('identifies the actual quote converter $actorId even when the original customer is different', async ({ actorId, role }) => {
    const version = await previewVersion();
    await prisma.orderStatusHistory.updateMany({ where: { orderId, fromStatus: null }, data: { actorId } });
    await prisma.orderEvent.updateMany({ where: { orderId, type: 'order_created' }, data: { actorId } });
    signIn(actorId, role);

    expect((await preview()).status).toBe(403);
    expect((await approve({ version })).status).toBe(403);
    expect((await readHistory()).orders[0]).toMatchObject({ customerId: buyerId, canReview: false });
    expect(await prisma.orderEvent.count({ where: { type: approvalType } })).toBe(0);
  });

  it.each(['missing', 'conflicting'] as const)('blocks review with %s creation evidence and retains a legacy audit event', async (evidence) => {
    const version = await previewVersion();
    if (evidence === 'missing') await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
    else await prisma.orderEvent.updateMany({ where: { orderId, type: 'order_created' }, data: { actorId: managerId } });
    const historical = await prisma.orderEvent.create({
      data: { orderId, type: approvalType, actorId: managerId, metadata: JSON.stringify({ version: 'legacy', total: 105 }) },
    });

    for (const response of [await preview(), await approve({ version })]) {
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: 'ORG_ORDER_CREATOR_UNVERIFIED' });
    }
    expect((await readHistory()).orders[0]).toMatchObject({ organizationReview: 'historical', canReview: false });
    expect(await prisma.orderEvent.findUnique({ where: { id: historical.id } })).toEqual(historical);
  });

  it('does not expose or approve an order through a different organization', async () => {
    const version = await previewVersion();

    expect((await preview('test-other-org')).status).toBe(404);
    expect((await approve({ version }, 'test-other-org')).status).toBe(404);
    expect(requireOrganizationPermission).toHaveBeenCalledWith(managerId, 'test-other-org', 'organization.orders.review');
    expect(await prisma.orderEvent.count({ where: { type: approvalType } })).toBe(0);
  });

  it('rejects an old preview after an order line changes and allows review of the new version', async () => {
    const version = await previewVersion();
    expect((await approve({ version })).status).toBe(200);
    await prisma.orderItem.update({ where: { id: 'test-line' }, data: { leadTime: '更新后的测试货期' } });

    expect((await readHistory()).orders[0]).toMatchObject({ organizationReview: 'historical' });
    const stale = await approve({ version });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ error: expect.stringContaining('订单已变化') });
    expect(await prisma.orderEvent.count({ where: { type: approvalType } })).toBe(1);

    const response = await preview();
    expect(response.status).toBe(200);
    const updated = await response.json();
    expect(updated).toMatchObject({ reviewed: false, lines: [{ id: 'test-line', leadTime: '更新后的测试货期' }] });
    expect(updated.version).not.toBe(version);
    expect((await approve({ version: updated.version })).status).toBe(200);
    expect(await prisma.orderEvent.count({ where: { type: approvalType } })).toBe(2);
    expect((await readHistory()).orders[0]).toMatchObject({ organizationReview: 'current' });
    const original = await prisma.orderEvent.findUniqueOrThrow({ where: { id: approvalType + ':' + version } });
    expect(JSON.parse(original.metadata!).snapshot.lines[0].leadTime).toBe('测试货期');
    await expectOrderPendingWithoutMerchantEffects();
  });

  it('retains the pricing guard on preview and submission after a repricing request', async () => {
    const version = await previewVersion();
    await prisma.orderEvent.create({
      data: { orderId, type: 'catalog_repricing_required', metadata: JSON.stringify({ quoteId: 'test-quote', quoteVersion: 2 }) },
    });

    for (const response of [await preview(), await approve({ version })]) {
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: 'QUOTE_REPRICE_REQUIRED' });
    }
    expect(await prisma.orderEvent.count({ where: { type: approvalType } })).toBe(0);
  });

  it('keeps an admin member’s organization review distinct from authorized platform acceptance', async () => {
    signIn(adminId, 'admin');
    expect((await patchOrder({ status: 'confirmed' })).status).toBe(409);
    expect((await approve({ version: await previewVersion(), action: 'accept_order', status: 'confirmed' })).status).toBe(200);
    await expectOrderPendingWithoutMerchantEffects();

    signIn(managerId);
    expect((await patchOrder({ status: 'confirmed', action: 'accept_order' })).status).toBe(409);
    await expectOrderPendingWithoutMerchantEffects();

    signIn(adminId, 'admin');
    const detail = await orderGET(new NextRequest(`http://localhost/api/orders/${orderId}`), { params: Promise.resolve({ id: orderId }) });
    expect(detail.status).toBe(200);
    const { approvalPreview } = await detail.json();
    const response = await patchOrder({
      status: 'confirmed', action: 'accept_order', approvalVersion: approvalPreview.version, metadata: { actorType: 'customer' },
    });
    expect(response.status).toBe(200);
    const history = await prisma.orderStatusHistory.findFirstOrThrow({ where: { orderId, toStatus: 'confirmed' } });
    expect(history).toMatchObject({ fromStatus: 'pending', actorId: adminId });
    expect(JSON.parse(history.metadata!)).toMatchObject({
      action: 'accept_order', actorType: 'libereal_admin', version: 2, orderVersion: approvalPreview.version,
      snapshot: { lines: approvalPreview.snapshot.lines, total: 105 },
    });
    expect(await prisma.accountReceivable.findUnique({ where: { orderId } })).toMatchObject({ amount: 105, status: 'open' });
    expect(await prisma.inventoryReservation.findFirst({ where: { orderId } })).toMatchObject({ quantity: 2, status: 'active' });
    expect((await readHistory()).orders).toEqual([
      expect.objectContaining({ id: orderId, status: 'confirmed', organizationReview: 'historical', canReview: false }),
    ]);

    signIn(managerId);
    const customerDetail = await orderGET(new NextRequest(`http://localhost/api/orders/${orderId}`), { params: Promise.resolve({ id: orderId }) });
    expect(customerDetail.status).toBe(200);
    const customerOrder = await customerDetail.json();
    expect(customerOrder).not.toHaveProperty('approvalPreview');
    expect(JSON.parse(customerOrder.statusHistory.find((entry: { toStatus: string }) => entry.toStatus === 'confirmed').metadata))
      .toEqual({ action: 'accept_order', actorType: 'libereal_admin', version: 2, orderVersion: approvalPreview.version });
    const organizationReview = customerOrder.events.find((event: { type: string }) => event.type === approvalType);
    expect(JSON.parse(organizationReview.metadata)).toMatchObject({ snapshot: { total: 105, lines: [{ quantity: 2 }] } });
    expect(organizationReview.metadata).not.toContain('SYNTHETIC-PRIVATE-COST');
  });
});
