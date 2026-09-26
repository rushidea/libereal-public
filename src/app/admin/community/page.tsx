'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

import { Search, FileText, X, Check, FlaskConical } from 'lucide-react';
import type { UserRecipe, RecipeContent, ProtocolContent } from '@/components/community/types';

export default function AdminCommunityPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FlaskConical className="w-6 h-6 text-brand-600" /> 社区共创
        </h1>
        <p className="text-sm text-gray-500 mt-1">审核用户提交的研究方案、实验协议、缓冲液配方</p>
      </div>
      <CommunityPanel />
    </div>
  );
}

function CommunityPanel() {

  const [recipes, setRecipes] = useState<UserRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('pending');
  const [typeFilter, setTypeFilter] = useState<'all' | 'protocol' | 'buffer'>('all');
  const [search, setSearch] = useState('');
  const [selectedRecipe, setSelectedRecipe] = useState<UserRecipe | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { data: session, status } = useSession();

  const fetchRecipes = async () => {
    setLoading(true);
    try {
      const params = filter === 'all' ? '' : `?status=${filter}`;
      const res = await fetch(`/api/admin/community${params}`);
      if (res.ok) {
        const data = await res.json();
        setRecipes(data.recipes || []);
      }
    } finally {
      setLoading(false);
    }
  };

  // Re-fetch recipes when filter changes. fetchRecipes() reads current state;
  // dependencies are intentionally limited to [filter] to avoid refetch on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchRecipes(); }, [filter]);

  const handleAction = async (recipeId: string, action: 'approve' | 'reject' | 'revoke') => {
    if (action === 'reject' && !rejectionReason.trim()) {
      alert('请输入拒绝原因');
      return;
    }
    if (action !== 'reject' && !confirm(`确定要${action === 'approve' ? '批准' : '撤销'}吗？`)) return;

    setActionLoading(true);
    try {
      const res = await fetch('/api/admin/community', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipeId, action, rejectionReason: action === 'reject' ? rejectionReason : undefined }),
      });
      if (res.ok) {
        setSelectedRecipe(null);
        setRejectionReason('');
        await fetchRecipes();
      } else {
        const data = await res.json();
        alert(data.error || '操作失败');
      }
    } finally {
      setActionLoading(false);
    }
  };

  const filtered = recipes.filter(r => {
    if (typeFilter !== 'all' && r.type !== typeFilter) return false;
    if (search && !r.name.toLowerCase().includes(search.toLowerCase()) && !(r.userName || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const STATUS_BADGE: Record<string, { label: string; color: string }> = {
    draft: { label: '草稿', color: 'bg-gray-100 text-gray-700' },
    pending: { label: '待审核', color: 'bg-amber-100 text-amber-700' },
    approved: { label: '已批准', color: 'bg-green-100 text-green-700' },
    rejected: { label: '已拒绝', color: 'bg-red-100 text-red-700' },
  };

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="w-5 h-5 text-brand-500" />
          <h2 className="text-lg font-bold text-gray-800">社区共创内容</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索名称/作者..."
              className="pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['pending', 'approved', 'rejected', 'all'] as const).map(f => {
          const labels = { pending: '待审核', approved: '已批准', rejected: '已拒绝', all: '全部' };
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-brand-500 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
              }`}
            >
              {labels[f]}
            </button>
          );
        })}
        <div className="ml-auto flex gap-2">
          {(['all', 'protocol', 'buffer'] as const).map(t => {
            const labels = { all: '全部类型', protocol: '实验方案', buffer: '配方' };
            return (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  typeFilter === t
                    ? 'bg-blue-500 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'
                }`}
              >
                {labels[t]}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">暂无{filter === 'pending' ? '待审核' : ''}内容</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(recipe => {
            const statusBadge = STATUS_BADGE[recipe.status] || STATUS_BADGE.draft;
            return (
              <div key={recipe.id} className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-medium text-gray-800 truncate">{recipe.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge.color}`}>
                      {statusBadge.label}
                    </span>
                    <span className="text-xs text-gray-500">
                      {recipe.type === 'protocol' ? '实验方案' : '配方'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500">
                    作者：{recipe.userName || recipe.userEmail} · 提交于 {new Date(recipe.createdAt).toLocaleString('zh-CN')}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => setSelectedRecipe(recipe)}
                    className="text-xs px-3 py-1.5 bg-brand-50 text-brand-700 rounded-lg hover:bg-brand-100"
                  >
                    查看
                  </button>
                  {recipe.status === 'pending' && (
                    <>
                      <button
                        onClick={() => handleAction(recipe.id, 'approve')}
                        disabled={actionLoading}
                        className="text-xs px-3 py-1.5 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" /> 批准
                      </button>
                      <button
                        onClick={() => { setSelectedRecipe(recipe); setRejectionReason(''); }}
                        disabled={actionLoading}
                        className="text-xs px-3 py-1.5 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 flex items-center gap-1"
                      >
                        <X className="w-3 h-3" /> 拒绝
                      </button>
                    </>
                  )}
                  {recipe.status === 'approved' && (
                    <button
                      onClick={() => handleAction(recipe.id, 'revoke')}
                      disabled={actionLoading}
                      className="text-xs px-3 py-1.5 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100"
                    >
                      撤销
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedRecipe && (
        <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/50 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]">
          <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-100 p-4 flex items-center justify-between">
              <h3 className="font-bold text-gray-800">内容预览 - {selectedRecipe.name}</h3>
              <button onClick={() => setSelectedRecipe(null)} className="p-1 hover:bg-gray-100 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              {selectedRecipe.description && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">描述</p>
                  <p className="text-sm text-gray-700">{selectedRecipe.description}</p>
                </div>
              )}

              {selectedRecipe.type === 'protocol' && (
                <>
                  {(selectedRecipe.content as ProtocolContent).steps && (selectedRecipe.content as ProtocolContent).steps.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">实验步骤</p>
                      <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                        {(selectedRecipe.content as ProtocolContent).steps.filter((s: string) => s.trim()).map((s: string, i: number) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                  {(selectedRecipe.content as ProtocolContent).tips && (selectedRecipe.content as ProtocolContent).tips.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">注意事项</p>
                      <ul className="text-sm text-gray-700 space-y-1 list-disc list-inside">
                        {(selectedRecipe.content as ProtocolContent).tips.filter((s: string) => s.trim()).map((s: string, i: number) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}

              {selectedRecipe.type === 'buffer' && (
                <>
                  {(selectedRecipe.content as RecipeContent).components && (selectedRecipe.content as RecipeContent).components.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">组分</p>
                      <table className="w-full text-sm">
                        <tbody>
                          {selectedRecipe.type === 'buffer' && (selectedRecipe.content as RecipeContent).components.filter(c => c.name.trim()).map((c, i) => (
                            <tr key={i} className="border-b border-gray-100">
                              <td className="py-1">{c.name}</td>
                              <td className="py-1 font-mono text-xs text-gray-600">{c.amount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {(selectedRecipe.content as RecipeContent).preparation && (selectedRecipe.content as RecipeContent).preparation.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">配制步骤</p>
                      <ol className="text-sm text-gray-700 space-y-1 list-decimal list-inside">
                        {(selectedRecipe.content as RecipeContent).preparation.filter((s: string) => s.trim()).map((s: string, i: number) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </>
              )}

              {selectedRecipe.status === 'pending' && (
                <div className="pt-4 border-t border-gray-100 space-y-2">
                  <button
                    onClick={() => handleAction(selectedRecipe.id, 'approve')}
                    disabled={actionLoading}
                    className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    批准并发布
                  </button>
                  <div className="flex gap-2">
                    <input
                      value={rejectionReason}
                      onChange={e => setRejectionReason(e.target.value)}
                      placeholder="拒绝原因（必填）"
                      className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
                    />
                    <button
                      onClick={() => handleAction(selectedRecipe.id, 'reject')}
                      disabled={actionLoading || !rejectionReason.trim()}
                      className="px-5 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                    >
                      拒绝
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
