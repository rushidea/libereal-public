'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, X, Save, Check, Loader2 } from 'lucide-react';
import {
  alignBrandDiscounts,
  parseBrandDiscountsJson,
} from '@/lib/discount-brand-catalog';
import { adminSurfaceClasses } from '@/lib/admin-surfaces';

interface DiscountTemplate {
  id?: string;
  name: string;
  discountRate: string;
  brandDiscounts: string;
  description: string;
}

function buildJson(fields: { brand: string; value: string }[]): string {
  const obj: Record<string, number> = {};
  for (const f of fields) {
    if (f.value !== '') {
      const v = parseFloat(f.value);
      if (!isNaN(v)) obj[f.brand] = v;
    }
  }
  return Object.keys(obj).length > 0 ? JSON.stringify(obj) : '';
}

function parseBrandDiscounts(
  json: string,
  catalogBrands: string[],
): { brand: string; value: string }[] {
  const parsed = parseBrandDiscountsJson(json) ?? {};
  const { aligned } = alignBrandDiscounts(parsed, catalogBrands);
  return catalogBrands.map((brand) => ({
    brand,
    value: aligned[brand] != null ? String(aligned[brand]) : '',
  }));
}

function TemplateModal({ template, catalogBrands, brandsLoading, onSave, onClose }: {
  template?: DiscountTemplate;
  catalogBrands: string[];
  brandsLoading: boolean;
  onSave: (t: DiscountTemplate) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [discountRate, setDiscountRate] = useState(template?.discountRate ?? '');
  const [brandFields, setBrandFields] = useState<{ brand: string; value: string }[]>([]);
  const [description, setDescription] = useState(template?.description ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (brandsLoading || catalogBrands.length === 0) return;
    setBrandFields(parseBrandDiscounts(template?.brandDiscounts ?? '', catalogBrands));
  }, [brandsLoading, catalogBrands, template?.brandDiscounts]);

  const brandDiscounts = buildJson(brandFields);

  const handleSave = async () => {
    if (!name.trim()) { setError('模板名称不能为空'); return; }
    setSaving(true);
    try {
      const url = template?.id ? `/api/admin/discount-templates/${template.id}` : '/api/admin/discount-templates';
      const method = template?.id ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: template?.id,
          name: name.trim(),
          discountRate: discountRate === '' ? null : parseFloat(discountRate),
          brandDiscounts: brandDiscounts || null,
          description: description.trim(),
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        onSave({ ...template!, name: name.trim(), discountRate, brandDiscounts, description });
        if (Array.isArray(data.unmappedBrands) && data.unmappedBrands.length > 0) {
          setError(`已保存；未对齐品牌已忽略：${data.unmappedBrands.join('、')}`);
          return;
        }
        onClose();
      } else {
        const d = await res.json();
        setError(d.error || '保存失败');
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/30 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]">
      <div className={`relative my-auto mx-auto flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden ${adminSurfaceClasses.modal}`}>
        <div className="flex-shrink-0 px-5 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">{template?.id ? '编辑模板' : '新建模板'}</h3>
          <button type="button" onClick={onClose} className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">模板名称 <span className="text-red-500">*</span></label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="如：VIP客户、常规客户、南京大学实验室"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">统一折扣率</label>
            <div className="flex items-center gap-2">
              <input type="number" min="0" max="2" step="0.01" value={discountRate} onChange={e => setDiscountRate(e.target.value)} placeholder="0~1 常用 (0.85=85折)，市场可填 0~2"
                className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <span className="text-xs text-gray-400">{discountRate !== '' ? `${(parseFloat(discountRate) * 10).toFixed(1).replace(/\.0$/, '')}折` : '—'}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">品牌折扣</label>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              {brandsLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-gray-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> 正在加载产品库品牌…
                </div>
              ) : catalogBrands.length === 0 ? (
                <div className="py-8 text-center text-sm text-gray-400">产品库暂无品牌，无法配置品牌折扣</div>
              ) : (
                <table className="w-full min-w-[620px] text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-3 py-2 text-left font-medium text-gray-600 w-44">品牌</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600">折扣率</th>
                      <th className="px-3 py-2 text-left font-medium text-gray-600 w-16">折</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brandFields.map((field, idx) => (
                      <tr key={field.brand} className="border-b border-gray-100 last:border-0">
                        <td className="px-3 py-1.5 text-gray-700">{field.brand}</td>
                        <td className="px-3 py-1.5">
                          <input type="number" min="0" max="2" step="0.01" placeholder="0~1 常用 (0.85=85折)，市场可填 0~2"
                            value={field.value}
                            onChange={e => {
                              const nf = [...brandFields]; nf[idx] = { ...field, value: e.target.value }; setBrandFields(nf);
                            }}
                            className="w-20 px-2 py-1 border border-gray-200 rounded text-gray-800 focus:outline-none focus:ring-1 focus:ring-brand-500" />
                        </td>
                        <td className="px-3 py-1.5 text-gray-400">{field.value !== '' ? `${(parseFloat(field.value) * 10).toFixed(1).replace(/\.0$/, '')}折` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1">品牌列表来自产品库，新增品牌后刷新即可出现；留空表示该品牌无特殊折扣</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <input type="text" value={description} onChange={e => setDescription(e.target.value)} placeholder="可选，如适用场景说明"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
        </div>
        <div className="flex-shrink-0 flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-200">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">取消</button>
          <button type="button" onClick={handleSave} disabled={saving || brandsLoading}
            className="px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5">
            <Save className="w-3.5 h-3.5" />
            {saving ? '保存中...' : '保存模板'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DiscountTemplateManager() {
  const [templates, setTemplates] = useState<DiscountTemplate[]>([]);
  const [catalogBrands, setCatalogBrands] = useState<string[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<DiscountTemplate | undefined>();
  const [savedMsg, setSavedMsg] = useState('');

  const fetchTemplates = async () => {
    const res = await fetch('/api/admin/discount-templates');
    if (res.ok) setTemplates(await res.json());
  };

  const fetchCatalogBrands = async () => {
    setBrandsLoading(true);
    try {
      const res = await fetch('/api/admin/discount-templates/brands');
      if (res.ok) {
        const data = await res.json();
        setCatalogBrands(Array.isArray(data.brands) ? data.brands : []);
      }
    } finally {
      setBrandsLoading(false);
    }
  };

  useEffect(() => {
    void fetchTemplates();
    void fetchCatalogBrands();
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个模板吗？')) return;
    const res = await fetch(`/api/admin/discount-templates/${id}`, { method: 'DELETE' });
    if (res.ok) setTemplates(prev => prev.filter(t => t.id !== id));
  };

  const handleSaveTemplate = (saved: DiscountTemplate) => {
    if (editingTemplate?.id) {
      setTemplates(prev => prev.map(ex => ex.id === saved.id ? { ...ex, ...saved } : ex));
    } else {
      void fetchTemplates();
      setSavedMsg(`已创建模板「${saved.name}」`);
      setTimeout(() => setSavedMsg(''), 3000);
    }
  };

  const summarize = (t: DiscountTemplate) => {
    const parts: string[] = [];
    if (t.discountRate !== '' && t.discountRate != null) {
      parts.push(`统一 ${(parseFloat(t.discountRate) * 10).toFixed(1).replace(/\.0$/, '')}折`);
    }
    if (t.brandDiscounts) {
      try {
        const n = Object.keys(JSON.parse(t.brandDiscounts)).length;
        if (n > 0) parts.push(`${n} 个品牌`);
      } catch { /* ignore */ }
    }
    return parts.length > 0 ? parts.join(' · ') : '（未设置折扣）';
  };

  return (
    <>
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
              <span className="text-sm">📋</span>
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">折扣模板库</h2>
              <p className="text-xs text-gray-500">{templates.length} 个模板 · 在 <a href="/admin/discounts/apply" className="text-indigo-600 hover:underline">批量应用</a> 页给用户套用</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { setEditingTemplate({ name: '', discountRate: '', brandDiscounts: '', description: '' }); setShowModal(true); }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-medium transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            新建模板
          </button>
        </div>

        {savedMsg && (
          <div className="px-3 py-2 bg-brand-100 border border-brand-200 text-brand-700 text-sm rounded-lg flex items-center gap-2">
            <Check className="w-4 h-4" />
            {savedMsg}
          </div>
        )}

        {templates.length === 0 ? (
          <div className={`rounded-brand border ${adminSurfaceClasses.border} py-6 text-center text-sm ${adminSurfaceClasses.muted}`}>
            暂无模板，点&quot;新建模板&quot;创建一个
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map(t => (
              <div key={t.id} className={`flex items-center gap-2 rounded-brand border ${adminSurfaceClasses.border} ${adminSurfaceClasses.panel} px-3 py-2.5`}>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 text-sm truncate">{t.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-2">
                    <span>{summarize(t)}</span>
                    {t.description && <span className="text-gray-300">· {t.description}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => { setEditingTemplate({ ...t }); setShowModal(true); }}
                    className="p-1 text-gray-400 hover:text-indigo-600 transition-colors" title="编辑模板"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(t.id!)}
                    className="p-1 text-gray-400 hover:text-red-500 transition-colors" title="删除模板"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && (
        <TemplateModal
          template={editingTemplate}
          catalogBrands={catalogBrands}
          brandsLoading={brandsLoading}
          onSave={handleSaveTemplate}
          onClose={() => { setShowModal(false); setEditingTemplate(undefined); }}
        />
      )}
    </>
  );
}
