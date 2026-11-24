import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  HARNESS_HEADER_FENCE_TOKEN,
  HARNESS_HEADER_LEASE_TOKEN,
  sha256Hex,
} from '@/lib/harness-tools/auth';
import { verifyAndPriceItems } from '@/lib/pricing';
import { GET as getContext } from '@/app/api/internal/harness/inquiries/[id]/context/route';
import { GET as getFeedback } from '@/app/api/internal/harness/inquiries/[id]/feedback/route';
import { GET as getSupplierEvidence } from '@/app/api/internal/harness/inquiries/[id]/supplier-evidence/route';
import { GET as getStatus } from '@/app/api/internal/harness/inquiries/[id]/status/route';
import { POST as postQuotePreview } from '@/app/api/internal/harness/inquiries/[id]/quote-preview/route';
import { POST as postSupplierReview } from '@/app/api/internal/harness/inquiries/[id]/supplier-review/route';
import { POST as postLeaseClaim } from '@/app/api/internal/harness/inquiries/[id]/lease/claim/route';
import { POST as postLeaseRelease } from '@/app/api/internal/harness/inquiries/[id]/lease/release/route';
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
        scopes: [
          'inquiry.read',
          'inquiry.quote.preview',
          'inquiry.supplier_review.prepare',
          'inquiry.lease',
        ],
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
    leaseHeaders?: { leaseToken: string; fenceToken: number };
    body?: unknown;
  } = {},
) {
  const headers = new Headers();
  if (options.token !== null) headers.set('x-libereal-harness-token', options.token ?? PILOT_TOKEN);
  if (options.clientId !== null) headers.set('x-libereal-harness-client-id', options.clientId ?? PILOT_CLIENT_ID);
  if (options.env !== null) headers.set('x-libereal-harness-env', options.env ?? TEST_ENV);
  if (options.leaseHeaders) {
    headers.set(HARNESS_HEADER_LEASE_TOKEN, options.leaseHeaders.leaseToken);
    headers.set(HARNESS_HEADER_FENCE_TOKEN, String(options.leaseHeaders.fenceToken));
  }
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

  it('classifies matched inquiry-mode DB items as QUOTE_REQUIRED and unmatched SKUs as CATALOG_ITEM_UNMATCHED', async () => {
    const brand = await prisma.brand.create({
      data: {
        name: 'InquiryClassifyBrand',
        slug: 'inquiry-classify-brand',
        isActive: true,
        defaultDiscountRate: 0.9,
        supplierQuoteRequiredAbove: 10_000,
      },
    });

    const inquiryOnlyProduct = await prisma.product.create({
      data: {
        catalogNumber: 'SYNTH-INQ-CLASSIFY',
        name: 'Synthetic Inquiry-Only Product',
        brand: brand.name,
        brandRecordId: brand.id,
        price: 0,
        originalPrice: 500,
        pricingMode: 'inquiry',
        inStock: false,
        leadTime: '待确认',
      },
    });

    const customer = await prisma.user.create({
      data: {
        email: 'inquiry-classify@example.invalid',
        name: 'Classify Customer',
        role: 'customer',
        tier: 'standard',
      },
    });

    const inquiry = await prisma.inquiry.create({
      data: {
        userId: customer.id,
        name: customer.name!,
        email: customer.email,
        phone: '13800000099',
        institution: 'Classify Lab',
        status: 'pending_quote',
        hasUnresolvedPricing: true,
        inquiryItems: {
          create: [
            {
              position: 0,
              productId: inquiryOnlyProduct.id,
              catalogNumber: inquiryOnlyProduct.catalogNumber,
              name: inquiryOnlyProduct.name,
              quantity: 1,
              metadata: JSON.stringify({ brand: brand.name }),
            },
            {
              position: 1,
              productId: null,
              catalogNumber: 'UNKNOWN-SKU-404',
              name: 'Unmatched Synthetic SKU',
              quantity: 2,
            },
          ],
        },
      },
      include: { inquiryItems: { orderBy: { position: 'asc' } } },
    });

    process.env.LIBEREAL_HARNESS_TOOLS_CONFIG = makeConfig([inquiry.id]);
    const params = Promise.resolve({ id: inquiry.id });

    const res = await postQuotePreview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/quote-preview`, {
        method: 'POST',
        body: {},
      }),
      { params },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.readyToDraft).toBe(false);
    expect(body.data.pricedSubtotal).toBe(0);
    expect(body.data.lines).toHaveLength(2);
    expect(body.data.lines[0].unitPrice).toBeNull();
    expect(body.data.lines[0].lineTotal).toBeNull();
    expect(body.data.lines[1].unitPrice).toBeNull();
    expect(body.data.lines[1].lineTotal).toBeNull();

    const byItemId = new Map<string, string>(
      (body.data.missingInfo as Array<{ inquiryItemId: string; code: string }>).map((item) => [
        item.inquiryItemId,
        item.code,
      ]),
    );
    expect(byItemId.get(inquiry.inquiryItems[0].id)).toBe('QUOTE_REQUIRED');
    expect(byItemId.get(inquiry.inquiryItems[1].id)).toBe('CATALOG_ITEM_UNMATCHED');
  });

  it('enforces inquiry lease conflicts, expiry reclamation, stale-writer fencing, and safe cancellation', async () => {
    const { inquiry } = await seedSyntheticInquiryFixtures();
    const highValueItem = inquiry.inquiryItems[1];
    process.env.LIBEREAL_HARNESS_TOOLS_CONFIG = makeConfig([inquiry.id]);
    const params = Promise.resolve({ id: inquiry.id });

    // Body smuggling leaseToken/fenceToken must be rejected upfront (400)
    const smuggleRes = await postSupplierReview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/supplier-review`, {
        method: 'POST',
        body: {
          inquiryItemId: highValueItem.id,
          expectedInquiryVersion: 'a'.repeat(64),
          idempotencyKey: 'm4-smuggle-lease-01',
          leaseToken: 'forged-token',
          fenceToken: 1,
        },
      }),
      { params },
    );
    expect(smuggleRes.status).toBe(400);
    expect((await smuggleRes.json()).code).toBe('UNTRUSTED_AUTHORIZATION_FIELD');

    const ctxRes = await getContext(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/context`),
      { params },
    );
    const initialVersion = (await ctxRes.json()).inquiryVersion as string;

    // 1. Writer 1 claims a short lease (500ms) -> fenceToken=1
    const claim1Res = await postLeaseClaim(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/lease/claim`, {
        method: 'POST',
        body: {
          ownerId: 'writer-1',
          threadId: 'thread-lease-test',
          leaseDurationMs: 500,
        },
      }),
      { params },
    );
    expect(claim1Res.status).toBe(200);
    const claim1 = await claim1Res.json();
    expect(claim1.data.fenceToken).toBe(1);
    expect(claim1.data.reclaimedExpiredLease).toBe(false);
    const leaseToken1 = claim1.data.leaseToken as string;
    expect(typeof leaseToken1).toBe('string');

    // 2. Concurrent Writer 2 claim while active returns 409 lease_conflict
    const conflictClaimRes = await postLeaseClaim(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/lease/claim`, {
        method: 'POST',
        body: {
          ownerId: 'writer-2',
          threadId: 'thread-lease-test',
          leaseDurationMs: 60_000,
        },
      }),
      { params },
    );
    expect(conflictClaimRes.status).toBe(409);
    const conflictClaim = await conflictClaimRes.json();
    expect(conflictClaim.errorClass).toBe('lease_conflict');
    expect(conflictClaim.code).toBe('LEASE_HELD_BY_OTHER_OWNER');

    // Unleased write while lease active returns 409 ACTIVE_LEASE_REQUIRED
    const unleasedRes = await postSupplierReview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/supplier-review`, {
        method: 'POST',
        body: {
          inquiryItemId: highValueItem.id,
          expectedInquiryVersion: initialVersion,
          idempotencyKey: 'm4-unleased-write-01',
        },
      }),
      { params },
    );
    expect(unleasedRes.status).toBe(409);
    expect((await unleasedRes.json()).code).toBe('ACTIVE_LEASE_REQUIRED');

    // Wait for Writer 1 lease to expire, then Writer 2 reclaims -> fenceToken=2
    await new Promise((resolve) => setTimeout(resolve, 600));
    const claim2Res = await postLeaseClaim(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/lease/claim`, {
        method: 'POST',
        body: {
          ownerId: 'writer-2',
          threadId: 'thread-lease-test',
          leaseDurationMs: 60_000,
        },
      }),
      { params },
    );
    expect(claim2Res.status).toBe(200);
    const claim2 = await claim2Res.json();
    expect(claim2.data.fenceToken).toBe(2);
    expect(claim2.data.reclaimedExpiredLease).toBe(true);
    const leaseToken2 = claim2.data.leaseToken as string;
    expect(leaseToken2).not.toBe(leaseToken1);

    // 3. Stale Writer 1 write with old (leaseToken1, fenceToken=1) rejected 409 with 0 DB writes
    const staleWriteRes = await postSupplierReview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/supplier-review`, {
        method: 'POST',
        leaseHeaders: { leaseToken: leaseToken1, fenceToken: 1 },
        body: {
          inquiryItemId: highValueItem.id,
          expectedInquiryVersion: initialVersion,
          idempotencyKey: 'm4-stale-writer-01',
        },
      }),
      { params },
    );
    expect(staleWriteRes.status).toBe(409);
    const staleWriteJson = await staleWriteRes.json();
    expect(staleWriteJson.errorClass).toBe('stale_lease');
    expect(staleWriteJson.code).toBe('STALE_WRITER_LEASE_REJECTED');
    expect(
      await prisma.backgroundTask.count({ where: { type: 'inquiry.supplier_written_quote' } }),
    ).toBe(0);

    // 4. Active Writer 2 write succeeds (201)
    const activeWriteRes = await postSupplierReview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/supplier-review`, {
        method: 'POST',
        leaseHeaders: { leaseToken: leaseToken2, fenceToken: 2 },
        body: {
          inquiryItemId: highValueItem.id,
          expectedInquiryVersion: initialVersion,
          idempotencyKey: 'm4-active-writer-02',
        },
      }),
      { params },
    );
    expect(activeWriteRes.status).toBe(201);
    expect(
      await prisma.backgroundTask.count({ where: { type: 'inquiry.supplier_written_quote' } }),
    ).toBe(1);

    // 5. Writer 2 cancels lease -> committed supplier review preserved, subsequent write rejected
    const cancelRes = await postLeaseRelease(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/lease/release`, {
        method: 'POST',
        body: {
          leaseToken: leaseToken2,
          fenceToken: 2,
          action: 'cancel',
          reason: 'run aborted cleanly',
        },
      }),
      { params },
    );
    expect(cancelRes.status).toBe(200);
    const cancelJson = await cancelRes.json();
    expect(cancelJson.data.status).toBe('cancelled');
    expect(
      await prisma.backgroundTask.count({ where: { type: 'inquiry.supplier_written_quote' } }),
    ).toBe(1);

    const postCancelWriteRes = await postSupplierReview(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/supplier-review`, {
        method: 'POST',
        leaseHeaders: { leaseToken: leaseToken2, fenceToken: 2 },
        body: {
          inquiryItemId: highValueItem.id,
          expectedInquiryVersion: initialVersion,
          idempotencyKey: 'm4-post-cancel-write',
        },
      }),
      { params },
    );
    expect(postCancelWriteRes.status).toBe(409);
    expect((await postCancelWriteRes.json()).code).toBe('STALE_WRITER_LEASE_REJECTED');
  });

  it('surfaces quote-email unknown/partial delivery tasks and redacted activeLease in status endpoint', async () => {
    const { inquiry, normalProduct } = await seedSyntheticInquiryFixtures();
    const quote = await prisma.quote.create({
      data: {
        inquiryId: inquiry.id,
        version: 1,
        status: 'sent',
        subtotal: 800,
        currency: 'CNY',
        sentAt: new Date(),
        validUntil: new Date(Date.now() + 7 * 86400_000),
        items: {
          create: [
            {
              inquiryItemId: inquiry.inquiryItems[0].id,
              position: 0,
              productId: normalProduct.id,
              catalogNumber: normalProduct.catalogNumber,
              name: normalProduct.name,
              unitPrice: 800,
              quantity: 1,
              lineTotal: 800,
              leadTime: '3-5天',
              available: true,
            },
          ],
        },
      },
    });

    await prisma.inquiryFeedback.updateMany({
      where: { inquiryId: inquiry.id },
      data: { handlingStatus: 'resolved', handledAt: new Date() },
    });

    const deliveryTask = await prisma.backgroundTask.create({
      data: {
        type: 'email.send',
        status: 'awaiting_human',
        dedupeKey: `quote-email:${quote.id}`,
        payload: JSON.stringify({
          kind: 'quote',
          to: inquiry.email,
          subject: 'LIBEREAL · 报价通知',
        }),
        lastError: 'SMTP socket timeout after DATA',
        result: JSON.stringify({ outcome: 'unknown' }),
      },
    });

    process.env.LIBEREAL_HARNESS_TOOLS_CONFIG = makeConfig([inquiry.id]);
    const params = Promise.resolve({ id: inquiry.id });

    const claimRes = await postLeaseClaim(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/lease/claim`, {
        method: 'POST',
        body: { ownerId: 'status-reader', threadId: 'thread-status-delivery' },
      }),
      { params },
    );
    const claimJson = await claimRes.json();
    const secretLeaseToken = claimJson.data.leaseToken as string;

    const statusRes = await getStatus(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/status`),
      { params },
    );
    expect(statusRes.status).toBe(200);
    const rawBody = await statusRes.text();
    expect(rawBody.includes(secretLeaseToken)).toBe(false);

    const statusJson = JSON.parse(rawBody);
    expect(statusJson.data.waitingOnHuman).toBe(true);
    expect(statusJson.data.reasons).toContain('存在待核对投递回执');
    expect(statusJson.data.deliveryTasks).toHaveLength(1);
    expect(statusJson.data.deliveryTasks[0]).toMatchObject({
      id: deliveryTask.id,
      type: 'email.send',
      status: 'awaiting_human',
      dedupeKey: `quote-email:${quote.id}`,
      outcome: 'unknown',
      reviewable: true,
    });
    expect(statusJson.data.activeLease).toMatchObject({
      ownerId: 'status-reader',
      threadId: 'thread-status-delivery',
      fenceToken: 1,
      status: 'running',
      expired: false,
    });

    // Partial outcome also remains reviewable
    await prisma.backgroundTask.update({
      where: { id: deliveryTask.id },
      data: { result: JSON.stringify({ outcome: 'partial' }) },
    });
    const partialRes = await getStatus(
      makeRequest(`/api/internal/harness/inquiries/${inquiry.id}/status`),
      { params },
    );
    const partialJson = await partialRes.json();
    expect(partialJson.data.deliveryTasks[0].outcome).toBe('partial');
    expect(partialJson.data.deliveryTasks[0].reviewable).toBe(true);
  });
});
