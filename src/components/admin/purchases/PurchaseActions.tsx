'use client';

import { useState } from 'react';
import type { PurchaseActionInput, previewPurchaseAction } from '@/lib/purchase-orders';
import type { PurchaseTerms } from '@/lib/purchase-terms';
import { actionNames, button, cents, field, LineDetails, money, primary, PurchaseLineFields, statuses, type Purchase } from './PurchaseLineForm';

type Action = PurchaseActionInput['action'];
type Preview = Awaited<ReturnType<typeof previewPurchaseAction>>;
type Pending = { input:PurchaseActionInput; preview:Preview };
export default function PurchaseActions({orderId,po,permissions,busy,request,onError}:{orderId:string;po:Purchase;permissions:string[];busy:boolean;
  request:(body:Record<string,unknown>)=>Promise<{preview?:Preview}|undefined>;onError:(message:string)=>void}) {
  const [action,setAction]=useState<Action|null>(null);
  const [pending,setPending]=useState<Pending|null>(null);
  const [revisions,setRevisions]=useState<Record<string,PurchaseTerms>>({});
  const permit=(key:string)=>permissions.includes(`purchases.${key}`);
  const choices:Action[]=[];
  if (po.status==='draft' && permit('approve')) choices.push('approve');
  if (po.status==='approved' && !po.orderedBefore && permit('write')) choices.push('register_order');
  if (['approved','ordered'].includes(po.status) && po.paidCents<po.totalCents && permit('pay')) choices.push('record_payment');
  if (permit('write')) choices.push(po.status==='on_hold'?'resolve_change':'report_change');
  const [outcome,setOutcome]=useState<PurchaseActionInput['outcome']>('original_terms');
  const preview=async (data:FormData)=>{
    if (!action) return;
    try {
      const value=(k:string)=>String(data.get(k)??'').trim()||undefined;
      const input:PurchaseActionInput={orderId,purchaseOrderId:po.id,action,version:po.version,requestId:crypto.randomUUID(),
        reference:value('reference'),description:value('description'),conditionReference:value('conditionReference'),
        amountCents:action==='record_payment'?cents(String(data.get('amount')??'')):undefined,
        changeKind:value('changeKind') as PurchaseActionInput['changeKind'],outcome:action==='resolve_change'?outcome:undefined,
        supplierReference:value('supplierReference'),customerReference:value('customerReference'),
        revisedTerms:action==='resolve_change'&&outcome==='revised_terms'?po.lines.map(l=>({orderItemId:l.orderItemId,terms:revisions[l.orderItemId]??l.terms})):undefined};
      const result=await request({...input,stage:'preview'});
      if (result?.preview) setPending({input,preview:result.preview});
    } catch (e) { onError(e instanceof Error?e.message:'请核对填写内容'); }
  };
  const inputField=(key:string,label:string)=> <label className="grid gap-1 text-sm">{label}<input className={field} name={key} required maxLength={2000}/></label>;
  const op=pending?.preview.snapshot.operation;
  return <article className="space-y-3 rounded border border-slate-200 p-4">
    <div className="flex flex-wrap justify-between gap-2"><strong>{po.lines[0]?.terms.supplier}</strong><span>{statuses[po.status]}</span></div>
    <p className="break-all text-xs text-slate-600">{po.id} · 第 {po.revision} 版</p>
    <p className="text-sm">本单应付 <strong>{money(po.totalCents)}</strong>　已登记实际付款 {money(po.paidCents)}</p>
    <details><summary className="cursor-pointer text-sm">查看采购条款和操作记录</summary><div className="mt-3 space-y-3">
      {po.lines.map(l=><LineDetails key={l.orderItemId} line={l}/>)}
      <ol className="space-y-1 text-xs text-slate-700">{po.ledger.map(e=><li key={e.id}>
        {new Date(e.createdAt).toLocaleString('zh-CN')} · {actionNames[e.action as keyof typeof actionNames]??e.action} · {e.actorId}
        {e.amountCents!=null&&` · ${money(e.amountCents)}`}
        <details><summary className="cursor-pointer">查看当时记录</summary><pre className="overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2">{JSON.stringify(e.detail,null,2)}</pre></details>
      </li>)}</ol></div></details>
    {!pending && <div className="flex flex-wrap gap-2">{choices.map(a=><button type="button" key={a} className={button} disabled={busy}
      onClick={()=>{setAction(a);setOutcome('original_terms');setRevisions({});}}>{actionNames[a]}</button>)}</div>}
    {action&&!pending&&<form key={action} className="grid gap-3 border-t pt-3" onSubmit={async e=>{e.preventDefault();await preview(new FormData(e.currentTarget));}}>
      <strong className="text-sm">{actionNames[action]}</strong>
      {action==='register_order'&&inputField('reference','供应商已接受订购的单据或书面确认编号')}
      {action==='record_payment'&&<>{inputField('amount','本次实际支付金额（元）')}{inputField('conditionReference','本次付款条件已满足的依据')}{inputField('reference','实际付款流水或银行凭证编号')}</>}
      {action==='report_change'&&<><label className="grid gap-1 text-sm">变更类别<select className={field} name="changeKind"><option value="unavailable">缺货</option><option value="delay">延期</option><option value="price">涨价或调价</option><option value="other">其他</option></select></label>
        {inputField('reference','供应商反馈来源')}{inputField('description','受影响的商品和具体变化')}</>}
      {action==='resolve_change'&&<><label className="grid gap-1 text-sm">协调结果<select className={field} value={outcome} onChange={e=>setOutcome(e.target.value as typeof outcome)}>
        <option value="original_terms">双方确认按原条款继续</option><option value="revised_terms">双方同意修订，提交新版本独立审核</option><option value="declined">客户未同意，继续挂起</option></select></label>
        {inputField('supplierReference','人工与供应商协调的书面依据')}{inputField('customerReference','客户对方案的回复依据')}{inputField('description','双方确认的具体结果')}
        {outcome==='revised_terms'&&po.lines.map(line=><PurchaseLineFields key={line.orderItemId} line={line} values={revisions[line.orderItemId]??line.terms} onChange={v=>setRevisions({...revisions,[line.orderItemId]:v})}/>)}</>}
      <div className="flex gap-2"><button className={primary} disabled={busy}>查看完整预览</button><button type="button" className={button} onClick={()=>setAction(null)}>收起</button></div>
    </form>}
    {pending&&op&&<section aria-label="操作预览" className="space-y-3 rounded border border-slate-300 bg-slate-50 p-4">
      <h3 className="font-semibold">{actionNames[op.action]} · 操作预览</h3>
      <p className="text-sm">客户订单 {orderId}　采购单 {po.id}</p>
      {pending.preview.snapshot.lines.map(l=><LineDetails key={l.orderItemId} line={l}/>)}
      {op.reference&&<p>业务凭证　{op.reference}</p>}
      {op.amountCents!=null&&<p>本次实际付款　<strong>{money(op.amountCents)}</strong> · 收款方 {po.lines[0].terms.payee} · 条件依据 {op.conditionReference}</p>}
      {op.changeKind&&<p>供货变化　{op.description}</p>}
      {op.outcome&&<><p>协调结果　{op.outcome==='declined'?'继续挂起':op.outcome==='revised_terms'?'修订后重新审核':'按原条款继续'} · {op.description}</p>
        <p>供应商依据　{op.supplierReference}</p><p>客户回复　{op.customerReference}</p>
        {op.revisedTerms?.map(e=><div key={e.orderItemId}><strong>拟修订条款</strong><LineDetails line={{source:po.lines.find(l=>l.orderItemId===e.orderItemId)!.source,terms:e.terms}}/></div>)}</>}
      <details><summary className="cursor-pointer text-xs">查看本次完整版本依据</summary><pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(pending.preview.snapshot,null,2)}</pre></details>
      <div className="flex gap-2"><button disabled={busy} className={primary} onClick={async()=>{const r=await request({...pending.input,stage:'confirm',actionHash:pending.preview.actionHash});if(r){setPending(null);setAction(null);}}}>确认{actionNames[op.action]}</button>
        <button disabled={busy} className={button} onClick={()=>setPending(null)}>返回核对</button></div>
    </section>}
  </article>;
}
