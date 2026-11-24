import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sha256Hex } from '@/lib/harness-tools/auth';
import { verifyAndPriceItems } from '@/lib/pricing';
import { GET as getContext } from '@/app/api/internal/harness/inquiries/[id]/context/route';
import { GET as getFeedback } from '@/app/api/internal/harness/inquiries/[id]/feedback/route';
import { GET as getSupplierEvidence } from '@/app/api/internal/harness/inquiries/[id]/supplier-evidence/route';
import { GET as getStatus } from '@/app/api/internal/harness/inquiries/[id]/status/route';
import { POST as postQuotePreview } from '@/app/api/internal/harness/inquiries/[id]/quote-preview/route';
import { POST as postSupplierReview } from '@/app/api/internal/harness/inquiries/[id]/supplier-review/route';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';

const TEST_ENV = 'local-test';
const PILOT_CLIENT_ID = 'harness-m2-pilot';
const PILOT_TOKEN = 'test-pilot-token-value-123456';
const READONLY_CLIENT_ID = 'harness-m2-readonly';
const READONLY_TOKEN = 'test-readonly-token-value-123456';
const REVOKED_CLIENT_ID = 'harness-m2-revoked';
const REVOKED_TOKEN = 'test-revoked-token-value-123456';
const EXPIRED_CLIENT_ID = 'harness-m2-expired';
const EXPIRED_TOKEN = 'test-expired-token-value-123456';

function makeConfig(pilotInquiryIds?: string[]) {
  return JSON.stringify({
    enabled: true,
    environment: TEST_ENV,
    ...(pilotInquiryIds !== undefined ? { pilotInquiryIds } : {}),
    clients: [
      {
        clientId: PILOT_CLIENT_ID,
        tokenSha256: sha256Hex(PILOT_TOKEN),
        scopes: ['inquiry.read', 'inquiry.quote.preview', 'inquiry.supplier_review.prepare'],
      },
      {
        clientId: READONLY_CLIENT_ID,
        tokenSha256: sha256Hex(READONLY_TOKEN),
        scopes: ['inquiry.read'],
      },
      {
        clientId: REVOKED_CLIENT_ID,
        tokenSha256: sha256Hex(REVOKED_TOKEN),
        scopes: ['inquiry.read', 'inquiry.quote.preview'],
        revoked: true,
      },
      {
        clientId: EXPIRED_CLIENT_ID,
        tokenSha256: sha256Hex(EXPIRED_TOKEN),
        scopes: ['inquiry.read', 'inquiry.quote.preview'],
        expiresAt: '2020-01-01T00:00:00.000Z',
      },
    ],
  });
}

function makeRequest(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    token?: string | null;
    clientId?: string | null;
    env?: string | null;
    body?: unknown;
  } = {},
) {
  const headers = new Headers();
  if (options.token !== null) headers.set('x-libereal-harness-token', options.token ?? PILOT_TOKEN);
  if (options.clientId !== null) headers.set('x-libereal-harness-client-id', options.clientId ?? PILOT_CLIENT_ID);
  if (options.env !== null) headers.set('x-libereal-harness-env', options.env ?? TEST_ENV);
  if (options.body !== undefined) headers.set('content-type', 'application/json');

  return new NextRequest(`http://localhost:3000${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function seedSyntheticInquiryFixtures() {
  const brand = await prisma.brand.create({
    data: {
      name: 'SynthBrand',
      slug: 'synth-brand',
      isActive: true,
      defaultDiscountRate: 0.9,
      supplierQuoteRequiredAbove: 10_000,
    },
  });

  const normalProduct = await prisma.product.create({
    data: {
      catalogNumber: 'SYNTH-NORM-100',
      name: 'Synthetic Normal Reagent',
      brand: brand.name,
      brandRecordId: brand.id,
      price: 1000,
      originalPrice: 1000,
      pricingMode: 'fixed',
      inStock: true,
      leadTime: '3-5天',
    },
  });

  const highValueProduct = await prisma.product.create({
    data: {
      catalogNumber: 'SYNTH-HIGH-15000',
      name: 'Synthetic High-Value Standard',
      brand: brand.name,
      brandRecordId: brand.id,
      price: 15_000,
      originalPrice: 15_000,
      pricingMode: 'fixed',
      inStock: false,
      leadTime: '待确认',
    },
  });

  const customer = await prisma.user.create({
    data: {
      email: 'synth-customer@example.invalid',
      name: 'Synthetic Customer',
      role: 'customer',
      tier: 'gold',
      brandDiscounts: JSON.stringify({ SynthBrand: 0.8 }),
    },
  });

  const inquiry = await prisma.inquiry.create({
    data: {
      userId: customer.id,
      name: 'Synthetic Customer',
      email: customer.email,
      phone: '13800000001',
      institution: 'Synthetic Lab',
      status: 'pending_quote',
      hasUnresolvedPricing: true,
      inquiryItems: {
        create: [
          {
            position: 0,
            productId: normalProduct.id,
            catalogNumber: normalProduct.catalogNumber,
            name: normalProduct.name,
            quantity: 2,
            metadata: JSON.stringify({ brand: brand.name }),
          },
          {
            position: 1,
            productId: highValueProduct.id,
            catalogNumber: highValueProduct.catalogNumber,
            name: highValueProduct.name,
            quantity: 1,
            metadata: JSON.stringify({ brand: brand.name }),
          },
          {
            position: 2,
            catalogNumber: 'UNMATCHED-SKU-999',
            name: 'Uncatalogued Requested Item',
            quantity: 3,
          },
        ],
      },
    },
    include: { inquiryItems: { orderBy: { position: 'asc' } } },
  });

  await prisma.inquiryFeedback.create({
    data: {
      inquiryId: inquiry.id,
      actorType: 'customer',
      actorUserId: customer.id,
      actorEmail: customer.email,
      actorName: customer.name,
      channel: 'website',
      feedbackType: 'consultation',
      content: '请核对货期与最新报价',
      handlingStatus: 'pending',
    },
  });

  return { brand, normalProduct, highValueProduct, customer, inquiry };
}

describe('M2 harness scoped inquiry/quote/feedback tool APIs', () => {
  let savedConfigEnv: string | undefined;

  beforeAll(() => {
    savedConfigEnv = process.env.LIBEREAL_HARNESS_TOOLS_CONFIG;
    getTestDb();
  });

  afterAll(() => {
    if (savedConfigEnv === undefined) delete process.env.LIBEREAL_HARNESS_TOOLS_CONFIG;
    else process.env.LIBEREAL_HARNESS_TOOLS_CONFIG = savedConfigEnv;
    closeTestDb();
  });

  beforeEach(() => {
    clearAllTables(getTestDb());
    process.env.LIBEREAL_HARNESS_TOOLS_CONFIG = makeConfig();
  });

  it('enforces auth, scope, revocation, expiry, pilot allowlist, and untrusted field rejection', async () => {
    const { inquiry } = await seedSyntheticInquiryFixtures();
    const params = Promise.resolve({ id: inquiry.id });

    delete process.env.LIBEREAL_HARNESS_TOOLS_CONFIG;
    const disabledRes = await getContext(makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/context`), { params });
    expect(disabledRes.status).toBe(503);
    expect((await disabledRes.json()).errorClass).toBe('disabled');

    process.env.LIBEREAL_HARNESS_TOOLS_CONFIG = makeConfig([inquiry.id]);

    const missingAuthRes = await getContext(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/context`, { token: null }),
      { params },
    );
    expect(missingAuthRes.status).toBe(401);

    const wrongTokenRes = await getContext(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/context`, { token: 'wrong-token' }),
      { params },
    );
    expect(wrongTokenRes.status).toBe(401);

    const wrongEnvRes = await getContext(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/context`, { env: 'staging' }),
      { params },
    );
    expect(wrongEnvRes.status).toBe(403);
    expect((await wrongEnvRes.json()).code).toBe('ENVIRONMENT_MISMATCH');

    const revokedRes = await getContext(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/context`, {
        clientId: REVOKED_CLIENT_ID,
        token: REVOKED_TOKEN,
      }),
      { params },
    );
    expect(revokedRes.status).toBe(403);
    expect((await revokedRes.json()).code).toBe('CLIENT_REVOKED');

    const expiredRes = await getContext(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/context`, {
        clientId: EXPIRED_CLIENT_ID,
        token: EXPIRED_TOKEN,
      }),
      { params },
    );
    expect(expiredRes.status).toBe(403);
    expect((await expiredRes.json()).code).toBe('CLIENT_EXPIRED');

    const outOfPilotRes = await getContext(
      makeRequest('/api/internal/harness/inquiries/INQ-NOT-IN-PILOT/context'),
      { params: Promise.resolve({ id: 'INQ-NOT-IN-PILOT' }) },
    );
    expect(outOfPilotRes.status).toBe(403);
    expect((await outOfPilotRes.json()).code).toBe('PILOT_SCOPE_FORBIDDEN');

    const readonlyPreviewRes = await postQuotePreview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/quote-preview`, {
        method: 'POST',
        clientId: READONLY_CLIENT_ID,
        token: READONLY_TOKEN,
        body: {},
      }),
      { params },
    );
    expect(readonlyPreviewRes.status).toBe(403);
    expect((await readonlyPreviewRes.json()).code).toBe('SCOPE_FORBIDDEN');

    const injectedAuthRes = await postQuotePreview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/quote-preview`, {
        method: 'POST',
        body: { approved: true },
      }),
      { params },
    );
    expect(injectedAuthRes.status).toBe(400);
    expect((await injectedAuthRes.json()).code).toBe('UNTRUSTED_AUTHORIZATION_FIELD');
  });

  it('matches verifyAndPriceItems discount priority bit-for-bit and flags high-value & unmatched lines without DB writes', async () => {
    const { brand, normalProduct, highValueProduct, customer, inquiry } = await seedSyntheticInquiryFixtures();
    process.env.LIBEREAL_HARNESS_TOOLS_CONFIG = makeConfig([inquiry.id]);

    // Compare directly against authoritative verifyAndPriceItems for the catalog item
    // Brand default is 0.9, customer brand discount is 0.8 (priority over brand default, no stacking).
    const directPricing = await verifyAndPriceItems(
      [
        {
          inquiryItemId: inquiry.inquiryItems[0].id,
          productId: normalProduct.id,
          catalogNumber: normalProduct.catalogNumber,
          brand: brand.name,
          name: normalProduct.name,
          price: 0,
          quantity: 2,
        },
      ],
      {
        inquiryId: inquiry.id,
        userId: customer.id,
        customerEmail: customer.email,
        allowQuoteRequired: true,
        allowManualAdjustment: false,
        allowClientFallback: false,
        strictQuantity: true,
      },
    );

    const previewRes = await postQuotePreview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/quote-preview`, {
        method: 'POST',
        body: {},
      }),
      { params: Promise.resolve({ id: inquiry.id }) },
    );
    expect(previewRes.status).toBe(200);
    const body = await previewRes.json();
    expect(body.ok).toBe(true);
    expect(body.tool).toBe('preview_inquiry_quote');
    expect(body.data.outboundSent).toBe(false);
    expect(body.data.quotePublished).toBe(false);
    expect(body.data.readyToDraft).toBe(false);

    // Line 0: exact parity with verifyAndPriceItems (1000 * 0.8 = 800, subtotal = 1600)
    expect(body.data.lines[0].unitPrice).toBe(directPricing.verifiedItems[0].unitPrice);
    expect(body.data.lines[0].unitPrice).toBe(800);
    expect(body.data.lines[0].lineTotal).toBe(directPricing.verifiedItems[0].lineTotal);
    expect(body.data.lines[0].lineTotal).toBe(1600);
    expect(body.data.pricedSubtotal).toBe(1600);

    // Line 1: high-value item (>10000) requires supplier written quote and must not fabricate unitPrice
    expect(body.data.lines[1].productId).toBe(highValueProduct.id);
    expect(body.data.lines[1].quoteRequired).toBe(true);
    expect(body.data.lines[1].unitPrice).toBeNull();

    // Line 2: unmatched SKU flagged without fallback price fabrication
    expect(body.data.lines[2].quoteRequired).toBe(true);
    expect(body.data.lines[2].unitPrice).toBeNull();

    const blockerCodes = (body.data.missingInfo as Array<{ code: string }>).map((m) => m.code);
    expect(blockerCodes).toContain('SUPPLIER_WRITTEN_QUOTE_REQUIRED');
    expect(blockerCodes).toContain('CATALOG_ITEM_UNMATCHED');

    // Confirm preview performed zero writes
    expect(await prisma.quote.count({ where: { inquiryId: inquiry.id } })).toBe(0);
    expect(await prisma.backgroundTask.count()).toBe(0);
  });

  it('enforces version conflict, idempotent replay, conflict detection, and readback consistency on supplier review preparation', async () => {
    const { inquiry } = await seedSyntheticInquiryFixtures();
    process.env.LIBEREAL_HARNESS_TOOLS_CONFIG = makeConfig([inquiry.id]);
    const params = Promise.resolve({ id: inquiry.id });

    const ctxRes = await getContext(makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/context`), { params });
    expect(ctxRes.status).toBe(200);
    const ctxBody = await ctxRes.json();
    const initialVersion = ctxBody.inquiryVersion as string;
    expect(initialVersion).toMatch(/^[a-f0-9]{64}$/);

    const highValueItemId = inquiry.inquiryItems[1].id;
    const staleVersion = 'a'.repeat(64);

    // 1. Stale version rejected with 409 version_conflict
    const staleRes = await postSupplierReview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/supplier-review`, {
        method: 'POST',
        body: {
          inquiryItemId: highValueItemId,
          expectedInquiryVersion: staleVersion,
          idempotencyKey: 'm2-test-idem-001',
        },
      }),
      { params },
    );
    expect(staleRes.status).toBe(409);
    const staleJson = await staleRes.json();
    expect(staleJson.errorClass).toBe('version_conflict');
    expect(staleJson.details.currentInquiryVersion).toBe(initialVersion);
    expect(await prisma.backgroundTask.count({ where: { type: 'inquiry.supplier_written_quote' } })).toBe(0);

    // 2. Valid version creates supplier written quote task + audit log + idempotency receipt
    const prepareRes = await postSupplierReview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/supplier-review`, {
        method: 'POST',
        body: {
          inquiryItemId: highValueItemId,
          expectedInquiryVersion: initialVersion,
          idempotencyKey: 'm2-test-idem-001',
        },
      }),
      { params },
    );
    expect(prepareRes.status).toBe(201);
    const prepareJson = await prepareRes.json();
    expect(prepareJson.ok).toBe(true);
    expect(prepareJson.data.replayed).toBe(false);
    expect(prepareJson.data.outboundSent).toBe(false);
    expect(prepareJson.data.status).toBe('awaiting_human');
    expect(prepareJson.inquiryVersion).not.toBe(initialVersion);

    const reviewId = prepareJson.data.reviewId as string;
    expect(await prisma.backgroundTask.count({ where: { type: 'inquiry.supplier_written_quote' } })).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'harness.inquiry.supplier_quote_prepared', targetId: inquiry.id },
      }),
    ).toBe(1);
    expect(await prisma.quote.count({ where: { inquiryId: inquiry.id } })).toBe(0);
    expect(await prisma.order.count({ where: { inquiryId: inquiry.id } })).toBe(0);
    expect(await prisma.backgroundTask.count({ where: { type: 'email.send' } })).toBe(0);

    // 3. Identical retry with same idempotencyKey returns 200 replayed: true with exact same reviewId
    const replayRes = await postSupplierReview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/supplier-review`, {
        method: 'POST',
        body: {
          inquiryItemId: highValueItemId,
          expectedInquiryVersion: initialVersion,
          idempotencyKey: 'm2-test-idem-001',
        },
      }),
      { params },
    );
    expect(replayRes.status).toBe(200);
    const replayJson = await replayRes.json();
    expect(replayJson.data.replayed).toBe(true);
    expect(replayJson.data.reviewId).toBe(reviewId);
    expect(await prisma.backgroundTask.count({ where: { type: 'inquiry.supplier_written_quote' } })).toBe(1);

    // 4. Same idempotencyKey with mutated payload returns 409 idempotency_conflict
    const conflictRes = await postSupplierReview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/supplier-review`, {
        method: 'POST',
        body: {
          inquiryItemId: highValueItemId,
          renewalReason: 'different reason payload',
          expectedInquiryVersion: initialVersion,
          idempotencyKey: 'm2-test-idem-001',
        },
      }),
      { params },
    );
    expect(conflictRes.status).toBe(409);
    expect((await conflictRes.json()).errorClass).toBe('idempotency_conflict');

    // 5. Readback endpoints reflect live DB state consistently
    const [evidenceRes, feedbackRes, statusRes] = await Promise.all([
      getSupplierEvidence(makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/supplier-evidence`), { params }),
      getFeedback(makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/feedback`), { params }),
      getStatus(makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/status`), { params }),
    ]);

    expect(evidenceRes.status).toBe(200);
    const evidenceJson = await evidenceRes.json();
    expect(evidenceJson.data.dataTrustBoundary).toBe('untrusted_external_business_data');
    expect(evidenceJson.data.entries[0].reviewId).toBe(reviewId);
    expect(evidenceJson.data.entries[0].status).toBe('awaiting_human');

    expect(feedbackRes.status).toBe(200);
    const feedbackJson = await feedbackRes.json();
    expect(feedbackJson.data.dataTrustBoundary).toBe('untrusted_external_business_data');
    expect(feedbackJson.data.feedbackSummary.pendingCount).toBe(1);

    expect(statusRes.status).toBe(200);
    const statusJson = await statusRes.json();
    expect(statusJson.data.waitingOnHuman).toBe(true);
    expect(statusJson.data.supplierQuoteTasks).toHaveLength(1);
    expect(statusJson.data.supplierQuoteTasks[0].id).toBe(reviewId);
    expect(statusJson.data.supplierQuoteTasks[0].outboundSent).toBe(false);
  });
});
