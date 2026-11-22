'use client';

import { useState } from 'react';
import type { purchaseWorkspace } from '@/lib/purchase-orders';
import type { PurchaseTerms } from '@/lib/purchase-terms';
import DocumentDigestField from './DocumentDigestField';

export type Workspace = Awaited<ReturnType<typeof purchaseWorkspace>>;
export type Line = Workspace['lines'][number];
export type Purchase = Workspace['orders'][number];
export const money = (v: number | undefined) => v == null ? '待核实' : new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(v/100);
export const field = 'rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-950';
export const button = 'rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50';
export const primary = 'rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50';
export const statuses = { draft:'待独立批准',approved:'采购已批准',ordered:'已登记供应商订购',on_hold:'供货变化待处理',superseded:'草稿已归并' };
export const actionNames = { approve:'批准采购单',approve_lead_time:'单独批准超长订货周期',register_order:'登记供应商订购结果',record_payment:'登记实际付款',
  report_change:'登记供货变化',review_change_scope:'核对供货事项范围',resolve_change:'回填协调结果',prepare:'准备采购',save_line:'保存采购资料',
  review_legacy_approval:'复核旧采购批准',approve_remaining:'核准原单剩余应付',record_late_order_exception:'登记实际订购异常',
  resolve_order_exception:'核对订购异常处理结果',
  reapprove_purchase:'重新核准本单后续动作',link_dispatch_shortfall:'关联已核实短失的采购依据' };

const textFields = {
  supplier:'供货方全称',payee:'收款方全称',paymentTerms:'供应商付款条件',
  freightTerms:'运费及其他费用',leadTime:'供货期',sourceReference:'供应商书面报价依据',
  settlementReference:'收款方及付款条件书面依据',coordinationReference:'本单交期及客户条件核实依据',amountBreakdown:'行金额差额及计算依据',
  writtenSupplier:'报价原文所列供货方',supplierConditions:'原函所列供货条件',identityReference:'供货方简称与法人主体对应依据',
} as const;
type TextKey = keyof typeof textFields;

export function cents(raw: string, allowsZero = false) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw.trim())) throw new Error('请填写最多两位小数的人民币金额');
  const [yuan,frac = ''] = raw.trim().split('.');
  const v = Number(yuan) * 100 + Number(frac.padEnd(2,'0'));
  if (!Number.isSafeInteger(v) || v < 0 || (!allowsZero && v === 0)) throw new Error(allowsZero ? '请填写有效金额' : '请填写大于零的有效金额');
  return v;
}
const localDate = (iso?:string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,-1);
};

export function LineDetails({line}:{line:Pick<Line,'source'|'terms'>}) {
  const {source,terms} = line;
  return <div className="space-y-1 text-sm">
    <strong>{source.name} · {source.quantity} {source.unit ?? '件'}</strong>
    <p>{[source.brand,source.catalogNumber,source.spec].filter(Boolean).join(' · ')}</p>
    <p>供货方 {terms.supplier || '待核实'}　收款方 {terms.payee || '待核实'}</p>
    <p>采购单价 {money(terms.unitPriceCents)}　行应付 {money(terms.linePayableCents)}　{terms.taxBasis === 'included' ? '单价含税' : terms.taxBasis === 'excluded' ? '单价未税' : '税费口径待核实'}</p>
    <p>付款条件　{terms.paymentTerms || '待供应商确认'}</p>
    <p>运费及其他费用　{terms.freightTerms || '待核实'}{terms.amountBreakdown && ` · ${terms.amountBreakdown}`}</p>
    <p>供货期　{terms.leadTime || '待核实'}　报价有效至 {terms.validUntil ? new Date(terms.validUntil).toLocaleString('zh-CN') : '待核实'}</p>
    <p>书面报价依据　{terms.sourceReference || '待补'}</p>
    {terms.sourceDocumentKind === 'multiple_items' && <p>报价原件商品行 {terms.sourceDocumentRow}</p>}
    {terms.writtenSupplier && <p>原函供货方　{terms.writtenSupplier}{terms.identityReference && ` · 法人核对 ${terms.identityReference}`}</p>}
    {terms.supplierConditions && <p>原函供货条件　{terms.supplierConditions}</p>}
    {terms.settlementReference && <p>结算依据　{terms.settlementReference}</p>}
    {terms.verification && <p>书证核对　{terms.verification.actorEmail} · {new Date(terms.verification.verifiedAt).toLocaleString('zh-CN')}</p>}
    <p>交期及客户条件核实依据　{terms.coordinationReference || '待补'}</p>
  </div>;
}

export function PurchaseLineFields({line,values,onChange,lockedTerms}:{line:Pick<Line,'source'>;values:PurchaseTerms;onChange:(v:PurchaseTerms)=>void;lockedTerms?:PurchaseTerms}) {
  const [amounts,setAmounts] = useState({ unitPriceCents:values.unitPriceCents == null ? '' : (values.unitPriceCents/100).toFixed(2),
    linePayableCents:values.linePayableCents == null ? '' : (values.linePayableCents/100).toFixed(2) });
  const editable = (key: keyof PurchaseTerms) => lockedTerms?.[key] === undefined;
  return <fieldset className="grid gap-3 sm:grid-cols-2">
    <legend className="mb-2 font-medium">{line.source.catalogNumber || line.source.name} · 数量 {line.source.quantity}</legend>
    {(Object.entries(textFields) as [TextKey,string][]).filter(([key]) => editable(key)).map(([k,label]) => <label key={k} className="grid gap-1 text-xs">{label}
      <input className={field} value={values[k] ?? ''} maxLength={2000} onChange={e => onChange({...values,[k]:e.target.value})}/></label>)}
    {editable('sourceSha256') && <DocumentDigestField label="供货书证摘要" value={values.sourceSha256 ?? ''} onChange={sourceSha256 => onChange({ ...values, sourceSha256 })}/>}
    {editable('sourceDocumentKind') && <label className="grid gap-1 text-xs">供货书证覆盖范围
      <select className={field} value={values.sourceDocumentKind ?? 'single_item'} onChange={event => onChange({
        ...values, sourceDocumentKind: event.target.value as PurchaseTerms['sourceDocumentKind'], sourceDocumentRow: undefined,
      })}>
        <option value="single_item">本商品和数量的单项报价</option><option value="multiple_items">原件列明多项报价</option>
      </select>
    </label>}
    {values.sourceDocumentKind === 'multiple_items' && editable('sourceDocumentRow') && <label className="grid gap-1 text-xs">商品在报价原件中的行序号
      <input className={field} type="number" min={1} step={1} required value={values.sourceDocumentRow ?? ''}
        onChange={event => onChange({ ...values, sourceDocumentRow: event.target.value ? Number(event.target.value) : undefined })}/>
    </label>}
    {editable('settlementSha256') && <DocumentDigestField label="结算书证摘要" value={values.settlementSha256 ?? ''} onChange={settlementSha256 => onChange({ ...values, settlementSha256 })}/>}
    {editable('identitySha256') && values.writtenSupplier && values.supplier && values.writtenSupplier !== values.supplier &&
      <DocumentDigestField label="法人主体映射书证摘要" value={values.identitySha256 ?? ''} onChange={identitySha256 => onChange({ ...values, identitySha256 })}/>}
    {editable('leadTimeAssessment') && <label className="grid gap-1 text-xs">本单交期核对结果
      <select className={field} value={values.leadTimeAssessment ?? ''} onChange={e => onChange({ ...values, leadTimeAssessment: e.target.value as PurchaseTerms['leadTimeAssessment'] })}>
        <option value="">待核对</option><option value="within_agreement">符合本单客户交期约定</option>
        <option value="exception_required">超出约定，须单独批准</option>
      </select>
    </label>}
    {(['unitPriceCents','linePayableCents'] as const).filter(editable).map(k => <label key={k} className="grid gap-1 text-xs">
      {k==='unitPriceCents' ? '采购单价（元）' : '含税含费用的本行应付合计（元）'}
      <input className={field} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={amounts[k]} onChange={e=>{
        const raw=e.target.value; setAmounts({...amounts,[k]:raw});
        let value; try { value=cents(raw); } catch { value=undefined; }
        onChange({...values,[k]:value});
      }}/></label>)}
    {editable('currency') && <label className="grid gap-1 text-xs">币种<select className={field} value={values.currency ?? ''} onChange={e=>onChange({...values,currency:e.target.value==='CNY'?'CNY':undefined})}>
      <option value="">待核实</option><option value="CNY">人民币</option></select></label>}
    {editable('taxBasis') && <label className="grid gap-1 text-xs">单价税费口径<select className={field} value={values.taxBasis ?? ''} onChange={e=>onChange({...values,taxBasis:e.target.value as PurchaseTerms['taxBasis']})}>
      <option value="">待核实</option><option value="included">含税</option><option value="excluded">未税</option></select></label>}
    {editable('validUntil') && <label className="grid gap-1 text-xs">报价有效至（本地时间）<input type="datetime-local" step="0.001" className={field} value={localDate(values.validUntil)} onChange={e=>onChange({...values,validUntil:e.target.value?new Date(e.target.value).toISOString():undefined})}/></label>}
  </fieldset>;
}

export default function PurchaseLineForm({line,enabled,busy,save}:{line:Line;enabled:boolean;busy:boolean;save:(line:Line,terms:PurchaseTerms,checkedEvidence:boolean)=>Promise<void>}) {
  const [terms,setTerms]=useState(line.terms);
  const [checkedEvidence,setCheckedEvidence]=useState(false);
  const written=line.source.written;
  return <article className="space-y-3 rounded border border-slate-200 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong>{line.source.name} · {line.source.quantity} {line.source.unit ?? '件'}</strong>
      <span className="text-xs text-slate-600">经办人 {line.ownerId}</span></div>
    <p className="text-sm">{[line.source.brand,line.source.catalogNumber,line.source.spec].filter(Boolean).join(' · ')}</p>
    {line.availableQuantity !== line.source.quantity && <p className="text-sm">客户订单行当前未发货 {line.availableQuantity} {line.source.unit ?? '件'}</p>}
    {written && <div className="rounded bg-slate-50 p-3 text-sm">
      <p>原供应商回复　{written.supplier} · {money(written.unitPriceCents)}</p><p>{written.conditions}</p>
      <p>{written.leadTime}</p><p>依据　{written.channel} · {written.reference}</p>
    </div>}
    {line.missing.length>0 && <p className="text-sm text-amber-800">待补　{line.missing.join('、')}</p>}
    {line.purchaseOrderId && <p className="break-all text-xs">采购单 {line.purchaseOrderId}</p>}
    {enabled && <details><summary className="cursor-pointer text-sm font-medium">编辑本行采购资料</summary>
      <form className="mt-3 space-y-3" onSubmit={async e=>{e.preventDefault();await save(line,terms,checkedEvidence);}}>
        <PurchaseLineFields line={line} values={terms} onChange={newTerms => { setTerms(newTerms); setCheckedEvidence(false); }}/>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={checkedEvidence} onChange={e => setCheckedEvidence(e.target.checked)}/>
          我已核对本行供货方、收款方、付款条件和交期的书面原件
        </label>
        <button disabled={busy} className={button}>保存本行资料</button>
      </form></details>}
  </article>;
}
