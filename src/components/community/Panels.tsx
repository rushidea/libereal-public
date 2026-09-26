'use client';

import { useState, useEffect, useCallback } from 'react';
import { FlaskConical, Send, Edit, Trash2, FileText, ExternalLink, Plus, Beaker } from 'lucide-react';
import { UserRecipe, ProtocolContent, RecipeContent, STATUS_CONFIG } from './types';
import ProtocolEditor from './ProtocolEditor';
import RecipeEditor from './RecipeEditor';
import { uiSurfaces } from '@/lib/ui-surfaces';

export function ProtocolsPanel() {
  const [recipes, setRecipes] = useState<UserRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'draft' | 'pending' | 'approved' | 'rejected'>('all');
  const [editing, setEditing] = useState<UserRecipe | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const fetchRecipes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: 'protocol' });
      if (filter !== 'all') params.set('status', filter);
      const res = await fetch(`/api/user/recipes?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRecipes(data.recipes || []);
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchRecipes(); }, [fetchRecipes]);

  const drafts = recipes.filter(r => r.status === 'draft');

  const handleSave = async (data: { name: string; description: string; content: ProtocolContent; submit: boolean }) => {
    try {
      if (editing) {
        // Update existing
        const status = data.submit ? 'pending' : 'draft';
        const res = await fetch(`/api/user/recipes?id=${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: data.name, description: data.description, content: data.content, status }),
        });
        if (!res.ok) throw new Error('保存失败');
      } else {
        // Create new
        const status = data.submit ? 'pending' : 'draft';
        const res = await fetch('/api/user/recipes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'protocol', name: data.name, description: data.description, content: data.content, status }),
        });
        if (!res.ok) throw new Error('保存失败');
      }
      setShowEditor(false);
      setEditing(null);
      await fetchRecipes();
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个实验方案吗？')) return;
    await fetch(`/api/user/recipes?id=${id}`, { method: 'DELETE' });
    await fetchRecipes();
  };

  const handleSubmit = async (id: string) => {
    if (!confirm('确定要提交审核吗？提交后将进入待审核状态。')) return;
    await fetch('/api/user/recipes/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await fetchRecipes();
  };

  const handleEdit = (recipe: UserRecipe) => {
    setEditing(recipe);
    setShowEditor(true);
  };

  const handleNew = () => {
    setEditing(null);
    setShowEditor(true);
  };

  const handleCancel = () => {
    setShowEditor(false);
    setEditing(null);
  };

  const loadDraft = (draftId: string) => {
    const draft = recipes.find(r => r.id === draftId);
    if (draft) {
      setEditing(draft);
    }
  };

  if (showEditor) {
    return (
      <ProtocolEditor
        recipeId={editing?.id}
        initialContent={editing?.content as ProtocolContent}
        initialName={editing?.name}
        initialDescription={editing?.description}
        onSave={handleSave}
        onCancel={handleCancel}
        drafts={drafts.filter(d => d.id !== editing?.id).map(d => ({ id: d.id, name: d.name, updatedAt: d.updatedAt, content: d.content as ProtocolContent }))}
        onLoadDraft={loadDraft}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className={`${uiSurfaces.panel} rounded-brand p-4 shadow-[var(--shadow-panel-strong)]`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <FlaskConical className="text-brand-500" size={22} />
            <div>
              <h2 className={`text-lg font-bold ${uiSurfaces.titleText}`}>我的实验方案</h2>
              <p className={`mt-0.5 text-xs ${uiSurfaces.mutedText}`}>
                创建、编辑并分享您的实验方案
              </p>
            </div>
          </div>
          <button
            onClick={handleNew}
            className={`flex min-h-10 items-center gap-1 rounded-brand px-4 py-2 text-sm ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing}`}
          >
            <Plus size={14} /> 新建实验方案
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['all', 'draft', 'pending', 'approved', 'rejected'] as const).map(f => {
          const labels: Record<string, string> = { all: '全部', draft: '草稿', pending: '待审核', approved: '已批准', rejected: '已拒绝' };
          const count = f === 'all' ? recipes.length : recipes.filter(r => r.status === f).length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-brand-500 text-white'
                  : `${uiSurfaces.panel} ${uiSurfaces.textSecondary} ${uiSurfaces.border}`
              }`}
            >
              {labels[f]} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : recipes.length === 0 ? (
        <div className={`${uiSurfaces.panel} rounded-brand p-12 text-center`}>
          <FileText className="w-12 h-12 text-gray-300 dark:text-gray-500 mx-auto mb-4" />
          <p className={uiSurfaces.mutedText}>还没有实验方案</p>
          <button
            onClick={handleNew}
            className={`mt-2 inline-block text-sm ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}
          >
            立即创建 →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {recipes.map(recipe => {
            const content = recipe.content as ProtocolContent;
            const statusCfg = STATUS_CONFIG[recipe.status];
            return (
              <div key={recipe.id} className={`${uiSurfaces.panel} rounded-brand p-5 shadow-[var(--shadow-panel)]`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className={`font-semibold ${uiSurfaces.titleText}`}>{recipe.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                    </div>
                    <p className={`mb-2 text-xs ${uiSurfaces.mutedText}`}>
                      {content.category} · {content.difficulty} · {content.duration || '未填写'}
                    </p>
                    {recipe.description && (
                      <p className={`mb-2 line-clamp-2 text-sm ${uiSurfaces.textSecondary}`}>{recipe.description}</p>
                    )}
                    {recipe.status === 'rejected' && recipe.rejectionReason && (
                      <p className="text-xs text-red-600 dark:text-red-500 bg-red-50 dark:bg-red-500/10 px-2 py-1 rounded mb-2">
                        拒绝原因：{recipe.rejectionReason}
                      </p>
                    )}
                    <p className={`text-xs ${uiSurfaces.mutedText}`}>
                      更新于 {new Date(recipe.updatedAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {(recipe.status === 'draft' || recipe.status === 'rejected') && (
                      <>
                        <button
                          onClick={() => handleEdit(recipe)}
                          className={`flex min-h-10 items-center gap-1 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing}`}
                        >
                          <Edit size={12} /> 编辑
                        </button>
                        {recipe.status === 'draft' && (
                          <button
                            onClick={() => handleSubmit(recipe.id)}
                            className={`flex min-h-10 items-center gap-1 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.statusSuccess} ${uiSurfaces.focusRing}`}
                          >
                            <Send size={12} /> 提交审核
                          </button>
                        )}
                        {recipe.status === 'rejected' && (
                          <button
                            onClick={() => handleEdit(recipe)}
                            className={`flex min-h-10 items-center gap-1 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.statusWarning} ${uiSurfaces.focusRing}`}
                          >
                            <Edit size={12} /> 修改重提
                          </button>
                        )}
                      </>
                    )}
                    {recipe.status === 'approved' && (
                      <a
                        href={`/protocols/user/${recipe.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`flex min-h-10 items-center gap-1 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing}`}
                      >
                        <ExternalLink size={12} /> 查看公开页
                      </a>
                    )}
                    <button
                      onClick={() => handleDelete(recipe.id)}
                      className={`flex min-h-10 items-center gap-1 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.textSecondary} hover:text-[var(--brand-color-error-text)] hover:bg-[var(--brand-color-error-bg)] ${uiSurfaces.focusRing}`}
                    >
                      <Trash2 size={12} /> 删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RecipesPanel() {
  const [recipes, setRecipes] = useState<UserRecipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'draft' | 'pending' | 'approved' | 'rejected'>('all');
  const [editing, setEditing] = useState<UserRecipe | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  const fetchRecipes = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: 'buffer' });
      if (filter !== 'all') params.set('status', filter);
      const res = await fetch(`/api/user/recipes?${params}`);
      if (res.ok) {
        const data = await res.json();
        setRecipes(data.recipes || []);
      }
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchRecipes(); }, [fetchRecipes]);

  const drafts = recipes.filter(r => r.status === 'draft');

  const handleSave = async (data: { name: string; description: string; content: RecipeContent; submit: boolean }) => {
    try {
      if (editing) {
        const status = data.submit ? 'pending' : 'draft';
        const res = await fetch(`/api/user/recipes?id=${editing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: data.name, description: data.description, content: data.content, status }),
        });
        if (!res.ok) throw new Error('保存失败');
      } else {
        const status = data.submit ? 'pending' : 'draft';
        const res = await fetch('/api/user/recipes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'buffer', name: data.name, description: data.description, content: data.content, status }),
        });
        if (!res.ok) throw new Error('保存失败');
      }
      setShowEditor(false);
      setEditing(null);
      await fetchRecipes();
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个配方吗？')) return;
    await fetch(`/api/user/recipes?id=${id}`, { method: 'DELETE' });
    await fetchRecipes();
  };

  const handleSubmit = async (id: string) => {
    if (!confirm('确定要提交审核吗？')) return;
    await fetch('/api/user/recipes/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await fetchRecipes();
  };

  const handleEdit = (recipe: UserRecipe) => {
    setEditing(recipe);
    setShowEditor(true);
  };

  const handleNew = () => {
    setEditing(null);
    setShowEditor(true);
  };

  const handleCancel = () => {
    setShowEditor(false);
    setEditing(null);
  };

  const loadDraft = (draftId: string) => {
    const draft = recipes.find(r => r.id === draftId);
    if (draft) {
      setEditing(draft);
    }
  };

  if (showEditor) {
    return (
      <RecipeEditor
        recipeId={editing?.id}
        initialContent={editing?.content as RecipeContent}
        initialName={editing?.name}
        initialDescription={editing?.description}
        onSave={handleSave}
        onCancel={handleCancel}
        drafts={drafts.filter(d => d.id !== editing?.id).map(d => ({ id: d.id, name: d.name, updatedAt: d.updatedAt, content: d.content as RecipeContent }))}
        onLoadDraft={loadDraft}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className={`${uiSurfaces.panel} rounded-brand p-4 shadow-[var(--shadow-panel-strong)]`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Beaker className="text-brand-500" size={22} />
            <div>
              <h2 className={`text-lg font-bold ${uiSurfaces.titleText}`}>我的配方</h2>
              <p className={`mt-0.5 text-xs ${uiSurfaces.mutedText}`}>
                创建、编辑并分享您的缓冲液/试剂配方
              </p>
            </div>
          </div>
          <button
            onClick={handleNew}
            className={`flex min-h-10 items-center gap-1 rounded-brand px-4 py-2 text-sm ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing}`}
          >
            <Plus size={14} /> 新建配方
          </button>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['all', 'draft', 'pending', 'approved', 'rejected'] as const).map(f => {
          const labels: Record<string, string> = { all: '全部', draft: '草稿', pending: '待审核', approved: '已批准', rejected: '已拒绝' };
          const count = f === 'all' ? recipes.length : recipes.filter(r => r.status === f).length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filter === f
                  ? 'bg-brand-500 text-white'
                  : `${uiSurfaces.panel} ${uiSurfaces.textSecondary} ${uiSurfaces.border}`
              }`}
            >
              {labels[f]} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
        </div>
      ) : recipes.length === 0 ? (
        <div className={`${uiSurfaces.panel} rounded-brand p-12 text-center`}>
          <Beaker className="w-12 h-12 text-gray-300 dark:text-gray-500 mx-auto mb-4" />
          <p className={uiSurfaces.mutedText}>还没有配方</p>
          <button
            onClick={handleNew}
            className={`mt-2 inline-block text-sm ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}
          >
            立即创建 →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {recipes.map(recipe => {
            const content = recipe.content as RecipeContent;
            const statusCfg = STATUS_CONFIG[recipe.status];
            return (
              <div key={recipe.id} className={`${uiSurfaces.panel} rounded-brand p-5 shadow-[var(--shadow-panel)]`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className={`font-semibold ${uiSurfaces.titleText}`}>{recipe.name}</h3>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                    </div>
                    <p className={`mb-2 text-xs ${uiSurfaces.mutedText}`}>
                      {content.category} · {content.components.length} 种组分
                    </p>
                    {recipe.description && (
                      <p className={`mb-2 line-clamp-2 text-sm ${uiSurfaces.textSecondary}`}>{recipe.description}</p>
                    )}
                    {recipe.status === 'rejected' && recipe.rejectionReason && (
                      <p className="text-xs text-red-600 dark:text-red-500 bg-red-50 dark:bg-red-500/10 px-2 py-1 rounded mb-2">
                        拒绝原因：{recipe.rejectionReason}
                      </p>
                    )}
                    <p className={`text-xs ${uiSurfaces.mutedText}`}>
                      更新于 {new Date(recipe.updatedAt).toLocaleString('zh-CN')}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2 flex-shrink-0">
                    {(recipe.status === 'draft' || recipe.status === 'rejected') && (
                      <>
                        <button
                          onClick={() => handleEdit(recipe)}
                          className={`flex min-h-10 items-center gap-1 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing}`}
                        >
                          <Edit size={12} /> {recipe.status === 'rejected' ? '修改' : '编辑'}
                        </button>
                        {recipe.status === 'draft' && (
                          <button
                            onClick={() => handleSubmit(recipe.id)}
                            className={`flex min-h-10 items-center gap-1 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.statusSuccess} ${uiSurfaces.focusRing}`}
                          >
                            <Send size={12} /> 提交审核
                          </button>
                        )}
                        {recipe.status === 'rejected' && (
                          <button
                            onClick={() => handleEdit(recipe)}
                            className={`flex min-h-10 items-center gap-1 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.statusWarning} ${uiSurfaces.focusRing}`}
                          >
                            <Send size={12} /> 修改并重提
                          </button>
                        )}
                      </>
                    )}
                    {recipe.status === 'approved' && (
                      <a
                        href={`/protocols/buffers/user/${recipe.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className={`flex min-h-10 items-center gap-1 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing}`}
                      >
                        <ExternalLink size={12} /> 查看公开页
                      </a>
                    )}
                    <button
                      onClick={() => handleDelete(recipe.id)}
                      className={`flex min-h-10 items-center gap-1 rounded-brand px-3 py-1.5 text-xs ${uiSurfaces.textSecondary} hover:text-[var(--brand-color-error-text)] hover:bg-[var(--brand-color-error-bg)] ${uiSurfaces.focusRing}`}
                    >
                      <Trash2 size={12} /> 删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
