// @vitest-environment node

import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as fulfillment } from '@/app/api/internal/harness/orders/[id]/fulfillment-context/route';
import { POST as fulfillmentPreview } from '@/app/api/internal/harness/orders/[id]/fulfillment-event-preview/route';
import { GET as finance } from '@/app/api/internal/harness/orders/[id]/finance-context/route';
import { POST as financePreview } from '@/app/api/internal/harness/orders/[id]/finance-action-preview/route';
import { GET as sale } from '@/app/api/internal/harness/after-sale-cases/[id]/context/route';
import { POST as salePreview } from '@/app/api/internal/harness/after-sale-cases/[id]/action-preview/route';
import { receiveCarrierNotice } from '@/lib/fulfillment-carrier';
import { sha256Hex } from '@/lib/harness-tools/auth';
import { prisma } from '@/lib/prisma';
import { clearAllTables, closeTestDb, getTestDb } from './db-helpers';
import { approveFixtureRefund, directLineId, orderId, recordedAllocation, relayLineId, secondOrderId, seedContinuationFixture, seedExchangeFixture, seedReturnFixture, siblingWaybill } from './harness-continuation-fixture';

const scopes = ['fulfillment.read', 'fulfillment.event.preview', 'finance.read', 'finance.action.preview', 'after_sale.read', 'after_sale.action.preview'];
const syntheticToken = 'synthetic-machine-stage-r2b';
function useHarness(caseIds: string[]) {
  const grants = { tokenSha256: sha256Hex(syntheticToken), pilotOrderIds: [orderId], pilotAfterSaleCaseIds: caseIds };
  vi.stubEnv('LIBEREAL_HARNESS_TOOLS_CONFIG', JSON.stringify({
    enabled: true, environment: 'local-test', clients: [
      { ...grants, clientId: 'scope-pilot', scopes },
      { ...grants, clientId: 'fulfillment-reader', scopes: ['fulfillment.read'] },
      { ...grants, clientId: 'no-cases', scopes, pilotAfterSaleCaseIds: [] },
    ],
  }));
}

const advance = () => vi.setSystemTime(Date.now() + 1000);

function call(handler: typeof fulfillment, id: string, body?: object, clientId = 'scope-pilot') {
  return handler(new NextRequest(`http://127.0.0.1/harness/${id}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json', 'x-libereal-harness-token': syntheticToken,
      'x-libereal-harness-client-id': clientId, 'x-libereal-harness-env': 'local-test',
    },
    body: body ? JSON.stringify(body) : undefined,
  }), { params: Promise.resolve({ id }) });
}

function intent(tool: string, id: string, expectedVersion: string, details: object) {
  const body = { expectedVersion, intent: details };
  const text = JSON.stringify([tool, id, body], (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, (value as Record<string, unknown>)[key]])) : value);
  return { ...body, idempotencyKey: sha256Hex(text) };
}

async function json(response: Response, status = 200) {
  const result = await response.json();
  expect(response.status, JSON.stringify(result)).toBe(status);
  return result;
}

describe('scoped fulfillment, finance and after-sale Harness previews', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-05-01T03:00:00Z'));
    vi.stubEnv('FULFILLMENT_CARRIER_SOURCE', 'synthetic-carrier-feed');
    vi.stubEnv('FULFILLMENT_CARRIER_SECRET', 'synthetic-fixture-carrier-secret-with-32-bytes');
    clearAllTables(getTestDb());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await prisma.$disconnect();
    closeTestDb();
  });

  it('keeps scopes and grants separate and rejects forged authorization and stale state', async () => {
    const f = await seedContinuationFixture();
    useHarness([f.caseId]);
    expect((await call(fulfillment, orderId, undefined, 'fulfillment-reader')).status).toBe(200);
    expect((await call(finance, orderId, undefined, 'fulfillment-reader')).status).toBe(403);
    expect((await call(sale, f.caseId, undefined, 'no-cases')).status).toBe(403);
    expect((await call(sale, orderId)).status).toBe(403);
    expect((await call(finance, secondOrderId)).status).toBe(403);
    expect((await call(salePreview, f.caseId, { intent: { approved: true } })).status).toBe(400);
    expect((await call(financePreview, orderId, { intent: { adminId: 'forged', mfaVerified: true } })).status).toBe(400);
    expect((await call(fulfillmentPreview, orderId, { intent: { stepUpToken: 'forged' } })).status).toBe(400);
    const read = await json(await call(finance, orderId));
    const request = intent('preview_finance_action', orderId, read.objectVersion, { action: 'invoice', planId: f.invoicePlanId, amountCents: 1 });
    await recordedAllocation(secondOrderId, f.bankReceiptId, 1, 'additional-sibling-distribution');
    const versionError = await json(await call(financePreview, orderId, request), 409);
    expect(versionError.code).toBe('OBJECT_VERSION_CHANGED');
    expect((await call(financePreview, orderId, { ...request, intent: { ...request.intent, amountCents: 2 } })).status).toBe(409);
  });

  it('separates carrier notifications from actual receipts and limits forwarding to its source batch', async () => {
    const f = await seedContinuationFixture();
    useHarness([f.caseId]);
    const { objectVersion, data } = await json(await call(fulfillment, orderId));
    const direct = data.parcels.find((parcel: { parcelId: string }) => parcel.parcelId === f.direct.id);
    expect(direct.lines[0].received).toBe(0);
    expect(direct.events).toContainEqual(expect.objectContaining({ kind: 'carrier_delivered', carrierReported: true, physicalReceipt: false }));
    expect(data.forwardableReceipts).toEqual([{
      receiptId: f.receipt.id, purchaseOrderId: f.supplier.relay, orderItemId: relayLineId, availableQuantity: 1,
    }]);
    const receive = await json(await call(fulfillmentPreview, orderId, intent('preview_fulfillment_event', orderId, objectVersion, {
      action: 'customer_delivery', parcelId: f.direct.id, lines: [{ parcelLineId: f.direct.lines[0].id, quantity: 1 }],
    })));
    expect(receive.data).toMatchObject({ allowed: true, humanActionRequired: true, physicalEvidenceRequired: true, carrierNoticeProvesReceipt: false });
    const forward = (quantity: number, trackingNumber: string) => ({
      action: 'dispatch', route: 'libereal_to_customer', carrier: f.carrier, trackingNumber,
      lines: [{ purchaseOrderId: f.supplier.relay, orderItemId: relayLineId, sourceReceiptId: f.receipt.id, quantity }],
    });
    const preview = async (details: object) => (await json(await call(fulfillmentPreview, orderId,
      intent('preview_fulfillment_event', orderId, objectVersion, details)))).data;
    expect(await preview(forward(1, 'SYNTH-NEW-RELAY'))).toMatchObject({ allowed: true });
    expect(await preview(forward(2, 'SYNTH-NEW-RELAY'))).toMatchObject({ allowed: false, blockers: ['DISPATCH_SCOPE_REJECTED'] });
    expect(await preview(forward(1, siblingWaybill))).toMatchObject({ allowed: false, blockers: ['DISPATCH_SCOPE_REJECTED'] });
    expect(await prisma.fulfillmentParcel.count()).toBe(3);
    await prisma.fulfillmentParcel.updateMany({
      where: { orderId: secondOrderId, trackingNumber: siblingWaybill },
      data: { trackingNumber: f.directWaybill, feedSource: 'synthetic-carrier-feed' },
    });
    const unmatched = await prisma.$transaction(tx => receiveCarrierNotice(tx, 'synthetic-carrier-feed', {
      eventId: 'synthetic-ambiguous-notice', kind: 'carrier_delivered', carrier: f.carrier, trackingNumber: f.directWaybill,
      occurredAt: new Date().toISOString(), reference: 'SYNTH-AMBIGUOUS', sha256: '9'.repeat(64), description: 'Synthetic uncertain carrier update',
    }));
    expect(unmatched.status).toBe('pending');
    const ambiguous = await json(await call(fulfillment, orderId));
    expect(ambiguous.data.carrierNoticeNeedsHumanMatching).toBe(true);
    expect(JSON.stringify(ambiguous.data)).not.toContain(unmatched.id);
    expect(await prisma.fulfillmentReceipt.findUnique({ where: { id: f.receipt.id }, select: { forwardedQuantity: true } })).toEqual({ forwardedQuantity: 0 });
  });

  it('scopes receipts and keeps allocation, invoices and supplier balances distinct', async () => {
    const f = await seedContinuationFixture();
    useHarness([f.caseId]);
    const { objectVersion, data } = await json(await call(finance, orderId));
    expect(JSON.stringify(data)).not.toMatch(/SYNTHETIC-HIDDEN|SYNTH-BANK|example\.invalid|bankTrace/);
    expect(data.bankReceipts).toHaveLength(1);
    expect(data.bankReceipts[0]).toMatchObject({ receivedCents: 20_000, availableCents: 5_000 });
    expect(data.purchases).toHaveLength(2);
    const preview = async (details: object) => (await json(await call(financePreview, orderId,
      intent('preview_finance_action', orderId, objectVersion, details)))).data;
    const allocate = (amountCents: number) => ({ action: 'allocate_receipt', receiptKey: data.bankReceipts[0].receiptKey, amountCents });
    expect(await preview(allocate(5_000))).toMatchObject({ allowed: true, projection: { receiptRemainingAfterCents: 0, receivableRemainingAfterCents: 17_000 } });
    expect(await preview(allocate(5_001))).toMatchObject({ allowed: false, blockers: ['RECEIPT_ALLOCATION_REJECTED'] });
    expect(await preview({ action: 'invoice', planId: f.invoicePlanId, amountCents: 10_000 }))
      .toMatchObject({ allowed: true, postedCashCents: 8_000, projection: { cashPostedByInvoice: false } });
    expect(await prisma.customerCashPosting.count()).toBe(2);
    expect(await preview({ action: 'reconcile_supplier', purchaseOrderId: f.supplier.direct }))
      .toMatchObject({ allowed: true, projection: { paidCents: 900, dueCents: 1600, invoicedCents: 2500, alreadyReconciled: false } });
    expect(await preview({ action: 'reconcile_supplier', purchaseOrderId: f.supplier.relay })).toMatchObject({ allowed: false });
    expect(await prisma.financeInvoice.count()).toBe(1);
  });

  it('binds the original parcel and requires verified original cash plus current independent refund approval', async () => {
    const f = await seedContinuationFixture();
    const returned = await seedReturnFixture(f.direct, advance);
    useHarness([f.caseId, returned.caseId]);
    const original = await json(await call(sale, returned.caseId));
    const result = (parcelLineId: string) => ({
      action: 'return', result: 'return', parcelLineId, quantity: 1, resolutionId: returned.resolutionId, resendApprovalId: null,
    });
    const preview = (caseId: string, version: string, details: object) =>
      call(salePreview, caseId, intent('preview_after_sale_action', caseId, version, details)).then(response => json(response));
    expect((await preview(returned.caseId, original.objectVersion, result(returned.parcelLineId))).data).toMatchObject({
      orderId, orderItemId: directLineId, allowed: true, projection: { resolutionId: returned.resolutionId, parcelId: f.direct.id },
    });
    expect((await preview(returned.caseId, original.objectVersion, result(f.inbound.lines[0].id))).data.allowed).toBe(false);
    const before = await json(await call(sale, f.caseId));
    expect(JSON.stringify(before.data)).not.toContain('SYNTHETIC-HIDDEN');
    expect((await preview(f.caseId, before.objectVersion, { action: 'refund', amountCents: 5_000 })).data).toMatchObject({
      allowed: false, blockers: ['INDEPENDENT_REFUND_APPROVAL_REQUIRED'],
    });
    // Read one position after the synthetic finance approval, with no actual refund.
    await approveFixtureRefund(f.caseId);
    const approved = await json(await call(sale, f.caseId));
    expect((await preview(f.caseId, approved.objectVersion, { action: 'refund', amountCents: 5_000 })).data).toMatchObject({
      allowed: true, changesSupplierPayable: false, projection: { verifiedPaidCents: 8_000, approvalRemainingCents: 5_000, refundedCents: 0 },
    });
    expect((await preview(f.caseId, approved.objectVersion, { action: 'refund', amountCents: 5_001 })).data).toMatchObject({
      allowed: false, blockers: ['AMOUNT_EXCEEDS_REFUND_APPROVAL'],
    });
    const savedApproval = await prisma.afterSaleEvent.findFirstOrThrow({ where: { caseId: f.caseId, action: 'approve_refund' } });
    await prisma.afterSaleEvent.update({ where: { id: savedApproval.id }, data: { approvedHash: 'c'.repeat(64) } });
    const tampered = await json(await call(sale, f.caseId));
    expect((await preview(f.caseId, tampered.objectVersion, { action: 'refund', amountCents: 5_000 })).data).toMatchObject({
      allowed: false, blockers: ['INDEPENDENT_REFUND_APPROVAL_REQUIRED'],
    });
    expect(await prisma.afterSaleEvent.count({ where: { action: { in: ['physical', 'refund_result'] } } })).toBe(0);
  });
  it('an approved exchange only becomes ready after actual replacement delivery', async () => {
    const f = await seedContinuationFixture();
    const e = await seedExchangeFixture(f);
    useHarness([e.caseId]);
    const details = { action: 'exchange', result: 'delivery', parcelLineId: e.replacement.lines[0].id,
      quantity: 1, resolutionId: null, resendApprovalId: null };
    const before = await json(await call(sale, e.caseId));
    expect(before.data.replacementParcels).toMatchObject([{ parcelLineId: details.parcelLineId, physicalReceipts: [] }]);
    const request = intent('preview_after_sale_action', e.caseId, before.objectVersion, details);
    expect((await json(await call(salePreview, e.caseId, request))).data.allowed).toBe(false);
    await e.sign();
    expect((await json(await call(salePreview, e.caseId, request), 409)).code).toBe('OBJECT_VERSION_CHANGED');
    const signed = await json(await call(sale, e.caseId));
    const result = await json(await call(salePreview, e.caseId, intent('preview_after_sale_action', e.caseId, signed.objectVersion, details)));
    expect(result.data).toMatchObject({ allowed: true, projection: { receiptEventIds: [expect.any(String)], nextCustomerState: 'awaiting_close' } });
    expect(await prisma.afterSaleEvent.count({ where: { caseId: e.caseId, action: 'physical' } })).toBe(0);
  });

});
