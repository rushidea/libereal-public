'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminMfaStepUp } from '@/components/admin/AdminMfaStepUpDialog';
import { button, field, money, primary } from '@/components/admin/purchases/PurchaseLineForm';
import { afterSaleActions, afterSaleLabel, type AfterSaleAction } from '@/lib/after-sale-options';
import AfterSaleForm, { issueName, type Desk, type FormInput } from './AfterSaleForm';

type Case = Desk['cases'][number];
type QueueCase = Pick<Case,'id'|'quantity'|'issue'|'ownerId'|'customerState'|'supplierState'> & {orderId:string;item:{name:string}};
type Source = {id:string;orderId:string;orderItemId:string;name:string;reference:string;remaining:number};
type Choice = {action:AfterSaleAction;caseId?:string;chosenLoss?:string};
type Confirmation = {input:FormInput;hash:string;snapshot:Record<string,unknown>;generation:number};
const date = (value:string) => new Date(value).toLocaleString('zh-CN',{hour12:false});
const displayFields:Record<string,string>={quantity:'实际数量',decision:'客户决定',note:'办理说明',report:'问题说明',result:'处理结果',
  remedy:'处理方式',recipient:'收款人',destination:'收款去向',method:'收付渠道',referenceNo:'回执流水',amountCents:'本次金额',approvedCents:'已批准金额',
  originalNumber:'原票号',number:'替代票号',waybill:'实际原运单',lineLimitCents:'本商品可核票面金额',purchaseOrderId:'原采购单',party:'出具意见的单位',contact:'技术联系人',supplier:'供应商',owner:'接手人',
  previousOwner:'原经办人',preparedId:'退款准备记录',approvalId:'独立批准',agreementId:'客户书面决定',financeEventId:'票款回执',shortfallId:'原履约记录',
  relatedCents:'关联金额',parcelLineId:'原包裹行',reference:'原运单',historyReview:'既有结算复核',historicCheck:'既有结算复核',outcome:'供方结果',
  totalCents:'同笔实际交易总额',allocatedBeforeCents:'原已分摊',unallocatedAfterCents:'本次后尚未分摊',allocationReference:'本行分摊书证',
  stoppedCents:'核实终止的未付额',releasedCents:'已确认不再支付的金额',previouslyRefundedCents:'原已实际退款金额'};
function permitted(row:Case, rights:string[], view:Desk):AfterSaleAction[] {
  const out:AfterSaleAction[]=[];
  const ops=rights.includes('orders.read')&&rights.includes('orders.write');
  const buy=rights.includes('purchases.read')&&rights.includes('purchases.write');
  const finance=rights.includes('finance.read')&&rights.includes('finance.write');
  if(ops&&row.customerState!=='closed') out.push('claim');
  if(!row.ownerId)return out;
  const effective=row.events.find(event=>event.id===row.agreementId)?.operation;
  const released=new Set(row.events.filter(event=>event.action==='release_refund_source').map(event=>event.operation?.reviewId));
  const held=row.events.some(event=>event.action==='review_refund_source'&&!released.has(event.id));
  if(ops) {
    out.push('add_evidence');
    if(!row.shortfallId&&row.customerState!=='closed')out.push('link_shortfall');
    if(['reviewing','awaiting_technical','awaiting_customer'].includes(row.customerState)&&['quality','technical'].includes(row.issue))out.push('technical');
    if(['reviewing','awaiting_customer','awaiting_technical','awaiting_fulfillment','awaiting_refund','refund_prepared','refund_followup','awaiting_invoice','awaiting_close'].includes(row.customerState)
      || row.agreementId)out.push('agreement');
    if(row.customerState==='awaiting_fulfillment')out.push('physical');
    if(row.customerState==='awaiting_close'&&!(effective?.remedy==='keep'&&held))out.push('close');
    if(row.customerState!=='closed'&&!row.originalParcelLineId
      && (row.originalParcelShares??[]).reduce((sum,part)=>sum+part.quantity,0)<row.quantity
      && view.deliveries.some(line=>line.orderItemId===row.orderItemId&&!line.afterSaleApprovalId&&line.receipts.length))out.push('bind_original_parcel');
  }
  if(buy || rights.includes('purchases.pay')&&rights.includes('purchases.read'))out.push('supplier');
  if(buy&&['quality','technical'].includes(row.issue)&&['reviewing','awaiting_technical','awaiting_customer'].includes(row.customerState)&&!out.includes('technical'))out.push('technical');
  const exchangeQty=row.events.filter(event=>event.action==='approve_exchange'&&event.operation?.agreementId===row.agreementId)
    .reduce((sum,event)=>sum+Number(event.operation?.quantity??0),0);
  if(rights.includes('purchases.read')&&rights.includes('purchases.approve')&&row.customerState==='awaiting_fulfillment'
    && effective?.remedy==='exchange'&&effective.returnRequirement&&!effective.replacements&&exchangeQty<row.quantity)out.push('approve_exchange');
  if(buy&&row.shortfallId&&row.customerState!=='closed'&&view.deliveries.some(line=>line.attributionRequired&&line.orderItemId===row.orderItemId
    && view.shortfalls.find(loss=>loss.resolutionId===row.shortfallId)?.approved.some(approval=>approval.id===line.approvalId)))out.push('attribute_resend');
  if(finance) {
    if(row.customerState==='awaiting_invoice')out.push('invoice_outcome');
    if(row.customerState==='awaiting_invoice_reissue')out.push('invoice_reissue');
    if((row.issue==='invoice'||effective?.remedy==='invoice')&&row.customerState!=='closed'&&view.invoiceChoices?.length)out.push('verify_invoice_line');
    if(['awaiting_refund','refund_prepared'].includes(row.customerState))out.push('prepare_refund');
    if(row.customerState==='refund_prepared')out.push('approve_refund');
    if(row.customerState==='awaiting_refund'&&view.refundSources?.length&&!held)out.push('review_refund_source');
    if(held&&effective?.remedy==='keep'&&!row.events.some(event=>event.action==='approve_refund'||event.action==='refund_result'))out.push('release_refund_source');
    if(row.customerState==='refund_approved')out.push('refund_result','stop_refund');
  }
  return out;
}
function Details({value}:{value:Record<string,unknown>}) {
  const transfer=value.transfer as Record<string,unknown>|undefined;
  const visible={...value,...(transfer&&{totalCents:transfer.totalCents,allocatedBeforeCents:transfer.allocatedBeforeCents,
    unallocatedAfterCents:transfer.unallocatedAfterCents,allocationReference:transfer.allocationReference})};
  return <dl className="grid gap-1 text-sm sm:grid-cols-[max-content_1fr]">{Object.entries(visible).filter(([key,v])=>displayFields[key]&&v!=null&&typeof v!=='object').map(([key,v])=>
    <div key={key} className="contents"><dt className="text-slate-600">{displayFields[key]}</dt>
      <dd className="break-words">{key.endsWith('Cents')?money(Number(v)):String(v)}</dd></div>)}</dl>;
}

export default function AfterSalesManager({initialOrder,initialLoss=''}:{initialOrder:string;initialLoss?:string}) {
  const [query,setQuery]=useState(initialOrder);const [view,setView]=useState<Desk|null>(null);
  const [rows,setRows]=useState<QueueCase[]>([]);const [sources,setSources]=useState<Source[]>([]);
  const [rights,setRights]=useState<string[]>([]);const [form,setForm]=useState<Choice|null>(null);
  const [pending,setPending]=useState<Confirmation|null>(null);const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');const [message,setMessage]=useState('');const generation=useRef(0);
  const currentId=useRef('');const currentPreview=useRef<Confirmation|null>(null);
  const {begin,dialog}=useAdminMfaStepUp();
  const choose=(choice:Choice|null)=>{currentPreview.current=null;setPending(null);setForm(choice);setError('');};
  const load=useCallback(async (id:string,search='',chosenLoss='',notice='',signal?:AbortSignal)=>{
    const seq=++generation.current;currentId.current=id;currentPreview.current=null;
    setBusy(true);setError('');setMessage(notice);setPending(null);setForm(null);setView(null);setRows([]);setSources([]);setRights([]);
    try {
      const params=new URLSearchParams(id?{orderId:id}:{search,pending:search?'0':'1'});
      const response=await fetch('/api/admin/after-sales?'+params,{cache:'no-store',signal});const body=await response.json();
      if(seq!==generation.current)return;
      if(!response.ok)throw Error(body.error||'售后资料暂时无法读取');
      setRights(body.permissions);setView(body.workspace??null);setRows(body.cases??[]);setSources(body.unassigned??[]);
      if(chosenLoss && body.workspace?.shortfalls.some((s:Desk['shortfalls'][number])=>s.resolutionId===chosenLoss&&s.quantity>s.claimed)
        && body.permissions.includes('orders.write'))setForm({action:'open',chosenLoss});
    } catch(err){if(seq===generation.current)setError(err instanceof Error?err.message:'读取失败');}
    finally {if(seq===generation.current)setBusy(false);}
  },[]);
  const invalidate=useCallback(()=>{generation.current+=1;currentPreview.current=null;},[]);
  useEffect(()=>{
    const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted)void load(initialOrder,'',initialLoss,'',controller.signal);});
    return ()=>{controller.abort();invalidate();};
  },[initialOrder,initialLoss,load,invalidate]);
  async function preview(input:FormInput) {
    const seq=generation.current;setBusy(true);setError('');setMessage('');
    try {
      const response=await fetch('/api/admin/after-sales',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,stage:'preview'})});
      const body=await response.json();if(seq!==generation.current)return;
      if(!response.ok)throw Error(body.error||'预览失败');
      const next={input,hash:body.preview.actionHash,snapshot:body.preview.snapshot,generation:seq};
      currentPreview.current=next;setPending(next);
    } catch(err){if(seq===generation.current)setError(err instanceof Error?err.message:'预览失败');}
    finally {if(seq===generation.current)setBusy(false);}
  }
  async function confirm(item:Confirmation,token:string) {
    if(item!==currentPreview.current || item.generation!==generation.current || currentId.current!==item.input.orderId)return;
    setBusy(true);setError('');
    try {
      const response=await fetch('/api/admin/after-sales',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...item.input,stage:'confirm',actionHash:item.hash,stepUpToken:token})});
      const body=await response.json();if(item.generation!==generation.current)return;
      if(!response.ok){if(response.status===409){currentPreview.current=null;setPending(null);}throw Error(body.error||'请核对原记录');}
      await load(item.input.orderId,'','',body.repeated?'已找到原办理记录 '+body.eventId:'已登记 '+body.eventId);
    }catch(err){if(item.generation===generation.current)setError(err instanceof Error?err.message:'请先核对原记录');}
    finally {if(item.generation===generation.current)setBusy(false);}
  }
  const selected=view?.cases.find(row=>row.id===form?.caseId);
  return <main className="mx-auto max-w-5xl space-y-5 p-4 text-slate-900 md:p-6"><h1 className="text-2xl font-semibold">订单售后</h1>
    <form className="flex flex-wrap items-end gap-2" onSubmit={e=>{e.preventDefault();void load('',query.trim());}}>
      <label className="grid gap-1 text-sm">订单、商品或售后单号<input className={field} value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <button className={button} disabled={busy}>检索</button>
      <button className={button} type="button" disabled={busy||!query.trim()} onClick={()=>void load(query.trim())}>打开原订单</button>
      <button className={button} type="button" disabled={busy} onClick={()=>{setQuery('');void load('');}}>待处理</button>
      {view&&<button className={button} type="button" disabled={busy} onClick={()=>void load(view.order.id)}>刷新本单</button>}</form>
    {busy&&<p role="status">正在核对…</p>}{error&&<p role="alert" className="text-red-700">{error}</p>}{message&&<p role="status" className="text-green-800">{message}</p>}
    {!view&&!busy&&<><section className="space-y-2"><h2 className="font-semibold">售后记录</h2>
      {rows.length===0?<p className="text-sm text-slate-600">没有符合条件的售后记录。</p>:rows.map(row=>
        <div key={row.id} className="flex flex-wrap items-center gap-3 border-b py-2 text-sm"><button className="font-medium underline" onClick={()=>void load(row.orderId)}>{row.orderId}</button>
          <span>{row.item.name} × {row.quantity}</span><span>{issueName(row.issue)}</span><span>{afterSaleLabel(row.customerState)}</span><span>{afterSaleLabel(row.supplierState)}</span></div>)}</section>
      {sources.length>0&&<section><h2 className="font-semibold">尚待接手的履约异常</h2>{sources.map(row=><p key={row.id} className="flex flex-wrap items-center gap-3 border-b py-2 text-sm">
        <button className="underline" onClick={()=>void load(row.orderId,'',row.id)}>{row.orderId} · {row.name}</button>{row.remaining} 件 · {row.reference}</p>)}</section>}</>}
    {view&&<><section className="space-y-2 rounded border p-4"><h2 className="font-semibold">原订单 {view.order.id}</h2>
      <p className="text-sm">{view.order.acceptedAt?'Libereal 接单于 '+date(view.order.acceptedAt):'原接单记录待核对'}</p>
      {view.lines.map(line=><p key={line.id} className="text-sm">{line.name} · {line.catalogNumber||line.id} · {line.quantity} 件 · 原行单价 {money(Math.round(line.unitPrice*100))}</p>)}
      <div className="flex flex-wrap items-center gap-3">{rights.includes('orders.write')&&<button className={button} disabled={busy} onClick={()=>choose({action:'open'})}>登记本单售后</button>}
        {rights.includes('purchases.read')&&<Link className="text-sm underline" href={'/admin/purchases?orderId='+encodeURIComponent(view.order.id)}>本单采购</Link>}
        {rights.includes('finance.read')&&<Link className="text-sm underline" href={'/admin/finance?orderId='+encodeURIComponent(view.order.id)}>本单票款</Link>}</div></section>
      {view.shortfalls.length>0&&<section className="space-y-2"><h2 className="font-semibold">原履约记录</h2>{view.shortfalls.map(loss=>
        <div key={loss.resolutionId} className="rounded border p-3 text-sm"><p>{loss.reference} · {loss.quantity} 件 · 已关联售后 {loss.claimed} 件</p>
          {loss.approved.map(right=><p key={right.id}>原补发批准 {right.id} · 可发 {right.available} 件 · 已发 {right.dispatched} 件 · {right.ambiguous?'待核对本包裹归属':'客户已签收 '+right.customerReceived+' 件'}</p>)}
          {rights.includes('orders.write')&&loss.claimed<loss.quantity&&<button className={button} onClick={()=>choose({action:'open',chosenLoss:loss.resolutionId})}>接续这条履约记录</button>}</div>)}</section>}
      {view.cases.map(row=><section key={row.id} className="space-y-2 rounded border p-4"><h2 className="font-semibold">{issueName(row.issue)} · {view.lines.find(l=>l.id===row.orderItemId)?.name} × {row.quantity}</h2>
        <p className="text-sm">{row.report}</p><p className="text-sm">客户侧 {afterSaleLabel(row.customerState)} · 供应商侧 {afterSaleLabel(row.supplierState)} · 经办 {row.ownerId??'待接手'}</p>
        <p className="text-sm">原凭据 {row.reference} · {date(row.reportedAt)}{row.relatedCents!=null&&' · 关联 '+money(row.relatedCents)}</p>
        {(row.originalParcelShares??[]).map(part=><p key={part.evidenceEventId??part.parcelLineId} className="text-sm">
          原包裹 {view.deliveries.find(line=>line.id===part.parcelLineId)?.reference??part.parcelLineId} · 本案 {part.quantity} 件
        </p>)}
        {row.events.some(event=>event.action==='approve_exchange')&&<Link className="text-sm underline"
          href={'/admin/orders?orderId='+encodeURIComponent(view.order.id)}>打开原单物流，登记已准售后换货</Link>}
        <details><summary className="cursor-pointer text-sm">办理记录（{row.events.length}）</summary>{row.events.map(event=><div className="my-2 border-l-2 pl-3 text-sm" key={event.id}>
          <p>{afterSaleActions[event.action as AfterSaleAction]??event.action} · {date(event.occurredAt)} · {event.actorId}</p>{event.reference&&<p>{event.reference}</p>}
          {event.operation&&<Details value={event.operation}/>}</div>)}</details>
        <div className="flex flex-wrap gap-2">{permitted(row,rights,view).map(action=><button key={action} className={button} disabled={busy} onClick={()=>choose({action,caseId:row.id})}>{afterSaleActions[action]}</button>)}</div></section>)}
      {form&&<div hidden={!!pending}><AfterSaleForm key={[form.action,form.caseId,form.chosenLoss].join('/')} view={view} current={selected} action={form.action} chosenLoss={form.chosenLoss}
        busy={busy} onPreview={preview} onCancel={()=>choose(null)}/></div>}
      {pending&&<section aria-label="售后办理预览" className="space-y-3 rounded border border-slate-300 bg-slate-50 p-4"><h2 className="font-semibold">{afterSaleActions[pending.input.action]} · 确认预览</h2>
        <p>订单 {pending.input.orderId} · {String((pending.snapshot.item as {name?:string})?.name??'')} × {String(pending.snapshot.scopeQuantity)}</p>
        <p className="text-sm">客户侧 {afterSaleLabel(String(pending.snapshot.nextState))} · 供应商侧 {afterSaleLabel(String(pending.snapshot.nextSupplierState))}</p>
        <Details value={pending.snapshot.operation as Record<string,unknown>}/><p className="text-sm">凭据 {String((pending.snapshot.proof as {reference?:string})?.reference??'')}</p>
        <details><summary className="cursor-pointer">完整内容与版本</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(pending.snapshot,null,2)}</pre></details>
        <div className="flex gap-2"><button className={primary} disabled={busy} onClick={()=>void begin(async token=>confirm(pending,token))}>确认{afterSaleActions[pending.input.action]}</button>
          <button className={button} disabled={busy} onClick={()=>{currentPreview.current=null;setPending(null);}}>返回修改</button></div></section>}</>}
    {dialog}</main>;
}
