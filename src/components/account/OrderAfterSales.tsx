'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { afterSaleIssues, afterSaleLabel, hasChoice } from '@/lib/after-sale-options';

type Item={ id?:string; name?:string; quantity?:number };
type CustomerCase={id:string;orderItemId:string;quantity:number;issue:string;customerState:string;reportedAt:string};
type Submission={content:string;requestId:string;occurredAt:string};

export default function OrderAfterSales({orderId,items}:{orderId:string;items:Item[]}) {
  const [cases,setCases]=useState<CustomerCase[]>([]);const [opened,setOpened]=useState(false);const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');const [error,setError]=useState('');const prior=useRef<Submission|null>(null);
  const active=useRef(orderId);const url='/api/orders/'+encodeURIComponent(orderId)+'/after-sales';
  useEffect(()=>{
    active.current=orderId;prior.current=null;const abort=new AbortController();
    async function load(){
      try{const response=await fetch(url,{cache:'no-store',signal:abort.signal});const body=await response.json();
        if(!response.ok||!Array.isArray(body.cases))throw Error(body.error||'售后记录暂时无法读取');
        if(!abort.signal.aborted)setCases(body.cases);
      }catch(err){if(!abort.signal.aborted)setError(err instanceof Error?err.message:'读取失败');}
    }
    void load();return ()=>{abort.abort();active.current='';};
  },[orderId,url]);
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;
    const form=new FormData(event.currentTarget);const request={orderItemId:String(form.get('orderItemId')),issue:String(form.get('issue')),
      quantity:Number(form.get('quantity')),note:String(form.get('note')??'').trim()};
    const key='libereal:after-sale-request:'+orderId;
    setBusy(true);setError('');setNotice('');
    try {
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(request)));
      const content=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
      let attempt=prior.current;
      if(!attempt){try{attempt=JSON.parse(sessionStorage.getItem(key)??'null') as Submission|null;}catch{/* store may be unavailable */}}
      if(!attempt||attempt.content!==content)attempt={content,requestId:crypto.randomUUID(),occurredAt:new Date().toISOString()};
      prior.current=attempt;try{sessionStorage.setItem(key,JSON.stringify(attempt));}catch{/* in-memory retry stays available */}
      const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...request,requestId:attempt.requestId,occurredAt:attempt.occurredAt})});
      const result=await response.json();if(active.current!==orderId)return;
      if(!response.ok)throw Error(result.error||'未能登记，请核对原单后再试');
      setNotice('已登记售后 '+result.id);setOpened(false);
      const read=await fetch(url,{cache:'no-store'});const body=await read.json();
      if(!read.ok||!Array.isArray(body.cases))throw Error('申请已登记，暂时无法刷新进度');
      if(active.current!==orderId)return;
      setCases(body.cases);prior.current=null;try{sessionStorage.removeItem(key);}catch{/* no persistent draft */}
    }catch(err){if(active.current===orderId)setError(err instanceof Error?err.message:'请查看原订单中的登记结果');}
    finally{if(active.current===orderId)setBusy(false);}
  }
  const valid=items.filter(line=>line.id&&line.quantity);
  return <section aria-label="订单售后" className="mt-4 space-y-3 rounded-2xl border border-gray-200 bg-white p-5 dark:border-slate-400 dark:bg-slate-200">
    <div className="flex items-center justify-between gap-2"><h2 className="font-semibold text-gray-800">订单售后</h2>{valid.length>0&&!opened&&<button className="text-sm font-medium text-brand-700 underline" onClick={()=>setOpened(true)}>提交售后需求</button>}</div>
    {cases.map(row=><p key={row.id} className="border-b py-2 text-sm">{items.find(line=>line.id===row.orderItemId)?.name} × {row.quantity} · {hasChoice(afterSaleIssues,row.issue)?afterSaleIssues[row.issue]:row.issue} · {afterSaleLabel(row.customerState)}</p>)}
    {notice&&<p role="status" className="text-sm text-green-800">{notice}</p>}{error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    {opened&&<form className="grid gap-3 text-sm" onSubmit={submit}>
      <label className="grid gap-1">订单商品<select name="orderItemId" required className="rounded border p-2">{valid.map(line=><option value={line.id} key={line.id}>{line.name} · 共 {line.quantity} 件</option>)}</select></label>
      <div className="grid gap-2 sm:grid-cols-2"><label className="grid gap-1">涉及数量<input name="quantity" type="number" min={1} step={1} required className="rounded border p-2"/></label>
        <label className="grid gap-1">问题类别<select name="issue" required defaultValue="" className="rounded border p-2"><option value="">请选择</option>{Object.entries(afterSaleIssues).map(([key,value])=><option value={key} key={key}>{value}</option>)}</select></label></div>
      <label className="grid gap-1">发生了什么，希望怎样处理？<textarea name="note" required maxLength={2000} rows={3} className="rounded border p-2"/></label>
      <div className="flex gap-4"><button disabled={busy} className="rounded bg-brand-700 px-3 py-2 font-medium text-white">提交需求</button>
        <button type="button" disabled={busy} className="underline" onClick={()=>setOpened(false)}>返回</button></div>
    </form>}</section>;
}
