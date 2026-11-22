'use client';

import { useState } from 'react';
import type { PurchaseActionInput, previewPurchaseAction } from '@/lib/purchase-orders';
import type { PurchaseTerms } from '@/lib/purchase-terms';
import DocumentDigestField from './DocumentDigestField';
import type { PurchaseRequest } from './PurchaseManager';
import { actionNames, button, cents, field, LineDetails, money, primary, PurchaseLineFields, statuses, type Line, type Purchase } from './PurchaseLineForm';

type Action = PurchaseActionInput['action'];
type Preview = Awaited<ReturnType<typeof previewPurchaseAction>>;
type Alternative = { name: string; brand: string; catalogNumber: string; spec: string; unit: string; terms: PurchaseTerms };
type Intervention = { quantity: number; outcome: 'cancel' | 'replace'; replacement?: Alternative };
type Pending = { input: PurchaseActionInput; preview: Preview };

function inputField(name: string, label: string) {
  return <label className="grid gap-1 text-sm">{label}<input className={field} name={name} required maxLength={2000}/></label>;
}

function DispositionFields({ line, value, allowReplacement, onChange }: {
  line: Line; value: Intervention; allowReplacement: boolean; onChange: (value: Intervention) => void;
}) {
  const source = line.source;
  const alternative = value.replacement ?? {
    name: source.name, brand: source.brand ?? '', catalogNumber: source.catalogNumber ?? '',
    spec: source.spec ?? '', unit: source.unit ?? '', terms: {},
  };
  const alternativeFields = { name: '替代商品名称', brand: '替代商品品牌', catalogNumber: '替代商品货号', spec: '替代商品规格', unit: '替代计量单位' } as const;
  const replacing = allowReplacement && value.outcome === 'replace';

  return <fieldset className="grid gap-2 rounded border p-3">
    <legend>{source.name} · 原数量 {source.quantity}</legend>
    <label className="grid gap-1 text-sm">本次受影响数量
      <input className={field} type="number" min={0} max={source.quantity} step={1} value={value.quantity || ''}
        onChange={event => onChange({ ...value, quantity: Number(event.target.value) })}/>
    </label>
    {allowReplacement && <label className="grid gap-1 text-sm">本行处理方式
      <select className={field} value={value.outcome} onChange={event => onChange({
        ...value, outcome: event.target.value as Intervention['outcome'], replacement: alternative,
      })}><option value="cancel">取消受影响数量</option><option value="replace">另建替代采购</option></select>
    </label>}
    {replacing && value.quantity > 0 && <>
      {(Object.keys(alternativeFields) as Array<keyof typeof alternativeFields>).map(key =>
        <label key={key} className="grid gap-1 text-sm">{alternativeFields[key]}
          <input className={field} required value={alternative[key]} maxLength={2000}
            onChange={event => onChange({ ...value, replacement: { ...alternative, [key]: event.target.value } })}/>
        </label>)}
      <PurchaseLineFields line={{ source: { ...source, name: alternative.name, quantity: value.quantity } }}
        values={alternative.terms} onChange={terms => onChange({ ...value, replacement: { ...alternative, terms } })}/>
    </>}
  </fieldset>;
}

export default function PurchaseActions({ orderId, po, permissions, busy, request, onError }: {
  orderId: string; po: Purchase; permissions: string[]; busy: boolean; request: PurchaseRequest; onError: (message: string) => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [revisions, setRevisions] = useState<Record<string, PurchaseTerms>>({});
  const [dispositions, setDispositions] = useState<Record<string, Intervention>>({});
  const [outcome, setOutcome] = useState<PurchaseActionInput['outcome']>('original_terms');
  const committed = po.orderedBefore || po.paidCents > 0;
  const permit = (key: string) => permissions.includes(`purchases.${key}`);
  const choices: Action[] = [];
  if (po.status === 'draft' && !committed && permit('approve')) {
    if (po.lines.some(line => line.terms.leadTimeAssessment === 'exception_required') && !po.leadTimeApproved) choices.push('approve_lead_time');
    choices.push('approve');
  }
  if (po.status === 'approved' && !po.orderedBefore && permit('write')) choices.push('register_order');
  if (['approved', 'ordered'].includes(po.status) && po.paidCents < po.totalCents && permit('pay')) choices.push('record_payment');
  if (po.openIncidentId && permit(committed ? 'approve' : 'write')) choices.push('resolve_change');
  if (!po.openIncidentId && permit('write')) choices.push('report_change');

  async function preview(data: FormData) {
    if (!action) return;
    try {
      const value = (key: string) => String(data.get(key) ?? '').trim() || undefined;
      const occurredAt = value('occurredAt');
      const resolvable = action === 'resolve_change' && committed && (outcome === 'declined' || outcome === 'replacement');
      const input: PurchaseActionInput = {
        orderId, purchaseOrderId: po.id, action, version: po.version, requestId: crypto.randomUUID(),
        reference: value('reference'), referenceSha256: value('referenceSha256'),
        occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
        description: value('description'), conditionReference: value('conditionReference'),
        amountCents: action === 'record_payment' ? cents(String(data.get('amount') ?? '')) : undefined,
        changeKind: value('changeKind') as PurchaseActionInput['changeKind'], outcome: action === 'resolve_change' ? outcome : undefined,
        supplierReference: value('supplierReference'), supplierSha256: value('supplierSha256'),
        customerReference: value('customerReference'), customerSha256: value('customerSha256'), refundFollowup: value('refundFollowup'),
        revisedTerms: action === 'resolve_change' && outcome === 'revised_terms'
          ? po.lines.map(line => ({ orderItemId: line.orderItemId, terms: revisions[line.orderItemId] ?? line.terms })) : undefined,
        dispositions: resolvable ? Object.entries(dispositions).flatMap(([orderItemId, entry]) => !entry.quantity ? [] : [{
          orderItemId, ...entry, outcome: outcome === 'declined' ? 'cancel' : entry.outcome,
        }]) : undefined,
      };
      const result = await request({ ...input, stage: 'preview' });
      if (result?.preview && 'purchaseOrderId' in result.preview.snapshot) setPending({ input, preview: result.preview as Preview });
    } catch (error) {
      onError(error instanceof Error ? error.message : '请核对填写内容');
    }
  }

  const op = pending?.preview.snapshot.operation;
  const hasRefundReview = po.ledger.some(row => row.action === 'resolve_change'
    && (row.detail.snapshot as { operation?: { refund?: { status?: string } } } | undefined)?.operation?.refund?.status === 'pending_review');
  return <article className="space-y-3 rounded border border-slate-200 p-4">
    <div className="flex flex-wrap justify-between gap-2"><strong>{po.lines[0]?.terms.supplier}</strong>
      <span>{po.status === 'on_hold' && !po.openIncidentId ? '供货处理结果已登记' : statuses[po.status]}</span></div>
    <p className="break-all text-xs text-slate-600">{po.id} · 第 {po.revision} 版</p>
    {po.lines[0]?.fromPurchaseOrderId && <p className="break-all text-sm">替代采购 · 原采购单 {po.lines[0].fromPurchaseOrderId}</p>}
    <p className="text-sm">本单应付 <strong>{money(po.totalCents)}</strong>　已登记实际付款 {money(po.paidCents)}</p>
    {po.orderReceipt && <p className="text-sm">供应商实际订购 {po.orderReceipt.occurredAt
      ? new Date(po.orderReceipt.occurredAt).toLocaleString('zh-CN') : '时间待核实'}　登记时间 {new Date(po.orderReceipt.registeredAt).toLocaleString('zh-CN')}
      {' · '}{po.orderReceipt.reference}</p>}
    {hasRefundReview && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">原付款的退款安排待财务核对。</p>}
    <details><summary className="cursor-pointer text-sm">查看采购条款和操作记录</summary><div className="mt-3 space-y-3">
      {po.lines.map(line => <LineDetails key={line.orderItemId} line={line}/>)}
      <ol className="space-y-1 text-xs text-slate-700">{po.ledger.map(entry => <li key={entry.id}>
        {new Date(entry.createdAt).toLocaleString('zh-CN')} · {actionNames[entry.action as keyof typeof actionNames] ?? entry.action} · {entry.actorId}
        {entry.amountCents != null && ` · ${money(entry.amountCents)}`}
        <details><summary className="cursor-pointer">查看当时记录</summary><pre className="overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2">{JSON.stringify(entry.detail, null, 2)}</pre></details>
      </li>)}</ol></div></details>
    {!pending && <div className="flex flex-wrap gap-2">{choices.map(choice =>
      <button type="button" key={choice} className={button} disabled={busy} onClick={() => {
        setAction(choice); setOutcome('original_terms'); setRevisions({}); setDispositions({});
      }}>{actionNames[choice]}</button>)}</div>}
    {action && !pending && <form key={action} className="grid gap-3 border-t pt-3" onSubmit={event => {
      event.preventDefault();
      void preview(new FormData(event.currentTarget));
    }}>
      <strong className="text-sm">{actionNames[action]}</strong>
      {action === 'register_order' && <>
        {inputField('reference', '供应商已接受订购的单据或书面确认编号')}
        <label className="grid gap-1 text-sm">供应商实际确认订购时间（本地时间）
          <input className={field} type="datetime-local" step="1" name="occurredAt" required/>
        </label>
        <DocumentDigestField name="referenceSha256" label="实际订购凭据摘要" required/>
      </>}
      {action === 'approve_lead_time' && <>
        {inputField('reference', '超长订货周期的书面批准依据')}
        <DocumentDigestField name="referenceSha256" label="超长期书证摘要" required/>
        {inputField('description', '逐单例外批准结论')}
      </>}
      {action === 'record_payment' && <>
        {inputField('amount', '本次实际支付金额（元）')}
        {inputField('conditionReference', '本次付款条件已满足的依据')}
        {inputField('reference', '实际付款流水或银行凭证编号')}
      </>}
      {action === 'report_change' && <>
        <label className="grid gap-1 text-sm">变更类别<select className={field} name="changeKind">
          <option value="unavailable">缺货</option><option value="delay">延期</option><option value="price">涨价或调价</option><option value="other">其他</option>
        </select></label>
        {inputField('reference', '供应商反馈来源')}{inputField('description', '受影响的商品和具体变化')}
      </>}
      {action === 'resolve_change' && <>
        <label className="grid gap-1 text-sm">协调结果<select className={field} value={outcome}
          onChange={event => setOutcome(event.target.value as typeof outcome)}>
          <option value="original_terms">双方确认按原条款继续</option>
          {committed ? <option value="replacement">按书面确认另建替代采购</option>
            : <option value="revised_terms">双方同意修订，提交新版本独立审核</option>}
          <option value="declined">{committed ? '取消受影响数量' : '客户未同意，结束本次采购准备'}</option>
        </select></label>
        {inputField('supplierReference', '人工与供应商协调的书面依据')}
        {inputField('customerReference', '客户对方案的回复依据')}
        {committed && <>
          <DocumentDigestField name="supplierSha256" label="供方书面回复摘要" required/>
          <DocumentDigestField name="customerSha256" label="客户书面回复摘要" required/>
        </>}
        {inputField('description', '双方确认的具体结果')}
        {outcome === 'revised_terms' && po.lines.map(line => <PurchaseLineFields key={line.orderItemId} line={line}
          values={revisions[line.orderItemId] ?? line.terms} onChange={terms => setRevisions({ ...revisions, [line.orderItemId]: terms })}/>)}
        {committed && (outcome === 'declined' || outcome === 'replacement') && <>
          {po.lines.map(line => <DispositionFields key={line.orderItemId} line={line} allowReplacement={outcome === 'replacement'}
            value={dispositions[line.orderItemId] ?? { quantity: 0, outcome: 'cancel' }}
            onChange={entry => setDispositions({ ...dispositions, [line.orderItemId]: entry })}/>)}
          {po.paidCents > 0 && inputField('refundFollowup', '原付款与未决退款的后续核对安排')}
        </>}
      </>}
      <div className="flex gap-2"><button className={primary} disabled={busy}>查看完整预览</button>
        <button type="button" className={button} onClick={() => setAction(null)}>收起</button></div>
    </form>}
    {pending && op && <section aria-label="操作预览" className="space-y-3 rounded border border-slate-300 bg-slate-50 p-4">
      <h3 className="font-semibold">{actionNames[op.action]} · 操作预览</h3>
      <p className="text-sm">客户订单 {orderId}　采购单 {po.id}</p>
      {pending.preview.snapshot.lines.map(line => <LineDetails key={line.orderItemId} line={line}/>)}
      {'reference' in op && op.reference && <p>业务凭证　{op.reference}</p>}
      {op.action === 'register_order' && <p>供应商实际确认订购时间 {new Date(op.occurredAt).toLocaleString('zh-CN')}</p>}
      {op.action === 'record_payment' && <p>本次实际付款　<strong>{money(op.amountCents)}</strong> · 收款方 {po.lines[0].terms.payee} · 条件依据 {op.conditionReference}</p>}
      {op.action === 'report_change' && <p>供货变化　{op.description}</p>}
      {op.action === 'resolve_change' && <>
        <p>协调结果　{op.description}</p>
        <p>供应商依据　{op.supplierReference}</p><p>客户回复　{op.customerReference}</p>
        {op.revisedTerms?.map(edit => <div key={edit.orderItemId}><strong>拟修订条款</strong>
          <LineDetails line={{ source: po.lines.find(line => line.orderItemId === edit.orderItemId)!.source, terms: edit.terms }}/></div>)}
        {op.dispositions?.map(entry => <div key={entry.orderItemId}>
          <p>{entry.outcome === 'cancel' ? '取消' : '另建替代采购'} · 原订单行 {entry.orderItemId} · 数量 {entry.quantity}</p>
          {entry.replacement && <LineDetails line={entry.replacement}/>}
        </div>)}
        {op.refund && <p>原单已付 {money(op.refund.paidCents)} · 退款待核对 · {op.refund.followup}</p>}
      </>}
      <details><summary className="cursor-pointer text-xs">查看本次完整版本依据</summary>
        <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(pending.preview.snapshot, null, 2)}</pre></details>
      <div className="flex gap-2"><button type="button" disabled={busy} className={primary} onClick={async () => {
        const result = await request({ ...pending.input, stage: 'confirm', actionHash: pending.preview.actionHash });
        if (result) { setPending(null); setAction(null); }
      }}>确认{actionNames[op.action]}</button>
      <button type="button" disabled={busy} className={button} onClick={() => setPending(null)}>返回核对</button></div>
    </section>}
  </article>;
}
