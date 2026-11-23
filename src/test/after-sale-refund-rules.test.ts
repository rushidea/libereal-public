// @vitest-environment node

import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { SaleEvidence } from '@/lib/after-sale-records';
import { actualRefunded, refundStep } from '@/lib/after-sale-refunds';
import type { AfterSaleWorkspace, SaleCase } from '@/lib/after-sale-workspace';

vi.mock('@/lib/finance-workspace', () => ({
  financeWorkspace: async () => ({
    settlementCents: 20000, acceptanceId: 'original-order-accepted', authorityConflict: false,
    cash: [{ id: 'synthetic-original-payment', amountCents: 20000 }], nativePaymentId: null,
  }),
}));

const tx = {} as Prisma.TransactionClient;
const orderId = 'office-logic-only';
const itemId = 'office-folder-logic-only';
const permissionAt = new Date('2026-11-20T01:00:00.000Z');
const later = new Date('2026-11-21T01:00:00.000Z');
const evidence: SaleEvidence = { occurredAt: later.toISOString(), reference: 'pure-test-paper', sha256: 'a'.repeat(64), documentRow: 1 };
const agreement = { remedy: 'refund', amountCents: 6000, recipient: '合成收款人', destination: '合成目的地 4321', method: 'bank' };
const receipt = { result: 'paid', referenceNo: 'SYNTHETIC-LOGIC-ONLY', note: '仅验证规则，不登记款项',
  amountCents: agreement.amountCents, recipient: agreement.recipient, destination: agreement.destination, method: agreement.method };

function event(id: string, action: string, operation: object): SaleCase['events'][number] {
  return { id, caseId: 'case', action, actorId: 'synthetic-finance', requestKey: id, businessKey: id, intentHash: id,
    approvedHash: id, reference: id, sha256: evidence.sha256, documentRow: 1, occurredAt: permissionAt,
    createdAt: permissionAt, detail: JSON.stringify({ operation }) };
}

function item(customerState: string, events: SaleCase['events']): SaleCase {
  return { id: 'case', orderId, orderItemId: itemId, quantity: 1, relatedCents: null, issue: 'shortage', channel: 'email',
    report: '合成一件文件夹短失', reportedAt: permissionAt, sourceReference: 'source', sourceSha256: evidence.sha256, sourceRow: 1,
    sourceKey: 'source-key', shortfallId: null, createdBy: 'synthetic-member', ownerId: 'synthetic-finance',
    customerState, supplierState: 'following', revision: 3, createdAt: permissionAt, events };
}

function preview(row: SaleCase, action: string, input: Record<string, unknown>, proof = evidence) {
  const view: AfterSaleWorkspace = {
    order: { id: orderId, status: 'completed', total: 200, email: 'office@example.invalid', customerId: 'synthetic-member',
      organizationId: null, ownerScope: 'personal', acceptance: null, termsVersion: 'original-terms', pointsRefundedCash: 23 },
    lines: [{ id: itemId, name: '合成文件夹', catalogNumber: 'OFFICE-A4', brand: null, quantity: 2, unitPrice: 100 }],
    cases: [row], deliveries: [], shortfalls: [],
  };
  return refundStep(tx, view, row, action, input, proof);
}

const decision = event('written-customer-terms', 'agreement', agreement);
const prepared = event('finance-prepared', 'prepare_refund', { agreementId: decision.id, historicCheck: '外部凭据与积分旧账均已逐项核对' });
const approved = event('manual-approval', 'approve_refund', { ...agreement, agreementId: decision.id });

describe('售后退款规则仅计算预览，不连接数据库', () => {
  it('批准固定客户书证的金额、收款方、去向和原准备事件，同一批准不可接续改过的客户约定', async () => {
    const row = item('refund_prepared', [decision, prepared]);
    const plan = await preview(row, 'approve_refund', {
      note: '具名批准依据', amountCents: 1, recipient: '请求伪填收款方', destination: '请求伪填去向', method: 'other',
    });
    expect(plan).toMatchObject({
      customerState: 'refund_approved', operation: {
        amountCents: agreement.amountCents, recipient: agreement.recipient, destination: agreement.destination,
        method: 'bank', agreementId: decision.id, preparedId: prepared.id, position: { paidCents: 20000, originalPointsBasisYuan: 23 },
      },
    });
    const newDecision = event('changed-customer-terms', 'agreement', { ...agreement, recipient: '新书证收款方' });
    await expect(preview(item('refund_prepared', [decision, prepared, newDecision]), 'approve_refund', { note: '旧准备' }))
      .rejects.toThrow('客户同意的退款条件已变化');
    await expect(preview(item('awaiting_refund', [event('two-units-worth', 'agreement', { ...agreement, amountCents: 10001 })]),
      'prepare_refund', { note: '仅一件', historyReview: '合成核对' })).rejects.toThrow('原商品行范围');
  });

  it('实际回执必须晚于批准、绑定原批准收款条件，并受批准剩余金额限制', async () => {
    const row = item('refund_approved', [decision, approved]);
    await expect(preview(row, 'refund_result', receipt, { ...evidence, occurredAt: '2026-11-19T01:00:00.000Z' }))
      .rejects.toThrow('不能早于人工批准');
    for (const change of [{ recipient: '不同收款人' }, { destination: '不同到账去向' }, { method: 'alipay' }]) {
      await expect(preview(row, 'refund_result', { ...receipt, ...change })).rejects.toThrow('须与人工批准一致');
    }
    const partial = event('prior-amount', 'refund_result', { result: 'paid', amountCents: 2500 });
    await expect(preview(item('refund_approved', [decision, approved, partial]), 'refund_result', { ...receipt, amountCents: 3501 }))
      .rejects.toThrow('超出本次批准的剩余金额');
  });

  it('待处理或失败回执仍待办，只有实际成功累计足额才进入待办结', async () => {
    const history = [
      decision, approved,
      event('old-pending', 'refund_result', { result: 'pending', amountCents: 10000 }),
      event('old-failed', 'refund_result', { result: 'failed', amountCents: 10000 }),
    ];
    const row = item('refund_approved', history);
    expect(actualRefunded(row)).toBe(0);
    for (const result of ['pending', 'failed']) {
      expect(await preview(row, 'refund_result', { ...receipt, result })).toMatchObject({
        customerState: 'refund_approved', operation: { result, amountCents: 0, approvalId: approved.id, previouslyRecordedCents: 0 },
      });
    }
    expect(await preview(row, 'refund_result', { ...receipt, amountCents: 2500 })).toMatchObject({
      customerState: 'refund_approved', operation: { result: 'paid', amountCents: 2500, approvedCents: 6000 },
    });
    const partial = item('refund_approved', [...history, event('part-paid', 'refund_result', { result: 'paid', amountCents: 2500 })]);
    expect(actualRefunded(partial)).toBe(2500);
    expect(await preview(partial, 'refund_result', { ...receipt, amountCents: 3500 })).toMatchObject({
      customerState: 'awaiting_close', operation: { result: 'paid', amountCents: 3500, approvedCents: 6000, previouslyRecordedCents: 2500 },
    });
    expect(partial.events).toHaveLength(5);
  });
});
