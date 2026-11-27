'use client';

import { useState } from 'react';
import type { previewPurchaseShipment } from '@/lib/purchase-orders';
import type { ShipmentAttributionInput } from '@/lib/purchase-fulfillment';
import DocumentDigestField from './DocumentDigestField';
import { button, field, primary, type Workspace } from './PurchaseLineForm';
import type { PurchaseRequest } from './PurchaseManager';

type Preview = Awaited<ReturnType<typeof previewPurchaseShipment>>;

export default function PurchaseFulfillmentReview({ orderId, review, canApprove, busy, request, onError }: {
  orderId: string; review: Workspace['fulfillment']; canApprove: boolean; busy: boolean; request: PurchaseRequest; onError: (error: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState<{ input: ShipmentAttributionInput; preview: Preview } | null>(null);
  const target = review.targets.find(row => row.id === selected);
  if (!review.targets.length && !review.ledger.length && !review.inconsistent.length) return null;

  async function showPreview(form: FormData) {
    if (!target) return;
    try {
      const read = (key: string) => String(form.get(key) ?? '').trim();
      const sources = target.purchaseSources.map(row => ({ purchaseOrderId: row.purchaseOrderId, quantity: Number(read(row.purchaseOrderId)) }));
      const other = Number(read('otherSource'));
      const localTime = read('occurredAt');
      const input: ShipmentAttributionInput = { orderId, version: review.version, requestId: crypto.randomUUID(), targetId: target.id,
        sources: [...sources, { purchaseOrderId: null, quantity: other }].filter(row => row.quantity > 0),
        reference: read('reference'), sha256: read('sha256'), description: read('description'),
        occurredAt: localTime ? new Date(localTime).toISOString() : undefined,
        documentRow: target.shipmentId ? undefined : Number(read('documentRow')) };
      const result = await request({ ...input, action: 'attribute_purchase_shipment', stage: 'preview' });
      if (result?.preview && 'referenceKey' in result.preview.snapshot) setPending({ input, preview: result.preview as Preview });
    } catch (error) {
      onError(error instanceof Error ? error.message : '请核对发货归属');
    }
  }

  const operation = pending?.preview.snapshot.operation;
  return <section className="space-y-3 rounded border p-4" aria-label="采购发货归属">
    <h3 className="font-semibold">采购发货归属</h3>
    {review.inconsistent.length > 0 && <p className="text-sm text-amber-900">客户订单发货数量与发货明细有差异，请先核对发货档案。</p>}
    {review.targets.length > 0 && <ul className="space-y-2 text-sm">{review.targets.map(row => <li key={row.id} className="flex flex-wrap items-center gap-2">
      <span>{row.name} · {row.shipmentId ? `发货单 ${row.reference ?? row.shipmentId}` : '历史发货差额'} · 待核对 {row.quantity}</span>
      {canApprove && !pending && <button type="button" className={button} disabled={busy} onClick={() => setSelected(row.id)}>核对发货来源</button>}
    </li>)}</ul>}
    {target && !pending && <form key={target.id} className="grid gap-3 border-t pt-3" onSubmit={event => {
      event.preventDefault();
      void showPreview(new FormData(event.currentTarget));
    }}>
      {target.purchaseSources.map(row => <label key={row.purchaseOrderId} className="grid gap-1 text-sm">采购单 {row.purchaseOrderId} 的发出数量
        <input className={field} name={row.purchaseOrderId} type="number" min={0} step={1} max={Math.min(row.quantity, target.quantity)}/>
      </label>)}
      <label className="grid gap-1 text-sm">其他有据来源的发出数量
        <input className={field} name="otherSource" type="number" min={0} step={1} max={target.quantity}/>
      </label>
      {!target.shipmentId && <>
        <label className="grid gap-1 text-sm">历史实际发货时间（本地时间）<input name="occurredAt" className={field} type="datetime-local" step="1" required/></label>
        <label className="grid gap-1 text-sm">发货记录在原件中的行序号<input name="documentRow" className={field} type="number" min={1} step={1} required/></label>
      </>}
      <label className="grid gap-1 text-sm">发货来源书面凭据档案<input name="reference" className={field} maxLength={2000} required/></label>
      <DocumentDigestField name="sha256" label="发货来源书证摘要" required/>
      <label className="grid gap-1 text-sm">发货归属核对结果<input name="description" className={field} maxLength={2000} required/></label>
      <div className="flex gap-2"><button className={primary} disabled={busy}>查看发货归属预览</button>
        <button type="button" className={button} onClick={() => setSelected('')}>收起</button></div>
    </form>}
    {pending && operation && <section aria-label="发货归属预览" className="space-y-2 rounded bg-slate-50 p-3 text-sm">
      <p>{operation.target.name} · 数量 {operation.target.quantity} · {new Date(operation.occurredAt).toLocaleString('zh-CN')}</p>
      {operation.sources.map(source => <p key={source.purchaseOrderId ?? 'other'}>{source.purchaseOrderId ? `采购单 ${source.purchaseOrderId}` : '其他有据来源'} · {source.quantity}</p>)}
      <p>档案 {operation.reference} · {operation.description}</p>
      <button type="button" className={primary} disabled={busy} onClick={async () => {
        const result = await request({ ...pending.input, action: 'attribute_purchase_shipment', stage: 'confirm', actionHash: pending.preview.actionHash });
        if (result) { setPending(null); setSelected(''); }
      }}>确认发货归属</button>
      <button type="button" className={button} disabled={busy} onClick={() => setPending(null)}>返回核对</button>
    </section>}
    {review.ledger.length > 0 && <details><summary className="cursor-pointer text-sm">查看已核对的发货归属</summary>
      <ul className="space-y-2 text-sm">{review.ledger.map(row => <li key={row.id}>
        {row.operation.target.name} · {row.operation.target.quantity} · {row.operation.reference} · 核对人 {row.actorId}
        {row.operation.sources.map(source => <div key={source.purchaseOrderId ?? 'other'}>{source.purchaseOrderId ?? '其他有据来源'} · {source.quantity}</div>)}
      </li>)}</ul></details>}
  </section>;
}
