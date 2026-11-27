import { vi } from 'vitest';
import { afterSaleAction } from '@/lib/after-sale-actions';
import { salePermission, type SaleInput } from '@/lib/after-sale-records';
import { reserveOrderCredit } from '@/lib/customer-credit';
import { applyFinanceAction, previewFinanceAction, type FinanceInput } from '@/lib/finance-actions';
import { financeWorkspace } from '@/lib/finance-workspace';
import { receiveCarrierNotice } from '@/lib/fulfillment-carrier';
import { dispatchParcel, recordParcelEvent } from '@/lib/fulfillment-parcels';
import { receiveInventoryBatch, reserveOrderInventory } from '@/lib/inventory';
import { merchantAcceptanceMetadata, merchantOrderApprovalPreview, ORDER_APPROVAL_INCLUDE } from '@/lib/order-approval';
import { pricingContentHash } from '@/lib/pricing-adjustment-approval';
import { prisma } from '@/lib/prisma';
import { applyPurchaseAction, prepareOrderPurchases, previewPurchaseAction, purchaseWorkspace, savePurchaseLine } from '@/lib/purchase-orders';
import { seedUser, getTestDb } from './db-helpers';
import { supplierPaymentProof } from './supplier-payment-proof';

export const orderId = 'synthetic-continuation-order';
export const secondOrderId = 'synthetic-continuation-sibling';
export const directLineId = 'synthetic-direct-line';
export const relayLineId = 'synthetic-relay-line';
const productId = 'synthetic-continuation-product';
const buyer = { id: 'synthetic-continuation-buyer', email: 'buyer@example.invalid' };
const merchant = { id: 'synthetic-merchant', email: 'merchant@example.invalid' };
const operator = { id: 'synthetic-operator', email: 'operator@example.invalid' };
const approver = { id: 'synthetic-purchase-approver', email: 'approver@example.invalid' };
const finance = { id: 'synthetic-finance', email: 'finance@example.invalid' };

export const advanceFixtureClock = () => vi.setSystemTime(Date.now() + 1000);

function proof(reference: string) {
  return { reference, sha256: pricingContentHash(reference), description: 'Synthetic fixture', documentRow: 1, occurredAt: new Date().toISOString() };
}

async function accept(id: string, rows: { id: string; quantity: number }[]) {
  const total = rows.reduce((sum, row) => sum + row.quantity * 100, 0);
  await prisma.$transaction(async tx => {
    const order = await tx.order.create({
      data: {
        id, customerId: buyer.id, email: buyer.email, subtotal: total, total, status: 'pending', paymentMethod: 'bank_transfer',
        orderItems: { create: rows.map((row, position) => ({
          ...row, position, productId, catalogNumber: 'SYNTH-CONTINUATION', name: 'Synthetic Product', unitPrice: 100,
        })) },
      },
      include: ORDER_APPROVAL_INCLUDE,
    });
    const preview = await merchantOrderApprovalPreview(tx, order);
    if (!preview) throw new Error('Missing merchant acceptance preview for fixture');
    await tx.order.update({ where: { id }, data: { status: 'confirmed', statusHistory: { create: {
      fromStatus: 'pending', toStatus: 'confirmed', actorId: merchant.id, actorEmail: merchant.email,
      metadata: merchantAcceptanceMetadata(preview),
    } } } });
    await reserveOrderCredit(tx, id, merchant.id);
    await reserveOrderInventory(tx, id, merchant.id);
  });
}

async function startPurchases() {
  await prisma.$transaction(tx => prepareOrderPurchases(tx, orderId, operator));
  for (const [orderItemId, quantity, supplier] of [
    [directLineId, 1, 'Synthetic Direct Supplier'],
    [relayLineId, 2, 'Synthetic Relay Supplier'],
  ] as const) {
    await prisma.$transaction(async tx => {
      const source = (await purchaseWorkspace(tx, orderId)).lines.find(line => line.orderItemId === orderItemId);
      if (!source) throw new Error('Missing fixture purchase requirement');
      await savePurchaseLine(tx, {
        orderId, orderItemId, revision: source.revision, checkedEvidence: true, terms: {
          supplier, writtenSupplier: supplier, payee: supplier, paymentTerms: 'Synthetic payment terms',
          unitPriceCents: 2500, linePayableCents: quantity * 2500, currency: 'CNY', taxBasis: 'included',
          freightTerms: 'Included', supplierConditions: 'Synthetic contract', leadTime: 'Three days',
          validUntil: new Date(Date.now() + 7 * 86400000).toISOString(),
          sourceReference: 'SYNTH-SUPPLY', sourceSha256: pricingContentHash(['contract', supplier]),
          settlementReference: 'SYNTH-SETTLEMENT', settlementSha256: pricingContentHash(['settlement', supplier]),
          coordinationReference: 'SYNTH-COORDINATION', leadTimeAssessment: 'within_agreement',
        },
      }, operator);
    });
  }

  const purchases = (await prisma.$transaction(tx => purchaseWorkspace(tx, orderId))).orders;
  for (const purchase of purchases) {
    await prisma.$transaction(async tx => {
      const input = { action: 'approve' as const, requestId: 'approve-' + purchase.id, orderId,
        purchaseOrderId: purchase.id, version: purchase.version };
      const { actionHash } = await previewPurchaseAction(tx, input, approver);
      await applyPurchaseAction(tx, { ...input, actionHash }, approver);
    });
    await prisma.$transaction(async tx => {
      const current = (await purchaseWorkspace(tx, orderId)).orders.find(item => item.id === purchase.id)!;
      advanceFixtureClock();
      const paper = proof('register-' + current.id);
      const input = { action: 'register_order' as const, requestId: paper.reference, orderId,
        purchaseOrderId: current.id, version: current.version, reference: paper.reference, referenceSha256: paper.sha256,
        occurredAt: paper.occurredAt };
      const { actionHash } = await previewPurchaseAction(tx, input, operator);
      await applyPurchaseAction(tx, { ...input, actionHash }, operator);
    });
  }
  const ordered = (await prisma.$transaction(tx => purchaseWorkspace(tx, orderId))).orders;
  return {
    direct: ordered.find(row => row.lines.some(line => line.orderItemId === directLineId))!.id,
    relay: ordered.find(row => row.lines.some(line => line.orderItemId === relayLineId))!.id,
  };
}

async function financeRecord(id: string, action: FinanceInput['action'], ref: string, data: FinanceInput['data']) {
  return prisma.$transaction(async tx => {
    const { version } = await financeWorkspace(tx, id);
    const input = { orderId: id, action, requestId: ref, version, data: { ...proof(ref), ...data } };
    const { actionHash } = await previewFinanceAction(tx, input, finance);
    await applyFinanceAction(tx, input, finance, actionHash, {
      action: 'admin_sensitive', permission: 'finance.write',
      sessionFingerprint: pricingContentHash(finance.id), verifiedAt: new Date().toISOString(),
    });
    return financeWorkspace(tx, id);
  });
}

async function bank(id: string, ref: string, receiptTotalCents: number) {
  const view = await financeRecord(id, 'verify_bank_receipt', ref, {
    documentKind: 'single_receipt', payer: 'SYNTHETIC-HIDDEN-PAYER', bankTrace: ref, receivingAccount: 'SYNTHETIC-HIDDEN-ACCOUNT', receiptTotalCents,
  });
  return view.banks.find(entry => entry.bankTrace === ref)!.id;
}

export function recordedAllocation(id: string, bankReceiptId: string, amountCents: number, ref: string) {
  return financeRecord(id, 'record_customer_receipt', ref, { bankReceiptId, amountCents, allocationReference: ref });
}

async function seedSupplierAccounting(purchaseOrderId: string) {
  const payee = 'Synthetic Direct Supplier';
  advanceFixtureClock();
  await prisma.$transaction(async tx => {
    const purchase = (await purchaseWorkspace(tx, orderId)).orders.find(item => item.id === purchaseOrderId)!;
    const input = {
      orderId, purchaseOrderId, version: purchase.version, action: 'record_payment' as const,
      requestId: 'synthetic-supplier-deposit', amountCents: 900, reference: 'synthetic-supplier-deposit',
      ...supplierPaymentProof('synthetic-supplier-deposit', payee),
      conditionReference: 'Synthetic separate supplier payment terms',
    };
    const { actionHash } = await previewPurchaseAction(tx, input, finance);
    await applyPurchaseAction(tx, { ...input, actionHash }, finance);
  });
  const invoice = { issuer: payee, recipient: 'Synthetic Seller', grossCents: 2500 };
  const plan = await financeRecord(orderId, 'create_plan', 'synthetic-supplier-invoice-plan', {
    ...invoice, side: 'supplier', trigger: 'accepted', purchaseOrderId,
  });
  const planId = plan.invoicePlans.find(item => item.purchaseOrderId === purchaseOrderId)!.id;
  await financeRecord(orderId, 'chase_invoice', 'synthetic-request-for-supplier-invoice', {
    planId, nextReviewAt: new Date(Date.now() + 86400000).toISOString(),
  });
  await financeRecord(orderId, 'record_invoice', 'synthetic-supplier-invoice-original', {
    ...invoice, planId, number: 'SYNTH-INVOICE-SUPPLIER-1', issuedAt: new Date().toISOString(), amountCents: 2500,
  });
}

async function saleCase(action: SaleInput['action'], ref: string, data: SaleInput['data'], caseId = '') {
  return prisma.$transaction(async tx => {
    const input = { orderId, action, requestId: ref, caseId, data: { ...proof(ref), note: 'Synthetic paperwork', ...data } };
    const permission = salePermission(input);
    const actor = permission === 'finance.write' ? finance : permission === 'purchases.approve' ? approver : operator;
    const { actionHash } = await afterSaleAction(tx, input, actor);
    return afterSaleAction(tx, input, actor, {
      hash: actionHash, authorization: {
        permission, sessionFingerprint: pricingContentHash(actor.id), verifiedAt: new Date().toISOString(),
      },
    });
  });
}

export async function approveFixtureRefund(caseId: string) {
  await saleCase('prepare_refund', 'prepare-synthetic-refund', { historyReview: 'Fixture cash and original line checked' }, caseId);
  return saleCase('approve_refund', 'approve-synthetic-refund', {}, caseId);
}

const carrier = 'Synthetic Carrier';
const directWaybill = 'SYNTH-DIRECT-WAYBILL';

export const siblingWaybill = 'SYNTH-SIBLING-WAYBILL';


export async function seedContinuationFixture() {
  for (const staff of [buyer, merchant, operator, approver, finance]) seedUser(getTestDb(), staff);
  await prisma.creditAccount.create({ data: { userId: buyer.id, baseLimit: 10_000, paymentTermDays: 30 } });
  await prisma.product.create({
    data: { id: productId, catalogNumber: 'SYNTH-CONTINUATION', name: 'Synthetic Product', brand: 'Synthetic Brand', price: 100, stockQuantity: -1 },
  });
  await prisma.$transaction(tx => receiveInventoryBatch(tx, { productId, batchNumber: 'SYNTH-PRIOR-STOCK', quantity: 20, actorId: operator.id }));
  await accept(orderId, [{ id: directLineId, quantity: 1 }, { id: relayLineId, quantity: 2 }]);
  await accept(secondOrderId, [{ id: 'synthetic-sibling-line', quantity: 3 }]);
  // A retained foreign carrier waybill is enough to exercise the ownership check.
  const siblingPaper = proof('synthetic-sibling-dispatch');
  await prisma.fulfillmentParcel.create({ data: {
    orderId: secondOrderId, route: 'legacy_customer', carrier, trackingNumber: siblingWaybill,
    status: 'dispatched', dispatchedAt: new Date(siblingPaper.occurredAt), reference: siblingPaper.reference,
    evidenceSha256: siblingPaper.sha256, evidenceRow: siblingPaper.documentRow, actorId: operator.id,
    requestKey: pricingContentHash(['request', siblingPaper.reference]), businessKey: pricingContentHash(['business', siblingPaper.reference]),
    contentHash: pricingContentHash(['content', siblingPaper.reference]),
    lines: { create: { orderItemId: 'synthetic-sibling-line', quantity: 1 } },
  } });
  const supplier = await startPurchases();

  const direct = await prisma.$transaction(tx => dispatchParcel(tx, orderId, {
    requestId: 'synthetic-direct', route: 'supplier_to_customer', ...proof('synthetic-direct'),
    carrier, trackingNumber: directWaybill, feedSource: 'synthetic-carrier-feed',
    lines: [{ purchaseOrderId: supplier.direct, orderItemId: directLineId, quantity: 1 }],
  }, operator));
  await prisma.$transaction(tx => receiveCarrierNotice(tx, 'synthetic-carrier-feed', {
    eventId: 'synthetic-carrier-direct', kind: 'carrier_delivered', ...proof('synthetic-direct-notice'),
    carrier, trackingNumber: directWaybill,
  }));

  const inbound = await prisma.$transaction(tx => dispatchParcel(tx, orderId, {
    requestId: 'synthetic-inbound', route: 'supplier_to_libereal', ...proof('synthetic-inbound'),
    carrier, trackingNumber: 'SYNTH-WAREHOUSE-WAYBILL',
    lines: [{ purchaseOrderId: supplier.relay, orderItemId: relayLineId, quantity: 2 }],
  }, operator));
  await prisma.$transaction(tx => recordParcelEvent(tx, orderId, inbound.id, {
    requestId: 'synthetic-first-receipt', kind: 'warehouse_receipt', ...proof('synthetic-first-receipt'),
    lines: [{ parcelLineId: inbound.lines[0].id, quantity: 1, batchNumber: 'SYNTH-ARRIVAL-A', productId }],
  }, operator));
  const receipt = await prisma.fulfillmentReceipt.findFirstOrThrow({ where: { parcelLineId: inbound.lines[0].id } });

  const bankReceiptId = await bank(orderId, 'SYNTH-BANK-PRIMARY', 20_000);
  await bank(secondOrderId, 'SYNTH-BANK-SIBLING', 5_000);
  await recordedAllocation(secondOrderId, bankReceiptId, 7_000, 'synthetic-sibling-allocation');
  await recordedAllocation(orderId, bankReceiptId, 8_000, 'synthetic-primary-allocation');
  const invoice = await financeRecord(orderId, 'create_plan', 'synthetic-customer-invoice-plan', {
    side: 'customer', trigger: 'accepted', issuer: 'Synthetic Issuer', recipient: 'Synthetic Recipient', grossCents: 10_000,
  });
  const invoicePlanId = invoice.invoicePlans.find(item => item.side === 'customer')!.id;
  await seedSupplierAccounting(supplier.direct);
  const { caseId } = await saleCase('open', 'open-synthetic-refund', {
    orderItemId: directLineId, quantity: 1, issue: 'other', channel: 'email', originalParcelLineId: direct.lines[0].id,
  });
  if (!caseId) throw new Error('Missing refund fixture');
  await saleCase('claim', 'claim-synthetic-refund', {}, caseId);
  await saleCase('agreement', 'agreement-synthetic-refund', {
    remedy: 'refund', amountCents: 5_000, recipient: 'SYNTHETIC-HIDDEN-REFUND-PARTY', destination: 'SYNTHETIC-HIDDEN-REFUND-ACCOUNT',
    method: 'bank', customerDecision: 'Synthetic buyer approved independent fixture check',
  }, caseId);
  return { supplier, direct, inbound, receipt, carrier, directWaybill, bankReceiptId, invoicePlanId, caseId };
}

export async function seedReturnFixture(direct: Awaited<ReturnType<typeof dispatchParcel>>, advance: () => void) {
  const parcelLineId = direct.lines[0].id;
  advance();
  const original = await prisma.fulfillmentParcelLine.findUniqueOrThrow({ where: { id: parcelLineId } });
  if (!original.receivedQuantity) await prisma.$transaction(tx => recordParcelEvent(tx, orderId, direct.id, {
    requestId: 'synthetic-signature', kind: 'customer_delivery', ...proof('synthetic-signature'), lines: [{ parcelLineId, quantity: 1 }],
  }, operator));
  const { caseId } = await saleCase('open', 'open-synthetic-return', {
    orderItemId: directLineId, quantity: 1, issue: 'return', channel: 'email', originalParcelLineId: parcelLineId,
  });
  if (!caseId) throw new Error('Missing return fixture');
  await saleCase('claim', 'claim-synthetic-return', {}, caseId);
  advance();
  await saleCase('agreement', 'agreement-synthetic-return', {
    remedy: 'return', customerDecision: 'Original parcel returned with verified evidence',
  }, caseId);
  advance();
  await prisma.$transaction(tx => recordParcelEvent(tx, orderId, direct.id, {
    requestId: 'synthetic-return-resolution', kind: 'confirm_shortfall', ...proof('synthetic-return-resolution'),
    supplierReference: 'SYNTH-SUPPLIER-RETURN', supplierSha256: pricingContentHash('seller-return'),
    customerReference: 'SYNTH-CUSTOMER-RETURN', customerSha256: pricingContentHash('buyer-return'),
    lines: [{ parcelLineId, quantity: 1, outcome: 'return' }],
  }, operator));
  const resolution = await prisma.fulfillmentLineResolution.findFirstOrThrow({ where: { parcelLineId, kind: 'return' } });
  return { caseId, parcelLineId, resolutionId: resolution.id };
}

export async function seedExchangeFixture(f: Awaited<ReturnType<typeof seedContinuationFixture>>) {
  const parcelLineId = f.direct.lines[0].id;
  advanceFixtureClock();
  await prisma.$transaction(tx => recordParcelEvent(tx, orderId, f.direct.id, {
    requestId: 'synthetic-exchange-original-signature', kind: 'customer_delivery', ...proof('synthetic-exchange-original-signature'),
    lines: [{ parcelLineId, quantity: 1 }],
  }, operator));
  const { caseId } = await saleCase('open', 'open-synthetic-exchange', {
    orderItemId: directLineId, quantity: 1, issue: 'quality', channel: 'email', originalParcelLineId: parcelLineId,
  });
  if (!caseId) throw new Error('Missing exchange fixture');
  await saleCase('claim', 'claim-synthetic-exchange', {}, caseId);
  await saleCase('technical', 'verified-synthetic-exchange-analysis', {
    authority: 'brand', party: 'Synthetic Brand', contact: 'Synthetic specialist',
  }, caseId);
  advanceFixtureClock();
  await saleCase('agreement', 'agreement-synthetic-exchange', {
    remedy: 'exchange', customerDecision: 'Written customer agreement for free exchange without return', returnRequirement: 'waived',
  }, caseId);
  const approval = await saleCase('approve_exchange', 'approved-synthetic-exchange', {
    supplier: 'Synthetic Direct Supplier', freeOfCharge: true, returnRequirement: 'waived',
  }, caseId);
  advanceFixtureClock();
  const replacement = await prisma.$transaction(tx => dispatchParcel(tx, orderId, {
    requestId: 'synthetic-replacement-dispatch', route: 'supplier_to_customer', ...proof('synthetic-replacement-dispatch'),
    lines: [{ purchaseOrderId: f.supplier.direct, orderItemId: directLineId, quantity: 1, afterSaleApprovalId: approval.eventId! }],
  }, operator));
  return { caseId, replacement, sign: async () => {
    advanceFixtureClock();
    return prisma.$transaction(tx => recordParcelEvent(tx, orderId, replacement.id, {
      requestId: 'synthetic-replacement-signed', kind: 'customer_delivery', ...proof('synthetic-replacement-signed'),
      lines: [{ parcelLineId: replacement.lines[0].id, quantity: 1 }],
    }, operator));
  } };
}
