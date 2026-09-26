'use client';

import { useCallback, useEffect, useState } from 'react';
import { ListTodo, RefreshCw, RotateCcw } from 'lucide-react';

type Task = {
  id: string;
  type: string;
  status: string;
  priority: number;
  attempts: number;
  maxAttempts: number;
  lastError?: string | null;
  runAt: string;
  completedAt?: string | null;
  createdAt: string;
};

type TaskResponse = {
  tasks: Task[];
  total: number;
  page: number;
  pageCount: number;
  counts: Record<string, number>;
  types: string[];
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  succeeded: '成功',
  failed: '失败',
};

const STATUS_CLASSES: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  running: 'bg-blue-50 text-blue-700',
  succeeded: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
};

export default function AdminTasksPage() {
  const [data, setData] = useState<TaskResponse>({ tasks: [], total: 0, page: 1, pageCount: 1, counts: {}, types: [] });
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page) });
      if (status) params.set('status', status);
      if (type) params.set('type', type);
      const response = await fetch(`/api/admin/tasks?${params}`);
      if (!response.ok) throw new Error('任务读取失败');
      setData(await response.json());
    } finally {
      setLoading(false);
    }
  }, [page, status, type]);

  useEffect(() => { void load(); }, [load]);

  const retry = async (id: string) => {
    setRetrying(id);
    try {
      const response = await fetch('/api/admin/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'retry' }),
      });
      if (response.ok) await load();
    } finally {
      setRetrying('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><ListTodo className="h-6 w-6 text-brand-600" />任务与通知</h1>
        <button type="button" onClick={() => void load()} disabled={loading} title="刷新任务" className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-brand-300 hover:text-brand-700 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.keys(STATUS_LABELS).map((key) => <button key={key} type="button" onClick={() => { setStatus(status === key ? '' : key); setPage(1); }} className={`rounded-lg border px-4 py-3 text-left ${status === key ? 'border-brand-400 bg-brand-50' : 'border-gray-200 bg-white'}`}><span className="block text-xs text-gray-500">{STATUS_LABELS[key]}</span><span className="mt-1 block text-xl font-semibold text-gray-900">{data.counts[key] || 0}</span></button>)}
      </div>

      <div className="flex flex-wrap gap-3">
        <select value={type} onChange={(event) => { setType(event.target.value); setPage(1); }} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700">
          <option value="">全部任务类型</option>
          {data.types.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="min-w-[900px] w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-4 py-3">状态</th><th className="px-4 py-3">任务类型</th><th className="px-4 py-3">执行时间</th><th className="px-4 py-3">尝试次数</th><th className="px-4 py-3">最近错误</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {!loading && data.tasks.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500">暂无任务</td></tr>}
            {data.tasks.map((task) => <tr key={task.id} className="align-top"><td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASSES[task.status] || 'bg-gray-100 text-gray-600'}`}>{STATUS_LABELS[task.status] || task.status}</span></td><td className="px-4 py-3 font-medium text-gray-900">{task.type}<span className="mt-1 block font-mono text-xs font-normal text-gray-400">{task.id}</span></td><td className="px-4 py-3 text-gray-600">{new Date(task.runAt).toLocaleString('zh-CN')}</td><td className="px-4 py-3 text-gray-600">{task.attempts} / {task.maxAttempts}</td><td className="max-w-md px-4 py-3 text-xs leading-5 text-red-600">{task.lastError || '—'}</td><td className="px-4 py-3 text-right">{task.status === 'failed' && <button type="button" onClick={() => void retry(task.id)} disabled={retrying === task.id} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-700 hover:border-brand-300 hover:text-brand-700 disabled:opacity-50"><RotateCcw className="h-3.5 w-3.5" />重新执行</button>}</td></tr>)}
          </tbody>
        </table>
      </div>

      {data.pageCount > 1 && <div className="flex items-center justify-between text-sm text-gray-600"><span>共 {data.total} 条</span><div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-gray-200 px-3 py-2 disabled:opacity-40">上一页</button><span className="px-2 py-2">{page} / {data.pageCount}</span><button type="button" disabled={page >= data.pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-gray-200 px-3 py-2 disabled:opacity-40">下一页</button></div></div>}
    </div>
  );
}
