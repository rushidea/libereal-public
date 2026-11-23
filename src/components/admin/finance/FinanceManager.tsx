'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminMfaStepUp } from '@/components/admin/AdminMfaStepUpDialog';
import { button, field, money } from '@/components/admin/purchases/PurchaseLineForm';
import type { FinanceInput } from '@/lib/finance-actions';
import type { FinanceWorkspace } from '@/lib/finance-workspace';
import { isOrderStatus, ORDER_STATUS_LABELS } from '@/lib/order-domain';
import FinanceForm, { actionLabels, dateLabel, invoiceStateLabels, paymentCaseProgressLabels, triggerLabels } from './FinanceForm';
import FinancePreview, { type FinancePreviewResult } from './FinancePreview';

type OrderRow = { id: string; status: string; amount: number; receivableStatus: string | null; supplierCount: number;
  attention: { supplierDifferences: number; invoiceFollowups: number } | null };
const arLabel: Record<string, string> = { open: '待回款', overdue: '逾期未结', paid: '已结清', cancelled: '已取消' };
const orderLabel = (status: string) => isOrderStatus(status) ? ORDER_STATUS_LABELS[status] : status;
const heading = 'text-base font-semibold text-slate-900';

export default function FinanceManager({ initialOrder }: { initialOrder: string }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState<FinanceWorkspace | null>(null);
  const [list, setList] = useState<OrderRow[]>([]);
  const [canWrite, setCanWrite] = useState(false);
  const [action, setAction] = useState<FinanceInput['action'] | null>(null);
  const [pending, setPending] = useState<{ input: FinanceInput; preview: FinancePreviewResult } | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const generation = useRef(0);
  const selected = useRef('');
  const { begin, dialog } = useAdminMfaStepUp();

  const load = useCallback(async (orderId: string, { search = '', attention = false, signal }:
    { search?: string; attention?: boolean; signal?: AbortSignal } = {}) => {
    const id = ++generation.current;
    selected.current = orderId;
    if (!orderId) setAttentionOnly(attention);
    setBusy(true); setLoaded(false); setError(''); setMessage(''); setView(null); setList([]); setPending(null); setAction(null); setCanWrite(false);
    try {
      const params = new URLSearchParams(orderId ? { orderId } : { search });
      if (!orderId && attention) params.set('attention', '1');
      const response = await fetch('/api/admin/finance?' + params, { cache: 'no-store', signal });
      const body = await response.json();
      if (generation.current !== id || signal?.aborted) return;
      if (!response.ok) throw new Error(response.status === 403 ? '当前账号没有财务查看权限' : body.error || '账务读取失败');
      setCanWrite(body.canWrite === true); setView(body.workspace ?? null); setList(body.orders ?? []); setLoaded(true);
    } catch (err) { if (generation.current === id && !signal?.aborted) setError(err instanceof Error ? err.message : '账务读取失败'); }
    finally { if (generation.current === id && !signal?.aborted) setBusy(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) void load(initialOrder, { signal: controller.signal }); });
    return () => controller.abort();
  }, [initialOrder, load]);

  async function send(input: FinanceInput, approval?: { hash: string; token: string }) {
    if (selected.current !== input.orderId) return;
    const id = generation.current;
    setError(''); setMessage(''); setBusy(true);
    try {
      const response = await fetch('/api/admin/finance', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, stage: approval ? 'confirm' : 'preview', actionHash: approval?.hash, stepUpToken: approval?.token }) });
      const body = await response.json();
      if (generation.current !== id) return;
      if (!response.ok) throw new Error(body.error || '票款登记未完成');
      if (approval) {
        setView(body.workspace); setAction(null); setPending(null); setMessage('已登记 · ' + body.eventId);
      } else setPending({ input, preview: body.preview });
    } catch (err) { if (generation.current === id) setError(err instanceof Error ? err.message : '请刷新原单核对登记结果'); }
    finally { if (generation.current === id) setBusy(false); }
  }

  const actions: FinanceInput['action'][] = [];
  if (view && canWrite) {
    if (!view.archived && !['closed','cancelled'].includes(view.status)) actions.push('verify_bank_receipt');
    if (view.acceptanceId && view.banks.some(row => row.availableCents > 0) && !view.authorityConflict
      && !view.paidAt && (view.postingOutstandingCents ?? 0) > 0) actions.push('record_customer_receipt');
    if (view.postingPrincipal && view.acceptanceId && view.receipts.some(row => row.counted && !view.cash.some(post => post.bankAllocationId === row.id))
      || view.nativePaymentId && !view.cash.some(post => post.paymentAttemptId === view.nativePaymentId)) actions.push('post_existing');
    if (view.receivable?.needsPrincipalReview && view.acceptanceId && !view.archived && !['closed','cancelled'].includes(view.status)) actions.push('verify_receivable_principal');
    if (view.receivable && ['open', 'overdue'].includes(view.receivable.status) && view.acceptanceId) {
      if (!view.receivable.termStartedAt && !view.receivable.dueAt) actions.push('restore_term');
      actions.push('set_term');
    }
    if (view.acceptanceId || view.purchases.length) actions.push('create_plan');
    const active = view.invoicePlans.filter(row => !row.closed);
    if (active.some(row => row.remainingCents > 0)) actions.push('record_invoice', 'amend_plan', 'close_plan');
    if (active.some(row => row.trigger === 'manual' && !row.manualAt)) actions.push('confirm_condition');
    if (active.some(row => row.side === 'supplier' && row.remainingCents > 0)) actions.push('chase_invoice');
    if (view.invoicePlans.some(row => row.allocations.some(a => a.status === 'recorded'))) actions.push('open_correction');
    if (view.invoicePlans.some(row => row.allocations.some(a => a.status === 'correction_pending'))) actions.push('resolve_correction');
    if (view.purchases.length) actions.push('reconcile_supplier');
    const cases = [...view.latePayments, ...view.receipts.filter(row => !row.counted && !row.reconciled)];
    if (cases.some(row => !row.review)) actions.push('review_payment_case');
    if (cases.some(row => row.review)) actions.push('update_payment_case');
    if (view.latePayments.some(row => row.status === 'paid_stock_shortfall_reconciliation_required' && row.tradeNo)) actions.push('resume_alipay_payment');
  }
  return <main className="mx-auto max-w-6xl space-y-5 p-4 text-slate-800 md:p-6">
    <h1 className="text-2xl font-semibold">票款与对账</h1>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => {
      event.preventDefault(); void load('', { search: query, attention: attentionOnly });
    }}>
      <label className="grid gap-1 text-sm">订单、客户邮箱、采购单或发票号<input className={field} value={query} onChange={e => setQuery(e.target.value)}/></label>
      <button className={button} disabled={busy}>查找</button>
      <button type="button" className={button} disabled={busy} onClick={() => {
        setQuery(''); void load('', { attention: view ? true : !attentionOnly });
      }}>{attentionOnly && !view ? '查看全部票款' : '供方差异与到期追票'}</button>
      {view && <button type="button" className={button} disabled={busy} onClick={() => void load(view.orderId)}>刷新原单</button>}
    </form>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {message && <p role="status" className="text-emerald-800">{message}</p>}
    {busy && <p role="status">正在核对账务记录…</p>}
    {loaded && !view && (list.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr><th>客户订单</th><th>履约状态</th><th>订单金额</th><th>应收</th>{attentionOnly && <th>待办</th>}</tr></thead><tbody>{list.map(row =>
        <tr key={row.id} className="border-t"><td className="py-2"><button className="font-medium underline" onClick={() => void load(row.id)}>{row.id}</button></td>
          <td>{orderLabel(row.status)}</td><td>{money(Math.round(row.amount * 100))}</td><td>{arLabel[row.receivableStatus ?? ''] ?? '另按订单核对'}</td>
          {attentionOnly && <td>{row.attention?.supplierDifferences ? `供方差异 ${row.attention.supplierDifferences} 项` : ''}
            {row.attention?.invoiceFollowups ? ` 到期追票 ${row.attention.invoiceFollowups} 项` : ''}</td>}</tr>)}</tbody></table></div>
      : <p>{attentionOnly ? '没有待跟进的供方差异或到期追票。' : '未找到对应票款记录。'}</p>)}
    {view && <><section className="space-y-2 rounded border border-slate-200 p-4">
      <h2 className={heading}>客户订单 {view.orderId}</h2>
      <p>{view.customerEmail} · {orderLabel(view.status)} · 订单金额 {money(view.principalCents)}</p>
      <p>已核销或平台确认 {money(view.settlementCents)} · 已核验可归属 {money(view.verifiedCents)}
        {view.receivable && ' · 应收余额 ' + money(view.receivable.outstandingCents)}</p>
      {view.receivable && <p>账期 {view.receivable.terms} 天 · 起算 {dateLabel(view.receivable.termStartedAt)} · 到期 {dateLabel(view.receivable.dueAt)}</p>}
      {view.receivable?.needsPrincipalReview && <p>保留原应收余额。订单面额待财务核对后再核销。</p>}
      {view.postingPrincipal?.reviewId && <p>原应收金额已核对 {money(view.postingPrincipal.cents)} · 核对记录 {view.postingPrincipal.reviewId}</p>}
      {view.receivable?.needsTermReview && <p>旧账期的起算日期与平台接单日期不同，请核对本单书面约定。</p>}
      <p>平台接单 {dateLabel(view.acceptedAt)} · 客户已签收 {dateLabel(view.shipmentDates.delivered)}</p>
      {view.authorityConflict && <p role="alert">到账来源有重叠，须由财务核对原件。</p>}
      {view.nativePaymentId && <p>支付宝原生交易 {view.nativePaymentId}</p>}
      {view.latePayments.map(row => <div key={row.id} className="text-sm">
        <p>平台到账待核对 · {row.outTradeNo} · {money(row.amountCents)}{row.tradeNo && ' · 支付宝流水 ' + row.tradeNo}</p>
        {row.review && <p>跟进负责人 {row.review.ownerId} · {paymentCaseProgressLabels[String(row.review.lastRecord.operation.outcome)] ?? '已领取待核对'}</p>}
      </div>)}
      {!view.acceptanceId && view.banks.length > 0 && <p>银行回单已留存。核销前请在采购页补齐平台接单依据。</p>}
    </section>
    {view.banks.length > 0 && <section aria-label="客户银行回款" className="space-y-2"><h2 className={heading}>客户银行回款</h2>
      {view.banks.map(bank => <p key={bank.id}>{bank.bankTrace} · {bank.payer} · 到账 {money(bank.totalCents)} · 尚可分配 {money(bank.availableCents)}</p>)}
      {view.cash.map(post => <p key={post.id}>本单核销 {money(post.amountCents)} · 释放授信 {money(post.releasedCents)} · {post.id}</p>)}</section>}
    {view.purchases.length > 0 && <section aria-label="采购付款与来票" className="space-y-3"><h2 className={heading}>采购付款与来票</h2>
      {view.purchases.map(po => <article key={po.id} className="space-y-1 rounded border border-slate-200 p-3 text-sm">
        <h3 className="font-semibold">{po.supplier ?? '供方须核对'} · {po.id}</h3>
        <p>收款方 {po.payees.join('、')} · 原采购 {money(po.originalCents)} · 已登记付款 {money(po.paidCents)} · 余款 {money(po.dueCents ?? undefined)}</p>
        <p>有效来票 {money(po.invoicedCents)} · 更正中 {money(po.underCorrectionCents)} · 待收票 {money(po.pendingInvoiceCents ?? undefined)} · {po.reconciled ? '已记录本版对账结果' : '待对账'}</p>
        {po.supplierFollowup && <p>供方差异待跟进 · 经办人 {po.supplierFollowup.actorId} · {String(po.supplierFollowup.reference)}</p>}
        {po.paymentExceptions.filter(row => row.pending).map(row => <p key={row.id}>付款待核对 {money(row.original.amountCents)}
          {' · 原流水 ' + row.original.paymentEvidence.bankTrace + ' · 负责人 ' + row.ownerId} · {row.followup?.operation.description ?? row.original.description}</p>)}
        {po.payments.map(row => <p key={row.id}>付款凭据 {row.reference} · {money(row.amountCents)} · 实际付款 {dateLabel(row.occurredAt)}
          {' · 原登记 ' + dateLabel(row.recordedAt)}{row.reviewedBy && ' · 补核人 ' + row.reviewedBy}</p>)}
      </article>)}</section>}
    {view.invoicePlans.length > 0 && <section aria-label="发票安排与原件" className="space-y-2"><h2 className={heading}>发票安排与原件</h2>
      {view.invoicePlans.map(plan => <article key={plan.id} className="space-y-1 rounded border border-slate-200 p-3 text-sm">
        <h3 className="font-semibold">{plan.side === 'customer' ? '客户开票' : '供应商来票'} · {plan.reference}{plan.closed && ' · 已关闭'}</h3>
        <p>{plan.issuer} 开给 {plan.recipient} · 原安排 {money(plan.grossCents)} · 已占用 {money(plan.usedCents)}
          {' · 尚可办理 ' + money(plan.remainingCents)} · {triggerLabels[plan.trigger]}</p>
        {plan.effectiveAt && <p>约定生效 {dateLabel(plan.effectiveAt)}</p>}
        <p>经办人 {plan.ownerId}</p>
        {!plan.closed && plan.remainingCents > 0 && plan.lastFollowup && <p>下次追票 {dateLabel(String(plan.lastFollowup.operation.nextReviewAt))}
          {' · 跟进人 ' + plan.lastFollowup.actorId}</p>}
        {plan.allocations.map(doc => <p key={doc.id}>票号 {doc.number} · {invoiceStateLabels[doc.status]} · 票面 {money(doc.grossCents)} · 本项 {money(doc.amountCents)}</p>)}
      </article>)}</section>}
    {actions.length > 0 && !action && <section className="space-y-2"><h2 className={heading}>办理事项</h2><div className="flex flex-wrap gap-2">
      {actions.map(key => <button key={key} className={button} disabled={busy} onClick={() => { setError(''); setMessage(''); setAction(key); }}>{actionLabels[key]}</button>)}</div></section>}
    {action && !pending && <FinanceForm key={view.version + action} view={view} action={action} busy={busy} onError={setError}
      onCancel={() => setAction(null)} onPreview={input => send(input)}/>}
    {pending && <FinancePreview preview={pending.preview} busy={busy} onBack={() => setPending(null)} onConfirm={() => {
      const current = pending;
      void begin(async token => { await send(current.input, { token, hash: current.preview.actionHash }); });
    }}/>}
    {view.events.length > 0 && <section className="space-y-2"><h2 className={heading}>办理记录</h2><ol className="space-y-2 text-sm">{view.events.map(event =>
      <li key={event.id} className="border-t pt-2"><strong>{actionLabels[event.action as FinanceInput['action']] ?? event.action}</strong> · {dateLabel(event.occurredAt)} · {event.actorId}
        <p>{String(event.operation.description ?? '')} · {String(event.operation.reference ?? '')}</p></li>)}</ol></section>}</>}
    {dialog}
  </main>;
}
