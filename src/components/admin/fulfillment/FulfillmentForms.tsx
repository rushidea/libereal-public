'use client';

import { useState, type ReactNode } from 'react';
import DocumentDigestField from '@/components/admin/purchases/DocumentDigestField';
import type { fulfillmentWorkspace } from '@/lib/fulfillment-parcels';

type JsonDates<T> = T extends Date ? string : T extends Array<infer Item> ? JsonDates<Item>[] :
  T extends object ? { [P in keyof T]: JsonDates<T[P]> } : T;
export type Workspace = JsonDates<Awaited<ReturnType<typeof fulfillmentWorkspace>>>;
export type SubmitIntent = (action: string, input: Record<string, unknown>) => void;
export const routeLabels: Record<string,string> = {
  supplier_to_customer: '供应商直发客户', supplier_to_libereal: '供应商发往 Libereal', libereal_to_customer: 'Libereal 转发客户', legacy_customer: '既有客户运单',
};
export const statusLabels: Record<string,string> = { dispatched: '已发出', in_transit: '运输中', partially_received: '部分签收',
  delivered: '已签收', exception: '异常待处理', carrier_delivered: '承运方报已送达', carrier_exception: '承运方报异常',
  warehouse_receipt: '本仓实收', customer_delivery: '客户签收', tracking: '人工物流进展', resolve_exception: '异常已处理',
  dispatch: '发货登记', match_carrier: '人工匹配通知', link_legacy: '接续原运单' };
export const inputStyle = 'min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900';
export const actionStyle = 'rounded-md bg-brand-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50';
export function Label({ children, title }: { children: ReactNode; title: string }) {
  return <label className="grid gap-1 text-xs text-gray-700">{title}{children}</label>;
}
const read = (form: FormData,name: string) => String(form.get(name) ?? '').trim();
function evidence(form: FormData) {
  return { requestId: crypto.randomUUID(), occurredAt: new Date(read(form,'occurredAt')).toISOString(), reference: read(form,'reference'),
    documentRow: Number(read(form,'documentRow')), sha256: read(form,'sha256') };
}
export function Proof({ explanation }: { explanation?: string }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <Label title="实际发生时间（本地时间）"><input name="occurredAt" className={inputStyle} type="datetime-local" step="1" required/></Label>
    <Label title="原件中的行号"><input name="documentRow" className={inputStyle} type="number" min={1} step={1} defaultValue={1} required/></Label>
    <Label title="物流凭据出处"><input name="reference" className={inputStyle} placeholder="运单、签收单或档案编号" required/></Label>
    <DocumentDigestField name="sha256" label="物流凭据摘要" required/>
    {explanation && <Label title={explanation}><textarea name="description" rows={2} className={inputStyle} required/></Label>}
  </div>;
}

export function DispatchForm({ view, submit, busy }: { view: Workspace; submit: SubmitIntent; busy: boolean }) {
  const [route,setRoute] = useState('supplier_to_customer');
  const forwarding = route === 'libereal_to_customer';
  const rows = forwarding ? view.receipts.flatMap(receipt => {
    const p = view.purchases.find(row => row.purchaseOrderId === receipt.purchaseOrderId && row.orderItemId === receipt.orderItemId);
    return p ? [{ ...p, sourceReceiptId: receipt.id, batchNumber: receipt.batchNumber, available: receipt.available }] : [];
  }) : view.purchases.filter(p => p.available > 0).map(p => ({ ...p, sourceReceiptId: null, batchNumber: null }));
  return <form className="space-y-3" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const lines = rows.map((row,index) => ({ purchaseOrderId: row.purchaseOrderId, orderItemId: row.orderItemId,
      sourceReceiptId: row.sourceReceiptId, quantity: Number(read(form,'qty'+index)) })).filter(row => row.quantity > 0);
    submit('dispatch',{ ...evidence(form), route, lines, carrier: read(form,'carrier'), trackingNumber: read(form,'trackingNumber'),
      feedSource: form.has('feed') ? view.feedSource : null });
  }}>
    <Label title="发货路线"><select className={inputStyle} value={route} onChange={e => setRoute(e.target.value)}>
      {Object.entries(routeLabels).filter(([value]) => value !== 'legacy_customer').map(([value,label]) => <option key={value} value={value}>{label}</option>)}
    </select></Label>
    {rows.length ? <fieldset key={route} className="space-y-1"><legend className="text-sm font-medium">本次实际发出的商品</legend>
      {rows.map((row,index) => <Label key={JSON.stringify([row.purchaseOrderId,row.orderItemId,row.sourceReceiptId])}
        title={[row.name,row.supplier,row.purchaseOrderId,row.batchNumber && '批次 '+row.batchNumber,'可发 '+row.available].filter(Boolean).join(' · ')}>
        <input className={inputStyle} type="number" name={'qty'+index} min={0} max={row.available} step={1} defaultValue={0}/>
      </Label>)}</fieldset> : <p className="text-sm text-gray-600">{forwarding ? '这笔订单还没有可转发的实际收货批次。' : '这笔订单还没有可用于本次发货的供方订购记录。'}</p>}
    {rows.length > 0 && <>
      <div className="grid gap-3 sm:grid-cols-2"><Label title="承运方"><input name="carrier" className={inputStyle}/></Label>
        <Label title="运单号"><input name="trackingNumber" className={inputStyle}/></Label></div>
      {view.feedSource && <label className="flex gap-2 text-sm"><input type="checkbox" name="feed"/>接收 {view.feedSource} 的运单回传</label>}
      <Proof/><button className={actionStyle} disabled={busy}>预览发货</button>
    </>}
  </form>;
}

export function EventForm({ parcel,view,submit,busy }: { parcel: Workspace['parcels'][number]; view: Workspace; submit: SubmitIntent; busy: boolean }) {
  const inbound = parcel.route === 'supplier_to_libereal';
  const physical = inbound ? 'warehouse_receipt' : 'customer_delivery';
  const unresolved = parcel.events.filter(e => e.kind === 'exception' && e.status === 'applied' || e.kind === 'carrier_exception' && e.status === 'awaiting_resolution');
  const options = unresolved.length ? ['resolve_exception','tracking'] :
    [...(parcel.lines.some(line => line.receivedQuantity < line.quantity) ? [physical] : []),'tracking','exception'];
  const [selected,setSelected] = useState(options[0]);
  const kind = options.includes(selected) ? selected : options[0];
  const lines = parcel.lines.filter(line => line.quantity > line.receivedQuantity);
  return <form className="mt-3 space-y-3" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const received = kind === physical ? lines.map(line => ({
      parcelLineId: line.id, quantity: Number(read(form,'qty'+line.id)), ...(inbound ? {
        batchNumber: read(form,'batch'+line.id), productId: line.productId || read(form,'product'+line.id),
        variantId: line.variantId || read(form,'variant'+line.id) } : {}),
    })).filter(row => row.quantity > 0) : [];
    submit('record_event',{ ...evidence(form), parcelId: parcel.id, kind, description: read(form,'description'),
      exceptionId: read(form,'exceptionId'), lines: received });
  }}>
    <Label title="办理事项"><select className={inputStyle} value={kind} onChange={e => setSelected(e.target.value)}>
      {options.map(value => <option key={value} value={value}>{value === 'exception' ? '登记物流异常' : value === 'resolve_exception' ? '登记异常处理结果' : statusLabels[value]}</option>)}
    </select></Label>
    {kind === 'resolve_exception' && <Label title="需要处理的异常"><select className={inputStyle} name="exceptionId" required>
      {unresolved.map(event => <option key={event.id} value={event.id}>{event.reference} · {new Date(event.occurredAt).toLocaleString('zh-CN')}</option>)}
    </select></Label>}
    {kind === physical && <fieldset className="space-y-2"><legend className="text-sm font-medium">本次实际收到的明细</legend>
      {lines.map(line => <div className="grid gap-2 rounded border border-gray-200 p-2 sm:grid-cols-2" key={line.id}>
        <Label title={(view.order.orderItems.find(i => i.id === line.orderItemId)?.name ?? line.orderItemId)+' · 待签 '+(line.quantity-line.receivedQuantity)}>
          <input name={'qty'+line.id} className={inputStyle} type="number" min={0} max={line.quantity-line.receivedQuantity} step={1} defaultValue={0}/></Label>
        {inbound && <Label title="实收批号"><input name={'batch'+line.id} className={inputStyle}/></Label>}
        {inbound && !line.productId && <>
          <Label title="实际目录商品 ID"><input name={'product'+line.id} className={inputStyle}/></Label>
          <Label title="实际规格 ID（有规格时填写）"><input name={'variant'+line.id} className={inputStyle}/></Label>
        </>}
      </div>)}</fieldset>}
    <Proof explanation={kind === physical ? '实际签收人与收货情况' : '处理经过与结果'}/>
    <button className={actionStyle} disabled={busy}>预览办理结果</button>
  </form>;
}

export function EvidenceAction({ action, fields, label, submit, busy }: {
  action: 'link_legacy'|'match_notice'; fields: Record<string,string>; label: string; submit: SubmitIntent; busy: boolean;
}) {
  return <form className="mt-2 space-y-2" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    submit(action,{ ...fields, ...evidence(form), description: read(form,'description') });
  }}><Proof explanation="核对依据与结果"/><button className={actionStyle} disabled={busy}>{label}</button></form>;
}
