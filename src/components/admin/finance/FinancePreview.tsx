'use client';

import type { previewFinanceAction } from '@/lib/finance-actions';
import { button, money, primary } from '@/components/admin/purchases/PurchaseLineForm';
import { actionLabels, dateLabel, paymentCaseProgressLabels, triggerLabels } from './FinanceForm';

export type FinancePreviewResult = Awaited<ReturnType<typeof previewFinanceAction>>;

export default function FinancePreview({ preview, busy, onConfirm, onBack }: {
  preview: FinancePreviewResult; busy: boolean; onConfirm: () => void; onBack: () => void;
}) {
  const { snapshot } = preview;
  const op = snapshot.operation;
  return <section aria-label="票款操作预览" className="space-y-2 rounded border border-slate-300 bg-slate-50 p-4 text-sm">
    <h3 className="text-base font-semibold">{actionLabels[op.action]}</h3>
    <p>订单 {snapshot.orderId} · 经办人 {snapshot.actor.email}</p>
    {op.action === 'create_plan' && <><p>{op.side === 'customer' ? '客户开票' : '供应商来票'} · {op.issuer} 开给 {op.recipient}</p>
      <p>含税金额 {money(op.grossCents)} · 办理条件 {triggerLabels[op.trigger]} {op.purchaseOrderId && ' · ' + op.purchaseOrderId}</p></>}
    {op.action === 'amend_plan' && <><p>原安排 {money(op.original.grossCents)} · 已占用 {money(op.original.usedCents)}
      {' · 原条件剩余 ' + money(op.original.remainingCents - op.amountCents)}</p>
      <p>本次按新条件办理 {money(op.amountCents)} · {triggerLabels[op.trigger]}</p></>}
    {op.action === 'close_plan' && <p>本次止用的未开或未收金额 {money(op.stoppedCents)}</p>}
    {op.action === 'record_invoice' && <><p>票号 {op.number} · {op.issuer} 开给 {op.recipient}</p>
      <p>票面 {money(op.grossCents)} · 已分 {money(op.allocatedBeforeCents)} · 本次归入 {money(op.amountCents)}</p>
      <p>开票时间 {dateLabel(op.issuedAt)} · 约定条件达成 {dateLabel(op.readyAt)}</p></>}
    {op.action === 'verify_bank_receipt' && <><p>付款人 {op.bank.payer} · 收款账户 {op.bank.receivingAccount}</p>
      <p>流水 {op.bank.bankTrace} · 到账 {money(op.bank.receiptTotalCents)} · {dateLabel(op.bank.occurredAt)}</p></>}
    {op.action === 'record_customer_receipt' && <><p>银行流水 {op.bank.bankTrace} · 分摊编号 {op.allocationReference}</p>
      <p>原额 {money(op.receiptTotalCents)} · 此前已分 {money(op.allocatedBeforeCents)} · 本次 {money(op.amountCents)}</p></>}
    {'accounting' in op && <p>本次核销 {money(op.accounting.amountCents)} · 本单余款 {money(op.accounting.remainingCents)} · 本次释放授信 {money(op.accounting.releaseCents)}</p>}
    {(op.action === 'restore_term' || op.action === 'set_term') && <p>原到期 {dateLabel(op.before.dueAt)} · 起算 {dateLabel(op.startedAt)} · {op.days} 天 · 到期 {dateLabel(op.dueAt)}</p>}
    {op.action === 'resume_alipay_payment' && <>
      <p>原支付宝流水 {op.payment.tradeNo} · {money(op.payment.amountCents)} · 平台回执时间 {dateLabel(op.payment.receivedAt)}</p>
      <p>确认时核对原订单可售库存及付款状态。</p>
      <ul>{op.payment.lines.map(row => <li key={row.id}>{row.name} · {row.quantity} 件</li>)}</ul>
    </>}
    {op.action === 'reconcile_supplier' && <><p>采购单 {op.purchase.id} · 供方 {op.purchase.supplier} · 收款方 {op.purchase.payees.join('、')}</p>
      <p>原采购 {money(op.purchase.originalCents)} · 已付 {money(op.purchase.paidCents)} · 余款 {money(op.purchase.dueCents ?? undefined)} · 有效来票 {money(op.purchase.invoicedCents)}</p>
      <ul>{op.purchase.payments.map(row => <li key={row.id}>付款凭据 {row.reference} · {money(row.amountCents)}</li>)}
        {op.purchase.invoices.map(row => <li key={row.allocationId}>发票登记 {row.id} · {money(row.amountCents)}</li>)}</ul>
      <p>{op.outcome === 'matched' ? '登记本次核对一致' : '差异交由本次经办人跟进'}</p></>}
    {(op.action === 'open_correction' || op.action === 'resolve_correction') && <><p>原票 {op.originalNumber} · {op.outcome === 'voided' ? '实际整张红冲或作废' : op.outcome === 'retained' ? '原票继续有效' : '交财务核实更正结果'}</p>
      <ul>{op.affected.map(row => <li key={row.planId}>受影响订单 {row.orderId} · {money(row.amountCents)}</li>)}</ul></>}
    {(op.action === 'review_payment_case' || op.action === 'update_payment_case') && <>
      <p>原交易 {op.source.kind === 'alipay' ? op.source.outTradeNo : op.sourceId} · {money(op.source.amountCents)}</p>
      {op.source.kind === 'alipay' && op.source.tradeNo && <p>支付宝流水 {op.source.tradeNo}</p>}
      <p>跟进负责人 {op.ownerId} · {op.action === 'update_payment_case' ? paymentCaseProgressLabels[op.outcome] : '到账差异待核对'}</p>
    </>}
    {'planId' in op && <p>发票安排 {op.planId}</p>}
    {'occurredAt' in op && <p>实际办理 {dateLabel(op.occurredAt)}</p>}
    {'nextReviewAt' in op && op.nextReviewAt && <p>下次跟进 {dateLabel(op.nextReviewAt)}</p>}
    <p>{op.description}</p><p className="break-all">依据 {op.reference} · {op.sha256}</p>
    <details><summary className="cursor-pointer">查看完整记录和版本</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(snapshot, null, 2)}</pre></details>
    <div className="flex gap-2"><button className={primary} disabled={busy} onClick={onConfirm}>确认{actionLabels[op.action]}</button>
      <button className={button} disabled={busy} onClick={onBack}>返回核对</button></div>
  </section>;
}
