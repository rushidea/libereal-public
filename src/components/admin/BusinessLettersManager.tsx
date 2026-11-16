'use client';

import { useCallback, useEffect, useState } from 'react';
import { LETTER_FIELDS, LETTER_STARTERS, LETTER_STATUS_LABELS, type LetterTemplate, type LetterFields } from '@/lib/business-letter-content';
import type { LetterDraft } from '@/lib/business-letters';
import { adminSurfaceClasses as styles } from '@/lib/admin-surfaces';

const emptyFields: LetterFields = { salutation: '', business_reference: '', products: '', details: '', signature: '' };
type EditTemplate = Omit<LetterTemplate, 'id' | 'revision'> & { id?: string; revision?: number };
type ViewSnapshot = { message: { to: string[]; from: string; replyTo: string; subject: string; html: string; text: string };
  source: { reviewId: string; scope: { brand: string; catalogNumber: string; quantity: number } } | null };

export default function BusinessLettersManager({ initialReviewId = '', initialReference = '' }: {
  initialReviewId?: string; initialReference?: string;
} = {}) {
  const [templates, setTemplates] = useState<LetterTemplate[]>([]);
  const [letters, setLetters] = useState<LetterDraft[]>([]);
  const [rights, setRights] = useState({ canManage: false, canSend: false, canReadLetters: false });
  const [editor, setEditor] = useState<EditTemplate | null>(null);
  const [templatePreview, setTemplatePreview] = useState<{ html: string; text: string } | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [to, setTo] = useState('');
  const [reference, setReference] = useState(initialReference);
  const [reviewId, setReviewId] = useState(initialReviewId);
  const [fields, setFields] = useState<LetterFields>(emptyFields);
  const [preview, setPreview] = useState<LetterDraft | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const invalidate = () => { setPreview(null); setConfirmed(false); setNotice(''); };

  const load = useCallback(async () => {
    const response = await fetch('/api/admin/business-letter-templates', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '加载失败');
    setTemplates(data.templates); setRights(data);
    if (data.canReadLetters) {
      const result = await fetch('/api/admin/business-letters', { cache: 'no-store' });
      const records = await result.json();
      if (!result.ok) throw new Error(records.error || '信函记录加载失败');
      setLetters(records.letters);
    }
  }, []);
  useEffect(() => {
    void load().catch(e => setError(e.message));
  }, [load]);

  async function operation(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : '操作未完成，请刷新后核对'); }
    finally { setBusy(false); }
  }
  async function post(path: string, body: unknown) {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '操作未完成');
    return data;
  }
  const snapshot: ViewSnapshot | null = preview ? JSON.parse(preview.snapshot) : null;
  const selected = templates.find(template => template.id === templateId);
  const inputClass = `${styles.input} w-full p-2 text-sm`;
  const buttonClass = `${styles.button} px-3 py-2 text-sm disabled:opacity-50`;

  return <div className="space-y-6">
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    <fieldset disabled={busy} className="space-y-6 disabled:opacity-70">
      <section className={`${styles.panel} space-y-4 p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">信函模板</h2>
          {rights.canManage && <div className="flex flex-wrap gap-2">{LETTER_STARTERS.map(starter => <button key={starter.name} type="button" className={buttonClass}
            onClick={() => { setEditor({ ...starter }); setTemplatePreview(null); invalidate(); }}>新增{starter.name}</button>)}</div>}
        </div>
        <p className="text-sm text-gray-500">先保存并启用模板，再用于发函。模板修改会要求尚未发送的信函重新预览确认。</p>
        {!templates.length && <p className="text-sm text-gray-500">暂无模板，请有内容管理权限的管理员创建。</p>}
        <ul className="divide-y">{templates.map(template => <li key={template.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div><p className="font-medium">{template.name} <span className="text-xs text-gray-500">第 {template.revision} 版 · {template.enabled ? '已启用' : '已停用'}</span></p><p className="text-sm text-gray-500">{template.subject}</p></div>
          <div className="flex gap-2">{rights.canSend && <button type="button" disabled={!template.enabled} className={buttonClass}
            onClick={() => { setTemplateId(template.id); setEditor(null); invalidate(); }}>调用模板</button>}
            {rights.canManage && <button type="button" className={buttonClass} onClick={() => { setEditor({ ...template }); setTemplatePreview(null); invalidate(); }}>编辑</button>}</div>
        </li>)}</ul>
        {editor && <form className="space-y-3 border-t pt-4" onChange={() => setTemplatePreview(null)} onSubmit={event => { event.preventDefault(); void operation(async () => {
          const data = await post('/api/admin/business-letter-templates', editor); setEditor(null); invalidate(); await load();
          setNotice(`已保存“${data.template.name}”第 ${data.template.revision} 版，${data.template.enabled ? '已启用' : '暂未启用'}。`);
        }); }}>
          <label className="block text-sm">模板名称<input className={inputClass} required maxLength={80} value={editor.name} onChange={e => setEditor({ ...editor, name: e.target.value })} /></label>
          <label className="block text-sm">邮件主题<input className={inputClass} required maxLength={200} value={editor.subject} onChange={e => setEditor({ ...editor, subject: e.target.value })} /></label>
          <label className="block text-sm">信函正文<textarea className={inputClass} rows={14} required maxLength={16000} value={editor.body} onChange={e => setEditor({ ...editor, body: e.target.value })} /></label>
          <p className="text-xs text-gray-500">可插入字段：{Object.entries(LETTER_FIELDS).map(([key, label]) => `${label} {{${key}}}`).join('；')}。无需填写 HTML。</p>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={editor.enabled} onChange={e => setEditor({ ...editor, enabled: e.target.checked })} />保存后启用</label>
          <div className="flex gap-2"><button type="button" className={buttonClass} onClick={() => void operation(async () => {
            const data = await post('/api/admin/business-letter-templates', { ...editor, action: 'preview' }); setTemplatePreview(data.message);
          })}>预览样式</button><button className={`${styles.primaryButton} px-4 py-2 text-sm`}>保存模板</button><button type="button" className={buttonClass} onClick={() => setEditor(null)}>取消</button></div>
          {templatePreview && <div className="space-y-2"><p className="text-xs text-gray-500">示例内容，仅预览样式，不保存或发送。</p><iframe title="模板样式预览" sandbox="" referrerPolicy="no-referrer" srcDoc={templatePreview.html} className="h-[620px] w-full border bg-white" /><details><summary>纯文本</summary><pre className="whitespace-pre-wrap text-sm">{templatePreview.text}</pre></details></div>}
        </form>}
      </section>

      {rights.canSend && <section className={`${styles.panel} space-y-4 p-5`}>
        <h2 className="font-semibold">填写信函</h2>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); void operation(async () => {
          if (!selected) throw new Error('请选择已启用的模板');
          setConfirmed(false);
          const data = await post('/api/admin/business-letters', { action: 'preview', templateId, templateRevision: selected.revision,
            to, businessReference: reference, fields, ...(reviewId ? { reviewId } : {}) });
          setPreview(data.letter); await load();
        }); }}>
          <label className="text-sm">模板<select className={inputClass} required value={templateId} onChange={e => { setTemplateId(e.target.value); invalidate(); }}>
            <option value="">请选择模板</option>{templates.filter(t => t.enabled).map(t => <option key={t.id} value={t.id}>{t.name} · 第 {t.revision} 版</option>)}</select></label>
          <label className="text-sm">收件人邮箱<input className={inputClass} required type="email" value={to} onChange={e => { setTo(e.target.value); invalidate(); }} /></label>
          <label className="text-sm">业务编号<input className={inputClass} required maxLength={160} value={reference} onChange={e => { setReference(e.target.value); invalidate(); }} /></label>
          <label className="text-sm">关联供应商询价任务（可选）<input className={inputClass} maxLength={100} value={reviewId} onChange={e => { setReviewId(e.target.value); invalidate(); }} /></label>
          {Object.entries(LETTER_FIELDS).filter(([key]) => key !== 'business_reference').map(([key, label]) => <label key={key} className="text-sm sm:col-span-2">{label}
            <textarea className={inputClass} rows={key === 'salutation' ? 1 : 3} maxLength={6000} value={fields[key as keyof LetterFields]}
              disabled={key === 'products' && Boolean(reviewId)} placeholder={key === 'products' && reviewId ? '预览时从关联询价读取产品与数量' : ''}
              onChange={e => { setFields({ ...fields, [key]: e.target.value }); invalidate(); }} /></label>)}
          <div className="sm:col-span-2"><button className={`${styles.primaryButton} px-4 py-2 text-sm`}>生成完整预览</button><span className="ml-3 text-xs text-gray-500">此步骤仅保存预览，不发送。</span></div>
        </form>
      </section>}

      {preview && snapshot && <section className={`${styles.panel} space-y-4 p-5`}>
        <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">发送前预览</h2><span className="text-sm">{LETTER_STATUS_LABELS[preview.status] || preview.status}</span></div>
        <dl className="grid gap-2 text-sm"><div>发件人：{snapshot.message.from}</div><div>回复地址：{snapshot.message.replyTo}</div><div>唯一收件人：{snapshot.message.to.join('、')}（无抄送或密送）</div><div>主题：{snapshot.message.subject}</div><div>业务编号：{preview.businessReference} · 模板第 {preview.templateRevision} 版</div></dl>
        {snapshot.source && <p className="text-sm">已关联原询价：{snapshot.source.scope.brand} {snapshot.source.scope.catalogNumber} × {snapshot.source.scope.quantity}。原商品和条件变化后须重新核对。</p>}
        <iframe title="商务信函 HTML 预览" sandbox="" referrerPolicy="no-referrer" srcDoc={snapshot.message.html} className="h-[720px] w-full rounded-lg border bg-white" />
        <details><summary className="cursor-pointer text-sm">纯文本版本</summary><pre className="mt-3 whitespace-pre-wrap text-sm">{snapshot.message.text}</pre></details>
        {rights.canSend && ['draft', 'approved'].includes(preview.status) && <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />我已核对本次收件人、完整内容及业务授权，确认发送这封信函。</label>
          <button type="button" className={`${styles.primaryButton} px-4 py-2 text-sm disabled:opacity-50`} disabled={!confirmed} onClick={() => void operation(async () => {
            const data = await post('/api/admin/business-letters', { action: 'send', id: preview.id, approvalHash: preview.approvalHash, confirm: true });
            setPreview(data.letter); setConfirmed(false); await load(); setNotice(LETTER_STATUS_LABELS[data.letter.status] || '请核对发送结果');
          })}>确认并发送</button>
        </div>}
        {['sending', 'unknown', 'rejected'].includes(preview.status) && <p className="text-sm text-amber-800">请先核对邮件服务商记录；系统不会自动重发这封信函。</p>}
        {preview.result && <p className="text-xs text-gray-500">服务商记录：{JSON.parse(preview.result).providerMessageId || JSON.parse(preview.result).error || '暂无回执'}</p>}
      </section>}

      {rights.canReadLetters && <section className={`${styles.panel} space-y-3 p-5`}>
        <div className="flex justify-between"><h2 className="font-semibold">最近信函</h2><button type="button" className={buttonClass} onClick={() => void operation(load)}>刷新记录</button></div>
        {!letters.length && <p className="text-sm text-gray-500">暂无信函记录。</p>}
        <ul className="divide-y">{letters.map(letter => <li key={letter.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
          <div><p>{letter.businessReference} · {LETTER_STATUS_LABELS[letter.status] || letter.status}</p><p className="text-xs text-gray-500">{new Date(letter.createdAt).toLocaleString('zh-CN')} · {letter.origin === 'worker' ? '自动流程准备' : '人工准备'}</p></div>
          <button type="button" className={buttonClass} onClick={() => { setPreview(letter); setConfirmed(false); }}>查看完整信函</button>
        </li>)}</ul>
      </section>}
    </fieldset>
  </div>;
}
