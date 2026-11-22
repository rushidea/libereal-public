'use client';

import { useState } from 'react';
import type { PurchaseActionInput, previewPurchaseAction } from '@/lib/purchase-orders';
import type { PurchaseTerms } from '@/lib/purchase-terms';
import { incidentLineTotals, incidentQuantityKey, type IncidentQuantity } from '@/lib/purchase-incident-scope';
import type { CustomerDecisionDocument, DecisionCoverage, DecisionDocumentInput, LegacyDecisionLocation } from '@/lib/purchase-decision-documents';
import type { ShortfallDecision } from '@/lib/purchase-shortfalls';
import DocumentDigestField from './DocumentDigestField';
import type { PurchaseRequest } from './PurchaseManager';
import { actionNames, button, cents, field, LineDetails, money, primary, PurchaseLineFields, statuses, type Line, type Purchase, type Workspace } from './PurchaseLineForm';

type Action = PurchaseActionInput['action'];
type Preview = Awaited<ReturnType<typeof previewPurchaseAction>>;
type Alternative = { name: string; brand: string; catalogNumber: string; spec: string; unit: string; terms: PurchaseTerms };
type Intervention = DecisionDocumentInput & {
  quantity: number; outcome: 'cancel' | 'replace'; replacement?: Alternative; shortfallId?: string;
  shortfallDecision?: ShortfallDecision; revisesResendApprovalId?: string;
};
type ScopeSubjects = Array<{ subject: DecisionCoverage; name: string }>;
type QuantityDraft = Record<string,number>;
const sourceNames = {unshipped:'供方尚未发出的原货',parcel:'已发运单中的货物',receipt:'已实收入仓批次',
  shortfall:'已核实物流短失',resend:'已批准的免费补发'};
function enteredQuantities(options: IncidentQuantity[], values: QuantityDraft) {
  return options.flatMap(row => {
    const quantity = values[incidentQuantityKey(row)];
    return quantity > 0 ? [{orderItemId:row.orderItemId,quantity,...(row.source ? {source:row.source} : {})}] : [];
  });
}

function IncidentQuantityFields({ title, quantities, values, lineName, onChange }: {
  title: string; quantities: IncidentQuantity[]; values: QuantityDraft; lineName: (row: IncidentQuantity) => string;
  onChange: (values: QuantityDraft) => void;
}) {
  if (!quantities.length) return null;
  return <fieldset className="grid gap-2 rounded border p-3">
    <legend>{title}</legend>
    {quantities.map(row => {
      const key = incidentQuantityKey(row);
      return <label key={key} className="grid gap-1 text-sm">
        {title} · {lineName(row)} · 可核对 {row.quantity}
        <input className={field} type="number" min={0} max={row.quantity} step={1} value={values[key] || ''}
          onChange={event => onChange({ ...values,[key]:Number(event.target.value) })}/>
      </label>;
    })}
  </fieldset>;
}

const scopeKey = (scope: DecisionCoverage) => JSON.stringify([scope.orderId,scope.purchaseOrderId,scope.orderItemId,scope.shortfallId ?? null]);
const decisionPurposeLabels: Record<string,string> = {
  free_resend:'书面同意免费补发',supplier_facts:'供方确认短失或缺货事实，保留原合同应付',new_purchase:'客户同意按以下条件另采',
  amend_contract:'书面同意变更原合同',amend_and_replace:'书面同意变更原合同及另采',
  cancel_unshipped:'书面同意取消未发货份额',replace_unshipped:'书面同意替代未发货份额',
  reduce_contract:'供方同意减少原合同数量',continue_contract:'书面同意按原合同继续',
  decline_preparation:'书面确认结束采购准备',reconfirm_terms:'客户同意修订后的替代采购条件',
};
type Pending = { input: PurchaseActionInput; preview: Preview };

function inputField(name: string, label: string) {
  return <label className="grid gap-1 text-sm">{label}<input className={field} name={name} required maxLength={2000}/></label>;
}

function DecisionDocumentFields({ label, rowLabel, row, coverage, restore, legacy, current, choices, onChange }: {
  label: string; rowLabel: string; row?: number; coverage?: DecisionCoverage[]; restore?: boolean; legacy?: LegacyDecisionLocation[];
  current: DecisionCoverage; choices: ScopeSubjects;
  onChange: (values: { row?: number; coverage?: DecisionCoverage[]; restore?: boolean; legacy?: LegacyDecisionLocation[] }) => void;
}) {
  const setCoverage = (entries: DecisionCoverage[]) => onChange({
    row, coverage: entries.length ? entries : undefined, restore: entries.length ? restore : false, legacy,
  });
  const saveLegacy = (entries: LegacyDecisionLocation[]) => onChange({ row, coverage, restore, legacy: entries.length ? entries : undefined });
  const candidates = choices.filter(({subject}) => !coverage?.some(entry => scopeKey(subject) === scopeKey(entry)));
  return <div className="grid gap-2">
    <label className="grid gap-1 text-sm">{rowLabel}
      <input className={field} type="number" min={1} step={1} value={row ?? ''}
        onChange={event => onChange(event.target.value ? { row: Number(event.target.value), coverage, restore, legacy } : {})}/>
    </label>
    {row && <details className="space-y-2 text-sm">
      <summary className="cursor-pointer">核对{label}覆盖范围</summary>
      {!coverage ? <button type="button" className={button} onClick={() => setCoverage([current])}>填写{label}覆盖的采购行及总量</button>
        : <>
          {coverage.map((entry,index) => {
            const known = choices.find(({subject}) => scopeKey(subject) === scopeKey(entry));
            const update = (change: Partial<DecisionCoverage>) => setCoverage(coverage.map((saved,slot) => slot === index ? { ...saved, ...change } : saved));
            return <fieldset key={index} className="grid gap-1 rounded border p-2">
              {known ? <legend>{known.name} · {entry.purchaseOrderId}</legend> : <>
                <label className="grid gap-1">客户订单编号<input className={field} required value={entry.orderId}
                  onChange={event => update({ orderId: event.target.value })}/></label>
                <label className="grid gap-1">采购单编号<input className={field} required value={entry.purchaseOrderId}
                  onChange={event => update({ purchaseOrderId: event.target.value })}/></label>
                <label className="grid gap-1">原客户商品行编号<input className={field} required value={entry.orderItemId}
                  onChange={event => update({ orderItemId: event.target.value })}/></label>
                <label className="grid gap-1">已核实的物流短失编号<input className={field} required={Boolean(current.shortfallId)} value={entry.shortfallId ?? ''}
                  onChange={event => update({ shortfallId: event.target.value || undefined })}/></label>
              </>}
              <label className="grid gap-1">{label}核准总量
                <input className={field} type="number" min={1} max={known?.subject.quantity} step={1} required value={entry.quantity || ''}
                  onChange={event => update({ quantity: Number(event.target.value) })}/>
              </label>
              <button type="button" className="justify-self-start underline" onClick={() => setCoverage(coverage.filter((_,slot) => slot !== index))}>移除此范围</button>
            </fieldset>;
          })}
          {candidates.length > 0 && <label className="grid gap-1">{current.shortfallId ? '添加原件列明的物流短失' : '添加该原件覆盖的本订单采购行'}
            <select className={field} value="" onChange={event => {
              if (event.target.value) setCoverage([...coverage,{ ...candidates[Number(event.target.value)].subject, quantity: 1 }]);
            }}>
              <option value="">{current.shortfallId ? '选择书证列明的短失' : '选择书证列明的采购行'}</option>
              {candidates.map(({subject,name},index) => <option key={scopeKey(subject)} value={index}>
                {name} · {subject.purchaseOrderId}
              </option>)}
            </select>
          </label>}
          <button type="button" className={button} onClick={() => setCoverage([...coverage,{ orderId: '',purchaseOrderId: '',orderItemId: '',quantity: 1 }])}>按编号添加其他订单的采购行</button>
          <label className="flex gap-2"><input type="checkbox" checked={restore ?? false}
            onChange={event => onChange({ row, coverage, legacy, restore: event.target.checked })}/>已核对原件，补记此前已使用的原件行范围</label>
        </>}
      <button type="button" className={button} onClick={() => saveLegacy([...(legacy ?? []), {
        activityId:'',orderItemId:current.orderItemId,row:0,quantity:0,
      }])}>补记{label}的旧批准原件行</button>
      {legacy?.map((entry,index) => {
        const update = (change: Partial<LegacyDecisionLocation>) => saveLegacy(legacy.map((saved,slot) => slot === index ? {...saved,...change} : saved));
        return <fieldset key={index} className="grid gap-1 rounded border p-2">
          <legend>按原件核对旧批准占用的行和数量</legend>
          <label>旧批准编号<input className={field} required value={entry.activityId}
            onChange={event => update({ activityId:event.target.value })}/></label>
          <label>旧批准商品行编号<input className={field} required value={entry.orderItemId}
            onChange={event => update({ orderItemId:event.target.value })}/></label>
          <label>旧批准实际原件行号<input className={field} type="number" min={1} step={1} required value={entry.row || ''}
            onChange={event => update({ row:Number(event.target.value) })}/></label>
          <label>旧批准该行已用数量<input className={field} type="number" min={1} step={1} required value={entry.quantity || ''}
            onChange={event => update({ quantity:Number(event.target.value) })}/></label>
          <button type="button" className="justify-self-start underline" onClick={() => saveLegacy(legacy.filter((_,slot) => slot !== index))}>移除这条旧批准定位</button>
        </fieldset>;
      })}
    </details>}
  </div>;
}

function LineDecisionDocuments({value,current,choices,customerOnly,onChange}: {
  value: DecisionDocumentInput; current: DecisionCoverage; choices: ScopeSubjects; customerOnly?: boolean;
  onChange: (value: DecisionDocumentInput) => void;
}) {
  return <>
    {!customerOnly && <DecisionDocumentFields label="供方书证" rowLabel="供方决定原件行号" row={value.supplierDocumentRow} coverage={value.supplierDocumentScope}
      restore={value.supplierRestoreScope} legacy={value.supplierLegacyLocations} choices={choices} current={current}
      onChange={document => onChange({ ...value,supplierDocumentRow:document.row,supplierDocumentScope:document.coverage,
        supplierRestoreScope:document.restore,supplierLegacyLocations:document.legacy })}/>}
    <DecisionDocumentFields label="客户书证" rowLabel="客户同意原件行号" row={value.customerDocumentRow} coverage={value.customerDocumentScope}
      restore={value.customerRestoreScope} legacy={value.customerLegacyLocations} choices={choices} current={current}
      onChange={document => onChange({ ...value,customerDocumentRow:document.row,customerDocumentScope:document.coverage,
        customerRestoreScope:document.restore,customerLegacyLocations:document.legacy })}/>
  </>;
}

function DispositionFields({ line, quantity, losses, resends, shortfall, value, current, choices, incidentLimit, allowReplacement, onChange }: {
  line: Pick<Line, 'source'>; quantity: number; losses: Workspace['fulfillment']['shortfalls'];
  resends: Workspace['fulfillment']['freeResends']; shortfall: boolean; current: DecisionCoverage; choices: ScopeSubjects; incidentLimit?: number;
  value: Intervention; allowReplacement: boolean; onChange: (value: Intervention) => void;
}) {
  const source = line.source;
  const alternative = value.replacement ?? {
    name: source.name, brand: source.brand ?? '', catalogNumber: source.catalogNumber ?? '',
    spec: source.spec ?? '', unit: source.unit ?? '', terms: {},
  };
  const alternativeFields = { name: '替代商品名称', brand: '替代商品品牌', catalogNumber: '替代商品货号', spec: '替代商品规格', unit: '替代计量单位' } as const;
  const replacing = allowReplacement && value.outcome === 'replace';
  const selectedLoss = losses.find(row => row.resolutionId === value.shortfallId);
  const selectedResend = resends.find(row => row.approvalId === value.revisesResendApprovalId);
  const limit = Math.min(incidentLimit ?? Infinity,shortfall ? selectedResend?.available ?? selectedLoss?.available ?? 0 : quantity);
  const exactChoices = choices.filter(({subject}) => Boolean(subject.shortfallId) === shortfall);

  return <fieldset className="grid gap-2 rounded border p-3">
    <legend>{source.name} · 原数量 {source.quantity} · 尚未供货 {quantity}</legend>
    {shortfall && <label className="grid gap-1 text-sm">已核实的物流短失
      <select className={field} value={value.revisesResendApprovalId ?? value.shortfallId ?? ''}
        onChange={event => {
          const prior = resends.find(row => row.approvalId === event.target.value);
          onChange({ quantity: 0, outcome: 'cancel', shortfallId: prior?.shortfallId ?? (event.target.value || undefined),
            revisesResendApprovalId: prior?.approvalId });
        }}>
        <option value="">请选择原物流记录或待改办的免费批准</option>
        {losses.filter(row => row.available > 0).map(row => <option value={row.resolutionId} key={row.resolutionId}>
          {row.reference} · 尚可处理 {row.available}
        </option>)}
        {resends.map(row => <option value={row.approvalId} key={row.approvalId}>
          {losses.find(loss => loss.resolutionId === row.shortfallId)?.reference} · 免费补发已发 {row.dispatched} · 已改办 {row.redirected} · 可改办 {row.available}
        </option>)}
      </select>
    </label>}
    {(selectedResend || value.quantity > 0) && <LineDecisionDocuments value={value} choices={exactChoices}
      current={{ ...current,...(selectedLoss ? { shortfallId:selectedLoss.resolutionId } : {}),quantity:Math.max(1,value.quantity) }}
      onChange={documents => onChange({ ...value,...documents })}/>}
    {selectedLoss && <label className="grid gap-1 text-sm">双方书面决定
      <select className={field} value={value.shortfallDecision ?? ''} required={value.quantity > 0}
        onChange={event => {
          const decision = event.target.value as ShortfallDecision | '';
          onChange({ ...value, shortfallDecision: decision || undefined, outcome: decision === 'new_purchase' ? 'replace' : 'cancel', replacement: alternative });
        }}>
        <option value="">请选择</option>
        {!selectedResend && <option value="free_resend">供方同意免费重发，保留原合同</option>}
        {selectedLoss.originalContract && <option value="change_contract">双方同意变更原合同的份额</option>}
        <option value="new_purchase">保留原合同应付，另建独立采购</option>
      </select>
    </label>}
    <label className="grid gap-1 text-sm">本次受影响数量
      <input className={field} type="number" min={0} max={limit} step={1} value={value.quantity || ''}
        onChange={event => onChange({ ...value, quantity: Number(event.target.value) })}/>
    </label>
    {value.shortfallDecision === 'change_contract' && selectedLoss?.contractSource && <p className="text-sm">
      对应原合同发货凭据 {selectedLoss.contractSource.reference}
    </p>}
    {allowReplacement && (!shortfall || value.shortfallDecision === 'change_contract') && <label className="grid gap-1 text-sm">本行处理方式
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

export default function PurchaseActions({ orderId, orderStatus, cancellation, po, orders, fulfillment, permissions, busy, request, onError }: {
  orderId: string; orderStatus: string; cancellation: Workspace['cancellation']; po: Purchase; orders: Workspace['orders'];
  fulfillment: Workspace['fulfillment'];
  permissions: string[]; busy: boolean; request: PurchaseRequest; onError: (message: string) => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [retainedTerms,setRetainedTerms] = useState<Record<string,PurchaseTerms>>({});
  const [retainedDocuments,setRetainedDocuments] = useState<Record<string,DecisionDocumentInput>>({});
  const [retainedBuyerFiles,setRetainedBuyerFiles] = useState<Record<string,CustomerDecisionDocument | undefined>>({});
  const [reviewResult,setReviewResult] = useState<NonNullable<PurchaseActionInput['reviewResult']>>('scope_confirmed');
  const [relatedIncidentId,setRelatedIncidentId] = useState('');
  const [revisions, setRevisions] = useState<Record<string, PurchaseTerms>>({});
  const [dispositions, setDispositions] = useState<Record<string, Intervention>>({});
  const [coordinationDocuments, setCoordinationDocuments] = useState<Record<string,DecisionDocumentInput>>({});
  const [affected, setAffected] = useState<QuantityDraft>({});
  const [handling, setHandling] = useState<QuantityDraft>({});
  const [incidentId, setIncidentId] = useState<string | undefined>();
  const [shortfallHandoffKey,setShortfallHandoffKey]=useState<string>();
  const [verifiedScopeMatchesResult, setVerifiedScopeMatchesResult] = useState(false);
  const [changeKind, setChangeKind] = useState<PurchaseActionInput['changeKind']>('unavailable');
  const [fileKinds, setFileKinds] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState<PurchaseActionInput['outcome']>('original_terms');
  const committed = po.orderedBefore || po.paidCents > 0 || po.commitmentExceptions.length > 0;
  const incident = po.incidents.find(row=>row.id===incidentId);
  const wasApproved = Boolean(po.approvedHash);
  const withdrawingDraft = !committed && outcome === 'declined';
  const revisingDraft = !committed && outcome === 'revised_terms';
  const withdrawingReplacement = withdrawingDraft && po.lines.some(row=>row.fromPurchaseOrderId);
  const continueWithEvidence = (outcome === 'original_terms' && (committed || wasApproved)) || (outcome === 'declined' && !committed && wasApproved);
  const revisingReplacement = outcome === 'revised_terms' && po.lines.some(line => line.fromPurchaseOrderId);
  const orderedSubjects = orders.flatMap(purchase => purchase.lines.map(line => ({
    name: line.source.name, subject: { orderId, purchaseOrderId: purchase.id, orderItemId: line.orderItemId, quantity: line.source.quantity },
  })));
  const scopeSubjects = [...orderedSubjects,...fulfillment.shortfalls.map(loss => ({
    name: (orderedSubjects.find(row => row.subject.purchaseOrderId === loss.purchaseOrderId && row.subject.orderItemId === loss.orderItemId)?.name ?? loss.orderItemId)
      +' · '+loss.reference,
    subject: { orderId,purchaseOrderId:loss.purchaseOrderId,orderItemId:loss.orderItemId,shortfallId:loss.resolutionId,quantity:loss.quantity },
  }))];
  const supplierCancelled = po.commitmentState === 'supplier_cancelled';
  const canContinueOriginal = !supplierCancelled && po.remaining.length > 0;
  const selectedKind = action === 'report_change' ? changeKind : incident?.changeKind;
  const alreadyAssigned = po.incidents.filter(row=>row.id!==incidentId).flatMap(row=>row.outstanding ?? []);
  const sourceOptions = po.incidentSources.flatMap(row=>{
    if (action === 'report_change' && (selectedKind === 'delay' || selectedKind === 'unavailable') && row.source.kind==='receipt') return [];
    const key = incidentQuantityKey(row);
    const used = alreadyAssigned.filter(item=>incidentQuantityKey(item)===key).reduce((sum,item)=>sum+item.quantity,0);
    return row.quantity>used ? [{...row,quantity:row.quantity-used}] : [];
  });
  const declared = enteredQuantities(action === 'resolve_change' ? po.remaining : sourceOptions,affected);
  const outstanding = incident?.outstanding ?? (declared.length ? declared : null);
  const selected = enteredQuantities(outstanding ?? [],handling);
  const handled = incidentLineTotals(selected.length ? selected : outstanding ?? []);
  const actedOn = new Map(handled.map(row=>[row.orderItemId,row.quantity]));
  const quotable = po.lines.filter(line=>!outstanding || actedOn.has(line.orderItemId));
  const split = withdrawingDraft || revisingDraft ? quotable.flatMap(line=>{
    const quantity = line.source.quantity-(actedOn.get(line.orderItemId) ?? line.source.quantity);
    return (quantity>0 && line.replacementId) ? [{line,quantity}] : [];
  }) : [];
  const newQuote = (terms: PurchaseTerms): PurchaseTerms => ({...terms,linePayableCents:undefined,sourceReference:undefined,
    sourceSha256:undefined,sourceDocumentKind:undefined,sourceDocumentRow:undefined,verification:undefined});
  const legacyScope = Boolean(incident && !incident.scope);
  const openExceptions = po.commitmentExceptions.filter(row => !row.resolution);
  const legacyFiles = [...new Set(po.documentReviewLines.map(row => row.sha256))];
  const shortfalls = fulfillment.shortfalls.filter(row => row.purchaseOrderId === po.id);
  const pendingResends = fulfillment.freeResends.filter(row => row.purchaseOrderId === po.id && row.available > 0);
  const stockSourceNeedsReview = fulfillment.replacementsWithUnverifiedStockSource.some(row => row.purchaseOrderId === po.id);
  const canHandleShortfall = po.orderedBefore && !supplierCancelled && (pendingResends.length > 0 || shortfalls.some(row => row.available > 0));
  const closed = orderStatus === 'cancelled' || orderStatus === 'closed';
  const archiveTerms = (line: Purchase['lines'][number]) => revisions[line.orderItemId] ?? legacyTerms(line);
  const lineFor = (id: string) => po.lines.find(line => line.orderItemId === id)!;
  const incidentLineName = (row: IncidentQuantity) => {
    const product = lineFor(row.orderItemId)?.source;
    const original = product ? [product.name,product.catalogNumber,product.spec,'订单第 '+(product.position+1)+' 行'] : [row.orderItemId];
    if (!row.source) return original.filter(Boolean).join(' · ');
    const fact = po.incidentSources.find(item=>incidentQuantityKey(item)===incidentQuantityKey(row));
    return [...original,sourceNames[row.source.kind],fact?.reference ?? ('id' in row.source ? row.source.id : '')].filter(Boolean).join(' · ');
  };
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
  const unlinkedShortfalls=fulfillment.unlinkedDispatchShortfalls.filter(row=>row.purchaseOrderId===po.id);
  const recovery=unlinkedShortfalls.find(row=>row.key===shortfallHandoffKey);
  const waitingForDeliveryDecision=fulfillment.dispatchHolds.some(row=>row.purchaseOrderId===po.id && row.pending>0);
  if (!waitingForDeliveryDecision && !unlinkedShortfalls.length && ['approved', 'ordered'].includes(po.status) && !po.needsLegacyReview && !po.needsFundingReapproval && (!closed || po.orderedBefore)
    && po.dueCents !== null && Math.min(po.dueCents, po.totalCents - po.paidCents) > 0 && permit('pay')) choices.push('record_payment');
  if (po.lines.length && permit('write')) choices.push('report_change');

  function choose(next: Action, selectedIncident?: string) {
    setIncidentId(selectedIncident);setShortfallHandoffKey(undefined); setAction(next); setOutcome(canContinueOriginal ? 'original_terms' : 'declined');
    setRevisions({}); setDispositions({}); setCoordinationDocuments({}); setFileKinds({});
    setAffected({}); setHandling({}); setVerifiedScopeMatchesResult(false); setChangeKind('unavailable');
    setReviewResult('scope_confirmed');setRelatedIncidentId('');setRetainedTerms({});setRetainedDocuments({});setRetainedBuyerFiles({});
  }

  async function preview(data: FormData) {
    if (!action) return;
    try {
      const value = (key: string) => String(data.get(key) ?? '').trim() || undefined;
      const occurredAt = value('occurredAt');
      const resolvable = action === 'resolve_change' && committed && (outcome === 'declined' || outcome === 'replacement' || outcome === 'shortfall');
      const selectsHandling = action === 'resolve_change' && (outcome === 'original_terms' || withdrawingDraft || revisingDraft);
      if (selectsHandling && !revisingDraft && !outstanding?.length) throw new Error('请先核对原供货事项涉及的商品和数量');
      const scopeAction = action === 'report_change' || (action === 'review_change_scope' && reviewResult==='scope_confirmed')
        || (action === 'resolve_change' && legacyScope);
      if (action==='resolve_change' && split.some(({line})=>!retainedTerms[line.orderItemId])) {
        throw new Error('请填写留存份额自己的书面报价和金额');
      }
      const input: PurchaseActionInput = {
        orderId, purchaseOrderId: po.id, action, version: po.version, requestId: crypto.randomUUID(),
        reference: value('reference'), referenceSha256: value('referenceSha256'),
        occurredAt: occurredAt ? new Date(occurredAt).toISOString() : undefined,
        description: value('description'), conditionReference: value('conditionReference'),
        amountCents: action === 'record_payment' ? cents(String(data.get('amount') ?? '')) : undefined,
        changeKind: action === 'report_change' ? changeKind : undefined, outcome: action === 'resolve_change' ? outcome : undefined,
        incidentId: action === 'resolve_change' || action === 'review_change_scope' ? incidentId : undefined,
        reviewResult: action==='review_change_scope' ? reviewResult : undefined,
        relatedIncidentId: action==='review_change_scope' && reviewResult==='duplicate' ? relatedIncidentId : undefined,
        affectedLines: !recovery && declared.length && scopeAction ? declared : undefined,
        shortfallHandoffKey:action==='report_change' ? recovery?.key : undefined,
        coordinationLines: selectsHandling && selected.length ? selected : undefined,
        confirmsFullIncidentScope: action === 'resolve_change' && legacyScope && outcome!=='original_terms' && !withdrawingDraft && verifiedScopeMatchesResult ? true : undefined,
        retainedDraftTerms: action==='resolve_change' && split.length ? split.map(({line})=>({orderItemId:line.orderItemId,
          terms:retainedTerms[line.orderItemId],...retainedDocuments[line.orderItemId],
          customerDecision:retainedBuyerFiles[line.orderItemId]})) : undefined,
        responsibility: value('responsibility'),
        supplierReference: value('supplierReference'), supplierSha256: value('supplierSha256'),
        customerReference: value('customerReference'), customerSha256: value('customerSha256'), refundFollowup: value('refundFollowup'),
        revisedTerms: action === 'review_legacy_approval' ? po.lines.map(line => ({ orderItemId: line.orderItemId, terms: archiveTerms(line) }))
          : action === 'resolve_change' && outcome === 'revised_terms'
            ? quotable.map(line=>({orderItemId:line.orderItemId,terms:revisions[line.orderItemId]
              ?? (split.some(row=>row.line.orderItemId===line.orderItemId) ? newQuote(line.terms) : line.terms)})) : undefined,
        dispositions: resolvable ? Object.entries(dispositions).flatMap(([orderItemId, entry]) => !entry.quantity ? [] : [{
          orderItemId, ...entry, outcome: outcome === 'declined' ? 'cancel' : entry.outcome,
        }]) : undefined,
        decisionDocumentLines: action === 'resolve_change' && !resolvable
          ? Object.entries(coordinationDocuments).map(([orderItemId,document]) => ({ orderItemId,...document })) : undefined,
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
      <span>{supplierCancelled ? '供方整笔取消' : po.status === 'on_hold' && !po.incidents.length ? '采购暂停' : statuses[po.status]}</span></div>
    <p className="break-all text-xs text-slate-600">{po.id} · 第 {po.revision} 版</p>
    {po.lines[0]?.fromPurchaseOrderId && <p className="break-all text-sm">替代采购 · 原采购单 {po.lines[0].fromPurchaseOrderId}</p>}
    {stockSourceNeedsReview && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">
      原库存归属待核。请通过登记供货变化，按原采购行和书面授权留下核对人及发现的问题。
    </p>}
    <p className="text-sm">{po.remainingScope || po.dueCents === null ? '原合同应付' : '本单应付'} <strong>{money(po.totalCents)}</strong>　已登记实际付款 {money(po.paidCents)}</p>
    {po.remainingScope && <p className="text-sm">核准的剩余商品应付 {money(po.remainingScope.totalCents)} · 经核实冲抵 {money(po.remainingScope.appliedPaidCents)} · 尚未付 {money(po.dueCents ?? undefined)}</p>}
    {waitingForDeliveryDecision && <p className="text-sm text-amber-900">相关实发份额待客户书面处理。请在原包裹核对结果后继续付款办理。</p>}
    {unlinkedShortfalls.map(row=><div key={row.key} className="space-y-1 rounded bg-amber-50 p-2 text-sm text-amber-900">
      <p>已核实误发短失待采购接续 · {row.reference} · {row.quantity} 件</p>
      {!pending && permit('write') && <button type="button" className={button} disabled={busy} onClick={()=>{
        choose('report_change');setShortfallHandoffKey(row.key);setChangeKind('other');
      }}>接续已核实的误发短失</button>}
    </div>)}
    {po.needsRemainingReview && <p className="text-sm text-amber-900">{openExceptions.length
      ? '核对实际承诺后，再逐行核准原单剩余应付。'
      : '原单剩余应付待独立核准。供货协调结果可据实登记。'}</p>}
    {po.incidents.map(issue => <section key={issue.id} aria-label={'供货事项 '+issue.reference}
      className="space-y-1 rounded bg-amber-50 p-2 text-sm text-amber-900">
      <p>供货事项待办理 · {issue.reference} · 登记人 {issue.reportedBy}</p>
      <p>{issue.description}</p>
      {issue.responsibility && <p>待核对环节 {issue.responsibility}</p>}
      {issue.lastReviewedBy && <p>上次核对人 {issue.lastReviewedBy}</p>}
      {issue.factReview && <p>已核对事实 {issue.factReview.reference} · {issue.factReview.description}</p>}
      {issue.shortfallOrigin && <p>原事项 {po.incidentHistory.find(row=>row.id===issue.shortfallOrigin?.incidentId)?.reference ?? issue.shortfallOrigin.incidentId}
        {' · 原包裹 '+issue.shortfallOrigin.parcelId}</p>}
      {issue.shortfallFollowups?.map(result=><p key={result.activityId}>
        已核对误发短失 {result.quantity} 件 · {result.reference} · 后续责任人 {result.responsibility} · {result.description}
      </p>)}
      {issue.outstanding ? <ul className="pl-4">{issue.outstanding.map(row => <li key={incidentQuantityKey(row)}>
        {incidentLineName(row)} · 仍待办理 {row.quantity}
      </li>)}</ul> : <p>原影响范围待具名核对。</p>}
      {!pending && permit(committed ? 'approve' : 'write') && <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} onClick={()=>choose('review_change_scope',issue.id)}>{actionNames.review_change_scope}</button>
        <button type="button" className={button} disabled={busy} onClick={()=>choose('resolve_change',issue.id)}>{actionNames.resolve_change}</button>
      </div>}
    </section>)}
    {po.incidentHistory.some(issue=>issue.status==='duplicate' || issue.status==='no_impact') && <details className="text-sm">
      <summary className="cursor-pointer">已核对的补充通知</summary>
      {po.incidentHistory.filter(issue=>issue.status==='duplicate' || issue.status==='no_impact').map(issue=><p key={issue.id}>
        {issue.reference} · {issue.linkedTo ? '补充原事项 '+(po.incidentHistory.find(row=>row.id===issue.linkedTo)?.reference ?? issue.linkedTo) : '无新增影响'}
        {' · '+issue.factReview?.actorId+' · '+issue.factReview?.reference}
      </p>)}
    </details>}
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
        <details><summary className="cursor-pointer">查看当时记录</summary><p>操作记录编号 {entry.id}</p>
          <pre className="overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2">{JSON.stringify(entry.detail, null, 2)}</pre></details>
      </li>)}</ol></div></details>
    {!pending && <div className="flex flex-wrap gap-2">{choices.map(choice =>
      <button type="button" key={choice} className={button} disabled={busy} onClick={()=>choose(choice)}>
        {choice === 'register_order' && po.status === 'on_hold' ? '补录暂停前实际订购' : actionNames[choice]}
      </button>)}</div>}
    {action && !pending && <form key={action+'-'+(incidentId ?? '')} className="grid gap-3 border-t pt-3" onSubmit={event => {
      event.preventDefault();
      void preview(new FormData(event.currentTarget));
    }}>
      <strong className="text-sm">{actionNames[action]}{incident && ' · '+incident.reference}</strong>
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
      {action === 'report_change' && (recovery ? <fieldset className="space-y-2">
        <legend className="font-medium">接续已核实的误发短失</legend>
        <p className="text-sm">{recovery.reference} · {recovery.quantity} 件 · 原包裹 {recovery.parcelId}</p>
        <p className="text-sm">原事项 {po.incidentHistory.find(row=>row.id===(recovery.originalIncidentId ?? recovery.incidentId))?.reference
          ?? recovery.originalIncidentId ?? recovery.incidentId}</p>
        {inputField('reference','短失接续的档案出处')}
        {inputField('description','已核实的接续经过和结果')}
        {inputField('responsibility','采购后续责任人')}
      </fieldset> : <>
        <label className="grid gap-1 text-sm">变更类别<select className={field} value={changeKind}
          onChange={event => {setChangeKind(event.target.value as PurchaseActionInput['changeKind']);setAffected({});}}>
          <option value="unavailable">缺货</option><option value="delay">延期</option><option value="price">涨价或调价</option><option value="other">其他</option>
        </select></label>
        {inputField('reference', '供应商反馈来源')}{inputField('description', '受影响的商品和具体变化')}
        <label className="grid gap-1 text-sm">需要核对的供方或环节<input className={field} name="responsibility" maxLength={2000}/></label>
        <IncidentQuantityFields title="本次供货事项影响数量" quantities={sourceOptions} values={affected}
          lineName={incidentLineName} onChange={setAffected}/>
        <p className="text-sm">单纯承运延期请在对应运单登记物流异常。涉及采购条件时，按实际货物来源登记供货事项。</p>
        {!declared.length && <p className="text-sm">影响数量暂未核全时，可先登记，再凭原件核对范围。</p>}
      </>)}
      {action === 'review_change_scope' && <>
        <label className="grid gap-1 text-sm">通知核对结果<select className={field} value={reviewResult}
          onChange={event=>{setReviewResult(event.target.value as typeof reviewResult);setAffected({});setRelatedIncidentId('');}}>
          <option value="scope_confirmed">核实范围或补充事实</option><option value="duplicate">同一事项的补充通知</option>
          <option value="no_impact">经核实无新增影响</option>
        </select></label>
        {reviewResult==='duplicate' && <label className="grid gap-1 text-sm">对应原供货事项
          <select className={field} required value={relatedIncidentId} onChange={event=>setRelatedIncidentId(event.target.value)}>
            <option value="">请选择原事项</option>
            {po.incidentHistory.filter(row=>row.id!==incidentId && (row.status==='open' || row.status==='settled')).map(row=>
              <option key={row.id} value={row.id}>{row.reference} · {row.status==='open'?'仍待办理':'已记录处理结果'}</option>)}
          </select>
        </label>}
        {inputField('reference','核对范围的原凭据出处')}
        <DocumentDigestField name="referenceSha256" label="核对依据摘要"/>
        {inputField('description','实际受影响的货物与仍待协调的情况')}
        <label className="grid gap-1 text-sm">需要核对的供方或环节<input className={field} name="responsibility" maxLength={2000}/></label>
        {reviewResult==='scope_confirmed' && <>
          <IncidentQuantityFields title="核实后仍受影响的货物和数量" quantities={sourceOptions} values={affected}
            lineName={incidentLineName} onChange={setAffected}/>
          <p className="text-sm">{incident?.outstanding ? '不填写数量时，保留已登记的范围并追加事实。' : '按原凭据选择实际涉及的货物。'}商业决定仍在原事项继续办理。</p>
        </>}
      </>}
      {action === 'resolve_change' && <>
        <label className="grid gap-1 text-sm">协调结果<select className={field} value={outcome}
          onChange={event => { setOutcome(event.target.value as typeof outcome); setDispositions({}); setCoordinationDocuments({}); setHandling({}); setVerifiedScopeMatchesResult(false); setRetainedTerms({});setRetainedDocuments({});setRetainedBuyerFiles({});setRevisions({}); }}>
          {canContinueOriginal && <option value="original_terms">双方确认按原条款继续</option>}
          {canHandleShortfall && <option value="shortfall">按书面决定处理已核实短失</option>}
          {committed ? (!closed && <option value="replacement">按书面确认另建替代采购</option>)
            : <option value="revised_terms">双方同意修订，提交新版本独立审核</option>}
          <option value="declined">{committed ? '取消受影响数量' : '撤回客户未同意的草稿行'}</option>
        </select></label>
        {legacyScope && <>
          {!verifiedScopeMatchesResult && <IncidentQuantityFields title="原供货事项完整涉及范围" quantities={po.remaining} values={affected}
            lineName={incidentLineName} onChange={values=>{setAffected(values);setHandling({});}}/>}
          <label className="grid gap-1 text-sm">需要核对的供方或环节<input className={field} name="responsibility" maxLength={2000}/></label>
          <p className="text-sm">根据原反馈和双方书证核实涉及的全部商品。若还有未决商品或数量，请一并填入。</p>
        </>}
        {(outcome === 'original_terms' || withdrawingDraft || revisingDraft) && outstanding && <>
          <IncidentQuantityFields title={withdrawingDraft ? '本次撤回的草稿行数量' : revisingDraft ? '本次改办的草稿行数量' : '本次继续原约的数量'}
            quantities={outstanding} values={handling} lineName={incidentLineName}
            onChange={values=>{setHandling(values);setRevisions({});setRetainedTerms({});setRetainedDocuments({});setRetainedBuyerFiles({});}}/>
          <p className="text-sm">留空时本次办理上面已核实的全部未决数量。书证允许范围可另行录入。</p>
        </>}
        {inputField('supplierReference', '人工与供应商协调的书面依据')}
        {inputField('customerReference', '客户对方案的回复依据')}
        {(committed || continueWithEvidence) && <>
          <DocumentDigestField name="supplierSha256" label="供方书面回复摘要" required/>
          <DocumentDigestField name="customerSha256" label="客户书面回复摘要" required/>
        </>}
        {!committed && revisingReplacement && <DocumentDigestField name="customerSha256" label="替代条件变更后客户同意的书证摘要"/>}
        {withdrawingReplacement && !continueWithEvidence && <DocumentDigestField name="customerSha256" label="客户书面撤回依据摘要" required/>}
        {(continueWithEvidence || revisingReplacement || withdrawingReplacement) && po.lines.flatMap(line => {
          const quantity = revisingReplacement
            ? (line.fromPurchaseOrderId && quotable.some(row=>row.orderItemId===line.orderItemId) ? actedOn.get(line.orderItemId) ?? line.source.quantity : 0)
            : (handled.find(row => row.orderItemId === line.orderItemId)?.quantity ?? 0);
          if (!quantity) return [];
          return [<fieldset key={line.orderItemId} className="space-y-2 rounded border p-3">
            <legend>{line.source.name} · 书面决定范围 {quantity}</legend>
            <LineDecisionDocuments value={coordinationDocuments[line.orderItemId] ?? {}} customerOnly={revisingReplacement || (withdrawingReplacement && !continueWithEvidence)}
              current={{ orderId,purchaseOrderId:po.id,orderItemId:line.orderItemId,quantity }} choices={orderedSubjects}
              onChange={document => setCoordinationDocuments(current => ({ ...current,[line.orderItemId]:document }))}/>
          </fieldset>];
        })}
        {inputField('description', '双方确认的具体结果')}
        {revisingDraft && quotable.map(line=>{
          const quantity = actedOn.get(line.orderItemId) ?? line.source.quantity;
          return <PurchaseLineFields key={line.orderItemId+'-'+quantity} line={{source:{...line.source,quantity}}}
            values={revisions[line.orderItemId] ?? (quantity<line.source.quantity ? newQuote(line.terms) : line.terms)} onChange={terms=>{
              setRevisions({...revisions,[line.orderItemId]:terms});setVerifiedScopeMatchesResult(false);
            }}/>;
        })}
        {split.map(({line,quantity})=>{
          const id = line.orderItemId;
          const buyerFile = retainedBuyerFiles[id];
          return <fieldset key={id+'-retained-'+quantity} className="space-y-3 rounded border p-3">
          <legend>{line.source.name} · 留存 {quantity} · 原供货及付款组的书面新报价</legend>
          <PurchaseLineFields line={{source:{...line.source,quantity}}} values={retainedTerms[line.orderItemId] ?? newQuote(line.terms)}
            lockedTerms={{supplier:line.terms.supplier,payee:line.terms.payee,paymentTerms:line.terms.paymentTerms,currency:line.terms.currency}}
            onChange={terms=>setRetainedTerms({...retainedTerms,[line.orderItemId]:terms})}/>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(buyerFile)}
            onChange={event=>setRetainedBuyerFiles({...retainedBuyerFiles,[id]:event.target.checked?{reference:'',sha256:''}:undefined})}/>
            留存份额另有客户书证
          </label>
          {buyerFile && <>
            <label className="grid gap-1 text-sm">客户同意留存份额的书证出处
              <input className={field} value={buyerFile.reference} required maxLength={2000}
                onChange={event=>setRetainedBuyerFiles({...retainedBuyerFiles,[id]:{...buyerFile,reference:event.target.value}})}/>
            </label>
            <DocumentDigestField label="客户同意留存份额的书证摘要" value={buyerFile.sha256} required
              onChange={sha256=>setRetainedBuyerFiles({...retainedBuyerFiles,[id]:{...buyerFile,sha256}})}/>
          </>}
          <LineDecisionDocuments value={retainedDocuments[id] ?? {}} customerOnly
            current={{orderId,purchaseOrderId:po.id,orderItemId:id,quantity}} choices={orderedSubjects}
            onChange={documents=>setRetainedDocuments({...retainedDocuments,[id]:documents})}/>
        </fieldset>;
        })}
        {committed && (outcome === 'declined' || outcome === 'replacement' || outcome === 'shortfall') && <>
          {po.lines.flatMap(line => {
            const sent = fulfillment.supplierDispatched.filter(row => row.purchaseOrderId === po.id && row.orderItemId === line.orderItemId)
              .reduce((sum,row) => sum + row.quantity,0);
            const quantity = Math.max(0,(po.remaining.find(row => row.orderItemId === line.orderItemId)?.quantity ?? 0)-sent);
            const scope = outstanding?.filter(row=>row.orderItemId===line.orderItemId);
            const canUse = (kind: 'shortfall' | 'resend', id: string) => !scope || scope.some(row=>!row.source ||
              (row.source.kind===kind && row.source.id===id));
            const losses = outcome === 'shortfall' ? shortfalls.filter(row=>row.orderItemId===line.orderItemId && canUse('shortfall',row.resolutionId)) : [];
            const resends = outcome === 'shortfall' ? pendingResends.filter(row=>row.orderItemId===line.orderItemId && canUse('resend',row.approvalId)) : [];
            const incidentLimit = scope?.filter(row=>!row.source || (outcome === 'shortfall'
              ? row.source.kind==='shortfall' || row.source.kind==='resend' : row.source.kind==='unshipped'))
              .reduce((sum,row)=>sum+row.quantity,0);
            return (incidentLimit !== 0 && (outcome === 'shortfall' ? resends.length > 0 || losses.some(row => row.available > 0) : quantity > 0))
              ? [<DispositionFields key={line.orderItemId} line={line}
              quantity={quantity} losses={losses} resends={resends} shortfall={outcome === 'shortfall'} allowReplacement={outcome !== 'declined'}
              choices={scopeSubjects} incidentLimit={incidentLimit}
              current={{ orderId,purchaseOrderId:po.id,orderItemId:line.orderItemId,quantity:line.source.quantity }}
              value={dispositions[line.orderItemId] ?? { quantity: 0, outcome: 'cancel' }}
              onChange={entry => {
                setDispositions({ ...dispositions, [line.orderItemId]: entry }); setVerifiedScopeMatchesResult(false);
              }}/>] : [];
          })}
          {po.paidCents > 0 && Object.values(dispositions).some(row => row.quantity > 0 && (!row.shortfallId || row.shortfallDecision === 'change_contract'))
            && inputField('refundFollowup', '原付款与未决退款的后续核对安排')}
        </>}
        {legacyScope && outcome !== 'original_terms' && !withdrawingDraft && <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={verifiedScopeMatchesResult}
            onChange={event=>{setVerifiedScopeMatchesResult(event.target.checked);setAffected({});}}/>
          我已核实，本次处置涵盖原事项涉及的全部商品和数量
        </label>}
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
      {op.action === 'report_change' && <>
        <p>供货变化　{op.description}</p>
        {'shortfallRecovery' in op && op.shortfallRecovery && <div className="space-y-1">
          <p>原短失核对 {op.shortfallRecovery.reviewReference} · 责任人 {op.responsibility}</p>
          <p>原包裹 {op.shortfallRecovery.purchaseFollowup.target.parcelId}
            {' · 已有合同决定覆盖 '+op.shortfallRecovery.purchaseFollowup.decisionLinks.reduce((sum,row)=>sum+row.quantity,0)+' 件'}
            {' · 新建待办 '+op.shortfallRecovery.purchaseFollowup.reportQuantity+' 件'}</p>
          {op.shortfallRecovery.purchaseFollowup.transfers.length>0 && <p>沿用已有采购事项 · {op.shortfallRecovery.purchaseFollowup.transfers
            .map(row=>row.incidentId+' · '+row.from.quantity+' 件').join('、')}</p>}
        </div>}
        {op.affectedLines?.map(row => <p key={row.orderItemId}>{lineFor(row.orderItemId)?.source.name} · 涉及 {row.quantity}</p>)}
      </>}
      {(op.action === 'report_change' || op.action === 'review_change_scope' || op.action === 'resolve_change') && op.supplyFacts?.map(row => <p key={row.orderItemId}>
        {lineFor(row.orderItemId)?.source.name} · 客户已核实实收 {row.customerReceived} · 发往客户待核实收 {row.customerTransit}
        {' · 仓库已实收 '+row.warehouseReceived+' · 入仓在途 '+row.warehouseTransit+' · 客户单待发 '+row.customerUnshipped}
        {row.shortfalls.length > 0 && ' · 已核实短失 '+row.shortfalls.map(loss => loss.reference+' '+loss.quantity).join('、')}
      </p>)}
      {op.action === 'review_change_scope' && <>
        <p>具名核对依据 {op.reference} · {op.description}</p>
        {op.reviewResult==='duplicate' && 'relatedIncident' in op && <p>补充原事项 {op.relatedIncident?.reference} · 新增影响 0</p>}
        {op.reviewResult==='no_impact' && <p>经核实无新增影响</p>}
        {op.outstanding.map(row=><p key={incidentQuantityKey(row)}>{incidentLineName(row)} · 仍待协调 {row.quantity}</p>)}
      </>}
      {op.action === 'resolve_change' && <>
        <p>本次处理 {op.incidentProgress.handled.map(row => (lineFor(row.orderItemId)?.source.name ?? row.orderItemId)+' '+row.quantity).join('、')}</p>
        {op.incidentProgress.outstanding.length > 0 && <p>仍待办理 {op.incidentProgress.outstanding
          .map(row => (lineFor(row.orderItemId)?.source.name ?? row.orderItemId)+' '+row.quantity).join('、')}</p>}
        <p>协调结果　{op.description}</p>
        <p>供应商依据　{op.supplierReference}</p><p>客户回复　{op.customerReference}</p>
        {op.withdrawnDraftLines?.map(row=><p key={row.orderItemId}>撤回草稿行 {lineFor(row.orderItemId)?.source.name} · {row.quantity} · 原报价 {money(row.quotedCents ?? undefined)}</p>)}
        {op.draftGroups?.moves.map(row=><p key={row.orderItemId}>{lineFor(row.orderItemId)?.source.name} 将进入新的供货付款组，待独立批准。</p>)}
        {op.draftAllocations?.map(row=><div key={row.orderItemId} className="space-y-1">
          <p>原报价 {row.originalQuantity} 件 · {money(row.originalQuotedCents)}</p>
          <p>原组留存 {row.retained.source.quantity} 件 · 新报价 {money(row.retained.terms.linePayableCents)}</p>
          <LineDetails line={row.retained}/>
          <p>{row.moved ? '另组 '+row.moved.source.quantity+' 件 · 新报价 '+money(row.moved.terms.linePayableCents)+' · 待独立批准'
            : '撤回 '+row.quantity+' 件草稿'}</p>
          {row.moved && <LineDetails line={row.moved}/>}
        </div>)}
        {op.revisedTerms?.map(edit => <div key={edit.orderItemId}><strong>拟修订条款</strong>
          <LineDetails line={{ source: po.lines.find(line => line.orderItemId === edit.orderItemId)!.source, terms: edit.terms }}/></div>)}
        {op.dispositions?.map(entry => <div key={entry.orderItemId}>
          <p>{entry.outcome === 'resend' ? '免费重发，保留原合同' : entry.shortfallDecision === 'new_purchase' ? '保留原合同应付，另建采购'
            : entry.outcome === 'cancel' ? '取消原合同份额' : '变更原合同并另建采购'} · 原订单行 {entry.orderItemId} · 数量 {entry.quantity}</p>
          {entry.priorResend && <p className="break-all">原免费批准 {entry.revisesResendApprovalId} · 核准 {entry.priorResend.authorized} · 已发 {entry.priorResend.dispatched} · 已改办 {entry.priorResend.redirected} · 本次改办 {entry.quantity}</p>}
          {entry.supplierDocumentRow && <p>供方决定原件第 {entry.supplierDocumentRow} 行</p>}
          {entry.customerDocumentRow && <p>客户同意原件第 {entry.customerDocumentRow} 行</p>}
          {entry.contractSource && <p>对应原合同发货凭据 {entry.contractSource.reference}</p>}
          {entry.replacement && <LineDetails line={entry.replacement}/>}
        </div>)}
        {'decisionDocuments' in op && op.decisionDocuments?.map(document => <div key={document.role+document.sha256+document.row} className="text-sm">
          <p>{document.role === 'supplier' ? '供方书证' : '客户书证'} · {document.row ? '原件第 '+document.row+' 行' : '整份使用'}
            {document.reference && ' · '+document.reference}
          </p>
          {document.authority && <p>{decisionPurposeLabels[document.authority.purpose]}
            {document.authority.alternate && ' · 供方 '+document.authority.alternate.supplier+' · 货号 '+document.authority.alternate.catalogNumber}
          </p>}
          {document.legacyLocations?.map(row => <p key={[row.activityId,row.orderItemId,row.row].join('/')}>
            旧批准 {row.activityId} · 原件第 {row.row} 行 · 原已使用 {row.quantity}
          </p>)}
          <ul className="pl-4">
            {document.balances.map(row => <li key={scopeKey(row)}>
              {scopeSubjects.find(({subject}) => scopeKey(subject) === scopeKey(row))?.name ?? (row.shortfallId ? row.orderItemId+' · '+row.shortfallId : row.orderItemId)}
              {' · 核准 '+row.quantity+' · 已用 '+row.usedBefore+' · 本次 '+row.using+' · 办理后剩余 '+row.remaining}
            </li>)}
          </ul>
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
