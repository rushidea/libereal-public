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
      <p>含税金额 {money(op.grossCents)} · 办理条件 {triggerLabels[op.trigger]} {op.purchaseOrderId && ' · ' + op.purchaseOrderId}</p>
      {op.invoiceEvidence && <><p>原书证 {op.invoiceEvidence.reference}{op.invoiceEvidence.documentRow && ' · 第 ' + op.invoiceEvidence.documentRow + ' 行'}
        {' · 生效 ' + dateLabel(op.invoiceEvidence.occurredAt)
          + (op.invoiceEvidence.sharesCumulativeLimit ? ' · 共享额度可安排 ' : ' · 本份增额可安排 ')
          + money(op.invoiceEvidence.remainingCents ?? undefined)}</p>
        <p>{op.invoiceEvidence.lines.map(line => line.name + ' ' + line.quantity + ' 件').join('、')}</p></>}
    </>}
    {op.action === 'amend_plan' && <><p>原安排 {money(op.original.grossCents)} · 已占用 {money(op.original.usedCents)}
      {' · 生效后原条件尚余 ' + money(op.retainedCents)}</p>
      <p>本次按新条件办理 {money(op.amountCents)} · {triggerLabels[op.trigger]} · 生效 {dateLabel(op.effectiveAt)}</p>
      {op.retroactiveReference && <p>书面追溯条款 {op.retroactiveReference}</p>}</>}
    {op.action === 'close_plan' && <p>本次止用的未开或未收金额 {money(op.stoppedCents)}</p>}
    {op.action === 'verify_invoice_coverage' && <p>
      {op.subject.invoiceNumber ? '原票 ' + op.subject.invoiceNumber + ' · ' + dateLabel(op.subject.issuedAt) : '原安排未开金额'}
      {' ' + money(op.amountCents) + ' · 原书证 ' + op.subject.originalReference + ' · 原安排 ' + op.subject.planReference}
    </p>}
    {op.action === 'record_invoice' && <><p>票号 {op.number} · {op.issuer} 开给 {op.recipient}</p>
      <p>票面 {money(op.grossCents)} · 已分 {money(op.allocatedBeforeCents)} · 本次归入 {money(op.amountCents)}</p>
      <p>开票时间 {dateLabel(op.issuedAt)} · 约定条件达成 {dateLabel(op.readyAt)}</p>
      {op.invoiceAuthority && <p>票面日期适用的累计额度 {money(op.invoiceAuthority.authorizedCents ?? undefined)}
        {' · 书证生效 ' + dateLabel(op.invoiceAuthority.at)}</p>}
      {op.adjustedPlans?.map(row => <p key={row.planId}>同一原安排 {row.reference} · 原可用 {money(row.previousCents)} · 回填后额度 {money(row.effectiveCents)}</p>)}
    </>}
    {(op.action === 'verify_invoice_coverage' || op.action === 'record_invoice') && op.portions && <ul>
      {op.portions.map(part => <li key={part.invoiceScopeId}>{part.proof.reference} · {dateLabel(part.proof.occurredAt)} · {money(part.amountCents)}
        {' · ' + part.lines.map(line => (line.name ?? line.orderItemId) + ' ' + line.quantity + ' 件').join('、')}</li>)}
    </ul>}
    {op.action === 'verify_bank_receipt' && <><p>付款人 {op.bank.payer} · 收款账户 {op.bank.receivingAccount}</p>
      <p>流水 {op.bank.bankTrace} · 到账 {money(op.bank.receiptTotalCents)} · {dateLabel(op.bank.occurredAt)}</p></>}
    {op.action === 'record_customer_receipt' && <><p>银行流水 {op.bank.bankTrace} · 分摊编号 {op.allocationReference}</p>
      <p>原额 {money(op.receiptTotalCents)} · 此前已分 {money(op.allocatedBeforeCents)} · 本次 {money(op.amountCents)}</p></>}
    {'accounting' in op && <p>本次核销 {money(op.accounting.amountCents)} · 本单余款 {money(op.accounting.remainingCents)} · 本次释放授信 {money(op.accounting.releaseCents)}</p>}
    {'accounting' in op && op.accounting.creditReservationUnverified && <p>原授信预占凭据待核对。本次仅核销应收。</p>}
    {op.action === 'verify_receivable_principal' && <p>原应收 {op.receivableId} · 原书证金额 {money(op.amountCents)} · 订单面额 {money(op.orderFaceCents)}</p>}
    {op.action === 'verify_customer_invoice_scope' && <>
      <p>{op.issuer} 开给 {op.recipient} · {op.scopeChange
        ? '原接单记录 ' + op.acceptanceId
        : '书证可开含税金额 ' + money(op.grossCents) + ' · 原接单记录 ' + op.acceptanceId}</p>
      {op.scopeChange && <><p>原累计可开 {money(op.scopeChange.beforeCents ?? undefined)}
        {op.scopeChange.deltaCents !== null && (' · 本次' + (op.scopeChange.deltaCents >= 0 ? '增加 ' : '调减 ')
          + money(Math.abs(op.scopeChange.deltaCents)))}
        {' · 新累计可开 ' + money(op.scopeChange.afterCents ?? undefined)}</p>
        {op.scopeChange.effectiveAt && <p>该书证适用时间 {dateLabel(op.scopeChange.effectiveAt)}
          {' · 当前累计可开 ' + money(op.scopeChange.currentCents ?? undefined)}</p>}
        {op.scopeChange.afterCents === null && <p>本次原件登记后需要具名核对该时点的开票书证。</p>}
        {op.scopeChange.mode === 'clarify' && <p>澄清依据确认的原件 {op.scopeChange.confirmedEvidenceIds.join('、')}</p>}
        {op.scopeChange.invoiceConflicts?.map(row => <p key={row.id}>待核原票 {row.number} · 票面日期 {dateLabel(row.issuedAt)}</p>)}
        <p>已开及更正中 {money(op.scopeChange.issuedCents)} · 已占额度 {money(op.scopeChange.plannedCents)}
          {' · 尚可安排 ' + money(op.scopeChange.availableCents ?? undefined)}</p></>}
      {op.documentRow && <p>本次核对原件第 {op.documentRow} 行</p>}
      <ul>{op.lines.map(line => <li key={line.id}>{line.name} · {line.quantity} 件</li>)}</ul>
    </>}
    {(op.action === 'restore_term' || op.action === 'set_term') && <p>原到期 {dateLabel(op.before.dueAt)} · 起算 {dateLabel(op.startedAt)} · {op.days} 天 · 到期 {dateLabel(op.dueAt)}</p>}
    {op.action === 'resume_alipay_payment' && <>
      <p>原支付宝流水 {op.payment.tradeNo} · {money(op.payment.amountCents)} · 平台回执时间 {dateLabel(op.payment.receivedAt)}</p>
      {op.payment.providerPaidAt && <p>支付宝原付款时间 {dateLabel(op.payment.providerPaidAt)}</p>}
      {op.payment.cancellationRequest && <p>本次一并核对原取消或移除申请 {op.payment.cancellationRequest.id} · {dateLabel(op.payment.cancellationRequest.recordedAt)}</p>}
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
