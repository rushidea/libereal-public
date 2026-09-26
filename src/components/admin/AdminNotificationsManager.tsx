'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bell, Megaphone, Trash2, Loader2, Search } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

type AdminNotification = {
  id: string;
  email: string;
  role: string;
  type: string;
  title: string;
  content: string;
  scope: string;
  requiresAck: boolean;
  createdByUserId: string | null;
  deletedAt: string | null;
  createdAt: string;
  isRead: boolean;
};

export default function AdminNotificationsManager() {
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'broadcast' | 'personal'>('all');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [requiresAck, setRequiresAck] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (scopeFilter !== 'all') params.set('scope', scopeFilter);
      if (includeDeleted) params.set('includeDeleted', '1');
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      params.set('take', '50');
      const res = await fetch(`/api/admin/notifications?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '加载失败');
        setNotifications([]);
        return;
      }
      setNotifications(data.notifications || []);
      setTotal(data.total || 0);
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  }, [scopeFilter, includeDeleted, searchQuery]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearchQuery(searchInput), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/admin/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim(),
          linkUrl: linkUrl.trim() || undefined,
          requiresAck,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '发布失败');
        return;
      }
      setTitle('');
      setContent('');
      setLinkUrl('');
      setRequiresAck(false);
      await load();
    } catch {
      setError('发布失败');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('确认删除该消息？删除后客户侧将不可见。')) return;
    setDeletingId(id);
    setError('');
    try {
      const res = await fetch(`/api/admin/notifications/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '删除失败');
        return;
      }
      await load();
    } catch {
      setError('删除失败');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <form
        onSubmit={handlePublish}
        className={`${uiSurfaces.panel} space-y-4 p-4 sm:p-5`}
      >
        <div className="flex items-center gap-2">
          <Megaphone className="h-5 w-5 text-brand-600" />
          <h2 className="text-lg font-semibold text-gray-900">发布公共通知</h2>
        </div>
        <p className={`text-sm ${uiSurfaces.mutedText}`}>
          公共通知对所有已登录客户可见。勾选强制确认后，客户须在全站遮罩中确认后才能继续操作。
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">标题</label>
          <input
            className={`${uiSurfaces.input} w-full`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            placeholder="通知标题"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">正文</label>
          <textarea
            className={`${uiSurfaces.input} w-full min-h-[120px]`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={5000}
            required
            placeholder="通知正文"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">链接（可选）</label>
          <input
            className={`${uiSurfaces.input} w-full`}
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="/help 或 https://..."
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={requiresAck}
            onChange={(e) => setRequiresAck(e.target.checked)}
            className="rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          发布后强制用户查看并确认
        </label>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || !title.trim() || !content.trim()}
            className={uiSurfaces.primaryButton}
          >
            {saving ? '发布中…' : '发布公共通知'}
          </button>
        </div>
      </form>

      <div className={`${uiSurfaces.panel} p-4 sm:p-5 space-y-4`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-brand-600" />
            <h2 className="text-lg font-semibold text-gray-900">消息列表</h2>
            <span className={`text-xs ${uiSurfaces.mutedText}`}>共 {total} 条</span>
          </div>

        <div className="relative max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            className={`${uiSurfaces.input} w-full pl-9`}
            placeholder="搜索标题、正文、收件邮箱或消息类型"
            aria-label="搜索消息"
          />
        </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'broadcast', 'personal'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setScopeFilter(key)}
                className={scopeFilter === key ? uiSurfaces.activePill : uiSurfaces.ghostPill}
              >
                {key === 'all' ? '全部' : key === 'broadcast' ? '公共' : '私信'}
              </button>
            ))}
            <label className="ml-1 flex items-center gap-1.5 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
                className="rounded border-gray-300 text-brand-600"
              />
              含已删
            </label>
          </div>
        </div>

        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center py-10 text-gray-500">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : notifications.length === 0 ? (
          <p className={`py-8 text-center text-sm ${uiSurfaces.mutedText}`}>暂无消息</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {notifications.map((n) => (
              <li key={n.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{n.title}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                      {n.scope === 'broadcast' ? '公共' : '私信'}
                    </span>
                    {n.requiresAck ? (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700">
                        需确认
                      </span>
                    ) : null}
                    {n.deletedAt ? (
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-600">
                        已删除
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-gray-600">{n.content}</p>
                  <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>
                    {n.type}
                    {n.scope === 'personal' ? ` · ${n.email}` : ''}
                    {' · '}
                    {new Date(n.createdAt).toLocaleString('zh-CN')}
                  </p>
                </div>
                {!n.deletedAt ? (
                  <button
                    type="button"
                    onClick={() => void handleDelete(n.id)}
                    disabled={deletingId === n.id}
                    className="inline-flex items-center gap-1 self-start rounded-lg px-2.5 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
