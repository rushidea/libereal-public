'use client';
import { useState } from 'react';

type Notice = { id:string; carrier:string; trackingNumber:string; source:string; reference:string; occurredAt:string; description:string };

export default function CarrierNoticeQueue() {
  const [open,setOpen] = useState(false);
  const [rows,setRows] = useState<Notice[]>([]);
  const [next,setNext] = useState<string|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  async function load(after?:string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/fulfillment/notices'+(after ? '?after='+encodeURIComponent(after) : ''),{cache:'no-store'});
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.notices)) throw new Error(result.error || '待核通知暂时无法读取');
      setRows(old => after ? [...old,...result.notices] : result.notices); setNext(result.next ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '待核通知暂时无法读取'); }
    finally { setBusy(false); }
  }
  return <section aria-label="待核物流通知" className="space-y-2">
    <button type="button" aria-expanded={open} className="text-sm text-brand-700 underline" onClick={() => {
      setOpen(!open); if (!open) void load();
    }}>{open ? '收起待核物流通知' : '待核物流通知'}</button>
    {open && <div className="rounded-lg border p-3 text-sm">
      {busy && <p role="status">正在读取…</p>}
      {error && <p role="alert">{error} <button type="button" className="underline" onClick={() => void load()}>重试</button></p>}
      {rows.length > 0 && <><p>请按运单核对原订单，在对应包裹中办理通知归属。</p>
        <ul className="divide-y">{rows.map(row => <li key={row.id} className="py-2">{row.carrier} · {row.trackingNumber} · {new Date(row.occurredAt).toLocaleString('zh-CN')}
          <p>{row.description} · {row.reference}</p></li>)}</ul></>}
      {!busy && !error && !rows.length && <p>目前没有等待匹配的物流通知。</p>}
      {next && <button type="button" disabled={busy} className="underline" onClick={() => void load(next)}>查看更多</button>}
    </div>}
  </section>;
}
