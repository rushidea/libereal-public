'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

type Task = {
  id: string; status: string; createdAt: string;
  summary: null | {
    kind: string; stage: string; workerId?: string; cancelled?: boolean;
    links?: { pr?: string; ci?: string; staging?: string };
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  };
};
type Capabilities = {
  available: boolean; reason?: string | null; model: string;
  domains: { id: string; available: boolean }[];
  engineering: { available: boolean; stagingAvailable: boolean; reason?: string | null };
};
type Draft = { asOf: string; source: string; analysis: { summary: string; draft: string; observations: string[]; limitations: string[] } };
const WORKERS: Record<string, string> = {
  catalog: '商品目录：分析公开商品资料', promotion: '促销：分析活动状态',
  customer_sales: '客户与销售：分析询盘、拟写内部草稿', order_fulfillment: '订单履约：分析订单状态',
  logistics: '物流：分析发货状态', content_search: '内容与搜索：分析已发布内容', risk_data: '风险与数据：分析审计汇总',
};
const STAGES: Record<string, string> = {
  queued: '排队中', supervisor: '主管分派', business: '业务分析', proposal: '制定方案', architecture: '架构设计',
  coding: '编写代码', review: '独立审查', pull_request: '创建 PR', ci: '运行 CI', staging: '测试版验证',
  awaiting_production_approval: '等待线上发布批准', complete: '已完成', failed: '执行失败', cancelled: '已取消',
  needs_reconciliation: '执行状态待核对', needs_connection: '尚未接通',
};
const STATUSES: Record<string, string> = { pending: '待执行', running: '执行中', succeeded: '成功', failed: '失败' };
const REASONS: Record<string, string> = {
  policy_not_configured: '尚未配置 AI 执行策略', provider_not_configured: '尚未接通模型服务', policy_unavailable: '执行策略暂不可用',
};
const ATTEMPT_STORAGE = 'aiops.pending-submission.v1';
const fieldClass = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900';
const buttonClass = 'rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 hover:border-brand-300 disabled:opacity-50';
function safeLink(value?: string) {
  try { const url = new URL(value || ''); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash ? url.href : undefined; } catch { return undefined; }
}
function parseDraft(value: unknown): Draft | null {
  try {
    if (typeof value !== 'string') return null;
    const draft = JSON.parse(value) as Draft;
    const a = draft.analysis;
    return typeof draft.asOf === 'string' && typeof draft.source === 'string' && a && typeof a.summary === 'string' && typeof a.draft === 'string' && Array.isArray(a.observations) && a.observations.every((s) => typeof s === 'string') && Array.isArray(a.limitations) && a.limitations.every((s) => typeof s === 'string') ? draft : null;
  } catch { return null; }
}
function httpError(response: Response) {
  return response.status === 401 ? '登录已失效，请重新登录。' : response.status === 403 ? '当前账号没有此操作权限。' : response.status === 404 ? '任务不存在或无权查看。' : `请求失败（${response.status}），请刷新查看。`;
}

export default function AiOpsPanel() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [request, setRequest] = useState('');
  const [kind, setKind] = useState('auto');
  const [hint, setHint] = useState('');
  const [attempt, setAttempt] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Task | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const detailSequence = useRef(0);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/admin/ai-ops', { cache: 'no-store' });
      if (!response.ok) throw new Error(httpError(response));
      const data = await response.json() as { tasks: Task[]; capabilities: Capabilities };
      setTasks(data.tasks); setCapabilities(data.capabilities);
    } catch (e) {
      setError(e instanceof Error && /^(请求失败|登录已失效|当前账号)/.test(e.message) ? e.message : '无法读取 AI 任务，请稍后刷新。');
      setCapabilities(null);
    }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(ATTEMPT_STORAGE);
      if (saved) { setAttempt(saved); setNotice('上次提交可能已受理。请先刷新本人任务列表核对，避免重复创建。'); }
    } catch { /* Storage may be disabled; the current submission remains protected in memory. */ }
    void load();
  }, [load]);

  const showDetail = async (task: Task) => {
    const sequence = ++detailSequence.current;
    setSelected(task); setDraft(null); setDetailError(''); setDetailLoading(true);
    try {
      const response = await fetch(`/api/admin/ai-ops/${encodeURIComponent(task.id)}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(httpError(response));
      const data = await response.json() as { task: Task; output?: string };
      if (sequence === detailSequence.current) { setSelected(data.task); setDraft(parseDraft(data.output)); }
    } catch { if (sequence === detailSequence.current) setDetailError('任务详情读取失败，请刷新详情或重新登录。'); }
    finally { if (sequence === detailSequence.current) setDetailLoading(false); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current || attempt || !request.trim() || !capabilities?.available) return;
    submittingRef.current = true; setSubmitting(true); setNotice('');
    const key = crypto.randomUUID();
    setAttempt(key);
    try { sessionStorage.setItem(ATTEMPT_STORAGE, key); } catch { /* In-memory guard remains active. */ }
    try {
      const response = await fetch('/api/admin/ai-ops', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: request.trim(), kind, ...(hint ? { hint } : {}), idempotencyKey: key }),
      });
      if (!response.ok) throw new Error(httpError(response));
      const data = await response.json() as { task: Task };
      setNotice('任务已受理。请刷新列表和详情查看实际进展。');
      await load(); await showDetail(data.task);
    } catch { setNotice('本次提交未能确认是否受理。不会自动重提，请先刷新列表核对。'); }
    finally { submittingRef.current = false; setSubmitting(false); }
  };

  const cancel = async () => {
    if (!selected || cancelling) return;
    const task = selected;
    setCancelling(true); setDetailError('');
    try {
      const response = await fetch(`/api/admin/ai-ops/${encodeURIComponent(task.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }),
      });
      if (!response.ok) throw new Error();
      await load(); await showDetail(task);
    } catch { setDetailError('取消结果未确认，任务可能已经结束。请刷新详情核对。'); }
    finally { setCancelling(false); }
  };

  return (
    <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 sm:p-6" aria-labelledby="aiops-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 id="aiops-heading" className="text-lg font-semibold text-gray-900">AI 运营助手</h2><p className="mt-1 text-sm text-gray-500">输入需求，由主管分派业务分析或工程任务。业务结果为内部草稿；工程进度以实际 PR、CI 和测试版记录为准。</p></div>
        <button type="button" className={buttonClass} disabled={loading} onClick={() => void load()}>{loading ? '读取中…' : '刷新本人 AI 任务'}</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      {capabilities && <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
        <p>模型：{capabilities.model} · {capabilities.available ? '服务已配置' : REASONS[capabilities.reason || ''] || 'AI 服务尚未接通'}</p>
        <p>工程执行：{capabilities.engineering.available ? '可用' : '尚未接通或当前账号无权限'}；测试版验证：{capabilities.engineering.stagingAvailable ? '可用' : '尚未接通或当前账号无权限'}</p>
        <p>任务需要后台 worker 执行；排队不表示已经开始。</p>
      </div>}
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <label className="block text-sm text-gray-700">任务需求<textarea value={request} onChange={(e) => setRequest(e.target.value)} disabled={Boolean(attempt) || submitting} maxLength={4000} required rows={3} className={`mt-1 ${fieldClass}`} placeholder="描述希望分析的问题或需要修改的功能" /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-gray-700">任务方向<select value={kind} disabled={Boolean(attempt)} onChange={(e) => { setKind(e.target.value); if (e.target.value === 'engineering') setHint(''); }} className={`mt-1 ${fieldClass}`}><option value="auto">自动分派</option><option value="business">业务分析</option><option value="engineering">工程任务</option></select></label>
          <label className="text-sm text-gray-700">业务领域提示（可选）<select value={hint} disabled={Boolean(attempt) || kind === 'engineering'} onChange={(e) => setHint(e.target.value)} className={`mt-1 ${fieldClass}`}><option value="">由主管选择</option>{Object.entries(WORKERS).map(([id, label]) => <option key={id} value={id} disabled={!capabilities?.domains.some((d) => d.id === id && d.available)}>{label}{capabilities?.domains.some((d) => d.id === id && d.available) ? '' : '（不可用）'}</option>)}</select></label>
        </div>
        <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={submitting || Boolean(attempt) || !request.trim() || !capabilities?.available || kind === 'engineering' && !capabilities.engineering.available} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{submitting ? '提交中…' : '提交 AI 任务'}</button>
          {attempt && <button type="button" className={buttonClass} disabled={submitting} onClick={() => { setAttempt(''); setRequest(''); setNotice(''); try { sessionStorage.removeItem(ATTEMPT_STORAGE); } catch { /* Optional storage. */ } }}>已核对，填写新任务</button>}
        </div>
        {notice && <p role="status" className="text-sm text-amber-700">{notice}</p>}
        {attempt && <p className="break-all text-xs text-gray-500">本次提交编号：{attempt}。页面刷新后请查看下方本人任务；此编号不会触发自动重提。</p>}
      </form>
      <div className="border-t border-gray-100 pt-4"><h3 className="mb-2 text-sm font-semibold text-gray-900">本人最近的 AI 任务</h3>
        {!loading && !error && tasks.length === 0 && <p className="text-sm text-gray-500">暂无 AI 任务。</p>}
        <ul className="divide-y divide-gray-100">{tasks.map((task) => <li key={task.id}><button type="button" onClick={() => void showDetail(task)} className="w-full space-y-1 py-3 text-left text-sm hover:bg-gray-50"><span className="block text-gray-900">{task.summary?.cancelled ? '已取消' : STATUSES[task.status] || task.status} · {STAGES[task.summary?.stage || ''] || '阶段未知'}</span><span className="block text-gray-600">{task.summary?.workerId ? WORKERS[task.summary.workerId] || task.summary.workerId : task.summary?.kind === 'engineering' ? '工程团队：方案、编码、独立审查与验证' : '主管：识别需求并分派任务'}</span><span className="block break-all text-xs text-gray-400">{new Date(task.createdAt).toLocaleString('zh-CN')} · {task.id}</span></button></li>)}</ul>
      </div>
      {selected && <div className="space-y-3 border-t border-gray-100 pt-4">
        <div className="flex flex-wrap items-center gap-3"><h3 className="text-sm font-semibold text-gray-900">任务详情</h3><button type="button" disabled={detailLoading || cancelling} className={buttonClass} onClick={() => void showDetail(selected)}>刷新详情</button>{['pending', 'running'].includes(selected.status) && <button type="button" disabled={detailLoading || cancelling} className={buttonClass} onClick={() => void cancel()}>{cancelling ? '取消中…' : '取消任务'}</button>}</div>
        <p className="break-all text-xs text-gray-500">{selected.id}</p>
        {detailLoading && <p role="status" className="text-sm text-gray-500">正在读取详情…</p>}
        {detailError && <p role="alert" className="text-sm text-red-600">{detailError}</p>}
        <p className="text-sm text-gray-700">状态：{selected.summary?.cancelled ? '已取消' : STATUSES[selected.status] || selected.status}；当前阶段：{STAGES[selected.summary?.stage || ''] || '未知'}</p>
        {selected.status === 'failed' && !selected.summary?.cancelled && <p className="text-sm text-red-600">{selected.summary?.stage === 'needs_connection' ? '所需执行服务尚未接通。' : selected.summary?.stage === 'needs_reconciliation' ? '执行状态待核对，请先检查已有结果，避免重复执行。' : '任务执行失败，接口未提供具体失败原因。'}</p>}
        <p className="text-sm text-gray-600">用量：输入 {selected.summary?.usage?.inputTokens ?? '未报告'} / 输出 {selected.summary?.usage?.outputTokens ?? '未报告'} / 合计 {selected.summary?.usage?.totalTokens ?? '未报告'} tokens</p>
        <div className="flex flex-wrap gap-4 text-sm">{(['pr', 'ci', 'staging'] as const).map((name) => { const url = safeLink(selected.summary?.links?.[name]); const label = { pr: 'PR', ci: 'CI', staging: '测试版' }[name]; return url ? <a key={name} href={url} target="_blank" rel="noopener noreferrer" className="text-brand-700 underline">查看{label}</a> : <span key={name} className="text-gray-400">{label}：暂无记录</span>; })}</div>
        {draft ? <div className="space-y-3 text-sm text-gray-700"><p className="text-xs text-gray-500">数据来源：{draft.source} · {new Date(draft.asOf).toLocaleString('zh-CN')}</p><p className="whitespace-pre-wrap">{draft.analysis.summary}</p><h4 className="font-medium">内部草稿</h4><p className="whitespace-pre-wrap">{draft.analysis.draft}</p><h4 className="font-medium">观察</h4><ul className="list-disc space-y-1 pl-5">{draft.analysis.observations.map((s, i) => <li key={i}>{s}</li>)}</ul><h4 className="font-medium">局限</h4><ul className="list-disc space-y-1 pl-5">{draft.analysis.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul></div> : !detailLoading && <p className="text-sm text-gray-500">暂无可展示的业务分析结果。工程结果请查看实际链接；阶段完成不代表已获准上线。</p>}
      </div>}
    </section>
  );
}
