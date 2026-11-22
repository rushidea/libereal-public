'use client';

import { useState } from 'react';
import { actionStyle, DispatchForm, EventForm, EvidenceAction, HistoricalInventoryForm, HistoricalShipmentForm, HoldReviewForm, routeLabels, statusLabels,
  type FulfillmentCapabilities, type Workspace } from './FulfillmentForms';

type StepUp = (callback: (token: string) => Promise<void>) => Promise<void>;
type Preview = { actionHash: string; snapshot: Record<string,unknown> };
type Pending = { action: string; input: Record<string,unknown>; preview: Preview };
const labels: Record<string,string> = {
  orderId:'客户订单', actorId:'经办人', requestId:'操作编号', route:'发货路线', lines:'商品明细', orderItemId:'原订单行', purchaseOrderId:'采购单',
  parcelId:'包裹', eventId:'承运方通知', kind:'事项', occurredAt:'实际时间', reference:'凭据出处', sha256:'凭据摘要', documentRow:'原件行号',
  description:'经办结果', quantity:'数量', batchNumber:'实际批次', priorReceived:'此前实收', parcelLineId:'包裹行', sourceReceiptId:'实收记录',
  productId:'商品 ID', variantId:'规格 ID', catalogNumber:'货号', name:'名称', contractVersion:'采购版本', supplier:'供方', priorStatus:'当前进度',
  carrier:'承运方', trackingNumber:'运单号', feedSource:'物流信息来源', shipmentId:'原发货单', dispatchedAt:'发出时间', deliveredAt:'签收时间',
  source:'来源', originalContent:'通知内容摘要', exceptionId:'待处理异常', recipient:'收货方', party:'收货方类别', email:'联系邮箱',
  institution:'单位', phone:'电话', address:'地址', deliveryAddress:'订单收货资料', priorParcel:'原包裹', priorEvent:'原登记',
  orderStatus:'原订单状态', receiptId:'原实收记录', inventoryAccountId:'库存账户', spec:'规格', unit:'单位', packageType:'包装', baseQuantity:'包装数量',
  inventory:'入仓归属', identity:'核对依据', approved:'已批准的商品', decisions:'双方确认', resolutions:'实物短失或退回', disposition:'本次实物处置',
  receivedAt:'实际入仓时间', history:'历史状态记录', priorShippedQty:'此前记录的已发数量', historicalAttributionId:'原核对记录',
  holdReview:'发运偏差核对',unreleased:'发运时未放行的数量',incidentIds:'当时相关供货事项',incidentId:'原暂停事项',
  status:'办理状态',originalIncidentId:'发运时的原事项',resolutionId:'实际短失或退回记录',shortfallEvidence:'原短失凭据',holdAssignments:'实发暂停份额',holdDecisions:'逐项处理结果',holdResponsibility:'处理责任人',outcome:'实际处理结果',holdSource:'实际货物来源',
  responsibility:'责任人',supplierReference:'供方书面核对',customerReference:'客户书面回复',
  resendApprovalId:'免费重发批准', resend:'原免费重发依据', allocation:'原出库流水归属', shipmentItemId:'原运单商品行',
};
function PreviewValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') return <span>未填写</span>;
  if (Array.isArray(value)) return <ol className="space-y-2">{value.map((entry,index) =>
    <li key={index} className="rounded border border-gray-200 bg-white p-2"><PreviewValue value={entry}/></li>)}</ol>;
  if (typeof value === 'object') return <dl className="grid gap-x-3 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
    {Object.entries(value).map(([key,entry]) => <div key={key} className="contents">
      <dt className="text-gray-600">{labels[key] ?? key}</dt><dd className="min-w-0 break-words"><PreviewValue value={entry}/></dd></div>)}</dl>;
  const text = String(value);
  const display = routeLabels[text] ?? statusLabels[text] ?? (text === 'customer' ? '客户' : text);
  return <span className="break-all">{display}</span>;
}
function reviewedHold(raw: string) {
  try {
    const review = JSON.parse(raw).holdReview;
    return review && typeof review.responsibility==='string' && typeof review.description==='string'
      ? {responsibility:review.responsibility,description:review.description,status:review.status} : null;
  } catch { return null; }
}
function progressDetail(raw: string) {
  try {
    const data=JSON.parse(raw);
    return [typeof data.description==='string' ? data.description : '',
      typeof data.holdResponsibility==='string' ? '责任人 '+data.holdResponsibility : ''].filter(Boolean).join(' · ');
  } catch { return ''; }
}

export default function FulfillmentPanel({ orderId, canWrite, stepUp, onUpdated }: {
  orderId: string; canWrite: boolean; stepUp: StepUp; onUpdated: () => Promise<void>;
}) {
  const [open,setOpen] = useState(false);
  const [view,setView] = useState<Workspace|null>(null);
  const [capabilities,setCapabilities] = useState<FulfillmentCapabilities>({ warehouse:false, shortfall:false });
  const [busy,setBusy] = useState(false);
  const [pending,setPending] = useState<Pending|null>(null);
  const [error,setError] = useState('');
  const url = '/api/admin/orders/'+encodeURIComponent(orderId)+'/fulfillment';
  async function readAt(dispatchedAt: string, reviewHold: boolean): Promise<Workspace> {
    const response = await fetch(url+'?dispatchAt='+encodeURIComponent(dispatchedAt)+(reviewHold?'&reviewHold=1':''),{cache:'no-store'});
    const body = await response.json();
    if (!response.ok || !body.workspace) throw new Error(body.error || '无法核对当时可用的货物');
    return body.workspace;
  }
  async function refresh() {
    const response = await fetch(url,{ cache: 'no-store' });
    const body = await response.json();
    if (!response.ok || !body.workspace) throw new Error(body.error || '履约记录暂时无法读取');
    setView(body.workspace);
    setCapabilities({ warehouse: body.capabilities?.warehouse === true, shortfall: body.capabilities?.shortfall === true });
  }
  async function work(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : '暂时无法读取物流记录'); }
    finally { setBusy(false); }
  }
  async function post(body: object) {
    const result = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data = await result.json();
    if (!result.ok) throw new Error(data.error || '暂时无法办理');
    return data;
  }
  function preview(action: string, input: Record<string,unknown>) {
    void work(async () => {
      const result = await post({ action, input, stage:'preview' });
      if (!result.preview?.actionHash || !result.preview.snapshot) throw new Error('未收到完整的预览，请再核对');
      setPending({action,input,preview:result.preview});
    });
  }
  function confirm() {
    if (!pending) return;
    const saved = pending;
    void stepUp(async token => {
      setBusy(true); setError('');
      try {
        await post({ action:saved.action,input:saved.input,stage:'confirm',actionHash:saved.preview.actionHash,stepUpToken:token });
        setPending(null); await refresh(); await onUpdated();
      } catch (reason) {
        setPending(null);
        setError(reason instanceof Error ? reason.message : '暂时无法确认物流记录');
        try { await refresh(); } catch { /* The original failure is still visible; the operator can refresh. */ }
      } finally { setBusy(false); }
    });
  }
  return <section className="space-y-3 border-t border-gray-200 pt-3" aria-label="履约物流">
    <button type="button" aria-expanded={open} className="font-medium text-brand-700 underline" onClick={() => {
      setOpen(!open); if (!open && !view) void work(refresh);
    }}>{open ? '收起履约物流' : '查看履约物流'}</button>
    {open && <>
      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
      {busy && <p role="status" className="text-sm text-gray-600">正在读取或核对物流记录…</p>}
      {!view && !busy && <button type="button" onClick={() => void work(refresh)} className="text-sm underline">重新读取</button>}
      {pending ? <section aria-label="物流操作预览" className="space-y-3 rounded-lg border border-brand-300 bg-brand-50 p-3">
        <h4 className="font-semibold">核对本次办理内容</h4>
        <PreviewValue value={pending.preview.snapshot}/>
        <div className="flex gap-3"><button type="button" disabled={busy} className={actionStyle} onClick={confirm}>确认并验证身份</button>
          <button type="button" className="text-sm underline" disabled={busy} onClick={() => setPending(null)}>返回填写</button></div>
      </section> : view && <>
        {view.parcels.map(parcel => <article key={parcel.id} className="space-y-2 rounded-lg border border-gray-200 p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="font-medium">{routeLabels[parcel.route] ?? parcel.route}</h4>
            <span className="text-sm text-gray-600">{statusLabels[parcel.status] ?? parcel.status}</span></div>
          <p className="text-sm">{[parcel.carrier,parcel.trackingNumber].filter(Boolean).join(' · ') || parcel.reference} · {new Date(parcel.dispatchedAt).toLocaleString('zh-CN')}</p>
          <ul className="text-sm">{parcel.lines.map(line => <li key={line.id}>
            {view.order.orderItems.find(item => item.id === line.orderItemId)?.name ?? line.orderItemId} · 已签 {line.receivedQuantity} / {line.quantity}
            {parcel.holdFacts?.filter(hold=>hold.parcelLineId===line.id && hold.pending>0).map(hold=><span key={hold.parcelLineId} className="text-amber-900"> · 误发待处理 {hold.pending} 件</span>)}
            {line.receipts.map(receipt => <span key={receipt.id}> · 批次 {receipt.inventoryBatch.batchNumber}（已转发 {receipt.forwardedQuantity}/{receipt.quantity}
              {receipt.releasedQuantity > 0 && ' · 已处置 '+receipt.releasedQuantity}）</span>)}
          </li>)}</ul>
          <details><summary className="cursor-pointer text-sm text-brand-700">物流进展和凭据</summary>
            {parcel.events.filter(event=>event.kind==='dispatch').map(event=>{
              const review=reviewedHold(event.details);
              return review && <p key={event.id} className="rounded bg-amber-50 p-2 text-sm text-amber-900">
                当时未放行的实际发运已核对{review.status==='pending' && ' · 登记时客户尚未回复'} · 核对人 {event.actorId} · 责任人 {review.responsibility} · {review.description}
              </p>;
            })}
          <ol className="mt-2 space-y-2 text-sm">{parcel.events.map(event => <li key={event.id}>
              {new Date(event.occurredAt).toLocaleString('zh-CN')} · {statusLabels[event.kind] ?? event.kind} · {event.source === 'staff' ? '人工登记' : event.source}
              {event.status === 'resolved' && ' · 已核结'}<div>{progressDetail(event.details)} {event.reference}</div>
            </li>)}</ol></details>
          {canWrite && <details><summary className="cursor-pointer text-sm font-medium text-brand-700">办理本包裹</summary>
            <EventForm parcel={parcel} view={view} capabilities={capabilities} busy={busy} submit={preview}/>
            {capabilities.shortfall && parcel.holdFacts?.map(hold=><HoldReviewForm key={hold.parcelLineId} parcel={parcel} hold={hold}
              view={view} capabilities={capabilities} busy={busy} submit={preview}/>)}
          </details>}
          {view.legacyInventory.filter(row => row.parcelId === parcel.id).map(row => <details key={row.parcelLineId}>
            <summary className="cursor-pointer text-sm font-medium text-amber-900">旧库存预留待核实 · {row.awaitingReview}</summary>
            {row.recognized.length > 0 && <p className="text-sm">已有原生运单及出库凭据可核对，已计 {row.recognized.reduce((sum,item) => sum+item.quantity,0)} 件。</p>}
            {row.recordedOutsideReview > 0 && <p className="text-sm">已有部分库存流水，须核对其覆盖的历史发货数量。</p>}
            {canWrite && capabilities.warehouse && (row.available > 0 || row.recordedOutsideReview > 0 && row.oldMovements.length > 0 && row.shipmentItems.length > 0)
              && <HistoricalInventoryForm row={row} busy={busy} submit={preview}/>}
          </details>)}
          {canWrite && view.unmatched.filter(n => n.carrier === parcel.carrier && n.trackingNumber === parcel.trackingNumber &&
            n.source === 'carrier/'+parcel.feedSource && n.occurredAt >= parcel.dispatchedAt).map(notice =>
            <details key={notice.id}><summary className="cursor-pointer text-sm text-brand-700">核对待匹配通知 · {notice.id}</summary>
              <EvidenceAction action="match_notice" fields={{parcelId:parcel.id,eventId:notice.id}} submit={preview} busy={busy} label="预览通知归属"/></details>)}
        </article>)}
        {view.legacyShipments.map(s => <details key={s.id} className="rounded border p-3 text-sm">
          <summary className="cursor-pointer">接续既有运单 · {s.carrier} {s.trackingNumber ?? s.id}</summary>
          {canWrite && <EvidenceAction action="link_legacy" fields={{shipmentId:s.id}} submit={preview} busy={busy} label="预览接续原运单"/>}
        </details>)}
        {canWrite && view.legacyBackfill.history.length > 0 && view.legacyBackfill.lines.length > 0 && <details className="rounded border p-3 text-sm">
          <summary className="cursor-pointer">补核历史发货记录和原运单</summary>
          <HistoricalShipmentForm view={view} busy={busy} submit={preview}/>
        </details>}
        {canWrite && ['confirmed','partially_shipped'].includes(view.order.status) && <details className="rounded border border-gray-200 p-3">
          <summary className="cursor-pointer text-sm font-medium text-brand-700">登记采购发货或转发</summary>
          <div className="mt-3"><DispatchForm view={view} submit={preview} busy={busy} readAt={readAt} canReviewHold={capabilities.shortfall}/></div></details>}
        {!view.parcels.length && !view.legacyShipments.length && <p className="text-sm text-gray-600">这笔订单还没有实际发出的包裹。</p>}
      </>}
    </>}
  </section>;
}
