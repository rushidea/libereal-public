'use client';
import type React from 'react';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Minus, Equal, Search, Package, Edit2, X, FileText, Sigma, Users, Undo2 } from 'lucide-react';
import { POINTS_LOG_TYPE_LABELS, POINTS_LOG_TYPE_COLORS, PRODUCT_CATEGORY_LABELS, PRODUCT_CATEGORY_COLORS, ProductCategory, PointsLogType } from '@/lib/points';
import PointsInjectPanel from '@/components/admin/PointsInjectPanel';
import ResearchGroupsManager from '@/components/admin/ResearchGroupsManager';
import { adminSurfaceClasses } from '@/lib/admin-surfaces';
import { isAdminMfaStepUpResponse, useAdminMfaStepUp } from '@/components/admin/AdminMfaStepUpDialog';

interface PointsLog {
  id: string;
  userId: string;
  delta: number;
  type: string;
  reason: string | null;
  relatedId: string | null;
  undoOfId: string | null;
  isUndone: boolean;
  adminEmail: string | null;
  createdAt: string;
  userName: string | null;
  userEmail: string;
}

interface Redemption {
  id: string;
  userId: string;
  productId: string;
  productName: string;
  pointsCost: number;
  status: string;
  shippingInfo: string | null;
  trackingNumber: string | null;
  adminNote: string | null;
  variantName: string | null;
  createdAt: string;
  updatedAt: string;
  userName: string | null;
  userEmail: string;
}

interface PointsProduct {
  id: string;
  name: string;
  description: string | null;
  category: string;
  imageUrl: string | null;
  pointsCost: number;
  stock: number;
  isActive: number;
  metadata: string | null;
  createdAt: string;
}

const REDEMPTION_STATUSES = [
  { value: 'pending', label: '待处理', color: 'bg-amber-100 text-amber-700' },
  { value: 'shipped', label: '已发货', color: 'bg-blue-100 text-blue-700' },
  { value: 'completed', label: '已完成', color: 'bg-green-100 text-green-700' },
  { value: 'cancelled', label: '已取消', color: 'bg-gray-100 text-gray-700' },
];

type PointsTab = 'adjust' | 'inject' | 'groups' | 'logs' | 'redemptions' | 'products';

const VALID_TABS: PointsTab[] = ['adjust', 'inject', 'groups', 'logs', 'redemptions', 'products'];

export default function PointsManager({ defaultTab = 'adjust' as PointsTab }: { defaultTab?: PointsTab }) {
  const initial: PointsTab = VALID_TABS.includes(defaultTab) ? defaultTab : 'adjust';
  const { begin: beginMfaStepUp, dialog: mfaDialog } = useAdminMfaStepUp();
  const [tab, setTab] = useState<PointsTab>(initial);
  const [loading, setLoading] = useState(false);

  // Adjust form state
  const [adjustUserId, setAdjustUserId] = useState('');
  const [adjustMode, setAdjustMode] = useState<'add' | 'subtract' | 'set'>('add');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustMessage, setAdjustMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Adjust user search state
  const [userMatches, setUserMatches] = useState<{ id: string; name: string | null; email: string; points: number; tier: string | null }[]>([]);
  const [userSearching, setUserSearching] = useState(false);
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string | null; email: string; points: number; tier: string | null } | null>(null);

  // Batch mode state
  const [batchMode, setBatchMode] = useState(false);
  const [batchEmails, setBatchEmails] = useState('');
  const [batchResult, setBatchResult] = useState<{ success: boolean; succeededCount: number; failedCount: number; succeeded: { email: string; userName?: string; oldPoints: number; newPoints: number; delta: number }[]; failed: { email: string; reason: string }[] } | null>(null);

  // User filter modal (batch mode helper)
  const [showUserFilterModal, setShowUserFilterModal] = useState(false);
  const [filterForm, setFilterForm] = useState({
    tiers: [] as string[],
    institution: '',
    department: '',
    pointsMin: '',
    pointsMax: '',
  });
  const [filterResults, setFilterResults] = useState<{ total: number; users: { id: string; email: string; name: string | null; points: number; tier: string | null; institution?: string | null; department?: string | null; institutionName?: string | null; institutionUnit?: string | null; institutionFacility?: string | null; school?: string | null; college?: string | null; major?: string | null; building?: string | null; piLab?: string | null; affiliatedLab?: string | null; isNewUser?: boolean; createdAt: string }[]; facets: { institutions: string[]; departments: string[] } } | null>(null);
  const [filterLoading, setFilterLoading] = useState(false);
  const [filterSelectedIds, setFilterSelectedIds] = useState<Set<string>>(new Set());
  const [filterOffset, setFilterOffset] = useState(0);
  const filterLimit = 50;

  function clearAdjustForm() {
    setAdjustUserId('');
    setAdjustMode('add');
    setAdjustAmount('');
    setAdjustReason('');
    setAdjustMessage(null);
    setSelectedUser(null);
    setUserMatches([]);
    setShowUserDropdown(false);
    setBatchMode(false);
    setBatchEmails('');
    setBatchResult(null);
  }

  // Logs state
  const [logs, setLogs] = useState<PointsLog[]>([]);
  const [logsFilter, setLogsFilter] = useState('');

  // Redemptions state
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [editingRedemption, setEditingRedemption] = useState<Redemption | null>(null);

  // Products state
  const [products, setProducts] = useState<PointsProduct[]>([]);
  const [editingProduct, setEditingProduct] = useState<PointsProduct | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (logsFilter) params.set('userId', logsFilter);
      params.set('limit', '100');
      const res = await fetch(`/api/admin/points/logs?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } finally {
      setLoading(false);
    }
  }, [logsFilter]);

  const fetchRedemptions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/points/redemptions?limit=100');
      if (res.ok) {
        const data = await res.json();
        setRedemptions(data.redemptions || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/points/products?includeInactive=true');
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'logs') fetchLogs();
    if (tab === 'redemptions') fetchRedemptions();
    if (tab === 'products') fetchProducts();
  }, [tab, fetchLogs, fetchRedemptions, fetchProducts]);

  // Debounced user search (for adjust tab)
  useEffect(() => {
    if (tab !== 'adjust') return;
    if (!adjustUserId.trim()) {
      setUserMatches([]);
      setUserSearching(false);
      return;
    }
    // 如果输入和已选 user 的 id 完全相同（说明已选中），不搜索
    if (selectedUser && adjustUserId === selectedUser.id) {
      return;
    }
    setUserSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(adjustUserId.trim())}&limit=8`);
        const data = await res.json();
        setUserMatches(data.users || []);
        setShowUserDropdown(true);
      } catch {
        setUserMatches([]);
      } finally {
        setUserSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [adjustUserId, tab, selectedUser]);

  async function submitBatchAdjust(
    body: { emails: string[]; mode: 'add' | 'subtract' | 'set'; amount: number; reason: string; stepUpToken?: string },
    allowMfaStepUp = true,
  ) {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/points/adjust-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (allowMfaStepUp && isAdminMfaStepUpResponse(res.status, data.error)) {
        await beginMfaStepUp((grantToken) => submitBatchAdjust({ ...body, stepUpToken: grantToken }, false));
        return;
      }
      if (res.ok) {
        setBatchResult(data);
        setAdjustMessage({
          type: data.failedCount === 0 ? 'success' : 'error',
          text: `批量完成：成功 ${data.succeededCount} 个，失败 ${data.failedCount} 个`,
        });
      } else {
        setAdjustMessage({ type: 'error', text: data.error || '操作失败' });
      }
    } catch {
      setAdjustMessage({ type: 'error', text: '网络错误' });
    } finally {
      setLoading(false);
    }
  }

  async function submitSingleAdjust(
    body: { userId: string; reason?: string; delta?: number; setTo?: number; stepUpToken?: string },
    allowMfaStepUp = true,
  ) {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/points/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (allowMfaStepUp && isAdminMfaStepUpResponse(res.status, data.error)) {
        await beginMfaStepUp((grantToken) => submitSingleAdjust({ ...body, stepUpToken: grantToken }, false));
        return;
      }
      if (res.ok) {
        setAdjustMessage({
          type: 'success',
          text: `调整成功：${data.oldPoints} → ${data.newPoints}（${data.delta > 0 ? '+' : ''}${data.delta}）`,
        });
        setAdjustAmount('');
        setAdjustReason('');
        setAdjustUserId('');
        setSelectedUser(null);
        setUserMatches([]);
        setShowUserDropdown(false);
      } else {
        setAdjustMessage({ type: 'error', text: data.error || '操作失败' });
      }
    } catch {
      setAdjustMessage({ type: 'error', text: '网络错误' });
    } finally {
      setLoading(false);
    }
  }

  async function handleAdjust() {
    setAdjustMessage(null);
    setBatchResult(null);
    const amount = parseInt(adjustAmount);

    if (batchMode) {
      const emails = batchEmails.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
      if (emails.length === 0) {
        setAdjustMessage({ type: 'error', text: '请输入至少一个邮箱' });
        return;
      }
      if (isNaN(amount) || (adjustMode === 'set' ? amount < 0 : amount <= 0)) {
        setAdjustMessage({ type: 'error', text: adjustMode === 'set' ? '请输入不小于 0 的整数' : '请输入有效的正整数' });
        return;
      }
      if (!adjustReason.trim()) {
        setAdjustMessage({ type: 'error', text: '批量调整必须填写原因' });
        return;
      }

      await submitBatchAdjust({ emails, mode: adjustMode, amount, reason: adjustReason.trim() });
      return;
    }

    if (!adjustUserId.trim()) {
      setAdjustMessage({ type: 'error', text: '请填写用户 ID' });
      return;
    }
    if (isNaN(amount) || (adjustMode === 'set' ? amount < 0 : amount <= 0)) {
      setAdjustMessage({ type: 'error', text: adjustMode === 'set' ? '请输入不小于 0 的整数' : '请输入有效的正整数' });
      return;
    }
    if (adjustMode !== 'add' && !adjustReason.trim()) {
      setAdjustMessage({ type: 'error', text: '扣除或设置积分时必须填写原因' });
      return;
    }

    const body: { userId: string; reason?: string; delta?: number; setTo?: number } = { userId: adjustUserId.trim(), reason: adjustReason.trim() || undefined };
    if (adjustMode === 'add') body.delta = amount;
    else if (adjustMode === 'subtract') body.delta = -amount;
    else body.setTo = amount;
    await submitSingleAdjust(body);
  }

  async function submitUndo(logId: string, stepUpToken?: string, allowMfaStepUp = true) {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/points/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logId, stepUpToken }),
      });
      const data = await res.json();
      if (allowMfaStepUp && isAdminMfaStepUpResponse(res.status, data.error)) {
        await beginMfaStepUp((grantToken) => submitUndo(logId, grantToken, false));
        return;
      }
      if (res.ok) {
        setAdjustMessage({
          type: 'success',
          text: `撤销成功：${data.userEmail || '用户'} ${data.oldPoints} → ${data.newPoints}（${data.delta > 0 ? '+' : ''}${data.delta}）`,
        });
        await fetchLogs();
      } else {
        setAdjustMessage({ type: 'error', text: data.error || '撤销失败' });
      }
    } catch {
      setAdjustMessage({ type: 'error', text: '网络错误' });
    } finally {
      setLoading(false);
    }
  }

  async function handleUndo(logId: string) {
    if (!confirm('确定撤销这条积分调整？该操作会创建一个方向相反的记录，无法撤销。')) return;
    await submitUndo(logId);
  }

  async function updateRedemptionStatus(id: string, status: string, trackingNumber?: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/points/redemptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, trackingNumber }),
      });
      if (res.ok) {
        await fetchRedemptions();
        setEditingRedemption(null);
      } else {
        const data = await res.json();
        alert(data.error || '更新失败');
      }
    } finally {
      setLoading(false);
    }
  }

  async function toggleProductActive(product: PointsProduct) {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/points/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !product.isActive }),
      });
      if (res.ok) await fetchProducts();
      else {
        const data = await res.json();
        alert(data.error || '操作失败');
      }
    } finally {
      setLoading(false);
    }
  }

  async function deleteProduct(product: PointsProduct) {
    if (!confirm(`确定删除礼遇「${product.name}」？`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/points/products/${product.id}`, { method: 'DELETE' });
      if (res.ok) await fetchProducts();
      else {
        const data = await res.json();
        alert(data.error || '删除失败');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { key: 'adjust' as const, label: '积分调整', icon: Equal },
          { key: 'inject' as const, label: '积分注入', icon: Plus },
          { key: 'groups' as const, label: '课题组', icon: Users },
          { key: 'logs' as const, label: '积分日志', icon: FileText },
          { key: 'redemptions' as const, label: '兑换订单', icon: Package },
          { key: 'products' as const, label: '礼遇管理', icon: Edit2 },
        ].map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                tab === item.key
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {item.label}
            </button>
          );
        })}
      </div>

      {/* Inject Tab */}
      {tab === 'inject' && <PointsInjectPanel />}

      {/* Research groups Tab */}
      {tab === 'groups' && <ResearchGroupsManager />}

      {/* Adjust Tab */}
      {tab === 'adjust' && (
        <div className={`${adminSurfaceClasses.panel} p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h3 className="min-w-0 font-semibold text-gray-800 flex items-center gap-2">
              <Sigma className="w-4 h-4 text-brand-600" /> 积分调整
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => { setBatchMode(!batchMode); setBatchResult(null); setAdjustMessage(null); }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  batchMode ? 'bg-brand-50 text-brand-700 border border-brand-200' : 'bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100'
                }`}
              >
                <Users className="w-3.5 h-3.5" /> 批量模式 {batchMode ? '开' : '关'}
              </button>
              <button
                onClick={clearAdjustForm}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-50 text-gray-600 border border-gray-200 hover:bg-gray-100 transition-colors flex items-center gap-1.5"
                title="清空当前编辑"
              >
                <X className="w-3.5 h-3.5" /> 清空
              </button>
            </div>
          </div>
          <div className="space-y-3 max-w-2xl">
            {batchMode ? (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">
                    用户邮箱列表（每行一个，或用逗号/分号分隔）
                  </label>
                  <button
                    onClick={() => { setShowUserFilterModal(true); setFilterOffset(0); }}
                    className="text-xs text-brand-600 hover:text-brand-700 flex items-center gap-1"
                  >
                    <Users className="w-3.5 h-3.5" /> 从用户列表筛选
                  </button>
                </div>
                <textarea
                  value={batchEmails}
                  onChange={e => setBatchEmails(e.target.value)}
                  rows={6}
                  placeholder={'user1@example.com\nuser2@example.com\nuser3@example.com'}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
                />
                <p className="text-xs text-gray-400 mt-1">
                  共 {batchEmails.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean).length} 个邮箱
                </p>

                {batchResult && (batchResult.succeeded.length > 0 || batchResult.failed.length > 0) && (
                  <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden">
                    {batchResult.succeeded.length > 0 && (
                      <div className="bg-green-50 border-b border-green-200 px-3 py-2">
                        <p className="text-sm font-medium text-green-800">
                          ✓ 成功 {batchResult.succeededCount} 个
                        </p>
                        <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                          {batchResult.succeeded.map((s) => (
                            <p key={s.email} className="text-xs text-green-700">
                              {s.email} ({s.userName || '-'}): {s.oldPoints} → {s.newPoints} ({s.delta > 0 ? '+' : ''}{s.delta})
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                    {batchResult.failed.length > 0 && (
                      <div className="bg-red-50 px-3 py-2">
                        <p className="text-sm font-medium text-red-800">
                          ✗ 失败 {batchResult.failedCount} 个
                        </p>
                        <div className="mt-1 space-y-0.5 max-h-32 overflow-y-auto">
                          {batchResult.failed.map((f, i) => (
                            <p key={i} className="text-xs text-red-700">
                              {f.email}: {f.reason}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
            <>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-1">用户 ID（输入 email / 姓名 / cuid 实时搜索）</label>
              <input
                type="text"
                value={adjustUserId}
                onChange={e => { setAdjustUserId(e.target.value); setShowUserDropdown(true); setSelectedUser(null); }}
                onFocus={() => { if (userMatches.length > 0) setShowUserDropdown(true); }}
                onBlur={() => setTimeout(() => setShowUserDropdown(false), 150)}
                placeholder="例如：admin@example.com"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                autoComplete="off"
              />
              {showUserDropdown && (adjustUserId.trim().length > 0) && (
                <div className={`absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto ${adminSurfaceClasses.panelStrong} rounded-brand shadow-[var(--shadow-panel)]`}>
                  {userSearching && (
                    <div className="px-3 py-2 text-sm text-gray-500 flex items-center gap-2">
                      <div className="animate-spin w-3.5 h-3.5 border-2 border-brand-500 border-t-transparent rounded-full" />
                      搜索中...
                    </div>
                  )}
                  {!userSearching && userMatches.length === 0 && (
                    <div className="px-3 py-3 text-sm text-gray-500 text-center">
                      未找到匹配用户
                    </div>
                  )}
                  {!userSearching && userMatches.map(u => (
                    <button
                      key={u.id}
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => {
                        setAdjustUserId(u.id);
                        setSelectedUser(u);
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-brand-50 border-b border-gray-100 last:border-0 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-gray-800 truncate">{u.name || u.email}</p>
                          <p className="text-xs text-gray-500 truncate">{u.email}</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-sm font-semibold text-brand-600">{u.points.toLocaleString('zh-CN')}</p>
                          <p className="text-xs text-gray-400">{u.tier || 'standard'}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected user info card */}
            {selectedUser && (
              <div className="bg-brand-50 border border-brand-200 rounded-lg p-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-full bg-brand-200 text-brand-700 flex items-center justify-center font-semibold text-sm flex-shrink-0">
                    {(selectedUser.name || selectedUser.email).slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-800 truncate">{selectedUser.name || selectedUser.email}</p>
                    <p className="text-xs text-gray-500 truncate">{selectedUser.email}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-500">当前积分</p>
                  <p className="text-lg font-bold text-brand-600">{selectedUser.points.toLocaleString('zh-CN')}</p>
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedUser(null); setAdjustUserId(''); }}
                  className="text-xs text-gray-400 hover:text-red-500 flex-shrink-0"
                  title="清除选择"
                >
                  ✕
                </button>
              </div>
            )}
            </>
            )}
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: 'add' as const, label: '增加', icon: Plus, color: 'green' },
                { value: 'subtract' as const, label: '扣除', icon: Minus, color: 'red' },
                { value: 'set' as const, label: '设置', icon: Equal, color: 'blue' },
              ].map(mode => {
                const Icon = mode.icon;
                return (
                  <button
                    key={mode.value}
                    onClick={() => setAdjustMode(mode.value)}
                    className={`py-2 rounded-lg text-sm font-medium border-2 transition-colors flex items-center justify-center gap-1.5 ${
                      adjustMode === mode.value
                        ? mode.color === 'green' ? 'bg-green-50 border-green-500 text-green-700'
                          : mode.color === 'red' ? 'bg-red-50 border-red-500 text-red-700'
                          : 'bg-blue-50 border-blue-500 text-blue-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" /> {mode.label}
                  </button>
                );
              })}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {adjustMode === 'set' ? '目标积分' : '积分数量'}
              </label>
              <input
                type="number"
                min={adjustMode === 'set' ? 0 : 1}
                value={adjustAmount}
                onChange={e => setAdjustAmount(e.target.value)}
                placeholder="请输入正整数"
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                原因 {adjustMode !== 'add' && <span className="text-red-500">*</span>}
              </label>
              <input
                type="text"
                value={adjustReason}
                onChange={e => setAdjustReason(e.target.value)}
                placeholder="例如：补录、补偿、订单调整..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <button
              onClick={handleAdjust}
              disabled={loading}
              className="px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? '处理中...' : '确认调整'}
            </button>
            {adjustMessage && (
              <div className={`p-3 rounded-lg text-sm ${
                adjustMessage.type === 'success'
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {adjustMessage.text}
              </div>
            )}
          </div>
        </div>
      )}

      {/* User Filter Modal (for batch mode) */}
      {showUserFilterModal && (
        <UserFilterModal
          form={filterForm}
          setForm={setFilterForm}
          results={filterResults}
          setResults={setFilterResults}
          loading={filterLoading}
          setLoading={setFilterLoading}
          selectedIds={filterSelectedIds}
          setSelectedIds={setFilterSelectedIds}
          offset={filterOffset}
          setOffset={setFilterOffset}
          limit={filterLimit}
          onClose={() => setShowUserFilterModal(false)}
          onAddToBatch={(emails) => {
            setBatchEmails(prev => {
              const set = new Set(prev.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean));
              emails.forEach(e => set.add(e));
              return Array.from(set).join('\n');
            });
            setShowUserFilterModal(false);
            setAdjustMessage({ type: 'success', text: `已添加 ${emails.length} 位用户到批量列表` });
          }}
        />
      )}

      {/* Logs Tab */}
      {tab === 'logs' && (
        <div className={`${adminSurfaceClasses.panel} overflow-hidden`}>
          <div className="grid grid-cols-1 gap-3 p-4 border-b border-gray-200 sm:flex sm:items-center">
            <h3 className="min-w-0 font-semibold text-gray-800 flex items-center gap-2">
              <FileText className="w-4 h-4 text-brand-600" /> 积分日志（{logs.length}）
            </h3>
            <div className="relative min-w-0 sm:ml-auto sm:w-64 sm:flex-none">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={logsFilter}
                onChange={e => setLogsFilter(e.target.value)}
                placeholder="按用户 ID 过滤"
                className="w-full pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <button
              onClick={fetchLogs}
              className="justify-self-start px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 sm:justify-self-auto"
            >
              刷新
            </button>
          </div>
          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">时间</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">用户</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">类型</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-700">变动</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">原因</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">操作人</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-700 w-16">操作</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无日志</td></tr>
                ) : logs.map(log => (
                  <tr key={log.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-600 text-xs whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-2">
                      <div className="text-gray-900 text-xs font-medium">{log.userName || '(已删除)'}</div>
                      <div className="text-gray-500 text-xs">{log.userEmail}</div>
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${POINTS_LOG_TYPE_COLORS[log.type as PointsLogType] || 'bg-gray-100 text-gray-700'}`}>
                        {POINTS_LOG_TYPE_LABELS[log.type as PointsLogType] || log.type}
                      </span>
                    </td>
                    <td className={`px-4 py-2 text-right font-mono font-semibold ${log.delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {log.delta > 0 ? '+' : ''}{log.delta}
                    </td>
                    <td className="px-4 py-2 text-gray-600 text-xs">{log.reason || '-'}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs">{log.adminEmail || '-'}</td>
                    <td className="px-4 py-2 text-right">
                      {log.type === 'admin_adjust' && (log.isUndone ? (
                        <span className="text-xs text-gray-400">已撤销</span>
                      ) : (
                        <button
                          onClick={() => handleUndo(log.id)}
                          disabled={loading}
                          className="text-xs text-rose-600 hover:text-rose-700 hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                          title="创建一条方向相反的记录撤销此调整"
                        >
                          <Undo2 className="w-3 h-3" /> 撤销
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Redemptions Tab */}
      {tab === 'redemptions' && (
        <div className={`${adminSurfaceClasses.panel} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4">
            <h3 className="min-w-0 flex-1 font-semibold text-gray-800 flex items-center gap-2">
              <Package className="w-4 h-4 text-brand-600" /> 兑换订单（{redemptions.length}）
            </h3>
            <button
              onClick={fetchRedemptions}
              className="shrink-0 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            >
              刷新
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">时间</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">用户</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">礼遇</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-700">积分</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">状态</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">物流</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-700">操作</th>
                </tr>
              </thead>
              <tbody>
                {redemptions.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">暂无兑换记录</td></tr>
                ) : redemptions.map(r => {
                  const statusInfo = REDEMPTION_STATUSES.find(s => s.value === r.status) || REDEMPTION_STATUSES[0];
                  const shipping = r.shippingInfo ? JSON.parse(r.shippingInfo) : null;
                  return (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-600 text-xs whitespace-nowrap">
                        {new Date(r.createdAt).toLocaleString('zh-CN')}
                      </td>
                      <td className="px-4 py-2">
                        <div className="text-gray-900 text-xs font-medium">{r.userName || '(已删除)'}</div>
                        <div className="text-gray-500 text-xs">{r.userEmail}</div>
                      </td>
                      <td className="px-4 py-2 text-gray-800">{r.productName}</td>
                      <td className="px-4 py-2 text-right text-purple-600 font-semibold">-{r.pointsCost}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusInfo.color}`}>
                          {statusInfo.label}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {shipping ? (
                          <div>
                            <div>{shipping.name} · {shipping.phone}</div>
                            <div className="text-gray-500">{r.trackingNumber || '(待发货)'}</div>
                          </div>
                        ) : r.trackingNumber ? (
                          <span className="text-gray-700">{r.trackingNumber}</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => setEditingRedemption(r)}
                          className="text-xs text-blue-600 hover:text-blue-700"
                        >
                          处理
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Products Tab */}
      {tab === 'products' && (
        <div className={`${adminSurfaceClasses.panel} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 p-4">
            <h3 className="min-w-0 flex-1 font-semibold text-gray-800 flex items-center gap-2">
              <Package className="w-4 h-4 text-brand-600" /> 礼遇管理（{products.length}）
            </h3>
            <button
              onClick={() => { setEditingProduct(null); setShowProductForm(true); }}
              className="shrink-0 px-3 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" /> 新增礼遇
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">名称</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">分类</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-700">积分</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-700">库存</th>
                  <th className="text-left px-4 py-2 font-semibold text-gray-700">状态</th>
                  <th className="text-right px-4 py-2 font-semibold text-gray-700">操作</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">暂无礼遇</td></tr>
                ) : products.map(p => (
                  <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-800 font-medium">{p.name}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRODUCT_CATEGORY_COLORS[p.category as ProductCategory] || 'bg-gray-100 text-gray-700'}`}>
                        {PRODUCT_CATEGORY_LABELS[p.category as ProductCategory] || p.category}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right text-purple-600 font-semibold">{p.pointsCost}</td>
                    <td className="px-4 py-2 text-right text-gray-700">{p.stock === -1 ? '∞' : p.stock}</td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${p.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {p.isActive ? '上架' : '下架'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => { setEditingProduct(p); setShowProductForm(true); }}
                        className="text-xs text-blue-600 hover:text-blue-700 mr-2"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => toggleProductActive(p)}
                        className="text-xs text-amber-600 hover:text-amber-700 mr-2"
                      >
                        {p.isActive ? '下架' : '上架'}
                      </button>
                      <button
                        onClick={() => deleteProduct(p)}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Edit Redemption Modal */}
      {editingRedemption && (
        <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/40 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]">
          <div className={`w-full max-w-md ${adminSurfaceClasses.modal} p-6`}>
            <h3 className="font-bold text-gray-800 mb-4">处理兑换订单</h3>
            <RedemptionEditForm
              redemption={editingRedemption}
              onSave={(status, trackingNumber) => updateRedemptionStatus(editingRedemption.id, status, trackingNumber)}
              onCancel={() => setEditingRedemption(null)}
              loading={loading}
            />
          </div>
        </div>
      )}

      {/* Product Form Modal */}
      {showProductForm && (
        <ProductFormModal
          product={editingProduct}
          onSave={async (data) => {
            setLoading(true);
            try {
              const url = editingProduct
                ? `/api/admin/points/products/${editingProduct.id}`
                : '/api/admin/points/products';
              const method = editingProduct ? 'PATCH' : 'POST';
              const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data),
              });
              if (res.ok) {
                await fetchProducts();
                setShowProductForm(false);
                setEditingProduct(null);
              } else {
                const d = await res.json();
                alert(d.error || '保存失败');
              }
            } finally {
              setLoading(false);
            }
          }}
          onCancel={() => { setShowProductForm(false); setEditingProduct(null); }}
        />
      )}

      {mfaDialog}
    </div>
  );
}

function RedemptionEditForm({ redemption, onSave, onCancel, loading }: {
  redemption: Redemption;
  onSave: (status: string, trackingNumber?: string) => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const [status, setStatus] = useState(redemption.status);
  const [trackingNumber, setTrackingNumber] = useState(redemption.trackingNumber || '');
  const [note, setNote] = useState(redemption.adminNote || '');
  const shipping = redemption.shippingInfo ? JSON.parse(redemption.shippingInfo) : null;

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="text-gray-500 mb-1">礼遇</div>
        <div className="font-medium">
          {redemption.productName}
          {redemption.variantName && <span className="ml-1.5 text-xs font-normal text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">{redemption.variantName}</span>}
          （-{redemption.pointsCost} 积分）
        </div>
      </div>
      <div>
        <div className="text-gray-500 mb-1">用户</div>
        <div className="font-medium">{redemption.userName} · {redemption.userEmail}</div>
      </div>
      {shipping && (
        <div>
          <div className="text-gray-500 mb-1">收货信息</div>
          <div className="bg-gray-50 p-2 rounded text-xs">
            <div>{shipping.name} · {shipping.phone}</div>
            <div className="text-gray-600">{shipping.address}</div>
          </div>
        </div>
      )}
      <div>
        <label className="block text-gray-700 mb-1 font-medium">状态</label>
        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-800"
        >
          {REDEMPTION_STATUSES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-gray-700 mb-1 font-medium">物流单号（实物必填）</label>
        <input
          type="text"
          value={trackingNumber}
          onChange={e => setTrackingNumber(e.target.value)}
          placeholder="顺丰/中通/..."
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-800"
        />
      </div>
      <div>
        <label className="block text-gray-700 mb-1 font-medium">管理员备注</label>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-800"
        />
      </div>
      <div className="flex gap-2 pt-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50"
        >
          取消
        </button>
        <button
          onClick={() => onSave(status, trackingNumber || undefined)}
          disabled={loading}
          className="flex-1 py-2 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white rounded-lg font-medium"
        >
          {loading ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  );
}

function ProductFormModal({ product, onSave, onCancel }: {
  product: PointsProduct | null;
  onSave: (data: Partial<PointsProduct>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [category, setCategory] = useState(product?.category || 'tool');
  const [pointsCost, setPointsCost] = useState(product?.pointsCost?.toString() || '');
  const [stock, setStock] = useState(product?.stock?.toString() ?? '-1');
  const [imageUrl, setImageUrl] = useState(product?.imageUrl || '');

  // 解析已有 variants（从 metadata JSON 字符串）
  const parseVariants = (): { name: string; cost: string }[] => {
    if (!product?.metadata) return [{ name: '', cost: '' }, { name: '', cost: '' }, { name: '', cost: '' }];
    try {
      const meta = JSON.parse(product.metadata);
      const vs = Array.isArray(meta.variants) ? meta.variants : [];
      const padded = [...vs, { name: '', cost: '' }, { name: '', cost: '' }, { name: '', cost: '' }];
      return padded.slice(0, 3).map((v) => ({ name: v?.name ?? '', cost: v?.cost != null ? String(v.cost) : '' }));
    } catch {
      return [{ name: '', cost: '' }, { name: '', cost: '' }, { name: '', cost: '' }];
    }
  };
  const [variants, setVariants] = useState<{ name: string; cost: string }[]>(parseVariants);

  function updateVariant(i: number, field: 'name' | 'cost', val: string) {
    setVariants(prev => prev.map((v, idx) => idx === i ? { ...v, [field]: val } : v));
  }

  function buildMetadata(): string | null {
    const filled = variants.filter(v => v.name.trim() !== '' && v.cost.trim() !== '' && !isNaN(parseInt(v.cost)));
    if (filled.length === 0) return null;
    return JSON.stringify({ variants: filled.map(v => ({ name: v.name.trim(), cost: parseInt(v.cost) })) });
  }

  return (
    <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/40 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]">
      <div className={`max-h-[90vh] w-full max-w-md overflow-y-auto ${adminSurfaceClasses.modal} p-6`}>
        <h3 className="font-bold text-gray-800 mb-4">{product ? '编辑礼遇' : '新增礼遇'}</h3>
        <div className="space-y-3 text-sm">
          <div>
            <label className="block text-gray-700 mb-1 font-medium">名称 *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-800" />
          </div>
          <div>
            <label className="block text-gray-700 mb-1 font-medium">描述</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-800" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-gray-700 mb-1 font-medium">分类 *</label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-800">
                <option value="tool">实用工具</option>
                <option value="digital">数字礼遇</option>
                <option value="physical">实物礼遇</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-700 mb-1 font-medium">积分价格 *</label>
              <input type="number" min="1" value={pointsCost} onChange={e => setPointsCost(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-800" />
            </div>
          </div>
          <div>
            <label className="block text-gray-700 mb-1 font-medium">库存（-1 表示无限）</label>
            <input type="number" min="-1" value={stock} onChange={e => setStock(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-800" />
          </div>
          <div>
            <label className="block text-gray-700 mb-1 font-medium">图片 URL（可选）</label>
            <input type="text" value={imageUrl} onChange={e => setImageUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-gray-800" />
          </div>

          {/* Variants */}
          <div className="pt-2 border-t border-gray-100">
            <div className="flex items-baseline justify-between mb-2">
              <label className="block text-gray-700 font-medium">规格选项</label>
              <span className="text-xs text-gray-400">最多 3 个，留空即不启用</span>
            </div>
            <div className="space-y-2">
              {variants.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-4">{i + 1}.</span>
                  <input
                    type="text"
                    value={v.name}
                    onChange={e => updateVariant(i, 'name', e.target.value)}
                    placeholder="规格名（如 64GB/标准版）"
                    className="flex-1 min-w-0 px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-800 text-sm"
                  />
                  <input
                    type="number"
                    min="1"
                    value={v.cost}
                    onChange={e => updateVariant(i, 'cost', e.target.value)}
                    placeholder="积分"
                    className="w-20 px-2.5 py-1.5 border border-gray-200 rounded-lg text-gray-800 text-sm"
                  />
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              启用后用户兑换时必须选一个规格，扣分用规格积分（而非上面&quot;积分价格&quot;）。
            </p>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel}
            className="flex-1 py-2 border border-gray-200 rounded-lg text-gray-700 hover:bg-gray-50">
            取消
          </button>
          <button onClick={() => onSave({
            name, description: description || null, category,
            pointsCost: parseInt(pointsCost), stock: parseInt(stock), imageUrl: imageUrl || null,
            metadata: buildMetadata(),
          })}
            className="flex-1 py-2 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-medium">
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// 用户筛选模态（用于批量模式从用户列表多选）
function UserFilterModal({
  form, setForm, results, setResults, loading, setLoading,
  selectedIds, setSelectedIds, offset, setOffset, limit,
  onClose, onAddToBatch,
}: {
  form: { tiers: string[]; institution: string; department: string; pointsMin: string; pointsMax: string };
  setForm: React.Dispatch<React.SetStateAction<{ tiers: string[]; institution: string; department: string; pointsMin: string; pointsMax: string }>>;
  results: { total: number; users: { id: string; email: string; name: string | null; points: number; tier: string | null; institution?: string | null; department?: string | null; institutionName?: string | null; institutionUnit?: string | null; institutionFacility?: string | null; school?: string | null; college?: string | null; major?: string | null; building?: string | null; piLab?: string | null; affiliatedLab?: string | null; isNewUser?: boolean; createdAt: string }[]; facets: { institutions: string[]; departments: string[] } } | null;
  setResults: (r: { total: number; users: { id: string; email: string; name: string | null; points: number; tier: string | null; institution?: string | null; department?: string | null; institutionName?: string | null; institutionUnit?: string | null; institutionFacility?: string | null; school?: string | null; college?: string | null; major?: string | null; building?: string | null; piLab?: string | null; affiliatedLab?: string | null; isNewUser?: boolean; createdAt: string }[]; facets: { institutions: string[]; departments: string[] } } | null) => void;
  loading: boolean;
  setLoading: (b: boolean) => void;
  selectedIds: Set<string>;
  setSelectedIds: (s: Set<string>) => void;
  offset: number;
  setOffset: (n: number) => void;
  limit: number;
  onClose: () => void;
  onAddToBatch: (emails: string[]) => void;
}) {
  const TIERS = ['standard'];

  function buildQuery() {
    const sp = new URLSearchParams();
    if (form.tiers.length > 0) sp.set('tiers', form.tiers.join(','));
    if (form.institution) sp.set('institution', form.institution);
    if (form.department) sp.set('department', form.department);
    if (form.pointsMin) sp.set('pointsMin', form.pointsMin);
    if (form.pointsMax) sp.set('pointsMax', form.pointsMax);
    sp.set('limit', String(limit));
    sp.set('offset', String(offset));
    return sp.toString();
  }

  async function doSearch() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/filter?${buildQuery()}`);
      const data = await res.json();
      setResults(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function toggleTier(t: string) {
    setForm({
      ...form,
      tiers: form.tiers.includes(t) ? form.tiers.filter((x: string) => x !== t) : [...form.tiers, t],
    });
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function toggleSelectAll() {
    if (!results) return;
    const allSelected = results.users.every(u => selectedIds.has(u.id));
    if (allSelected) {
      const next = new Set(selectedIds);
      results.users.forEach(u => next.delete(u.id));
      setSelectedIds(next);
    } else {
      const next = new Set(selectedIds);
      results.users.forEach(u => next.add(u.id));
      setSelectedIds(next);
    }
  }

  function handleAddToBatch() {
    if (!results || selectedIds.size === 0) return;
    const emails = results.users.filter(u => selectedIds.has(u.id)).map(u => u.email);
    onAddToBatch(emails);
  }

  return (
    <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/40 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]">
      <div className={`flex max-h-[90vh] w-full max-w-5xl flex-col ${adminSurfaceClasses.modal}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Users className="w-4 h-4 text-brand-600" /> 从用户列表筛选
          </h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Filter Panel */}
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50/50">
          <div className="grid grid-cols-2 md:grid-cols-2 gap-3 text-sm">
            <div>
              <label className="block text-xs text-gray-500 mb-1">单位（模糊）</label>
              <input
                type="text"
                value={form.institution}
                onChange={e => setForm((form) => ({ ...form, institution: e.target.value }))}
                placeholder="如：清华、北大"
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
                list="filter-institutions"
              />
              {results?.facets.institutions && results.facets.institutions.length > 0 && (
                <datalist id="filter-institutions">
                  {results.facets.institutions.slice(0, 50).map((v: string) => <option key={v} value={v} />)}
                </datalist>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">部门/课题组（模糊）</label>
              <input
                type="text"
                value={form.department}
                onChange={e => setForm((form) => ({ ...form, department: e.target.value }))}
                placeholder="如：化学系、计算所"
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
                list="filter-departments"
              />
              {results?.facets.departments && results.facets.departments.length > 0 && (
                <datalist id="filter-departments">
                  {results.facets.departments.slice(0, 50).map((v: string) => <option key={v} value={v} />)}
                </datalist>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">积分下限</label>
              <input
                type="number"
                value={form.pointsMin}
                onChange={e => setForm((form) => ({ ...form, pointsMin: e.target.value }))}
                placeholder="0"
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">积分上限</label>
              <input
                type="number"
                value={form.pointsMax}
                onChange={e => setForm((form) => ({ ...form, pointsMax: e.target.value }))}
                placeholder="不限"
                className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="block text-xs text-gray-500 mb-1">等级（多选，留空 = 全部）</label>
            <div className="flex flex-wrap gap-1.5">
              {TIERS.map(t => {
                const active = form.tiers.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTier(t)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border ${
                      active
                        ? 'bg-brand-50 border-brand-300 text-brand-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => { setOffset(0); doSearch(); }}
              disabled={loading}
              className="px-3 py-1.5 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
            >
              <Search className="w-3.5 h-3.5" /> 搜索
            </button>
            <button
              onClick={() => {
                setForm({ tiers: [], institution: '', department: '', pointsMin: '', pointsMax: '' });
                setSelectedIds(new Set());
                setResults(null);
              }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            >
              清空筛选
            </button>
            {results && (
              <span className="ml-auto text-xs text-gray-500">
                共 {results.total} 位用户（当前页 {results.users.length}）
              </span>
            )}
          </div>
        </div>

        {/* User List */}
        <div className="flex-1 overflow-auto">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full" />
            </div>
          )}
          {!loading && !results && (
            <div className="text-center py-12 text-gray-400 text-sm">
              设置筛选条件后点击「搜索」
            </div>
          )}
          {!loading && results && results.users.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              没有匹配的用户
            </div>
          )}
          {!loading && results && results.users.length > 0 && (
            <table className="w-full min-w-[940px] text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="border-b border-gray-200">
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={results.users.length > 0 && results.users.every(u => selectedIds.has(u.id))}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">姓名</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">邮箱</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">单位</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">部门</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">等级</th>
                  <th className="text-right px-3 py-2 font-semibold text-gray-700">积分</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">注册</th>
                </tr>
              </thead>
              <tbody>
                {results.users.map(u => (
                  <tr key={u.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(u.id)}
                        onChange={() => toggleSelect(u.id)}
                      />
                    </td>
                    <td className="px-3 py-2 text-gray-800 text-xs">{u.name || '-'}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{u.email}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{u.institutionName || u.school || u.institution || '-'}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{[u.institutionUnit || u.college, u.department || u.major, u.institutionFacility || u.building, u.affiliatedLab || u.piLab].filter(Boolean).join(' · ') || '-'}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">
                      {u.tier} {u.isNewUser && <span className="ml-1 text-amber-600 text-[10px]">新</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-gray-800 text-xs font-mono">{u.points.toLocaleString('zh-CN')}</td>
                    <td className="px-3 py-2 text-gray-500 text-[11px]">{new Date(u.createdAt).toLocaleDateString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="grid grid-cols-1 gap-3 border-t border-gray-200 px-5 py-3 sm:flex sm:items-center">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0 || loading}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              ← 上一页
            </button>
            <span className="text-xs text-gray-500">
              第 {Math.floor(offset / limit) + 1} 页
            </span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={!results || offset + limit >= results.total || loading}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-50"
            >
              下一页 →
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
            <span className="text-sm text-gray-600">
              已选 <strong className="text-brand-600">{selectedIds.size}</strong> 位
            </span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
            >
              取消
            </button>
            <button
              onClick={handleAddToBatch}
              disabled={selectedIds.size === 0}
              className="px-4 py-1.5 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white rounded-lg text-sm font-medium"
            >
              添加到批量 ({selectedIds.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
