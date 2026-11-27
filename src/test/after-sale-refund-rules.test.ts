// @vitest-environment node

import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { SaleEvidence } from '@/lib/after-sale-records';
import { allocateAfterSaleTransfer } from '@/lib/after-sale-transfers';
import { afterSalePaymentUses } from '@/lib/after-sale-payment-source';
import { actualRefunded, refundStep } from '@/lib/after-sale-refunds';
import type { AfterSaleWorkspace, SaleCase } from '@/lib/after-sale-workspace';

vi.mock('@/lib/finance-workspace', () => ({
  financeWorkspace: async () => ({
    settlementCents: 20000, acceptanceId: 'original-order-accepted', authorityConflict: false,
    cash: [{ id: 'synthetic-original-payment', amountCents: 20000 }], nativePaymentId: null,
  }),
}));

const tx = {
  afterSaleEvent: { findMany: async () => [] },
  paymentAttempt: { findFirst: async ({where}:{where:{id:string|object}}) => typeof where.id==='string' ? {
    id:where.id, status:'paid_superseded_reconciliation_required', amount:300, tradeNo:'SYNTHETIC-SEPARATE-B4-TRADE',
    outTradeNo:'SYNTHETIC-SEPARATE-B4-ATTEMPT', notifiedAt:new Date('2026-11-19T01:00:00.000Z'), paidAt:new Date('2026-11-19T01:00:00.000Z'),
    order:{customerId:'synthetic-member',organizationId:null,ownerScope:'personal',email:'office@example.invalid'},
  } : null },
  auditLog: { findMany: async () => [{id:'synthetic-signed-receipt',afterData:JSON.stringify({ tradeNo:'SYNTHETIC-SEPARATE-B4-TRADE',
    outTradeNo:'SYNTHETIC-SEPARATE-B4-ATTEMPT',amount:300,reason:'superseded_attempt_paid' })}] },
} as unknown as Prisma.TransactionClient;
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

function preview(row: SaleCase, action: string, input: Record<string, unknown>, proof = evidence, others: SaleCase[] = []) {
  const view: AfterSaleWorkspace = {
    order: { id: orderId, status: 'completed', total: 200, email: 'office@example.invalid', customerId: 'synthetic-member',
      organizationId: null, ownerScope: 'personal', acceptance: null, termsVersion: 'original-terms', pointsRefundedCash: 23 },
    lines: [{ id: itemId, name: '合成文件夹', catalogNumber: 'OFFICE-A4', brand: null, quantity: 2, unitPrice: 100 }],
    cases: [row,...others], deliveries: [], shortfalls: [], replacements: [], supplierParties:new Map(), resendShipments: [],
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

  it('独立验签实收按本交易已退与有效预留扣减，普通货款单独计上限',async()=>{
    const link=event('extra-reviewed','review_refund_source',{originalPayment:{paymentId:'extra-300'}});
    const previous=event('extra-previous-approved','approve_refund',{amountCents:10000});
    const paid=event('extra-prior-paid-part','refund_result',{result:'paid',amountCents:3000,approvalId:previous.id});
    const pending={...item('refund_approved',[link,previous,paid]),id:'other-in-progress'};
    const historic={...item('closed',[link,event('actual-earlier-simulated-refund','refund_result',{result:'paid',amountCents:2000})]),id:'older-case'};
    const old=[pending,historic];
    const data={note:'具名核对该独立流水的实际实付和在途指令',historyReview:'仅计算合成记录，不写数据库'};
    const apply=(amountCents:number)=>preview(item('awaiting_refund',[link,event('new-paper','agreement',{...agreement,amountCents})]),
      'prepare_refund',data,evidence,old);
    expect(await apply(18000)).toMatchObject({operation:{amountCents:18000,position:{
      originalPaymentId:'extra-300',paidCents:30000,usedCents:12000,caseGoodsCents:10000,independentReceipt:true}}});
    await expect(apply(18001)).rejects.toThrow('剩余实收款');
    expect(await preview(item('awaiting_refund',[event('normal-case','agreement',{...agreement,amountCents:10000})]),
      'prepare_refund',data,evidence,old)).toMatchObject({operation:{position:{independentReceipt:false,usedCents:0,paidCents:20000}}});
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

  it('保留实退额度，未决指令有书证结束后才可核准改付剩余款',async()=>{
    const partial=event('actual-first-part','refund_result',{result:'paid',amountCents:2500,approvalId:approved.id,referenceNo:'FIRST-REAL-RECEIPT'});
    const pending={...event('unresolved-instruction','refund_result',{
      result:'pending',amountCents:0,approvalId:approved.id,referenceNo:'OLD-INSTRUCTION'}),sha256:'b'.repeat(64)};
    const row=item('refund_approved',[decision,prepared,approved,partial,pending]);
    const stopped={result:'stopped',confirmStopped:true,referenceNo:'ORIGINAL-END-OF-INSTRUCTION',note:'合成规则检查'};
    await expect(preview(row,'stop_refund',stopped)).rejects.toThrow('所有已登记的未决指令');
    expect(await preview(row,'stop_refund',{...stopped,pendingResultIds:[pending.id]})).toMatchObject({
      customerState:'refund_followup',operation:{approvalId:approved.id,stoppedCents:3500,paidCents:2500,pendingResultIds:[pending.id]},
    });
    const revised=event('signed-new-destination','agreement',{...agreement,amountCents:3500,destination:'新书证核实去向'});
    const stop=event('checked-termination','stop_refund',{approvalId:approved.id,stoppedCents:3500});
    const awaiting=item('awaiting_refund',[...row.events,stop,revised]);
    expect(await preview(awaiting,'prepare_refund',{note:'新的准备',historyReview:'原已退及停止保留'})).toMatchObject({
      customerState:'refund_prepared',operation:{destination:'新书证核实去向',amountCents:3500,position:{recordedCents:2500}},
    });
    await expect(preview(awaiting,'refund_result',receipt)).rejects.toThrow('先取得本版退款批准');
    const preparedAgain=event('prepare-remaining','prepare_refund',{agreementId:revised.id,historicCheck:'复核已退与新账户'});
    const reapproved=event('approve-remaining','approve_refund',{...agreement,destination:'新书证核实去向',amountCents:3500,agreementId:revised.id});
    const final=item('refund_approved',[...awaiting.events,preparedAgain,reapproved]);
    expect(await preview(final,'refund_result',{...receipt,referenceNo:'ONLY-THE-NEW-PART',destination:'新书证核实去向',amountCents:3500})).toMatchObject({
      customerState:'awaiting_close',operation:{approvalId:reapproved.id,previouslyRecordedCents:2500,previouslyRecordedInApprovalCents:0},
    });
    expect(actualRefunded(final)).toBe(2500);
  });

  it.each(['customer_refund','supplier_return'] as const)('同一 %s 实际回单按原件和总额安全分摊',async direction=>{
    const terms={direction,method:'bank',party:'合成同一主体',destination:'同一个核实去向',referenceNo:'SYNTHETIC-TRANSFER'};
    const data={transferTotalCents:8000,allocationReference:'原件行对应明细 A'};
    const first=await allocateAfterSaleTransfer(tx,terms,data,evidence,3000);
    expect(first).toMatchObject({allocatedBeforeCents:0,unallocatedAfterCents:5000});
    const firstRow={...event('first-record',direction==='customer_refund'?'refund_result':'supplier',
      {result:'paid',outcome:'financial_result',amountCents:3000,referenceNo:terms.referenceNo,transfer:first}),occurredAt:new Date(evidence.occurredAt)};
    const sharedTx={afterSaleEvent:{findMany:async()=>[firstRow]}} as unknown as Prisma.TransactionClient;
    expect(await allocateAfterSaleTransfer(sharedTx,terms,{...data,allocationReference:'原件行对应明细 B'},evidence,4000))
      .toMatchObject({allocatedBeforeCents:3000,unallocatedAfterCents:1000});
    await expect(allocateAfterSaleTransfer(sharedTx,terms,data,evidence,100)).rejects.toThrow('分摊依据已登记');
    await expect(allocateAfterSaleTransfer(sharedTx,terms,{...data,allocationReference:'相邻明细'},evidence,5001)).rejects.toThrow('真实交易总额');
    await expect(allocateAfterSaleTransfer(sharedTx,{...terms,referenceNo:'SAME-PAPER-ALIAS'},{...data,allocationReference:'明细 C'},evidence,5000))
      .rejects.toThrow('已有记录');
    await expect(allocateAfterSaleTransfer(sharedTx,{...terms,destination:'另一个账户'},{...data,allocationReference:'明细 D'},evidence,1000))
      .rejects.toThrow('已有记录');
  });

  it('从同一原到账的具名结果计算实际退款，待办和失败回执没有实退金额', async()=>{
    const checked=event('verified-payment','review_refund_source',{originalPayment:{paymentId:'original-alipay',amountCents:4000}});
    const paid=event('paid-original-payment','refund_result',{sourcePaymentId:'original-alipay',amountCents:4000,result:'paid'});
    const unrelated=event('not-original','refund_result',{sourcePaymentId:'different',amountCents:4000,result:'paid'});
    const pending=event('payment-pending','refund_result',{sourcePaymentId:'original-alipay',amountCents:4000,result:'pending'});
    const buffer={afterSaleEvent:{findMany:async()=>[checked,unrelated,pending]}} as unknown as Prisma.TransactionClient;
    expect((await afterSalePaymentUses(buffer,orderId)).get('original-alipay')).toMatchObject({
      reviewId:checked.id,receivedCents:4000,paidCents:0});
    const finished={afterSaleEvent:{findMany:async()=>[checked,unrelated,pending,paid]}} as unknown as Prisma.TransactionClient;
    expect((await afterSalePaymentUses(finished,orderId)).get('original-alipay')).toMatchObject({
      reviewId:checked.id,receivedCents:4000,paidCents:4000});
  });

});
