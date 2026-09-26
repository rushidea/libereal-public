'use client';

import { useState, useEffect } from 'react';
import {
  Tag, Users, Search, Loader2, ChevronLeft, AlertTriangle, X, ChevronRight,
} from 'lucide-react';
import { detectDiscountConflicts, DiscountConflictInfo, DiscountConflictUser, DiscountTemplateForConflict } from '@/lib/discountConflicts';

interface FilteredUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  institution: string | null;
  department: string | null;
  institutionName?: string | null;
  institutionUnit?: string | null;
  institutionFacility?: string | null;
  school?: string | null;
  college?: string | null;
  major?: string | null;
  building?: string | null;
  piLab?: string | null;
  affiliatedLab?: string | null;
  tier: string;
  points: number;
  discountRate: number | null;
  brandDiscounts: string | null;
  sourceTemplateId: string | null;
}

interface DiscountTemplate {
  id: string;
  name: string;
  discountRate: string;
  brandDiscounts: string;
  description: string;
}

interface FilterForm {
  tiers: string[];
  institution: string;
  department: string;
  pointsMin: string;
  pointsMax: string;
}

interface FilterResponse {
  total: number;
  users: FilteredUser[];
  facets: { institutions: string[]; departments: string[] };
}

const TIERS = ['standard'];
const DEFAULT_FORM: FilterForm = {
  tiers: [],
  institution: '',
  department: '',
  pointsMin: '',
  pointsMax: '',
};
const PAGE_SIZE = 50;

export default function AdminDiscountsApplyPage() {
  const [form, setForm] = useState<FilterForm>(DEFAULT_FORM);
  const [results, setResults] = useState<FilterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [templates, setTemplates] = useState<DiscountTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [confirm, setConfirm] = useState<{ template: DiscountTemplate; conflicts: DiscountConflictInfo; pickedUsers: FilteredUser[] } | null>(null);
  const [applying, setApplying] = useState(false);
  const [appliedMsg, setAppliedMsg] = useState('');
  const [error, setError] = useState('');

  // 拉模板列表
  useEffect(() => {
    fetch('/api/admin/discount-templates')
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        const arr: DiscountTemplate[] = Array.isArray(data) ? data : [];
        setTemplates(arr);
        if (arr.length > 0 && !selectedTemplateId) setSelectedTemplateId(arr[0].id);
      })
      .catch(() => setTemplates([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 筛选搜索 - re-search on offset change (pagination). doSearch() reads
  // current form state via buildQuery(); form changes are triggered via the
  // search button (which resets offset to 0 and calls doSearch() directly).
  useEffect(() => {
    doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);

  function buildQuery() {
    const sp = new URLSearchParams();
    if (form.tiers.length > 0) sp.set('tiers', form.tiers.join(','));
    if (form.institution.trim()) sp.set('institution', form.institution.trim());
    if (form.department.trim()) sp.set('department', form.department.trim());
    if (form.pointsMin) sp.set('pointsMin', form.pointsMin);
    if (form.pointsMax) sp.set('pointsMax', form.pointsMax);
    sp.set('limit', String(PAGE_SIZE));
    sp.set('offset', String(offset));
    return sp.toString();
  }

  async function doSearch() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/filter?${buildQuery()}`);
      if (res.ok) setResults(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function toggleTier(t: string) {
    setForm(f => ({
      ...f,
      tiers: f.tiers.includes(t) ? f.tiers.filter(x => x !== t) : [...f.tiers, t],
    }));
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!results) return;
    const allSelected = results.users.every(u => selectedIds.has(u.id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allSelected) results.users.forEach(u => next.delete(u.id));
      else results.users.forEach(u => next.add(u.id));
      return next;
    });
  }

  function handleClear() {
    setForm(DEFAULT_FORM);
    setSelectedIds(new Set());
    setOffset(0);
    setResults(null);
  }

  function handleApplyClick() {
    setError('');
    if (selectedIds.size === 0) { setError('请先勾选用户'); return; }
    if (!selectedTemplateId) { setError('请选择模板'); return; }
    const tpl = templates.find(t => t.id === selectedTemplateId);
    if (!tpl) { setError('模板不存在'); return; }
    // 必须搜过才能拿到用户完整数据（discountRate/brandDiscounts）
    if (!results) { setError('请先搜索用户'); return; }
    const pickedUsers = results.users.filter(u => selectedIds.has(u.id));
    if (pickedUsers.length === 0) { setError('当前页未选中任何用户，请先勾选'); return; }
    const conflicts = detectDiscountConflicts(
      pickedUsers as DiscountConflictUser[],
      tpl as DiscountTemplateForConflict,
    );
    setConfirm({ template: tpl, conflicts, pickedUsers });
  }

  async function confirmAndApply() {
    if (!confirm) return;
    setApplying(true);
    setError('');
    try {
      const res = await fetch('/api/admin/discount-templates/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: confirm.template.id, userIds: confirm.pickedUsers.map(u => u.id) }),
      });
      const data = await res.json();
      if (res.ok) {
        setAppliedMsg(`已为 ${data.appliedCount} 个用户应用模板「${confirm.template.name}」`);
        setTimeout(() => setAppliedMsg(''), 4000);
        setConfirm(null);
        setSelectedIds(new Set());
        doSearch();
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

  const allSelected = results?.users.length ? results.users.every(u => selectedIds.has(u.id)) : false;
  const totalPages = results ? Math.ceil(results.total / PAGE_SIZE) : 0;
  const currentPage = results ? Math.floor(offset / PAGE_SIZE) + 1 : 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId);
  const activeTemplates = templates.filter(t => t.discountRate !== '' || (t.brandDiscounts && t.brandDiscounts !== ''));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Tag className="w-6 h-6 text-brand-600" /> 批量应用折扣
        </h1>
        <p className="text-sm text-gray-500 mt-1">从筛选列表中选用户 + 选模板，一键套用</p>
      </div>

      {appliedMsg && (
        <div className="px-3 py-2 bg-brand-100 border border-brand-200 text-brand-700 text-sm rounded-lg flex items-center gap-2">
          <Tag className="w-4 h-4" />
          {appliedMsg}
        </div>
      )}
      {error && (
        <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          {error}
        </div>
      )}

      {/* 筛选面板 */}
      <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/70 p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">单位（模糊）</label>
            <input
              type="text"
              value={form.institution}
              onChange={e => setForm(form => ({...form, institution: e.target.value }))}
              placeholder="如：清华、北大"
              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
              list="apply-institutions"
            />
            {results?.facets.institutions && (
              <datalist id="apply-institutions">
                {results.facets.institutions.slice(0, 50).map(v => <option key={v} value={v} />)}
              </datalist>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">部门/课题组（模糊）</label>
            <input
              type="text"
              value={form.department}
              onChange={e => setForm(form => ({...form, department: e.target.value }))}
              placeholder="如：化学系、计算所"
              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
              list="apply-departments"
            />
            {results?.facets.departments && (
              <datalist id="apply-departments">
                {results.facets.departments.slice(0, 50).map(v => <option key={v} value={v} />)}
              </datalist>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">积分下限</label>
            <input type="number" value={form.pointsMin} onChange={e => setForm(form => ({...form, pointsMin: e.target.value }))} placeholder="0"
              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">积分上限</label>
            <input type="number" value={form.pointsMax} onChange={e => setForm(form => ({...form, pointsMax: e.target.value }))} placeholder="不限"
              className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">等级（多选，留空 = 全部）</label>
          <div className="flex flex-wrap gap-1.5">
            {TIERS.map(t => {
              const active = form.tiers.includes(t);
              return (
                <button key={t} type="button" onClick={() => toggleTier(t)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                    active ? 'bg-brand-50 border-brand-300 text-brand-700'
                           : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => { setOffset(0); doSearch(); }} disabled={loading}
            className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
            <Search className="w-3.5 h-3.5" /> 搜索
          </button>
          <button onClick={handleClear} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
            清空筛选
          </button>
          {results && (
            <span className="ml-auto text-xs text-gray-500">
              共 {results.total} 位用户（当前页 {results.users.length}，已选 {selectedIds.size}）
            </span>
          )}
        </div>
      </div>

      {/* 用户列表 */}
      <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white/70 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> 加载中…
          </div>
        ) : !results ? (
          <div className="px-5 py-12 text-center text-sm text-gray-400">点「搜索」加载用户</div>
        ) : results.users.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-gray-400">无匹配用户</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-gray-50/80">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-2 text-left w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">用户</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">机构 / 部门</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">等级</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">积分</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">当前折扣 / 源模板</th>
                </tr>
              </thead>
              <tbody>
                {results.users.map(u => {
                  const checked = selectedIds.has(u.id);
                  return (
                    <tr key={u.id}
                      onClick={() => toggleSelect(u.id)}
                      className={`border-b border-gray-100 cursor-pointer transition-colors ${
                        checked ? 'bg-brand-50/60' : 'hover:bg-gray-50'
                      }`}>
                      <td className="px-4 py-2">
                        <input type="checkbox" checked={checked} onChange={() => toggleSelect(u.id)} onClick={e => e.stopPropagation()}
                          className="rounded border-gray-300 text-brand-500 focus:ring-brand-500" />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800">{u.name || '(未设置)'}</div>
                        <div className="text-xs text-gray-500">{u.email}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {[
                          u.institutionName || u.school || u.institution,
                          u.institutionUnit || u.college,
                          u.department || u.major,
                          u.institutionFacility || u.building,
                          u.affiliatedLab || u.piLab,
                        ].filter(Boolean).join(' · ') || '-'}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">{u.tier}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">{u.points}</td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {u.sourceTemplateId ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">
                            套过模板
                          </span>
                        ) : (u.discountRate != null || u.brandDiscounts) ? (
                          <span className="inline-flex items-center px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">
                            手动设置
                          </span>
                        ) : <span className="text-gray-400">—</span>}
                        {u.discountRate != null && (
                          <span className="ml-1 text-gray-600">
                            {(u.discountRate * 10).toFixed(1).replace(/\.0$/, '')}折
                          </span>
                        )}
                        {u.brandDiscounts && (() => {
                          try {
                            const n = Object.keys(JSON.parse(u.brandDiscounts)).length;
                            return n > 0 ? <span className="ml-1 text-gray-400">· {n}品牌</span> : null;
                          } catch { return null; }
                        })()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 分页 + 应用操作栏（底部固定感） */}
      <div className="sticky bottom-[calc(var(--mobile-bottom-nav-height)+0.5rem)] z-40 flex flex-wrap items-center gap-3 rounded-2xl border border-white/70 bg-white/70 p-3 backdrop-blur-md lg:bottom-0">
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}
              className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-50 hover:bg-white">
              <ChevronLeft className="w-3 h-3" /> 上一页
            </button>
            <span className="text-xs text-gray-500 px-2">{currentPage} / {totalPages}</span>
            <button onClick={() => setOffset(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= (results?.total ?? 0)}
              className="px-2 py-1 text-xs border border-gray-200 rounded disabled:opacity-50 hover:bg-white">
              下一页 <ChevronRight className="w-3 h-3 inline" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <Users className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-600">已选 <span className="font-semibold text-brand-600">{selectedIds.size}</span> 人</span>
          {selectedIds.size > 0 && (
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-gray-400 hover:text-gray-600">
              清空选择
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">应用模板：</label>
          <select value={selectedTemplateId} onChange={e => setSelectedTemplateId(e.target.value)}
            disabled={activeTemplates.length === 0}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500">
            {activeTemplates.length === 0 && <option value="">（无模板，先去创建）</option>}
            {activeTemplates.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button onClick={handleApplyClick}
            disabled={selectedIds.size === 0 || !selectedTemplateId}
            className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium flex items-center gap-1.5">
            <Tag className="w-4 h-4" /> 应用到 {selectedIds.size} 人
          </button>
        </div>
      </div>

      {/* 智能检查 + 确认弹窗 */}
      {confirm && (
        <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/40 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h3 className="font-semibold text-gray-900">应用模板前确认</h3>
              <button onClick={() => setConfirm(null)} className="ml-auto p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-700">
                即将为 <span className="font-semibold text-indigo-600">{confirm.pickedUsers.length}</span> 个用户应用模板
                <span className="font-semibold">「{confirm.template.name}」</span>，将覆盖用户当前的统一折扣率和品牌折扣。
              </p>
              {confirm.conflicts.withPersonalDiscount > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  ⚠️ 其中 <span className="font-semibold">{confirm.conflicts.withPersonalDiscount}</span> 个用户已设置个人统一折扣率
                </div>
              )}
              {confirm.conflicts.withBrandDiscounts > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  ⚠️ 其中 <span className="font-semibold">{confirm.conflicts.withBrandDiscounts}</span> 个用户已设置品牌折扣
                </div>
              )}
              {confirm.conflicts.brandConflicts.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                  ⚠️ 发现 <span className="font-semibold">{confirm.conflicts.brandConflicts.length}</span> 处品牌折扣冲突
                  {confirm.conflicts.brandConflicts[0] && (
                    <div className="mt-1 text-amber-700">
                      例：{confirm.conflicts.brandConflicts[0].userName} 的「
                      {confirm.conflicts.brandConflicts[0].brand}」当前
                      {((confirm.conflicts.brandConflicts[0].existing) * 10).toFixed(1).replace(/\.0$/, '')}折，模板
                      {((confirm.conflicts.brandConflicts[0].incoming) * 10).toFixed(1).replace(/\.0$/, '')}折
                    </div>
                  )}
                </div>
              )}
              {confirm.conflicts.hasOtherTemplate > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">
                  ℹ️ 其中 <span className="font-semibold">{confirm.conflicts.hasOtherTemplate}</span> 个用户已套用了其他折扣模板
                </div>
              )}
              {confirm.conflicts.withPersonalDiscount === 0 && confirm.conflicts.withBrandDiscounts === 0 && confirm.conflicts.brandConflicts.length === 0 && confirm.conflicts.hasOtherTemplate === 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-800">
                  ✓ 所选用户无现有折扣设置，可安全应用
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg text-sm">
                取消
              </button>
              <button onClick={confirmAndApply} disabled={applying}
                className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-indigo-300 text-white rounded-lg text-sm font-medium">
                {applying ? '应用中…' : '确认覆盖'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
