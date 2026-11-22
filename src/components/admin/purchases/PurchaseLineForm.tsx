'use client';

import { useState } from 'react';
import type { purchaseWorkspace } from '@/lib/purchase-orders';
import type { PurchaseTerms } from '@/lib/purchase-terms';

export type Workspace = Awaited<ReturnType<typeof purchaseWorkspace>>;
export type Line = Workspace['lines'][number];
export type Purchase = Workspace['orders'][number];
export const money = (v: number | undefined) => v == null ? '待核实' : new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(v/100);
export const field = 'rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-950';
export const button = 'rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50';
export const primary = 'rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50';
export const statuses = { draft:'待独立批准',approved:'采购已批准',ordered:'已登记供应商订购',on_hold:'供货变化待处理',superseded:'草稿已归并' };
export const actionNames = { approve:'批准采购单',register_order:'登记供应商订购结果',record_payment:'登记实际付款',
  report_change:'登记供货变化',resolve_change:'回填协调结果',prepare:'准备采购',save_line:'保存采购资料' };

const textFields = {
  supplier:'供货方全称',payee:'收款方全称',paymentTerms:'供应商付款条件',
  freightTerms:'运费及其他费用',leadTime:'供货期',sourceReference:'供应商书面报价依据',
  settlementReference:'收款方及付款条件补充依据',coordinationReference:'本单交期及客户条件核实依据',amountBreakdown:'行金额差额及计算依据',
} as const;
type TextKey = keyof typeof textFields;

export function cents(raw: string) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw.trim())) throw new Error('请填写最多两位小数的人民币金额');
  const [yuan,frac = ''] = raw.trim().split('.');
  const v = Number(yuan) * 100 + Number(frac.padEnd(2,'0'));
  if (!Number.isSafeInteger(v) || v <= 0) throw new Error('请填写大于零的有效金额');
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
    {terms.settlementReference && <p>结算依据　{terms.settlementReference}</p>}
    <p>交期及客户条件核实依据　{terms.coordinationReference || '待补'}</p>
  </div>;
}

export function PurchaseLineFields({line,values,onChange}:{line:Line;values:PurchaseTerms;onChange:(v:PurchaseTerms)=>void}) {
  const [amounts,setAmounts] = useState({ unitPriceCents:values.unitPriceCents == null ? '' : (values.unitPriceCents/100).toFixed(2),
    linePayableCents:values.linePayableCents == null ? '' : (values.linePayableCents/100).toFixed(2) });
  return <fieldset className="grid gap-3 sm:grid-cols-2">
    <legend className="mb-2 font-medium">{line.source.catalogNumber || line.source.name} · 数量 {line.source.quantity}</legend>
    {(Object.entries(textFields) as [TextKey,string][]).map(([k,label]) => <label key={k} className="grid gap-1 text-xs">{label}
      <input className={field} value={values[k] ?? ''} maxLength={2000} onChange={e => onChange({...values,[k]:e.target.value})}/></label>)}
    {(['unitPriceCents','linePayableCents'] as const).map(k => <label key={k} className="grid gap-1 text-xs">
      {k==='unitPriceCents' ? '采购单价（元）' : '含税含费用的本行应付合计（元）'}
      <input className={field} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" value={amounts[k]} onChange={e=>{
        const raw=e.target.value; setAmounts({...amounts,[k]:raw});
        let value; try { value=cents(raw); } catch { value=undefined; }
        onChange({...values,[k]:value});
      }}/></label>)}
    <label className="grid gap-1 text-xs">币种<select className={field} value={values.currency ?? ''} onChange={e=>onChange({...values,currency:e.target.value==='CNY'?'CNY':undefined})}>
      <option value="">待核实</option><option value="CNY">人民币</option></select></label>
    <label className="grid gap-1 text-xs">单价税费口径<select className={field} value={values.taxBasis ?? ''} onChange={e=>onChange({...values,taxBasis:e.target.value as PurchaseTerms['taxBasis']})}>
      <option value="">待核实</option><option value="included">含税</option><option value="excluded">未税</option></select></label>
    <label className="grid gap-1 text-xs">报价有效至（本地时间）<input type="datetime-local" step="0.001" className={field} value={localDate(values.validUntil)} onChange={e=>onChange({...values,validUntil:e.target.value?new Date(e.target.value).toISOString():undefined})}/></label>
  </fieldset>;
}

export default function PurchaseLineForm({line,enabled,busy,save}:{line:Line;enabled:boolean;busy:boolean;save:(line:Line,terms:PurchaseTerms)=>Promise<void>}) {
  const [terms,setTerms]=useState(line.terms);
  const written=line.source.written;
  return <article className="space-y-3 rounded border border-slate-200 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><strong>{line.source.name} · {line.source.quantity} {line.source.unit ?? '件'}</strong>
      <span className="text-xs text-slate-600">经办人 {line.ownerId}</span></div>
    <p className="text-sm">{[line.source.brand,line.source.catalogNumber,line.source.spec].filter(Boolean).join(' · ')}</p>
    {written && <div className="rounded bg-slate-50 p-3 text-sm">
      <p>原供应商回复　{written.supplier} · {money(written.unitPriceCents)}</p><p>{written.conditions}</p>
      <p>{written.leadTime}</p><p>依据　{written.channel} · {written.reference}</p>
    </div>}
    {line.missing.length>0 && <p className="text-sm text-amber-800">待补　{line.missing.join('、')}</p>}
    {line.purchaseOrderId && <p className="break-all text-xs">采购单 {line.purchaseOrderId}</p>}
    {enabled && <details><summary className="cursor-pointer text-sm font-medium">编辑本行采购资料</summary>
      <form className="mt-3 space-y-3" onSubmit={async e=>{e.preventDefault();await save(line,terms);}}>
        <PurchaseLineFields line={line} values={terms} onChange={setTerms}/><button disabled={busy} className={button}>保存本行资料</button>
      </form></details>}
  </article>;
}
