'use client';

import { useState } from 'react';
import { X, Plus, Trash2, Save, Send, Sparkles, Beaker } from 'lucide-react';
import { RecipeContent, RECIPE_CATEGORIES } from './types';
import { bufferSummaries } from '@/data/buffers-summary';
import { buffers as bufferDetails } from '@/data/buffers-detail';
import { uiSurfaces } from '@/lib/ui-surfaces';

const editorPanelClass = `${uiSurfaces.modal} rounded-brand`;
const editorInputClass = `${uiSurfaces.input} rounded-brand px-3 py-2 text-sm text-[var(--brand-color-text)] ${uiSurfaces.focusRing} focus:border-[var(--brand-color-primary)]`;

type RecipeEditorProps = {
  initialContent?: RecipeContent;
  initialName?: string;
  initialDescription?: string;
  recipeId?: string;
  onSave: (data: { name: string; description: string; content: RecipeContent; submit: boolean }) => Promise<void>;
  onCancel: () => void;
  drafts: Array<{ id: string; name: string; updatedAt: string; content: RecipeContent }>;
  onLoadDraft: (draftId: string) => void;
};

const BLANK_RECIPE: RecipeContent = {
  name: '',
  category: '缓冲液',
  description: '',
  components: [{ name: '', amount: '', notes: '' }],
  preparation: [''],
  storage: '',
  notes: '',
  relatedProducts: [],
};

export default function RecipeEditor({
  initialContent,
  initialName = '',
  initialDescription = '',
  recipeId,
  onSave,
  onCancel,
  drafts,
  onLoadDraft,
}: RecipeEditorProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [content, setContent] = useState<RecipeContent>(initialContent || BLANK_RECIPE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(!initialContent);
  const [showDraftPicker, setShowDraftPicker] = useState(false);

  const loadBlankTemplate = () => {
    setContent({ ...BLANK_RECIPE });
    setName('');
    setDescription('');
    setShowTemplatePicker(false);
  };

  const loadFromExisting = (bufferId: string) => {
    const detail = bufferDetails.find(b => b.id === bufferId);
    if (!detail) return;
    const contentData: RecipeContent = {
      name: detail.name,
      category: detail.category,
      description: detail.description,
      components: detail.components.map(c => ({ name: c.name, amount: c.amount, notes: '' })),
      preparation: [...detail.preparation],
      storage: detail.storage || '',
      notes: detail.notes ? detail.notes.join('\n') : '',
      relatedProducts: (detail.relatedProducts || []).map(p => ({ name: p.name, cat: '', code: p.code })),
    };
    setContent(contentData);
    setName(detail.name);
    setDescription(detail.description);
    setShowTemplatePicker(false);
  };

  const handleSubmit = async (submit: boolean) => {
    setError('');
    if (!name.trim()) { setError('请填写配方名称'); return; }
    if (!content.name.trim()) { setError('请填写配方名'); return; }
    if (content.components.length === 0 || content.components.every(c => !c.name.trim())) {
      setError('请至少填写一个组分'); return;
    }
    setSaving(true);
    try {
      await onSave({ name, description, content, submit });
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
      setSaving(false);
    }
  };

  return (
    <div className={`${editorPanelClass} max-h-[85vh] overflow-y-auto p-6`}>
      <div className={`sticky top-0 mb-4 flex items-center justify-between border-b border-[var(--surface-border)] ${uiSurfaces.modal} pb-2`}>
        <h3 className={`text-lg font-bold ${uiSurfaces.titleText}`}>
          {recipeId ? '编辑配方' : '新建配方'}
        </h3>
        <button onClick={onCancel} className={`${uiSurfaces.mutedText} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}>
          <X size={20} />
        </button>
      </div>

      {error && <div className={`mb-4 rounded-brand border border-[var(--brand-color-error-border)] bg-[var(--brand-color-error-bg)] p-3 text-sm text-[var(--brand-color-error-text)]`}>{error}</div>}

      {showTemplatePicker && (
        <div className={`${uiSurfaces.panelStrong} mb-6 rounded-brand p-4`}>
          <p className="text-sm font-medium text-gray-700 dark:text-slate-900 mb-3">选择创建方式：</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              onClick={loadBlankTemplate}
              className={`rounded-brand border-2 ${uiSurfaces.panel} ${uiSurfaces.text} p-4 text-left transition-colors hover:border-[var(--brand-color-primary)] ${uiSurfaces.focusRing}`}
            >
              <Sparkles className="w-5 h-5 text-brand-500 mb-2" />
              <p className="font-medium text-gray-800 dark:text-slate-900 text-sm">从零创建</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">空白模板，逐步填写</p>
            </button>
            <button
              onClick={() => setShowTemplatePicker(false)}
              className={`rounded-brand border-2 ${uiSurfaces.panel} ${uiSurfaces.text} p-4 text-left transition-colors hover:border-[var(--brand-color-primary)] ${uiSurfaces.focusRing}`}
            >
              <Beaker className="w-5 h-5 text-brand-500 mb-2" />
              <p className="font-medium text-gray-800 dark:text-slate-900 text-sm">从现有配方克隆</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">基于公开配方修改</p>
            </button>
            {drafts.length > 0 && (
              <button
                onClick={() => setShowDraftPicker(!showDraftPicker)}
                className={`rounded-brand border-2 ${uiSurfaces.panel} ${uiSurfaces.text} p-4 text-left transition-colors hover:border-[var(--brand-color-primary)] ${uiSurfaces.focusRing}`}
              >
                <Save className="w-5 h-5 text-brand-500 mb-2" />
                <p className="font-medium text-gray-800 dark:text-slate-900 text-sm">从我的草稿恢复</p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{drafts.length} 个草稿</p>
              </button>
            )}
          </div>

          {showDraftPicker && (
            <div className="mt-3 border-t border-gray-200 dark:border-slate-400 pt-3">
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-2">选择要恢复的草稿：</p>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {drafts.map(d => (
                  <button
                    key={d.id}
                    onClick={() => { onLoadDraft(d.id); setShowDraftPicker(false); setShowTemplatePicker(false); }}
                    className={`w-full rounded-brand border ${uiSurfaces.panel} p-2 text-left text-sm ${uiSurfaces.text} ${uiSurfaces.focusRing}`}
                  >
                    <p className="font-medium text-gray-800 dark:text-slate-900">{d.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">{new Date(d.updatedAt).toLocaleString('zh-CN')}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!showDraftPicker && (
            <div className="mt-3 border-t border-gray-200 dark:border-slate-400 pt-3">
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-2">选择要克隆的配方：</p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {bufferSummaries.map(b => (
                  <button
                    key={b.id}
                    onClick={() => loadFromExisting(b.id)}
                    className={`w-full rounded-brand border ${uiSurfaces.panel} p-2 text-left text-sm ${uiSurfaces.text} ${uiSurfaces.focusRing}`}
                  >
                    <p className="font-medium text-gray-800 dark:text-slate-900">{b.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">{b.category}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>配方名称 <span className="text-[var(--brand-color-error-text)]">*</span></label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：改良版 RIPA 裂解液"
            className={editorInputClass}
          />
        </div>

        <div>
          <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>配方描述</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="简要介绍本配方的用途和特点"
            className={editorInputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>配方名（卡片显示）</label>
            <input
              value={content.name}
              onChange={e => setContent(content => ({ ...content, name: e.target.value }))}
              placeholder="例如：磷酸盐缓冲液 (PBS)"
              className={editorInputClass}
            />
          </div>
          <div>
            <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>分类</label>
            <select
              value={content.category}
              onChange={e => setContent(content => ({ ...content, category: e.target.value }))}
              className={editorInputClass}
            >
              {RECIPE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>配方描述</label>
          <textarea
            value={content.description}
            onChange={e => setContent(content => ({ ...content, description: e.target.value }))}
            rows={2}
            className={editorInputClass}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={`block text-sm font-medium ${uiSurfaces.text}`}>组分 <span className="text-[var(--brand-color-error-text)]">*</span></label>
            <button
              type="button"
              onClick={() => setContent(content => ({ ...content, components: [...content.components, { name: '', amount: '', notes: '' }] }))}
              className="text-xs text-brand-600 dark:text-brand-500 hover:text-brand-700 flex items-center gap-1"
            >
              <Plus size={12} /> 添加组分
            </button>
          </div>
          {content.components.map((comp, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 mb-2">
              <input
                value={comp.name}
                onChange={e => {
                  const newComps = [...content.components];
                  newComps[i] = { ...newComps[i], name: e.target.value };
                  setContent(content => ({ ...content, components: newComps }));
                }}
                placeholder="组分名称"
                className={`${editorInputClass} col-span-4`}
              />
              <input
                value={comp.amount}
                onChange={e => {
                  const newComps = [...content.components];
                  newComps[i] = { ...newComps[i], amount: e.target.value };
                  setContent(content => ({ ...content, components: newComps }));
                }}
                placeholder="用量"
                className={`${editorInputClass} col-span-3`}
              />
              <input
                value={comp.notes || ''}
                onChange={e => {
                  const newComps = [...content.components];
                  newComps[i] = { ...newComps[i], notes: e.target.value };
                  setContent(content => ({ ...content, components: newComps }));
                }}
                placeholder="备注（可选）"
                className={`${editorInputClass} col-span-4`}
              />
              {content.components.length > 1 && (
                <button
                  type="button"
                  onClick={() => setContent(content => ({ ...content, components: content.components.filter((_, idx) => idx !== i) }))}
                  className="col-span-1 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={`block text-sm font-medium ${uiSurfaces.text}`}>配制步骤</label>
            <button
              type="button"
              onClick={() => setContent(content => ({ ...content, preparation: [...content.preparation, ''] }))}
              className="text-xs text-brand-600 dark:text-brand-500 hover:text-brand-700 flex items-center gap-1"
            >
              <Plus size={12} /> 添加步骤
            </button>
          </div>
          {content.preparation.map((step, i) => (
            <div key={i} className="flex items-start gap-2 mb-2">
              <span className="text-xs text-gray-500 dark:text-gray-500 mt-2 w-6">{i + 1}.</span>
              <textarea
                value={step}
                onChange={e => {
                  const newSteps = [...content.preparation];
                  newSteps[i] = e.target.value;
                  setContent(content => ({ ...content, preparation: newSteps }));
                }}
                rows={2}
                placeholder={`步骤 ${i + 1}`}
                className={`${editorInputClass} flex-1`}
              />
              {content.preparation.length > 1 && (
                <button
                  type="button"
                  onClick={() => setContent(content => ({ ...content, preparation: content.preparation.filter((_, idx) => idx !== i) }))}
                  className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-500 mt-2"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div>
          <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>储存方式</label>
          <input
            value={content.storage}
            onChange={e => setContent(content => ({ ...content, storage: e.target.value }))}
            placeholder="例如：4°C 保存 1 个月，-20°C 保存 6 个月"
            className={editorInputClass}
          />
        </div>

        <div>
          <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>备注</label>
          <textarea
            value={content.notes}
            onChange={e => setContent(content => ({ ...content, notes: e.target.value }))}
            rows={2}
            placeholder="其他需要说明的事项"
            className={editorInputClass}
          />
        </div>
      </div>

      <div className="flex gap-3 mt-6 pt-4 border-t border-gray-100 dark:border-slate-400">
        <button
          onClick={() => handleSubmit(false)}
          disabled={saving}
          className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-brand border ${uiSurfaces.border} py-2.5 text-sm font-medium ${uiSurfaces.text} hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing} disabled:opacity-50`}
        >
          <Save size={14} /> 保存草稿
        </button>
        <button
          onClick={() => handleSubmit(true)}
          disabled={saving}
          className={`flex min-h-11 flex-1 items-center justify-center gap-2 rounded-brand py-2.5 text-sm font-medium ${uiSurfaces.primaryButton} ${uiSurfaces.focusRing} disabled:opacity-50`}
        >
          <Send size={14} /> {saving ? '保存中...' : '保存并提交审核'}
        </button>
      </div>
    </div>
  );
}
