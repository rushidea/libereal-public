'use client';

import { useState } from 'react';
import { X, Plus, Trash2, Save, Send, Sparkles, FileText } from 'lucide-react';
import { ProtocolContent, PROTOCOL_CATEGORIES, DIFFICULTY_OPTIONS } from './types';
import { protocolSummaries } from '@/data/protocols-summary';
import { protocols as protocolDetails } from '@/data/protocols-detail';
import { uiSurfaces } from '@/lib/ui-surfaces';

const editorPanelClass = `${uiSurfaces.modal} rounded-brand`;
const editorInputClass = `${uiSurfaces.input} rounded-brand px-3 py-2 text-sm text-[var(--brand-color-text)] ${uiSurfaces.focusRing} focus:border-[var(--brand-color-primary)]`;

type ProtocolEditorProps = {
  initialContent?: ProtocolContent;
  initialName?: string;
  initialDescription?: string;
  recipeId?: string; // present when editing existing
  onSave: (data: { name: string; description: string; content: ProtocolContent; submit: boolean }) => Promise<void>;
  onCancel: () => void;
  drafts: Array<{ id: string; name: string; updatedAt: string; content: ProtocolContent }>; // for "从我的草稿恢复"
  onLoadDraft: (draftId: string) => void;
};

const BLANK_PROTOCOL: ProtocolContent = {
  title: '',
  category: '蛋白检测',
  difficulty: '基础',
  duration: '',
  description: '',
  steps: [''],
  tips: [''],
  relatedProducts: [],
};

export default function ProtocolEditor({
  initialContent,
  initialName = '',
  initialDescription = '',
  recipeId,
  onSave,
  onCancel,
  drafts,
  onLoadDraft,
}: ProtocolEditorProps) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [content, setContent] = useState<ProtocolContent>(initialContent || BLANK_PROTOCOL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showTemplatePicker, setShowTemplatePicker] = useState(!initialContent);
  const [showDraftPicker, setShowDraftPicker] = useState(false);

  const loadBlankTemplate = () => {
    setContent({ ...BLANK_PROTOCOL });
    setName('');
    setDescription('');
    setShowTemplatePicker(false);
  };

  const loadFromExisting = (protocolId: string) => {
    const detail = protocolDetails.find(p => p.id === protocolId);
    if (!detail) return;
    const contentData: ProtocolContent = {
      title: detail.title,
      category: detail.category,
      difficulty: detail.difficulty,
      duration: detail.duration,
      description: detail.description,
      steps: [...detail.steps],
      tips: [...detail.tips],
      relatedProducts: (detail.relatedProducts || []).map(p => ({ name: p.name, cat: p.cat, code: p.code })),
    };
    setContent(contentData);
    setName(detail.title);
    setDescription(detail.description);
    setShowTemplatePicker(false);
  };

  const handleSubmit = async (submit: boolean) => {
    setError('');
    if (!name.trim()) { setError('请填写方案名称'); return; }
    if (!content.title.trim()) { setError('请填写方案标题'); return; }
    if (content.steps.length === 0 || content.steps.every(s => !s.trim())) {
      setError('请至少填写一个步骤'); return;
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
          {recipeId ? '编辑实验方案' : '新建实验方案'}
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
              <FileText className="w-5 h-5 text-brand-500 mb-2" />
              <p className="font-medium text-gray-800 dark:text-slate-900 text-sm">从现有协议克隆</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">基于公开方案修改</p>
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
              <p className="text-xs text-gray-500 dark:text-gray-500 mb-2">选择要克隆的协议：</p>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {protocolSummaries.map(p => (
                  <button
                    key={p.id}
                    onClick={() => loadFromExisting(p.id)}
                    className={`w-full rounded-brand border ${uiSurfaces.panel} p-2 text-left text-sm ${uiSurfaces.text} ${uiSurfaces.focusRing}`}
                  >
                    <p className="font-medium text-gray-800 dark:text-slate-900">{p.title}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-500">{p.category} · {p.difficulty} · {p.duration}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>方案名称 <span className="text-[var(--brand-color-error-text)]">*</span></label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如：改良版 Western Blot 操作流程"
            className={editorInputClass}
          />
        </div>

        <div>
          <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>方案描述</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            placeholder="简要介绍本方案的用途和特点"
            className={editorInputClass}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>分类</label>
            <select
              value={content.category}
              onChange={e => setContent(content => ({ ...content, category: e.target.value }))}
              className={editorInputClass}
            >
              {PROTOCOL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>难度</label>
            <select
              value={content.difficulty}
              onChange={e => setContent(content => ({ ...content, difficulty: e.target.value as '基础' | '中级' | '高级' }))}
              className={editorInputClass}
            >
              {DIFFICULTY_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>预估时长</label>
          <input
            value={content.duration}
            onChange={e => setContent(content => ({ ...content, duration: e.target.value }))}
            placeholder="例如：2-3天 / 4-5小时"
            className={editorInputClass}
          />
        </div>

        <div>
          <label className={`mb-1 block text-sm font-medium ${uiSurfaces.text}`}>详细介绍</label>
          <textarea
            value={content.description}
            onChange={e => setContent(content => ({ ...content, description: e.target.value }))}
            rows={3}
            placeholder="详细描述本方案的适用范围、原理等"
            className={editorInputClass}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={`block text-sm font-medium ${uiSurfaces.text}`}>实验步骤 <span className="text-[var(--brand-color-error-text)]">*</span></label>
            <button
              type="button"
              onClick={() => setContent(content => ({ ...content, steps: [...content.steps, ''] }))}
              className="text-xs text-brand-600 dark:text-brand-500 hover:text-brand-700 flex items-center gap-1"
            >
              <Plus size={12} /> 添加步骤
            </button>
          </div>
          {content.steps.map((step, i) => (
            <div key={i} className="flex items-start gap-2 mb-2">
              <span className="text-xs text-gray-500 dark:text-gray-500 mt-2 w-6">{i + 1}.</span>
              <textarea
                value={step}
                onChange={e => {
                  const newSteps = [...content.steps];
                  newSteps[i] = e.target.value;
                  setContent(content => ({ ...content, steps: newSteps }));
                }}
                rows={2}
                placeholder={`步骤 ${i + 1}`}
                className={`${editorInputClass} flex-1`}
              />
              {content.steps.length > 1 && (
                <button
                  type="button"
                  onClick={() => setContent(content => ({ ...content, steps: content.steps.filter((_, idx) => idx !== i) }))}
                  className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-500 mt-2"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={`block text-sm font-medium ${uiSurfaces.text}`}>注意事项</label>
            <button
              type="button"
              onClick={() => setContent(content => ({ ...content, tips: [...content.tips, ''] }))}
              className="text-xs text-brand-600 dark:text-brand-500 hover:text-brand-700 flex items-center gap-1"
            >
              <Plus size={12} /> 添加提示
            </button>
          </div>
          {content.tips.map((tip, i) => (
            <div key={i} className="flex items-start gap-2 mb-2">
              <span className="text-xs text-gray-500 dark:text-gray-500 mt-2 w-6">•</span>
              <textarea
                value={tip}
                onChange={e => {
                  const newTips = [...content.tips];
                  newTips[i] = e.target.value;
                  setContent(content => ({ ...content, tips: newTips }));
                }}
                rows={2}
                placeholder={`提示 ${i + 1}`}
                className={`${editorInputClass} flex-1`}
              />
              <button
                type="button"
                onClick={() => setContent(content => ({ ...content, tips: content.tips.filter((_, idx) => idx !== i) }))}
                className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-500 mt-2"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
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
