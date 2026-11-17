'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LetterContact, LetterContactData } from '@/lib/business-letter-contacts';
import { adminSurfaceClasses as styles } from '@/lib/admin-surfaces';

type Editor = LetterContactData & { id?: string; revision?: number };
type Preview = { before: LetterContact | null; after: LetterContactData & { brands: { id: string; name: string }[] }; previewHash: string };
const blank: Editor = { companyName: '', contactName: '', salutation: '', email: '', phone: '', qq: '', brandIds: [], notes: '', sourceReference: '', enabled: false };
const labels = { companyName: '供应商或公司名称', contactName: '联系人姓名', salutation: '信函称呼', email: '邮箱', phone: '电话', qq: 'QQ', sourceReference: '资料来源', notes: '内部备注' };

export default function BusinessLetterContacts({ onSelect, onChanged, canSelect }: {
  onSelect: (contact: LetterContact) => void; onChanged: (contact: LetterContact) => void; canSelect: boolean;
}) {
  const [contacts, setContacts] = useState<LetterContact[]>([]);
  const [brands, setBrands] = useState<{ id: string; name: string }[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [query, setQuery] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputClass = `${styles.input} w-full p-2 text-sm`;
  const buttonClass = `${styles.button} px-3 py-2 text-sm disabled:opacity-50`;
  const resetPreview = () => { setPreview(null); setConfirmed(false); setNotice(''); };
  const load = useCallback((search: string) => fetch(`/api/admin/business-letter-contacts?q=${encodeURIComponent(search)}`, { cache: 'no-store' }).then(async response => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '通讯录加载失败');
    setContacts(data.contacts); setBrands(data.brands); setHasMore(data.hasMore); setCanManage(data.canManage); setLoaded(true);
  }), []);
  useEffect(() => { let active = true; void load('').catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [load]);
  async function operation(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '处理未完成，请刷新后核对'); }
    finally { setBusy(false); }
  }
  async function post(body: unknown) {
    const response = await fetch('/api/admin/business-letter-contacts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '联系人操作未完成');
    return data;
  }
  return <section aria-label="供应商与品牌通讯录" className={`${styles.panel} space-y-4 p-5`}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">供应商与品牌通讯录</h2>
      {canManage && <button type="button" disabled={busy} className={buttonClass} onClick={() => { setEditor({ ...blank, brandIds: [] }); resetPreview(); }}>新增联系人</button>}
    </div>
    <p className="text-sm text-gray-500">检索供应商、品牌或联系人，选用后填入收件地址与称呼。电话和 QQ 仅作联系资料，不表示这些渠道已自动接通。</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-800">{notice}</p>}
    <fieldset disabled={busy} className="space-y-4 disabled:opacity-70">
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void operation(() => load(query)); }}>
        <label className="flex-1"><span className="sr-only">检索供应商、品牌或联系人</span><input className={inputClass} maxLength={160} value={query} placeholder="供应商、品牌、联系人、邮箱、电话或 QQ" onChange={e => setQuery(e.target.value)} /></label>
        <button className={buttonClass}>检索</button>
        <button type="button" className={buttonClass} onClick={() => { setQuery(''); void operation(() => load('')); }}>全部</button>
      </form>
      {!loaded && !error && <p role="status" className="text-sm text-gray-500">正在加载通讯录…</p>}
      {loaded && !contacts.length && <p className="text-sm text-gray-500">没有匹配的联系人。可调整检索内容或新增资料。</p>}
      {hasMore && <p className="text-sm text-gray-500">当前显示前 100 位，请缩小检索范围。</p>}
      <ul className="divide-y">{contacts.map(contact => <li key={contact.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0 text-sm"><p className="font-medium">{contact.companyName} · {contact.contactName} <span className="text-xs text-gray-500">{contact.enabled ? '已启用' : '未启用'} · 第 {contact.revision} 版</span></p>
          <p className="text-gray-600">{contact.brands.length ? contact.brands.map(b => b.name).join('、') : '未关联品牌'}</p>
          <p className="break-all text-gray-600">{[contact.email, contact.phone && `电话 ${contact.phone}`, contact.qq && `QQ ${contact.qq}`].filter(Boolean).join(' · ')}</p>
          {!contact.email && <p className="text-xs text-gray-500">未登记邮箱，暂不能用于邮件发函。</p>}
        </div>
        <div className="flex gap-2">{canSelect && <button type="button" className={buttonClass} disabled={!contact.enabled || !contact.email} onClick={() => onSelect(contact)}>用于本次信函</button>}
          {canManage && <button type="button" className={buttonClass} onClick={() => { setEditor({ ...contact }); resetPreview(); }}>查看与编辑</button>}</div>
      </li>)}</ul>
      {editor && <form className="grid gap-3 border-t pt-4 sm:grid-cols-2" onChange={resetPreview} onSubmit={e => { e.preventDefault(); void operation(async () => { setPreview(null); setConfirmed(false); const data = await post({ ...editor, action: 'preview' }); setPreview(data.preview); }); }}>
        <h3 className="font-medium sm:col-span-2">{editor.id ? '修改联系人资料' : '新增联系人资料'}</h3>
        {Object.entries(labels).map(([key, label]) => <label key={key} className={`text-sm ${key === 'notes' || key === 'sourceReference' ? 'sm:col-span-2' : ''}`}>{label}
          <input className={inputClass} type={key === 'email' ? 'email' : 'text'} required={key === 'companyName' || key === 'contactName'} maxLength={key === 'notes' || key === 'sourceReference' ? 2000 : key === 'email' ? 254 : 160}
            value={editor[key as keyof typeof labels]} onChange={e => setEditor({ ...editor, [key]: e.target.value })} />
        </label>)}
        <fieldset className="space-y-2 sm:col-span-2"><legend className="text-sm">关联品牌（可多选）</legend><div className="flex max-h-40 flex-wrap gap-x-5 gap-y-2 overflow-auto rounded border p-3">{brands.map(brand => <label key={brand.id} className="flex gap-2 text-sm"><input type="checkbox" checked={editor.brandIds.includes(brand.id)} onChange={e => setEditor({ ...editor, brandIds: e.target.checked ? [...editor.brandIds, brand.id] : editor.brandIds.filter(id => id !== brand.id) })} />{brand.name}</label>)}</div></fieldset>
        <label className="flex gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={editor.enabled} onChange={e => setEditor({ ...editor, enabled: e.target.checked })} />确认保存后启用，可选用于信函</label>
        <div className="flex gap-2 sm:col-span-2"><button className={buttonClass}>预览资料变更</button><button type="button" className={buttonClass} onClick={() => { setEditor(null); resetPreview(); }}>取消</button></div>
      </form>}
      {editor && preview && <div className="space-y-3 rounded border p-4">
        <h3 className="font-medium">保存前核对</h3>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">资料</th><th className="p-2">保存前</th><th className="p-2">本次保存</th></tr></thead><tbody>
          {Object.entries(labels).map(([key, label]) => <tr key={key} className="border-t"><th className="p-2 align-top font-normal">{label}</th><td className="whitespace-pre-wrap break-all p-2 align-top">{preview.before?.[key as keyof typeof labels] || '—'}</td><td className="whitespace-pre-wrap break-all p-2 align-top">{preview.after[key as keyof typeof labels] || '—'}</td></tr>)}
          <tr className="border-t"><th className="p-2 font-normal">关联品牌</th><td className="p-2">{preview.before?.brands.map(b => b.name).join('、') || '—'}</td><td className="p-2">{preview.after.brands.map(b => b.name).join('、') || '—'}</td></tr>
          <tr className="border-t"><th className="p-2 font-normal">状态</th><td className="p-2">{preview.before ? preview.before.enabled ? '启用' : '未启用' : '—'}</td><td className="p-2">{preview.after.enabled ? '启用' : '未启用'}</td></tr>
        </tbody></table></div>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对以上资料及来源，确认按本次展示的内容保存。</label>
        <button type="button" disabled={!confirmed} className={`${styles.primaryButton} px-4 py-2 text-sm disabled:opacity-50`} onClick={() => void operation(async () => {
          const data = await post({ ...editor, action: 'save', previewHash: preview.previewHash, confirm: true });
          onChanged(data.contact); setEditor(null); resetPreview(); await load(query); setNotice(`已保存 ${data.contact.companyName} · ${data.contact.contactName} 第 ${data.contact.revision} 版。`);
        })}>确认保存联系人</button>
      </div>}
    </fieldset>
  </section>;
}
