'use client';

import { useState, type FormEvent } from 'react';
import DocumentDigestField from '@/components/admin/purchases/DocumentDigestField';
import type { DeliveryScope } from '@/lib/task-delivery-review';

export const deliveryOutcomes: Record<string, string> = {
  all_accepted: '已核实全部渠道和收件方均受理',
  none_accepted: '已核实全部渠道和收件方均未受理',
  partial: '只有部分结果已核实',
  unknown: '目前尚无确定结果',
};

export function DeliveryTargets({scope}:{scope:DeliveryScope}) {
  return <div className="grid gap-1">
    {scope.reference&&<p>原业务记录 {scope.reference}{scope.kind==='credit_reminder'&&scope.sourceVersion?' · '+scope.sourceVersion:''}</p>}
    {scope.targets.length?<ul>{scope.targets.map(target=><li key={target.id} className="break-all">
      {target.channel==='email'?'邮件':'短信'} · {target.recipient}</li>)}</ul>
      :<p>原记录缺少可核实的收件范围，仍需凭原投递档案核对。</p>}
  </div>;
}

export default function DeliveryReview({ id, version, scope, reload }: {
  id: string; version: string; scope:DeliveryScope; reload: () => Promise<void>;
}) {
  const [outcome, setOutcome] = useState('');
  const [selected,setSelected]=useState<string[]>([]);
  const [reference, setReference] = useState('');
  const [sha256, setSha256] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const targetIds=outcome==='partial'?selected:
        outcome==='all_accepted'||outcome==='none_accepted'?scope.targets.map(target=>target.id):[];
      const response = await fetch('/api/admin/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'record_delivery_review', version, outcome, reference, sha256:sha256.toLowerCase(), targetIds }) });
      if (!response.ok) throw new Error(response.status === 403 ? '需要任务管理权限' : '任务或凭据已变化，请刷新核对');
      await reload();
    } catch (issue) { setError(issue instanceof Error ? issue.message : '登记失败'); }
    finally { setBusy(false); }
  }
  return <details className="text-left text-xs">
    <summary className="cursor-pointer text-brand-700 underline">登记投递核查</summary>
    <form onSubmit={submit} className="mt-2 grid min-w-52 gap-2">
      <DeliveryTargets scope={scope}/>
      <label>核查结果<select required value={outcome} onChange={event => setOutcome(event.target.value)} className="block w-full border">
        <option value="">请选择</option>{Object.entries(deliveryOutcomes)
          .filter(([key])=>scope.targets.length>0||key==='unknown').map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      {outcome==='partial'&&<fieldset><legend>本次回执涉及的渠道和收件方</legend>
        {scope.targets.map(target=><label key={target.id} className="flex gap-2">
          <input type="checkbox" checked={selected.includes(target.id)} onChange={event=>{
            const check=event.target.checked;
            setSelected(current=>check?[...current,target.id]:current.filter(id=>id!==target.id));
          }}/>
          <span className="break-all">{target.channel==='email'?'邮件':'短信'} · {target.recipient}</span>
        </label>)}</fieldset>}
      <label>回执编号或书证位置<input required maxLength={500} value={reference} onChange={event => setReference(event.target.value)} className="block w-full border"/></label>
      <DocumentDigestField label="书证 SHA-256" value={sha256} onChange={setSha256} required/>
      <button type="submit" disabled={busy||outcome==='partial'&&!selected.length} className="rounded border px-2 py-1">确认登记核查结果</button>
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </form>
  </details>;
}
