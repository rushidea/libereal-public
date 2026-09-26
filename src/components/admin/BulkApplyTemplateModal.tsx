'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, Tag, X } from 'lucide-react';
import {
  detectDiscountConflicts,
  type DiscountConflictInfo,
  type DiscountConflictUser,
  type DiscountTemplateForConflict,
} from '@/lib/discountConflicts';
import { adminSurfaceClasses } from '@/lib/admin-surfaces';

export type BulkApplyUser = DiscountConflictUser;

interface DiscountTemplate {
  id: string;
  name: string;
  discountRate: string;
  brandDiscounts: string;
  description: string;
}

type Props = {
  selectedUsers: BulkApplyUser[];
  onClose: () => void;
  onDone: () => void;
};

export default function BulkApplyTemplateModal({ selectedUsers, onClose, onDone }: Props) {
  const [templates, setTemplates] = useState<DiscountTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<{ template: DiscountTemplate; conflicts: DiscountConflictInfo } | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/discount-templates');
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setTemplates(Array.isArray(data) ? data.filter((t: DiscountTemplate) =>
            t.discountRate !== '' || (t.brandDiscounts && t.brandDiscounts !== '')
          ) : []);
        } else {
          setError('加载模板失败');
        }
      } catch {
        if (!cancelled) setError('网络错误');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePick = (template: DiscountTemplate) => {
    const conflicts = detectDiscountConflicts(
      selectedUsers,
      template as DiscountTemplateForConflict,
    );
    setConfirm({ template, conflicts });
  };

  async function confirmAndApply() {
    if (!confirm) return;
    setApplying(true);
    setError('');
    try {
      const res = await fetch('/api/admin/discount-templates/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: confirm.template.id, userIds: selectedUsers.map(u => u.id) }),
      });
      const data = await res.json();
      if (res.ok) {
        onDone();
      } else {
        setError(data.error || '应用失败');
        setConfirm(null);
      }
    } catch {
      setError('网络错误');
      setConfirm(null);
    } finally {
      setApplying(false);
    }
  }

  const summarize = (t: DiscountTemplate) => {
    const parts: string[] = [];
    if (t.discountRate !== '' && t.discountRate != null) {
      parts.push(`统一 ${(parseFloat(t.discountRate) * 10).toFixed(1).replace(/\.0$/, '')}折`);
    }
    if (t.brandDiscounts) {
      try {
        const c = Object.keys(JSON.parse(t.brandDiscounts)).length;
        if (c > 0) parts.push(`${c} 个品牌`);
      } catch { /* ignore */ }
    }
    return parts.length > 0 ? parts.join(' · ') : '—';
  };

  return (
    <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/40 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]">
      <div className={`my-auto flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden ${adminSurfaceClasses.modal}`}>
        <div className="flex-shrink-0 px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">为 {selectedUsers.length} 个用户套用折扣模板</h3>
            <p className="text-xs text-gray-500 mt-0.5">点击模板后系统会自动检查冲突并提醒，确认后才覆盖</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>}
          {loading ? (
            <div className="text-center text-sm text-gray-400 py-8 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 加载模板中…
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-8">
              暂无模板，请先在 <Link href="/admin/discounts" className="text-indigo-600 hover:underline">折扣模板</Link> 页面创建
            </div>
          ) : (
            <ul className="space-y-2">
              {templates.map(t => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => handlePick(t)}
                    className="w-full text-left px-3 py-2.5 border border-gray-200 rounded-lg hover:border-indigo-400 hover:bg-indigo-50/40 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-gray-900 text-sm">{t.name}</div>
                      <Tag className="w-4 h-4 text-indigo-500" />
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{summarize(t)}</div>
                    {t.description && <div className="text-xs text-gray-400 mt-0.5">{t.description}</div>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex-shrink-0 flex items-center justify-end px-5 py-3 border-t border-gray-200">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors">关闭</button>
        </div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/40 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]">
          <div className={`w-full max-w-md ${adminSurfaceClasses.modal}`}>
            <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h3 className="font-semibold text-gray-900">应用模板前确认</h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-700">
                即将为 <span className="font-semibold text-indigo-600">{selectedUsers.length}</span> 个用户应用模板
                <span className="font-semibold">「{confirm.template.name}」</span>，将覆盖用户当前的统一折扣率和品牌折扣。
              </p>
              {confirm.conflicts.withPersonalDiscount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  其中 <span className="font-semibold">{confirm.conflicts.withPersonalDiscount}</span> 个用户已设置个人统一折扣率
                </div>
              )}
              {confirm.conflicts.withBrandDiscounts > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  其中 <span className="font-semibold">{confirm.conflicts.withBrandDiscounts}</span> 个用户已设置品牌折扣
                </div>
              )}
              {confirm.conflicts.brandConflicts.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  发现 <span className="font-semibold">{confirm.conflicts.brandConflicts.length}</span> 处品牌折扣冲突
                  <div className="mt-1 text-amber-700">
                    例：{confirm.conflicts.brandConflicts[0].userName} 的「
                    {confirm.conflicts.brandConflicts[0].brand}」当前
                    {((confirm.conflicts.brandConflicts[0].existing) * 10).toFixed(1).replace(/\.0$/, '')}折，模板
                    {((confirm.conflicts.brandConflicts[0].incoming) * 10).toFixed(1).replace(/\.0$/, '')}折
                  </div>
                </div>
              )}
              {confirm.conflicts.hasOtherTemplate > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">
                  其中 <span className="font-semibold">{confirm.conflicts.hasOtherTemplate}</span> 个用户已套用了其他折扣模板
                </div>
              )}
              {confirm.conflicts.withPersonalDiscount === 0 && confirm.conflicts.withBrandDiscounts === 0 && confirm.conflicts.brandConflicts.length === 0 && confirm.conflicts.hasOtherTemplate === 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-800">
                  所选用户无现有折扣设置，可安全应用
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className={`rounded-brand border px-4 py-2 text-sm ${adminSurfaceClasses.button}`}
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmAndApply}
                disabled={applying}
                className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white rounded-lg text-sm font-medium"
              >
                {applying ? '应用中…' : '确认覆盖'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
