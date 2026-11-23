'use client';

import { useState, type FormEvent } from 'react';

export const deliveryOutcomes: Record<string, string> = {
  all_accepted: '已核实全部渠道和收件方均受理',
  none_accepted: '已核实全部渠道和收件方均未受理',
  partial: '只有部分结果已核实',
  unknown: '目前尚无确定结果',
};

export default function DeliveryReview({ id, version, reload }: { id: string; version: string; reload: () => Promise<void> }) {
  const [outcome, setOutcome] = useState('');
  const [reference, setReference] = useState('');
  const [sha256, setSha256] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/admin/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'record_delivery_review', version, outcome, reference, sha256 }) });
      if (!response.ok) throw new Error(response.status === 403 ? '需要任务管理权限' : '任务或凭据已变化，请刷新核对');
      await reload();
    } catch (issue) { setError(issue instanceof Error ? issue.message : '登记失败'); }
    finally { setBusy(false); }
  }
  return <details className="text-left text-xs">
    <summary className="cursor-pointer text-brand-700 underline">登记投递核查</summary>
    <form onSubmit={submit} className="mt-2 grid min-w-52 gap-2">
      <p>请核对原任务的每个渠道和收件方，并保留相应回执。</p>
      <label>核查结果<select required value={outcome} onChange={event => setOutcome(event.target.value)} className="block w-full border">
        <option value="">请选择</option>{Object.entries(deliveryOutcomes).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>回执编号或书证位置<input required maxLength={500} value={reference} onChange={event => setReference(event.target.value)} className="block w-full border"/></label>
      <label>书证 SHA-256<input required pattern="[a-f0-9]{64}" value={sha256} onChange={event => setSha256(event.target.value)} className="block w-full border"/></label>
      <button type="submit" disabled={busy} className="rounded border px-2 py-1">确认登记核查结果</button>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </form>
  </details>;
}
