'use client';

import { useState } from 'react';
import type { FinanceInput } from '@/lib/finance-actions';
import type { FinanceWorkspace } from '@/lib/finance-workspace';
import { invoicePeriodAt } from '@/lib/finance-invoice-timeline';
import DocumentDigestField from '@/components/admin/purchases/DocumentDigestField';
import { button, cents, field, money, primary } from '@/components/admin/purchases/PurchaseLineForm';

export const actionLabels = {
  verify_bank_receipt: '核验银行到账原件', record_customer_receipt: '分摊银行回款', post_existing: '核销既有到账',
  verify_receivable_principal: '核对原应收金额',
  verify_customer_invoice_scope: '核对历史客户可开票范围',
  verify_invoice_coverage: '核对原票或安排的商品归属',
  restore_term: '按平台接单日期补齐账期', set_term: '登记单独约定的账期', create_plan: '登记开票或收票安排',
  amend_plan: '变更未开或未收部分的条件',
  confirm_condition: '核验约定开票条件', chase_invoice: '记录供应商追票', close_plan: '止用剩余开票或收票安排',
  record_invoice: '回填实际发票', open_correction: '登记发票更正待办', resolve_correction: '回填发票更正结果',
  reconcile_supplier: '核对采购、付款与来票', review_payment_case: '领取到账差异', update_payment_case: '记录到账差异进展',
  resume_alipay_payment: '接续库存恢复后的原支付宝到账',
} satisfies Record<FinanceInput['action'], string>;

export const triggerLabels: Record<string, string> = { accepted: '本方接单或供方确认订购', dispatched: '全部对客发货后',
  delivered: '客户实际签收后', paid: '实际付清后', manual: '经办人核验书面约定' };
export const invoiceStateLabels: Record<string, string> = { recorded: '有效', correction_pending: '更正办理中', voided: '原票已红冲或作废' };
export const paymentCaseProgressLabels: Record<string, string> = {
  awaiting_provider_evidence: '等待原交易书证', awaiting_authorized_disposition: '等待获准并办妥的处理结果',
};
export const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '待核对';

function Text({ name, label, initial, required = true }: { name: string; label: string; initial?: string; required?: boolean }) {
  return <label className="grid gap-1">{label}<input name={name} className={field} defaultValue={initial} required={required} maxLength={2000}/></label>;
}

function Time({ name, label, required = true, value, onChange }: {
  name: string; label: string; required?: boolean; value?: string; onChange?: (value: string) => void;
}) {
  return <label className="grid gap-1">{label}<input className={field} name={name} type="datetime-local" step="1" required={required}
    value={value} onChange={onChange && (event => onChange(event.target.value))}/></label>;
}

function Amount({ name, label, allowZero = false }: { name: string; label: string; allowZero?: boolean }) {
  return <label className="grid gap-1">{label}（元）<input className={field} name={name} type="number" step="0.01"
    min={allowZero ? '0' : '0.01'} required/></label>;
}

const moneyFields = new Set(['receiptTotalCents', 'amountCents', 'grossCents']);
const timeFields = new Set(['occurredAt', 'issuedAt', 'nextReviewAt', 'startedAt', 'effectiveAt', 'coverageAt']);

type InvoicePlan = FinanceWorkspace['invoicePlans'][number];

function canReviewUnissued(plan: InvoicePlan) {
  return plan.remainingCents > 0 || plan.coveragePeriods?.some(period => period.remainingCents > 0);
}

export function canReviewInvoiceCoverage(plan: InvoicePlan) {
  return plan.side === 'customer' && plan.invoiceScopeId && (canReviewUnissued(plan)
    || plan.allocations.some(row => row.status !== 'voided'));
}

export default function FinanceForm({ view, action, initialPlanId, busy, onPreview, onCancel, onError }: {
  view: FinanceWorkspace; action: FinanceInput['action']; initialPlanId?: string; busy: boolean;
  onPreview: (input: FinanceInput) => Promise<void>; onCancel: () => void; onError: (message: string) => void;
}) {
  const scopes = view.customerInvoiceScopes ?? [];
  const availableScopes = scopes.filter(row => (row.remainingCents ?? 0) > 0);
  const customerCanPlan = view.acceptanceId && (view.principalCents > 0 || availableScopes.length > 0);
  const [side, setSide] = useState(customerCanPlan ? 'customer' : 'supplier');
  const [scopeId, setScopeId] = useState(availableScopes[0]?.id ?? '');
  const selectedScope = availableScopes.find(row => row.id === scopeId);
  const [additionalPlanEvidence, setAdditionalPlanEvidence] = useState(false);
  const usesVerifiedScope = action === 'create_plan' && side === 'customer' && Boolean(selectedScope);
  const openLines = view.originalInvoiceLines?.filter(line => line.unverifiedQuantity > 0) ?? [];
  const families = view.customerInvoiceFamilies ?? [];
  const [basisId, setBasisId] = useState(openLines.length ? '' : families[0]?.id ?? '');
  const [restateCeiling, setRestateCeiling] = useState(false);
  const [clarifyingAt, setClarifyingAt] = useState('');
  const scopeBasis = scopes.find(row => row.id === basisId);
  const scopeAmounts = families.find(row => row.id === basisId);
  const unresolved = scopeAmounts?.timeline?.filter(row => row.needsReview) ?? [];
  const clarification = unresolved.find(row => row.at === clarifyingAt);
  const restates = Boolean(clarification || restateCeiling);
  const eligibleLines = scopeBasis ? scopeBasis.lines.map(line => ({ ...line, unverifiedQuantity: line.quantity })) : openLines;
  const chooseLines = !scopeBasis || !restates && (eligibleLines.length > 1 || eligibleLines[0]?.unverifiedQuantity > 1);
  const [documentKind, setDocumentKind] = useState('single_receipt');
  const plans = view.invoicePlans.filter(plan => action === 'verify_invoice_coverage'
    ? canReviewInvoiceCoverage(plan)
    : action === 'record_invoice' ? plan.recordable
    : !plan.closed && (action === 'chase_invoice' ? plan.side === 'supplier' && plan.remainingCents > 0
      : action === 'confirm_condition' ? plan.trigger === 'manual' && !plan.manualAt
      : action === 'amend_plan' ? plan.scheduledRemainingCents > 0 : Math.min(plan.remainingCents, plan.scheduledRemainingCents) > 0));
  const [planId, setPlanId] = useState(plans.find(row => row.id === initialPlanId)?.id ?? plans[0]?.id ?? '');
  const [poId, setPoId] = useState(view.purchases[0]?.id ?? '');
  const [allocationId, setAllocationId] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const plan = plans.find(row => row.id === planId);
  const allocations = plan?.allocations.filter(row => row.status !== 'voided') ?? [];
  const reviewUnissued = plan && canReviewUnissued(plan);
  const reviewingInvoice = allocations.find(row => row.id === allocationId) ?? (reviewUnissued ? undefined : allocations[0]);
  const selectedAt = Date.parse(invoiceDate);
  const at = action === 'verify_invoice_coverage' && reviewingInvoice ? reviewingInvoice.issuedAt
    : Number.isFinite(selectedAt) ? new Date(selectedAt).toISOString() : null;
  const period = at ? invoicePeriodAt(plan?.coveragePeriods ?? [], at) : null;
  const reservation = at ? period?.review?.remaining : plan?.coverageReview?.remaining;
  const originalProof = scopes.find(row => row.id === plan?.invoiceScopeId);
  const originalFamily = families.find(row => row.id === originalProof?.familyId);
  const confirmedAtInvoice = new Set(originalFamily?.timeline?.filter(point => !at || point.at <= at)
    .flatMap(point => point.confirmedEvidenceIds) ?? []);
  const coverageChoices = scopes.flatMap(proof => {
    if (!originalProof || originalProof.familyId !== proof.familyId) return [];
    const reserved = action === 'record_invoice' ? reservation?.find(row => row.invoiceScopeId === proof.id) : undefined;
    if (action === 'verify_invoice_coverage' ? !confirmedAtInvoice.has(proof.id) : action !== 'record_invoice' || !reserved) return [];
    const lines = proof.lines.flatMap(line => {
      const max = reserved ? reserved.lines.find(row => row.orderItemId === line.id)?.quantity
        : originalProof.lines.find(row => row.id === line.id)?.quantity;
      return max ? [{ ...line, quantity: Math.min(max, line.quantity) }] : [];
    });
    return lines.length ? [{ proof, lines, maxCents: reserved?.amountCents }] : [];
  });
  const po = view.purchases.find(row => row.id === poId);
  const invoices = [...new Map(view.invoicePlans.flatMap(row => row.allocations).map(doc => [doc.invoiceId, doc])).values()]
    .filter(doc => action === 'open_correction' ? doc.status === 'recorded' : doc.status === 'correction_pending');
  const sources = [
    ...view.latePayments.filter(row=>!row.refund).map(row => ({ id: row.id, review: row.review, label: row.outTradeNo + ' · ' + money(row.amountCents),
      stockHeld: row.status === 'paid_stock_shortfall_reconciliation_required' })),
    ...view.receipts.filter(row => !row.counted && !row.reconciled).map(row => ({ id: row.id, review: row.review, label: row.id })),
  ].filter(row => action === 'resume_alipay_payment' ? 'stockHeld' in row && row.stockHeld
    : action === 'review_payment_case' ? !row.review : Boolean(row.review));
  const cashSources = view.receipts.filter(row => row.counted && !view.cash.some(entry => entry.bankAllocationId === row.id))
    .map(row => ({ id: row.id, label: '银行回款 ' + money(row.amountCents) + ' · ' + row.id }));
  if (view.nativePaymentId && !view.cash.some(entry => entry.paymentAttemptId === view.nativePaymentId)) {
    cashSources.push({ id: view.nativePaymentId, label: '支付宝 · ' + view.nativePaymentId });
  }

  const poSelect = <label className="grid gap-1">对应采购单<select className={field} name="purchaseOrderId" value={poId} required onChange={e => setPoId(e.target.value)}>
    {view.purchases.map(row => <option key={row.id} value={row.id}>{row.supplier ?? '供方待核'} · {row.id}</option>)}</select></label>;
  return <form className="space-y-4 rounded border border-slate-200 p-4 text-sm" onSubmit={async event => {
    event.preventDefault();
    try {
      const data: Record<string, unknown> = {};
      const form = new FormData(event.currentTarget);
      for (const [key, entry] of form) {
        if (typeof entry !== 'string' || !entry.trim()) continue;
        if (key.startsWith('invoiceQuantity:') || key.startsWith('confirmedProof:') || key.startsWith('coverage:')) continue;
        data[key] = key === 'confirmContinueAfterCancellation' || key === 'restateInvoiceCeiling' ? true
          : moneyFields.has(key) ? cents(entry, key === 'grossCents' && action === 'verify_customer_invoice_scope' && restates)
          : timeFields.has(key) ? new Date(entry).toISOString()
          : key === 'days' || key === 'statementRow' || key === 'documentRow' ? Number(entry) : entry.trim();
      }
      if (action === 'verify_customer_invoice_scope') {
        if (chooseLines) data.invoiceLines = eligibleLines.flatMap(line => {
          const quantity = Number(form.get('invoiceQuantity:' + line.id));
          return quantity > 0 ? [{ orderItemId: line.id, quantity }] : [];
        });
        if (clarification) {
          data.restateInvoiceCeiling = true;
          data.clarifiesInvoiceEvidenceAt = clarification.at;
          data.confirmedInvoiceEvidenceIds = clarification.evidenceIds.filter(id => form.has('confirmedProof:' + id));
        }
      }
      const portions = coverageChoices.flatMap(({ proof, lines }) => {
        const amount = String(form.get('coverage:amount:' + proof.id) ?? '');
        return amount ? [{ invoiceScopeId: proof.id, amountCents: cents(amount), lines: lines.flatMap(line => {
          const quantity = Number(form.get('coverage:quantity:' + proof.id + ':' + line.id));
          return quantity > 0 ? [{ orderItemId: line.id, quantity }] : [];
        }) }] : [];
      });
      if (action === 'verify_invoice_coverage' || portions.length) data.portions = portions;
      await onPreview({ orderId: view.orderId, version: view.version, requestId: crypto.randomUUID(), action, data });
    } catch (error) { onError(error instanceof Error ? error.message : '请核对填写内容'); }
  }}>
    <h3 className="font-semibold">{actionLabels[action]}</h3>
    <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
      {action === 'verify_receivable_principal' && <>
        <Amount name="amountCents" label="原凭证记载的应收金额"/>
        <Time name="occurredAt" label="原书证确认应收时间"/>
      </>}
      {action === 'verify_customer_invoice_scope' && <>
        {families.length > 0 && <label className="grid gap-1 sm:col-span-2">开票书证对应范围
          <select name="invoiceScopeBasisId" className={field} value={basisId}
            onChange={event => { setBasisId(event.target.value); setRestateCeiling(false); setClarifyingAt(''); }}>
            {openLines.length > 0 && <option value="">核对尚无依据的商品份额</option>}
            {families.map(row => {
              const original = scopes.find(scope => scope.id === row.id);
              return <option key={row.id} value={row.id}>{original?.reference} · {original?.lines.map(line =>
                line.name + ' ' + line.quantity + ' 件').join('、')} · 已核 {money(row.authorizedCents ?? undefined)}</option>;
            })}
          </select>
        </label>}
        <Text key={'proof-issuer-' + basisId} name="issuer" label="原书证开票方全称" initial={scopeBasis?.issuer}/>
        <Text key={'proof-recipient-' + basisId} name="recipient" label="原书证受票方全称" initial={scopeBasis?.recipient}/>
        {scopeAmounts && <>
          <p className="sm:col-span-2">当前累计可开 {money(scopeAmounts.authorizedCents ?? undefined)} · 已开及更正中 {money(scopeAmounts.issuedCents)}
            {' · 尚可安排 ' + money(scopeAmounts.availableCents ?? undefined)}</p>
          {unresolved.length > 0 && <label className="grid gap-1 sm:col-span-2">已有书证的待核时间<select className={field}
            value={clarifyingAt} onChange={event => setClarifyingAt(event.target.value)}>
            <option value="">登记新的书证</option>
            {unresolved.map(row => <option key={row.at} value={row.at}>{dateLabel(row.at)}</option>)}
          </select></label>}
          {clarification ? <fieldset key={clarification.at} className="space-y-1 sm:col-span-2">
            <legend>澄清书证确认当时生效的原件</legend>
            {clarification.evidenceIds.map(id => <label key={id} className="flex items-center gap-2">
              <input type="checkbox" name={'confirmedProof:' + id}/>{scopeAmounts.evidence.find(proof => proof.id === id)?.reference}
            </label>)}
          </fieldset> : <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="restateInvoiceCeiling" checked={restateCeiling}
            onChange={event => setRestateCeiling(event.target.checked)}/>书证重新核定累计可开额</label>}
        </>}
        <Amount name="grossCents" label={!scopeBasis ? '原书证可开的含税金额'
          : clarification ? '澄清书证确认当时的累计可开额'
            : restateCeiling ? '原书证核定的新累计可开额' : '原书证明确补充的含税金额'} allowZero={restates}/>
        <Time name="occurredAt" label={clarification ? '澄清书证的实际确认时间' : '原书证载明的实际确认时间'}/>
        <label className="grid gap-1">书证分行核对时填写原件行号
          <input name="documentRow" type="number" min="1" step="1" className={field}/>
        </label>
        {scopeBasis && !chooseLines ? <p className="sm:col-span-2">已核商品与数量 {scopeBasis.lines.map(line => line.name + ' ' + line.quantity + ' 件').join('、')}</p>
          : <fieldset key={basisId} className="space-y-1 sm:col-span-2"><legend>原书证覆盖的实际订单行</legend>
          {eligibleLines.map(line => <label key={line.id} className="flex items-center gap-2">
            {line.unverifiedQuantity === 1
              ? <><input name={'invoiceQuantity:' + line.id} type="checkbox" value="1"/>{line.name} · 1 件</>
              : <>{line.name} · 可核实 {line.unverifiedQuantity} 件
                <input name={'invoiceQuantity:' + line.id} type="number" min="0" max={line.unverifiedQuantity} step="1" className={field}/></>}
          </label>)}
        </fieldset>}
      </>}
      {action === 'verify_bank_receipt' && <>
        <label className="grid gap-1">银行原件类型<select name="documentKind" className={field} value={documentKind} onChange={e => setDocumentKind(e.target.value)}>
          <option value="single_receipt">单笔银行回单</option><option value="statement">银行对账单</option></select></label>
        {documentKind === 'statement' && <label className="grid gap-1">对账单中的交易行号<input name="statementRow" type="number" className={field} min="1" step="1" required/></label>}
        <Text name="bankTrace" label="银行流水号"/><Text name="receivingAccount" label="实际收款账户的档案标识"/>
        <Text name="payer" label="原件所列付款人"/><Amount name="receiptTotalCents" label="该笔实际到账金额"/><Time name="occurredAt" label="实际到账时间"/>
      </>}
      {action === 'record_customer_receipt' && <>
        <label className="grid gap-1">已核验的银行到账<select className={field} name="bankReceiptId" required>{view.banks.filter(row => row.availableCents > 0)
          .map(row => <option key={row.id} value={row.id}>{row.bankTrace} · 可分 {money(row.availableCents)}</option>)}</select></label>
        <Text name="allocationReference" label="本单分摊编号"/><Amount name="amountCents" label="本次归入原单金额"/>
        {view.receipts.some(row => !row.bankReceiptId && !row.reconciled) && <label className="grid gap-1">对应旧分摊<select className={field} name="legacyAllocationId">
          <option value="">本次新增</option>{view.receipts.filter(row => !row.bankReceiptId && !row.reconciled).map(row =>
            <option key={row.id} value={row.id}>{row.id} · {money(row.amountCents)}</option>)}</select></label>}
      </>}
      {action === 'post_existing' && <label className="grid gap-1">既有到账<select className={field} name="sourceId" required>{cashSources.map(row =>
        <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>}
      {action === 'set_term' && <><Time name="startedAt" label="书面约定的起算时间"/>
        <label className="grid gap-1">约定天数<input className={field} name="days" type="number" step="1" min="0" required/></label></>}
      {action === 'create_plan' && <>
        <label className="grid gap-1">发票方向<select name="side" className={field} value={side} onChange={e => setSide(e.target.value)}>
          {customerCanPlan && <option value="customer">Libereal 给客户开票</option>}
          {view.purchases.some(row => row.agreedCents !== null) && <option value="supplier">向供应商收票</option>}</select></label>
        {side === 'supplier' && poSelect}
        {side === 'customer' && availableScopes.length > 0 && <label className="grid gap-1">本次开票对应的已核书证
          <select name="invoiceScopeId" value={scopeId} onChange={e => setScopeId(e.target.value)} className={field} required>
            {availableScopes.map(row => <option key={row.id} value={row.id}>{row.reference}{row.documentRow && ' · 第 ' + row.documentRow + ' 行'}
              {' · 生效 ' + dateLabel(row.occurredAt) + ' · ' + row.lines.map(line => line.name + ' ' + line.quantity + ' 件').join('、')
                + (row.sharesCumulativeLimit ? ' · 共享额度可安排 ' : ' · 本份增额可安排 ') + money(row.remainingCents ?? undefined)}</option>)}
          </select></label>}
        <Text key={side + poId + scopeId} name="issuer" label="约定开票方全称" initial={side === 'supplier' ? po?.supplier ?? '' : selectedScope?.issuer}/>
        <Text key={'recipient-' + side + scopeId} name="recipient" label="约定受票方全称" initial={side === 'customer' ? selectedScope?.recipient : undefined}/>
        <Amount name="grossCents" label="本项安排含税金额"/>
        <label className="grid gap-1">约定开票节点<select name="trigger" required className={field} defaultValue="">
          <option value="" disabled>选择书面约定</option>{Object.entries(triggerLabels).filter(([key]) => side === 'customer' || !['dispatched', 'delivered'].includes(key))
            .map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
      </>}
      {['record_invoice','verify_invoice_coverage','amend_plan','confirm_condition','close_plan','chase_invoice'].includes(action) && <label className="grid gap-1">发票安排
        <select name="planId" value={planId} onChange={e => { setPlanId(e.target.value); setAllocationId(''); }} className={field} required>
          {plans.map(row => <option key={row.id} value={row.id}>{row.side === 'customer' ? '销项' : '进项'} · {row.reference}
            {action === 'record_invoice' ? ' · 按票面日期核对' : ' · 安排未办 ' + money(action === 'amend_plan' ? row.scheduledRemainingCents : row.remainingCents)}</option>)}</select></label>}
      {action === 'verify_invoice_coverage' && <>
        <label className="grid gap-1">本次核对对象
          <select name="allocationId" value={reviewingInvoice?.id ?? ''} onChange={e => setAllocationId(e.target.value)} className={field}>
            {reviewUnissued && <option value="">原安排未开金额</option>}
            {allocations.map(row => <option key={row.id} value={row.id}>原票 {row.number} · 本项 {money(row.amountCents)}</option>)}
          </select>
        </label>
        {!reviewingInvoice && <Time name="coverageAt" label="所核对的原安排时间（留空按当前）" required={false} value={invoiceDate} onChange={setInvoiceDate}/>}
      </>}
      {action === 'amend_plan' && <>
        <Amount name="amountCents" label="本次变更条件对应的未开金额"/>
        <Time name="effectiveAt" label="书面约定生效时间（与确认时间相同可留空）" required={false}/>
        <Text name="retroactiveReference" label="书证中明确的追溯条款（早于确认时填写）" required={false}/>
        <label className="grid gap-1">新约定开票节点<select name="trigger" required className={field} defaultValue="">
          <option value="" disabled>选择书面约定</option>{Object.entries(triggerLabels).filter(([key]) =>
            plan?.side === 'customer' || !['dispatched', 'delivered'].includes(key))
            .map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
      </>}
      {action === 'record_invoice' && <><Text key={'issuer' + planId} name="issuer" label="票面开票方全称" initial={plan?.issuer}/>
        <Text key={'recipient' + planId} name="recipient" label="票面受票方全称" initial={plan?.recipient}/><Text name="number" label="票面号码"/>
        <Time name="issuedAt" label="票面开票时间" value={invoiceDate} onChange={setInvoiceDate}/><Amount name="grossCents" label="整张发票含税合计"/>
        <Amount name="amountCents" label="本次归入此项金额"/>
        {plan?.side==='customer'&&<Text name="correctionEventId" label="重开时填写原票实际红冲回执记录号" required={false}/>}</>}
      {(action === 'verify_invoice_coverage' || action === 'record_invoice' && plan?.coverageReview) && <div
        key={planId + (reviewingInvoice?.id ?? period?.key ?? '')} className="space-y-3 sm:col-span-2">
        {action === 'verify_invoice_coverage' && <p>请按实际原件填写各书证覆盖的商品数量，金额合计须等于 {money(reviewingInvoice?.amountCents
          ?? period?.remainingCents ?? plan?.remainingCents)}。</p>}
        {action === 'record_invoice' && (reservation?.length ? <p>全额开票可沿用已核未开明细。分次开票请填写本次各行实际数量和金额。</p>
          : <p>所填票面日期的未开份额待核，请核对当日适用的原安排。</p>)}
        {!coverageChoices.length && <p>请按原件核对适用日期、商品和数量。</p>}
        {coverageChoices.map(({ proof, lines, maxCents }) => <fieldset key={proof.id} className="space-y-2 rounded border p-3">
          <legend>{proof.reference} · {dateLabel(proof.occurredAt)}</legend>
          <label className="grid gap-1">归入本书证的金额（元）
            <input name={'coverage:amount:' + proof.id} type="number" min="0.01" step="0.01" max={maxCents === undefined ? undefined : maxCents / 100} className={field}/>
          </label>
          {lines.map(line => <label key={line.id} className="grid gap-1">{line.name ?? line.id} · 本次实际数量
            <input name={'coverage:quantity:' + proof.id + ':' + line.id} type="number" min="0" max={line.quantity} step="1" className={field}/>
          </label>)}
        </fieldset>)}
      </div>}
      {['chase_invoice','amend_plan','confirm_condition','close_plan','open_correction','resolve_correction','review_payment_case','update_payment_case'].includes(action)
        && <Time name="occurredAt" label="实际办理时间"/>}
      {action === 'chase_invoice' && <Time name="nextReviewAt" label="约定下次跟进时间"/>}
      {(action === 'open_correction' || action === 'resolve_correction') && <label className="grid gap-1">原发票<select name="invoiceId" className={field} required>
        {invoices.map(row => <option key={row.invoiceId} value={row.invoiceId}>{row.number} · {money(row.grossCents)}</option>)}</select></label>}
      {action === 'resolve_correction' && <label className="grid gap-1">实际办理结果<select className={field} name="outcome" defaultValue="" required>
        <option value="" disabled>核对书面结果后选择</option><option value="retained">原票继续有效</option><option value="voided">原票已整张红冲或作废</option></select></label>}
      {action === 'reconcile_supplier' && <>{poSelect}<label className="grid gap-1">对账结果<select className={field} name="outcome" defaultValue="" required>
        <option value="" disabled>请选择</option><option value="matched">本次核对一致</option><option value="followup">有差异，继续跟进</option></select></label></>}
      {(action === 'review_payment_case' || action === 'update_payment_case' || action === 'resume_alipay_payment') && <label className="grid gap-1">待核对的交易<select name="sourceId" className={field} required>
        {sources.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></label>}
      {action === 'resume_alipay_payment' && view.cancellationRequest && <label className="flex items-start gap-2 sm:col-span-2">
        <input type="checkbox" required name="confirmContinueAfterCancellation"/>
        已凭书面依据核对取消或移除申请的处理结果，原单可继续办理。
      </label>}
      {action === 'update_payment_case' && <label className="grid gap-1">当前进展<select className={field} name="outcome" defaultValue="" required>
        <option value="" disabled>按已有书证选择</option>
        {Object.entries(paymentCaseProgressLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>}
      {usesVerifiedScope && <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" checked={additionalPlanEvidence}
        onChange={event => setAdditionalPlanEvidence(event.target.checked)}/>另有本次安排的书面依据</label>}
      {usesVerifiedScope && !additionalPlanEvidence ? <p className="sm:col-span-2">沿用已核书证 {selectedScope?.reference}</p> : <>
        <Text name="reference" label="书面依据或原件编号" initial={action === 'restore_term' ? view.acceptanceId ?? '' : ''}/>
        {action === 'restore_term' && view.acceptanceEvidenceHash
          ? <label className="grid gap-1">平台接单资料摘要<input className={field} readOnly name="sha256" value={view.acceptanceEvidenceHash}/></label>
          : <DocumentDigestField name="sha256" label="原件 SHA-256 摘要" required/>}
      </>}
      <label className="grid gap-1 sm:col-span-2">核对结果或书面约定<textarea className={field} rows={2} name="description" required maxLength={2000}/></label>
    </fieldset>
    <div className="flex gap-2"><button className={primary} disabled={busy}>查看完整预览</button>
      <button type="button" onClick={onCancel} className={button} disabled={busy}>收起</button></div>
  </form>;
}
