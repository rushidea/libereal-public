'use client';

import { useState } from 'react';
import type { PurchaseActionInput, previewPurchaseAction } from '@/lib/purchase-orders';
import type { PurchaseTerms } from '@/lib/purchase-terms';
import DocumentDigestField from './DocumentDigestField';
import type { PurchaseRequest } from './PurchaseManager';
import { actionNames, button, cents, field, LineDetails, money, primary, PurchaseLineFields, statuses, type Line, type Purchase, type Workspace } from './PurchaseLineForm';

type Action = PurchaseActionInput['action'];
type Preview = Awaited<ReturnType<typeof previewPurchaseAction>>;
type Alternative = { name: string; brand: string; catalogNumber: string; spec: string; unit: string; terms: PurchaseTerms };
type Intervention = { quantity: number; outcome: 'cancel' | 'replace'; replacement?: Alternative; forwardingLossId?: string };
type Pending = { input: PurchaseActionInput; preview: Preview };

function inputField(name: string, label: string) {
  return <label className="grid gap-1 text-sm">{label}<input className={field} name={name} required maxLength={2000}/></label>;
}

function DispositionFields({ line, quantity, losses, value, allowReplacement, onChange }: {
  line: Pick<Line, 'source'>; quantity: number; losses: Workspace['fulfillment']['forwardingShortfalls'];
  value: Intervention; allowReplacement: boolean; onChange: (value: Intervention) => void;
}) {
  const source = line.source;
  const alternative = value.replacement ?? {
    name: source.name, brand: source.brand ?? '', catalogNumber: source.catalogNumber ?? '',
    spec: source.spec ?? '', unit: source.unit ?? '', terms: {},
  };
  const alternativeFields = { name: '替代商品名称', brand: '替代商品品牌', catalogNumber: '替代商品货号', spec: '替代商品规格', unit: '替代计量单位' } as const;
  const replacing = allowReplacement && value.outcome === 'replace';
  const selectedLoss = losses.find(row => row.resolutionId === value.forwardingLossId);
  const limit = selectedLoss?.available ?? quantity;

  return <fieldset className="grid gap-2 rounded border p-3">
    <legend>{source.name} · 原数量 {source.quantity} · 尚未供货 {quantity}</legend>
    {!!losses.length && allowReplacement && <label className="grid gap-1 text-sm">本次另购依据
      <select className={field} value={value.forwardingLossId ?? ''}
        onChange={event => onChange({ ...value, quantity: 0, outcome: event.target.value ? 'replace' : 'cancel',
          forwardingLossId: event.target.value || undefined, replacement: alternative })}>
        <option value="">原采购尚未供货</option>
        {losses.map(row => <option value={row.resolutionId} key={row.resolutionId}>核实转发短失 · 可补 {row.available} · {row.resolutionId}</option>)}
      </select>
    </label>}
    <label className="grid gap-1 text-sm">本次受影响数量
      <input className={field} type="number" min={0} max={limit} step={1} value={value.quantity || ''}
        onChange={event => onChange({ ...value, quantity: Number(event.target.value) })}/>
    </label>
    {allowReplacement && !selectedLoss && <label className="grid gap-1 text-sm">本行处理方式
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

const exceptionResults = {
  supplier_cancelled: '供方已书面确认取消', supplier_resolution_pending: '仍需与供方协调', liability_review: '费用或责任待核',
} as const;

function legacyTerms(line: Purchase['lines'][number]): PurchaseTerms {
  const reply = line.source.written;
  if (!reply || line.terms.sourceReference !== reply.reference) return line.terms;
  return { writtenSupplier: reply.supplier, supplierConditions: reply.conditions, sourceSha256: reply.replyHash, ...line.terms };
}

export default function PurchaseActions({ orderId, orderStatus, cancellation, po, fulfillment, permissions, busy, request, onError }: {
  orderId: string; orderStatus: string; cancellation: Workspace['cancellation']; po: Purchase;
  fulfillment: Workspace['fulfillment'];
  permissions: string[]; busy: boolean; request: PurchaseRequest; onError: (message: string) => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [revisions, setRevisions] = useState<Record<string, PurchaseTerms>>({});
  const [dispositions, setDispositions] = useState<Record<string, Intervention>>({});
  const [fileKinds, setFileKinds] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<PurchaseActionInput['outcome']>('original_terms');
  const committed = po.orderedBefore || po.paidCents > 0 || po.commitmentExceptions.length > 0;
  const supplierCancelled = po.commitmentState === 'supplier_cancelled';
  const canContinueOriginal = !supplierCancelled && !po.needsRemainingReview;
  const openExceptions = po.commitmentExceptions.filter(row => !row.resolution);
  const legacyFiles = [...new Set(po.documentReviewLines.map(row => row.sha256))];
  const closed = orderStatus === 'cancelled' || orderStatus === 'closed';
  const archiveTerms = (line: Purchase['lines'][number]) => revisions[line.orderItemId] ?? legacyTerms(line);
  const lineFor = (id: string) => po.lines.find(line => line.orderItemId === id)!;
  const permit = (key: string) => permissions.includes(`purchases.${key}`);
  const choices: Action[] = [];
  if (!closed && po.status === 'draft' && !committed && permit('approve')) {
    if (po.lines.some(line => line.terms.leadTimeAssessment === 'exception_required') && !po.leadTimeApproved) choices.push('approve_lead_time');
    choices.push('approve');
  }
  if (po.needsLegacyReview && permit('approve')) choices.push('review_legacy_approval');
  if (po.needsFundingReapproval && permit('approve')) choices.push('reapprove_purchase');
  if (po.canApproveRemaining && permit('approve')) choices.push('approve_remaining');
  if (po.canRegisterOrder && permit('write')) choices.push('register_order');
  if (po.canRecordCommitmentException && permit('approve')) choices.push('record_late_order_exception');
  if (openExceptions.length && permit('approve')) choices.push('resolve_order_exception');
  if (['approved', 'ordered'].includes(po.status) && !po.needsLegacyReview && !po.needsFundingReapproval && (!closed || po.orderedBefore)
    && po.dueCents !== null && Math.min(po.dueCents, po.totalCents - po.paidCents) > 0 && permit('pay')) choices.push('record_payment');
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
        revisedTerms: action === 'review_legacy_approval' ? po.lines.map(line => ({ orderItemId: line.orderItemId, terms: archiveTerms(line) }))
          : action === 'resolve_change' && outcome === 'revised_terms'
            ? po.lines.map(line => ({ orderItemId: line.orderItemId, terms: revisions[line.orderItemId] ?? line.terms })) : undefined,
        dispositions: resolvable ? Object.entries(dispositions).flatMap(([orderItemId, entry]) => !entry.quantity ? [] : [{
          orderItemId, ...entry, outcome: outcome === 'declined' ? 'cancel' : entry.outcome,
        }]) : undefined,
        paymentReference: value('paymentReference'), paymentSha256: value('paymentSha256'),
        leadTimeReference: value('leadTimeReference'), leadTimeSha256: value('leadTimeSha256'),
        remainingLines: action === 'approve_remaining' ? po.remaining.map(line => ({
          orderItemId: line.orderItemId, payableCents: cents(value(`payable-${line.orderItemId}`) ?? '', true),
        })) : undefined,
        appliedPaidCents: action === 'approve_remaining' && po.paidCents > 0 ? cents(value('appliedPaid') ?? '', true) : undefined,
        exceptionOutcome: value('exceptionOutcome') as PurchaseActionInput['exceptionOutcome'],
        exceptionId: value('exceptionId'), exceptionResolution: value('exceptionResolution') as PurchaseActionInput['exceptionResolution'],
        documentScopes: action === 'reapprove_purchase' && po.documentReviewLines.length ? po.documentReviewLines.map(row => ({
          orderItemId: row.orderItemId, sha256: value(`document-${row.sha256}`), kind: fileKinds[row.sha256],
          row: fileKinds[row.sha256] === 'multiple_items' ? Number(value(`document-row-${row.orderItemId}`)) : undefined,
        })) : undefined,
      };
      const result = await request({ ...input, stage: 'preview' });
      if (result?.preview && 'purchaseOrderId' in result.preview.snapshot) setPending({ input, preview: result.preview as Preview });
    } catch (error) {
      onError(error instanceof Error ? error.message : '请核对填写内容');
    }
  }

  const op = pending?.preview.snapshot.operation;
  const hasRefundReview = po.ledger.some(row => (row.action === 'resolve_change' || row.action === 'resolve_order_exception')
    && (row.detail.snapshot as { operation?: { refund?: { status?: string } } } | undefined)?.operation?.refund?.status === 'pending_review');
  return <article className="space-y-3 rounded border border-slate-200 p-4">
    <div className="flex flex-wrap justify-between gap-2"><strong>{po.lines[0]?.terms.supplier}</strong>
      <span>{supplierCancelled ? '供方整笔取消' : po.status === 'on_hold' && !po.openIncidentId ? '采购暂停' : statuses[po.status]}</span></div>
    <p className="break-all text-xs text-slate-600">{po.id} · 第 {po.revision} 版</p>
    {po.lines[0]?.fromPurchaseOrderId && <p className="break-all text-sm">替代采购 · 原采购单 {po.lines[0].fromPurchaseOrderId}</p>}
    <p className="text-sm">{po.remainingScope || po.dueCents === null ? '原合同应付' : '本单应付'} <strong>{money(po.totalCents)}</strong>　已登记实际付款 {money(po.paidCents)}</p>
    {po.remainingScope && <p className="text-sm">核准的剩余商品应付 {money(po.remainingScope.totalCents)} · 经核实冲抵 {money(po.remainingScope.appliedPaidCents)} · 尚未付 {money(po.dueCents ?? undefined)}</p>}
    {po.needsRemainingReview && <p className="text-sm text-amber-900">{openExceptions.length
      ? '核对实际承诺后，再逐行核准原单剩余应付。'
      : '部分商品已取消或转替代采购，须逐行核准原单剩余应付。'}</p>}
    {supplierCancelled && !closed && <p className="text-sm">如仍需交付，请凭双方书面回复登记供货变化，另建采购并独立批准。</p>}
    {po.needsLegacyReview && <p className="text-sm text-amber-900">继续登记前须复核原批准、书证和已付凭据。</p>}
    {po.needsFundingReapproval && <p className="text-sm text-amber-900">客户付款条件已变化。后续动作需重新核准，已实际发生的订购按原有效期补录。</p>}
    {cancellation && <p className="text-sm">客户订单{cancellation.status === 'closed' ? '关闭' : '取消'}时间 {new Date(cancellation.occurredAt).toLocaleString('zh-CN')}</p>}
    {po.orderReceipt && <p className="text-sm">{po.orderReceipt.exception ? '已核对的异常订购' : '供应商实际订购'} {po.orderReceipt.occurredAt
      ? new Date(po.orderReceipt.occurredAt).toLocaleString('zh-CN') : '时间待核实'}　登记时间 {new Date(po.orderReceipt.registeredAt).toLocaleString('zh-CN')}
      {' · '}{po.orderReceipt.reference}</p>}
    {po.orderReceipt && po.orderReceipt.lines.length > 0 && <ul className="text-sm">
      {po.orderReceipt.lines.map(line => <li key={line.orderItemId}>{line.name} · 实际订购 {line.quantity} {line.unit ?? '件'} · {money(line.payableCents)}</li>)}
    </ul>}
    {po.commitmentExceptions.map(exception => <p key={exception.id} className="rounded bg-amber-50 p-2 text-sm text-amber-900">
      实际承诺 {exception.reference} · {new Date(exception.occurredAt).toLocaleString('zh-CN')} · 责任人 {exception.actorId}
      {' · '}{exception.resolution === 'payable_verified' ? '已核对原合同应付' : exception.resolution === 'supplier_cancelled' ? '供方取消结果已核对' : '承诺异常待处理'}
      {exception.resolutionActorId && ` · 核对人 ${exception.resolutionActorId}`}
    </p>)}
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
        setAction(choice); setOutcome(canContinueOriginal ? 'original_terms' : 'declined'); setRevisions({}); setDispositions({}); setFileKinds({});
      }}>{choice === 'register_order' && po.status === 'on_hold' ? '补录暂停前实际订购' : actionNames[choice]}</button>)}</div>}
    {action && !pending && <form key={action} className="grid gap-3 border-t pt-3" onSubmit={event => {
      event.preventDefault();
      void preview(new FormData(event.currentTarget));
    }}>
      <strong className="text-sm">{actionNames[action]}</strong>
      {(action === 'register_order' || action === 'record_late_order_exception') && <>
        {action === 'register_order' && po.status === 'on_hold' && <p className="text-sm">采购仍处于暂停。请按供方原件填写实际发生时间。</p>}
        {inputField('reference', action === 'register_order' ? '供应商已接受订购的单据或书面确认编号' : '实际订购及处理结果的书面出处')}
        <label className="grid gap-1 text-sm">供应商实际确认订购时间（本地时间）
          <input className={field} type="datetime-local" step="1" name="occurredAt" required/>
        </label>
        <DocumentDigestField name="referenceSha256" label="实际订购凭据摘要" required/>
      </>}
      {action === 'reapprove_purchase' && <>
        {legacyFiles.map(sha256 => <fieldset key={sha256} className="space-y-3 rounded border p-3">
          <legend>核对原供货文件</legend>
          <p className="text-sm">原件出处 {po.documentReviewLines.find(row => row.sha256 === sha256)?.reference}</p>
          <p className="text-sm">按原件标明本单采用的报价行。原件列有多项报价时，即使本单只采用一项，也请填写该项的原件行号。</p>
          <DocumentDigestField name={`document-${sha256}`} label="旧供货原件摘要" required/>
          <label className="grid gap-1 text-sm">原供货文件范围<select className={field} value={fileKinds[sha256] ?? ''} required
            onChange={event => setFileKinds(current => ({ ...current, [sha256]: event.target.value }))}>
            <option value="">请选择核对结果</option><option value="single_item">单项报价</option><option value="multiple_items">列明多项报价</option>
          </select></label>
          {po.documentReviewLines.filter(row => row.sha256 === sha256).map(row => {
            const line = lineFor(row.orderItemId);
            return <div key={row.orderItemId} className="space-y-1 text-sm">
              <p>{line.source.name} · {[line.source.brand, line.source.catalogNumber, line.source.spec].filter(Boolean).join(' · ')} · 数量 {line.source.quantity} · 单价 {money(line.terms.unitPriceCents)}</p>
              {fileKinds[sha256] === 'multiple_items' && <label className="grid gap-1">{line.source.catalogNumber ?? line.source.name} 对应原件行序号
                <input name={`document-row-${row.orderItemId}`} type="number" min={1} step={1} className={field} required/>
              </label>}
            </div>;
          })}
        </fieldset>)}
        {inputField('reference', '客户付款条件变动的档案出处')}
        <DocumentDigestField name="referenceSha256" label="新批准依据摘要" required/>
        {inputField('description', '本次重新批准的后续动作与旧款归属')}
      </>}
      {action === 'record_late_order_exception' && <>
        <label className="grid gap-1 text-sm">异常处理结果<select name="exceptionOutcome" className={field} required>
          <option value="">请选择</option>{Object.entries(exceptionResults).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        {inputField('description', '异常处理结果和后续责任')}
      </>}
      {action === 'resolve_order_exception' && <>
        <label className="grid gap-1 text-sm">待核对的实际承诺<select name="exceptionId" className={field} required>
          {openExceptions.map(row => <option key={row.id} value={row.id}>{row.reference} · {row.actorId}</option>)}
        </select></label>
        <label className="grid gap-1 text-sm">核对结果<select name="exceptionResolution" className={field} required>
          <option value="">请选择</option><option value="supplier_cancelled">已核实供方整笔取消</option><option value="payable_verified">已核实原合同应付</option>
        </select></label>
        {inputField('reference', '供方书面处理结果及原合同应付核对依据')}
        <DocumentDigestField name="referenceSha256" label="异常处理结果书证摘要" required/>
        {inputField('description', '核对结果及已付款、退款或取消费用的后续安排')}
      </>}
      {action === 'review_legacy_approval' && <>
        {inputField('reference', '原采购授权的档案出处')}
        <DocumentDigestField name="referenceSha256" label="原采购授权书证摘要" required/>
        {po.paidCents > 0 && <>{inputField('paymentReference', '已付款凭证的档案出处')}
          <DocumentDigestField name="paymentSha256" label="已付款凭证摘要" required/></>}
        {po.lines.map(line => <div key={line.orderItemId} className="space-y-3 rounded border p-3">
          <LineDetails line={line}/><PurchaseLineFields line={line} values={archiveTerms(line)} lockedTerms={line.terms}
            onChange={terms => setRevisions(current => ({ ...current, [line.orderItemId]: terms }))}/>
        </div>)}
        {po.lines.some(line => archiveTerms(line).leadTimeAssessment === 'exception_required') && <>
          {inputField('leadTimeReference', '原超长交期的独立批准依据')}
          <DocumentDigestField name="leadTimeSha256" label="原超长交期批准书证摘要" required/>
        </>}
        {inputField('description', '核对原授权、付款及本次接续结果')}
      </>}
      {action === 'approve_remaining' && <>
        {po.remaining.map(line => <div key={line.orderItemId} className="space-y-2 rounded border p-3">
          <p className="text-sm">{lineFor(line.orderItemId).source.name} · 剩余 {line.quantity} {lineFor(line.orderItemId).source.unit ?? '件'}</p>
          {inputField(`payable-${line.orderItemId}`, '本行核实应付（元）')}
        </div>)}
        {po.paidCents > 0 && inputField('appliedPaid', '已付款中确认抵扣剩余应付的金额（元，可填 0）')}
        {inputField('reference', '供方确认剩余行金额及付款归属的书面依据')}
        <DocumentDigestField name="referenceSha256" label="剩余应付确认书证摘要" required/>
        {inputField('description', '逐行应付和原付款归属核对结果')}
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
          onChange={event => { setOutcome(event.target.value as typeof outcome); setDispositions({}); }}>
          {canContinueOriginal && <option value="original_terms">双方确认按原条款继续</option>}
          {committed ? (!closed && <option value="replacement">按书面确认另建替代采购</option>)
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
          {po.remaining.flatMap(line => {
            const sent = fulfillment.supplierDispatched.filter(row => row.purchaseOrderId === po.id && row.orderItemId === line.orderItemId)
              .reduce((sum,row) => sum + row.quantity,0);
            const quantity = Math.max(0,line.quantity-sent);
            const losses = outcome === 'replacement' ? fulfillment.forwardingShortfalls.filter(row =>
              row.purchaseOrderId === po.id && row.orderItemId === line.orderItemId && row.available > 0) : [];
            return quantity || losses.length ? [<DispositionFields key={line.orderItemId} line={lineFor(line.orderItemId)}
              quantity={quantity} losses={losses} allowReplacement={outcome === 'replacement'}
              value={dispositions[line.orderItemId] ?? { quantity: 0, outcome: 'cancel' }}
              onChange={entry => setDispositions({ ...dispositions, [line.orderItemId]: entry })}/>] : [];
          })}
          {po.paidCents > 0 && Object.values(dispositions).some(row => row.quantity > 0 && !row.forwardingLossId)
            && inputField('refundFollowup', '原付款与未决退款的后续核对安排')}
        </>}
      </>}
      <div className="flex gap-2"><button className={primary} disabled={busy}>查看完整预览</button>
        <button type="button" className={button} onClick={() => setAction(null)}>收起</button></div>
    </form>}
    {pending && op && <section aria-label="操作预览" className="space-y-3 rounded border border-slate-300 bg-slate-50 p-4">
      <h3 className="font-semibold">{actionNames[op.action]} · 操作预览</h3>
      <p className="text-sm">客户订单 {orderId}　采购单 {po.id}</p>
      {op.action === 'register_order' && op.execution && <p className="text-sm font-medium">原合同明细</p>}
      {pending.preview.snapshot.lines.map(line => <LineDetails key={line.orderItemId} line={line}/>)}
      {'reference' in op && op.reference && <p>业务凭证　{op.reference}</p>}
      {op.action === 'register_order' && <p>供应商实际确认订购时间 {new Date(op.occurredAt).toLocaleString('zh-CN')}</p>}
      {op.action === 'register_order' && op.execution && <div className="space-y-1 text-sm">
        <p>适用批准 {op.execution.approvalId} · 订购应付 {money(op.execution.totalCents)}</p>
        {op.execution.lines.map(line => <p key={line.orderItemId}>{line.source.name} · 订购 {line.quantity} {line.source.unit ?? '件'} · 应付 {money(line.payableCents)}</p>)}
        {op.priorCancellation && <p>该笔实际订购早于客户取消时间 {new Date(op.priorCancellation.occurredAt).toLocaleString('zh-CN')}</p>}
      </div>}
      {op.action === 'record_late_order_exception' && <div className="space-y-1 text-sm">
        <p>实际发生于 {new Date(op.occurredAt).toLocaleString('zh-CN')} · {exceptionResults[op.exceptionOutcome]}</p>
        {op.category === 'credit' && <p>{op.credit.status === 'unproven' ? '承诺时的授信依据或先后待核实' : '承诺时授信不满足原采购批准条件'}</p>}
        <p>责任人 {op.responsibleActor} · {op.description}</p>
      </div>}
      {op.action === 'resolve_order_exception' && <div className="space-y-1 text-sm">
        <p>核对 {op.resolution === 'payable_verified' ? '原合同应付' : '供方整笔取消'} · 责任人 {op.responsibleActor} · {op.description}</p>
        {op.remainingReviewPending && <p>部分商品的取消或替代已登记，剩余应付还需逐行核准。</p>}
        {op.refund && <p>原单已付 {money(op.refund.paidCents)} · 退款待财务核对</p>}
      </div>}
      {op.action === 'review_legacy_approval' && <div className="space-y-2 text-sm">
        <p>原批准人 {op.evidence.approval.actorId} · 原批准时间 {new Date(op.evidence.approval.recordedAt).toLocaleString('zh-CN')}</p>
        {op.evidence.payments.map(payment => <p key={payment.id}>原付款 {money(payment.amountCents)} · 流水 {payment.receiptReference}</p>)}
        {'paymentReference' in op && <p>已付款凭证档案 {op.paymentReference}</p>}
        {op.checkedTerms.map(line => <LineDetails key={line.orderItemId} line={{ source: lineFor(line.orderItemId).source, terms: line.terms }}/>)}
        <p>{op.description}</p>
      </div>}
      {op.action === 'reapprove_purchase' && <div className="space-y-1 text-sm">
        <p>原批准 {op.originalApprovalId} · 现行约定预付 {money(op.fundingPlan?.requiredPrepayCents)}{op.fundingPlan?.balanceTerms && ` · ${op.fundingPlan.balanceTerms}`}</p>
        {op.payments.map(payment => <p key={payment.id}>已付 {money(payment.amountCents ?? undefined)} · {payment.reference}</p>)}
        {op.documentScopes.map(line => <div key={line.orderItemId} className="rounded border p-2">
          <p>{line.terms.sourceDocumentKind === 'multiple_items' ? `原件第 ${line.terms.sourceDocumentRow} 行` : '原件单项报价'}</p>
          <LineDetails line={line}/>
        </div>)}
        <p>{op.description}</p>
      </div>}
      {op.action === 'approve_remaining' && <div className="space-y-1 text-sm">
        {op.scope.lines.map(line => <p key={line.orderItemId}>{lineFor(line.orderItemId).source.name} · 剩余 {line.quantity} · 应付 {money(line.payableCents)}</p>)}
        <p>剩余商品应付 {money(op.scope.totalCents)} · 已付款确认抵扣 {money(op.scope.appliedPaidCents)} · 本次核实未付 {money(op.scope.totalCents - op.scope.appliedPaidCents)}</p>
        <p>{op.description}</p>
      </div>}
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
