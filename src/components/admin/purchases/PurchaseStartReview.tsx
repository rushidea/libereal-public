'use client';

import { useState } from 'react';
import type { PurchaseStartInput, previewPurchaseStartAction } from '@/lib/purchase-start';
import DocumentDigestField from './DocumentDigestField';
import { button, cents, field, money, primary, type Workspace } from './PurchaseLineForm';
import type { PurchaseRequest } from './PurchaseManager';

type Action = PurchaseStartInput['action'];
type Preview = Awaited<ReturnType<typeof previewPurchaseStartAction>>;
const actionLabels: Record<Action, string> = {
  verify_acceptance: '核验历史平台接单', review_customer_terms: '核对本单付款条件',
  record_customer_receipt: '核对实际到账与分摊', approve_credit_exception: '单独批准超授信例外',
};
const modes = { prepay: '全额预付', credit: '账期付款', partial_prepay: '部分预付与尾款' };

function TextField({ name, label }: { name: string; label: string }) {
  return <label className="grid gap-1 text-sm">{label}<input name={name} className={field} required maxLength={2000}/></label>;
}

export default function PurchaseStartReview({ review, permissions, busy, request, onError }: {
  review: Workspace['startReview']; permissions: string[]; busy: boolean; request: PurchaseRequest; onError: (message: string) => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [mode, setMode] = useState<'prepay' | 'credit' | 'partial_prepay'>(review.plan?.mode ?? 'credit');
  const [pending, setPending] = useState<{ input: PurchaseStartInput; preview: Preview } | null>(null);
  const finance = permissions.includes('finance.write');
  const allowed: Action[] = [];
  if (review.canVerifyAcceptance && permissions.includes('orders.write')) allowed.push('verify_acceptance');
  if (review.active && finance) {
    allowed.push('review_customer_terms');
    if (review.plan && review.outstandingCents > 0) allowed.push('record_customer_receipt');
    if (review.creditExceptionRequired) allowed.push('approve_credit_exception');
  }

  async function showPreview(form: FormData) {
    if (!action) return;
    try {
      const read = (name: string) => String(form.get(name) ?? '').trim() || undefined;
      const localTime = read('occurredAt');
      const input: PurchaseStartInput = {
        action, orderId: review.orderTerms.orderId, version: review.version, requestId: crypto.randomUUID(),
        reference: read('reference'), sha256: read('sha256'), description: read('description'), historyId: read('historyId'),
        originalActor: read('originalActor'), authorityReference: read('authorityReference'),
        occurredAt: localTime ? new Date(localTime).toISOString() : undefined,
        paymentMode: action === 'review_customer_terms' ? mode : undefined, balanceTerms: read('balanceTerms'),
        requiredPrepayCents: read('requiredPrepay') ? cents(read('requiredPrepay')!) : undefined,
        transactionReference: read('transactionReference'), allocationReference: read('allocationReference'), receiptKind: read('receiptKind'),
        receiptTotalCents: read('receiptTotal') ? cents(read('receiptTotal')!) : undefined,
        amountCents: read('allocatedAmount') ? cents(read('allocatedAmount')!) : undefined,
      };
      const result = await request({ ...input, stage: 'preview' });
      if (result?.preview && 'review' in result.preview.snapshot) setPending({ input, preview: result.preview as Preview });
    } catch (error) {
      onError(error instanceof Error ? error.message : '请核对填写内容');
    }
  }

  return <section className="space-y-3 rounded border border-slate-200 p-4" aria-label="本单采购启动条件">
    <h3 className="font-semibold">本单采购启动条件</h3>
    {review.acceptance && <p className="text-sm">平台接单凭据 {review.acceptance.id} · {review.acceptance.actor}
      {' · '}{new Date(review.acceptance.at).toLocaleString('zh-CN')}</p>}
    {review.plan && <p className="text-sm">{modes[review.plan.mode]} · 约定预付 {money(review.plan.requiredPrepayCents)}
      {' · '}已核实到账 {money(review.payment.receivedCents)} · 未收 {money(review.outstandingCents)}</p>}
    {review.credit && <p className="text-sm">授信应收 {money(review.credit.owedCents)} · 总占用 {money(review.credit.occupiedCents)}
      {' · '}当前可用总额度 {money(review.credit.limitCents)} · 账期 {review.credit.paymentTermDays} 天</p>}
    {review.plan?.balanceTerms && <p className="text-sm">余款条件 {review.plan.balanceTerms}</p>}
    {!pending && allowed.length > 0 && <div className="flex flex-wrap gap-2">{allowed.map(item =>
      <button key={item} type="button" className={button} disabled={busy} onClick={() => setAction(item)}>{actionLabels[item]}</button>)}</div>}
    {action && !pending && <form key={action} className="grid gap-3 border-t pt-3" onSubmit={event => {
      event.preventDefault();
      void showPreview(new FormData(event.currentTarget));
    }}>
      {action === 'verify_acceptance' && <>
        {review.history.length > 0 && <label className="grid gap-1 text-sm">对应的订单历史
          <select className={field} name="historyId"><option value="">独立平台档案</option>
            {review.history.map(row => <option key={row.id} value={row.id}>{row.actorEmail ?? row.actorId ?? '身份待核'} · {row.recordedAt}</option>)}
          </select>
        </label>}
        <TextField name="originalActor" label="原平台接单人"/>
        <TextField name="authorityReference" label="原经办人当时的平台授权依据"/>
        <label className="grid gap-1 text-sm">原平台接单时间（本地时间）<input name="occurredAt" type="datetime-local" step="1" required className={field}/></label>
      </>}
      {action === 'review_customer_terms' && <>
        <label className="grid gap-1 text-sm">本单约定付款方式
          <select className={field} value={mode} onChange={event => setMode(event.target.value as typeof mode)}>
            {Object.entries(modes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        {mode === 'partial_prepay' && <TextField name="requiredPrepay" label="约定预付款（元）"/>}
        {mode !== 'prepay' && <TextField name="balanceTerms" label="账期或尾款书面约定"/>}
      </>}
      {action === 'record_customer_receipt' && <>
        <label className="grid gap-1 text-sm">实际到账凭证类型<select name="receiptKind" className={field}>
          <option value="bank_receipt">银行到账回单</option><option value="platform_receipt">结算平台到账凭证</option>
        </select></label>
        <TextField name="transactionReference" label="银行或结算平台流水编号"/>
        <TextField name="allocationReference" label="本单分摊凭据编号"/>
        <TextField name="receiptTotal" label="该笔实际到账原额（元）"/>
        <TextField name="allocatedAmount" label="本次分给本单的实收金额（元）"/>
        <label className="grid gap-1 text-sm">实际到账时间（本地时间）<input name="occurredAt" type="datetime-local" step="1" required className={field}/></label>
      </>}
      <TextField name="reference" label="可回查的书面原件或档案出处"/>
      <DocumentDigestField name="sha256" label="书证摘要" required/>
      <TextField name="description" label="本次核对的事实与结论"/>
      <div className="flex gap-2"><button className={primary} disabled={busy}>查看核对预览</button>
        <button type="button" className={button} onClick={() => setAction(null)}>收起</button></div>
    </form>}
    {pending && <section aria-label="采购启动核对预览" className="space-y-2 rounded bg-slate-50 p-4 text-sm">
      <h4 className="font-semibold">{actionLabels[pending.input.action]}</h4>
      <p>客户订单 {pending.preview.snapshot.orderId} · 应付 {money(pending.preview.snapshot.review.principal)}</p>
      <ul>{pending.preview.snapshot.review.orderTerms.lines.map(line =>
        <li key={line.id}>{line.name} · {line.catalogNumber} · {line.quantity} {line.unit} · 单价 {money(Math.round(line.unitPrice * 100))}</li>)}</ul>
      <p>经办人 {pending.preview.snapshot.actor.email} · 档案出处 {pending.preview.snapshot.operation.reference}</p>
      {'amountCents' in pending.preview.snapshot.operation && <p>本单实收分摊 {money(pending.preview.snapshot.operation.amountCents)}</p>}
      <p>{pending.preview.snapshot.operation.description}</p>
      <details><summary>查看完整依据与版本</summary><pre className="overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(pending.preview.snapshot, null, 2)}</pre></details>
      <div className="flex gap-2"><button type="button" disabled={busy} className={primary} onClick={async () => {
        const result = await request({ ...pending.input, stage: 'confirm', actionHash: pending.preview.actionHash });
        if (result) { setPending(null); setAction(null); }
      }}>确认{actionLabels[pending.input.action]}</button>
      <button type="button" disabled={busy} className={button} onClick={() => setPending(null)}>返回核对</button></div>
    </section>}
  </section>;
}
