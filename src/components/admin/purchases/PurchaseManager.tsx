'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAdminMfaStepUp, isAdminMfaStepUpResponse } from '@/components/admin/AdminMfaStepUpDialog';
import type { previewPurchaseAction } from '@/lib/purchase-orders';
import type { previewPurchaseStartAction } from '@/lib/purchase-start';
import PurchaseLineForm, { button, field, primary, type Workspace } from './PurchaseLineForm';
import PurchaseActions from './PurchaseActions';
import PurchaseStartReview from './PurchaseStartReview';

type Result = { permissions?:string[]; workspace?:Workspace; preview?:Awaited<ReturnType<typeof previewPurchaseAction | typeof previewPurchaseStartAction>>; error?:string;
  orders?:{id:string;status:string;prepared:number;purchases:number}[] };

export type PurchaseRequest = (body: Record<string, unknown>) => Promise<Result | undefined>;

export default function PurchaseManager({initialOrder}:{initialOrder:string}) {
  const [query,setQuery]=useState('');
  const [list,setList]=useState<NonNullable<Result['orders']>>([]);
  const [workspace,setWorkspace]=useState<Workspace|null>(null);
  const [permissions,setPermissions]=useState<string[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [loaded,setLoaded]=useState(false);
  const {begin,dialog}=useAdminMfaStepUp();
  const loadId=useRef(0);
  const selected=useRef('');
  const load=useCallback(async (order:string,search='',signal?:AbortSignal)=>{
    const id=++loadId.current;
    selected.current=order;
    setBusy(true);setError('');setLoaded(false);setWorkspace(null);
    try {
      const params=order?new URLSearchParams({orderId:order}):new URLSearchParams({search});
      const res=await fetch('/api/admin/purchases?'+params,{cache:'no-store',signal});
      const data:Result=await res.json();
      if (id!==loadId.current || signal?.aborted) return;
      if (!res.ok) throw new Error(res.status===403?'当前账号没有采购查看权限':data.error||'采购记录读取失败');
      setPermissions(data.permissions??[]);setList(data.orders??[]);setWorkspace(data.workspace??null);setLoaded(true);
    } catch(e) { if(id===loadId.current && !signal?.aborted)setError(e instanceof Error?e.message:'采购记录读取失败'); }
    finally { if(id===loadId.current && !signal?.aborted)setBusy(false); }
  },[]);
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(initialOrder, '', controller.signal);
    });
    return () => controller.abort();
  }, [initialOrder, load]);

  async function request(body:Record<string,unknown>,token?:string):Promise<Result|undefined> {
    const target=selected.current;
    if (target!==body.orderId) return;
    setError('');setBusy(true);
    try {
      const res=await fetch('/api/admin/purchases',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,stepUpToken:token})});
      const data:Result=await res.json();
      if (selected.current!==target) return;
      if (!token && isAdminMfaStepUpResponse(res.status,data.error)) {
        await begin(async t=>{if(selected.current===target)await request(body,t);});
        return;
      }
      if (!res.ok) throw new Error(data.error||'采购操作未完成');
      if(data.workspace)setWorkspace(data.workspace);
      return data;
    } catch(e) {if(selected.current===target)setError(e instanceof Error?e.message:'采购请求未完成，请刷新核对记录');}
    finally {if(selected.current===target)setBusy(false);}
  }

  return <div className="space-y-5">{dialog}
    <h1 className="text-2xl font-bold">供应商采购</h1>
    {error&&<p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();void load('',query);}}>
      <input aria-label="客户订单号或采购单号" placeholder="客户订单号或采购单号" value={query} className={field} onChange={e=>setQuery(e.target.value)}/>
      <button className={button} disabled={busy}>查找</button>
    </form>
    {busy&&<p role="status" className="text-sm text-slate-600">正在读取或核对采购记录…</p>}
    {!workspace&&loaded&&<section>
      {list.length===0?<p className="text-sm">未找到可以查看的采购记录。</p>:
        <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">客户订单</th><th>已准备商品行</th><th>采购单数</th></tr></thead>
          <tbody>{list.map(row=><tr key={row.id} className="border-t"><td className="p-2"><button className="font-medium underline" onClick={()=>void load(row.id)}>{row.id}</button></td><td>{row.prepared}</td><td>{row.purchases}</td></tr>)}</tbody></table></div>}
    </section>}
    {workspace&&<><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">客户订单 {workspace.orderId}</h2>
      <button className={button} disabled={busy} onClick={()=>void load(workspace.orderId)}>刷新原单</button></div>
      <p className="text-sm">{workspace.eligibility.eligible?'已核实平台接单及本单采购启动依据':workspace.eligibility.reason}</p>
      {workspace.startReview && <PurchaseStartReview key={workspace.startReview.version} review={workspace.startReview}
        permissions={permissions} busy={busy} request={request} onError={setError}/>}
      {workspace.canPrepare&&permissions.includes('purchases.write')&&
        <button className={primary} disabled={busy} onClick={()=>void request({action:'prepare',orderId:workspace.orderId})}>从原订单准备采购</button>}
      {workspace.lines.length>0&&<section className="space-y-3"><h2 className="text-lg font-semibold">采购准备</h2>
        {workspace.lines.map(line=>{
          const po=workspace.orders.find(o=>o.id===line.purchaseOrderId);
          const editable=line.availableQuantity>0&&workspace.eligibility.eligible&&permissions.includes('purchases.write')&&(!po||(po.status==='draft'&&!po.orderedBefore&&!po.paidCents));
          return <PurchaseLineForm key={`${line.orderItemId}-${line.revision}`} line={line} enabled={editable} busy={busy}
            save={async (line, terms, checkedEvidence) => { await request({ action: 'save_line', orderId: workspace.orderId, orderItemId: line.orderItemId, revision: line.revision, terms, checkedEvidence }); }}/>;
        })}</section>}
      {workspace.orders.length>0&&<section className="space-y-3"><h2 className="text-lg font-semibold">采购单</h2>
        {workspace.orders.map(po=><PurchaseActions key={po.version} orderId={workspace.orderId} orderStatus={workspace.orderStatus} cancellation={workspace.cancellation}
          po={po} permissions={permissions} busy={busy} request={request} onError={setError}/>)}</section>}
    </>}
  </div>;
}
