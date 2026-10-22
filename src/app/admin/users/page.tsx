'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { notFound } from 'next/navigation';
import { Search, Shield, Check, UserX, AlertTriangle, Plus, LockKeyhole } from 'lucide-react';
import UserRow, { userTableColumn } from '@/components/admin/UserRow';
import CreateUserModal from '@/components/admin/CreateUserModal';
import UserDiscountTemplateSection from '@/components/admin/UserDiscountTemplateSection';
import { parseAdminUsersResponse } from '@/data/admin-users-response';
import { filterAdminUsersBySearch, retainVisibleSelection, visibleSelectedUserIds } from '@/data/admin-user-list';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  institution?: string;
  department?: string;
  institutionType?: string;
  institutionName?: string;
  institutionUnit?: string;
  institutionFacility?: string;
  school?: string;
  college?: string;
  major?: string;
  building?: string;
  piLab?: string;
  affiliatedLab?: string;
  tier: string;
  createdAt: string;
  phone?: string;
  discountRate?: number | null;
  brandDiscounts?: string | null;
  sourceTemplateId?: string | null;
  isNewUser?: boolean;
  approvalStatus?: string;
  isBlacklisted?: boolean;
  isFrozen?: boolean;
  identity?: string;
  lastLoginAt?: string | null;
  creditAccount?: {
    baseLimit: number; overrideLimit?: number | null; temporaryLimit: number; temporaryUntil?: string | null;
    usedAmount: number; status: string; paymentTermDays: number;
  } | null;
}

export default function AdminUsersPage() {
  const { data: session, status } = useSession();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [missing, setMissing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [templates, setTemplates] = useState<{ id: string; name: string }[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [permissions, setPermissions] = useState<string[] | null>(null);
  const filteredUsers = filterAdminUsersBySearch(users, search);
  const visibleSelectedIds = visibleSelectedUserIds(filteredUsers, selectedUserIds);
  const visibleSelectedUsers = filteredUsers.filter((user) => selectedUserIds.has(user.id));
  const allVisibleSelected = filteredUsers.length > 0 && visibleSelectedIds.length === filteredUsers.length;
  const [useCompactList, setUseCompactList] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 767px)');
    const apply = () => setUseCompactList(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    if (status !== 'authenticated' || (session?.user as User)?.role !== 'admin') return;
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/access?view=current', { cache: 'no-store' })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { permissions?: unknown } | null) => {
        if (active) setPermissions(Array.isArray(data?.permissions) ? data.permissions.filter((item): item is string => typeof item === 'string') : []);
      })
      .catch(() => { if (active) setPermissions([]); });
    return () => { active = false; };
  }, []);

  async function fetchData() {
    setLoading(true);
    setLoadError('');
    try {
      const [usersRes, templatesRes] = await Promise.all([
        fetch('/api/users'),
        fetch('/api/admin/discount-templates'),
      ]);
      if (usersRes.status === 401 || usersRes.status === 403) {
        setMissing(true);
        return;
      }
      const usersData: unknown = await usersRes.json().catch(() => null);
      if (!usersRes.ok) {
        const message = usersData && typeof usersData === 'object' && typeof (usersData as { error?: unknown }).error === 'string'
          ? (usersData as { error: string }).error
          : '用户数据读取失败';
        throw new Error(message);
      }
      const parsedUsers = parseAdminUsersResponse<User>(usersData);
      if (!parsedUsers) throw new Error('用户数据格式异常');
      setUsers(parsedUsers);
      if (templatesRes.ok) {
        const tplData = await templatesRes.json();
        setTemplates(Array.isArray(tplData) ? tplData.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })) : []);
      }
    } catch (e) {
      console.error(e);
      setUsers([]);
      setSelectedUserIds(new Set());
      setLoadError(e instanceof Error ? e.message : '用户数据读取失败');
    } finally {
      setLoading(false);
    }
  }

  async function deleteUsers(userIds: string[]) {
    const ids = visibleSelectedUserIds(filterAdminUsersBySearch(users, search), new Set(userIds));
    if (ids.length === 0) return;
    if (!confirm(`停用选中的 ${ids.length} 个用户？账号会被冻结，仍可登录，但不能下单或询价。订单、积分和授信会保留，之后可以解冻。`)) return;
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: ids }),
      });
      if (res.ok) {
        setActionMessage({ type: 'success', text: `已停用 ${ids.length} 个用户，订单、积分和授信已保留` });
        fetchData();
        setSelectedUserIds(new Set());
      } else {
        const data = await res.json().catch(() => ({}));
        setActionMessage({ type: 'error', text: data.error || '停用失败' });
      }
    } catch (e) {
      console.error(e);
      setActionMessage({ type: 'error', text: '网络错误' });
    }
  }

  async function approveUsers(userIds: string[]) {
    if (!confirm(`确定要审核通过 ${userIds.length} 个用户吗？`)) return;
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds, action: 'approve' }),
      });
      if (res.ok) {
        setActionMessage({ type: 'success', text: `已审核通过 ${userIds.length} 个用户` });
        fetchData();
        setSelectedUserIds(new Set());
      } else {
        const data = await res.json().catch(() => ({}));
        setActionMessage({ type: 'error', text: data.error || '操作失败' });
      }
    } catch (e) {
      console.error(e);
      setActionMessage({ type: 'error', text: '网络错误' });
    }
  }

  async function setUserTier(userIds: string[], tier: string) {
    if (!confirm(`确定要将 ${userIds.length} 个用户设置为"${tier}"吗？`)) return;
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds, action: 'setTier', tier }),
      });
      if (res.ok) {
        setActionMessage({ type: 'success', text: `已更新等级为「${tier}」` });
        fetchData();
        setSelectedUserIds(new Set());
      } else {
        const data = await res.json().catch(() => ({}));
        setActionMessage({ type: 'error', text: data.requiredPermission === 'pricing.write' ? '修改客户等级需要价格权限。' : (data.error || '操作失败') });
      }
    } catch (e) {
      console.error(e);
      setActionMessage({ type: 'error', text: '网络错误' });
    }
  }

  async function freezeUsers(userIds: string[], freeze: boolean) {
    if (!confirm(freeze
      ? `冻结选中的 ${userIds.length} 个用户？冻结后仍可登录，但看不到折扣价，也无法下单或询价。`
      : `解冻选中的 ${userIds.length} 个用户？`)) return;
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds, action: freeze ? 'freeze' : 'unfreeze' }),
      });
      if (res.ok) {
        setActionMessage({ type: 'success', text: freeze ? '已冻结所选用户' : '已解冻所选用户' });
        fetchData();
        setSelectedUserIds(new Set());
      } else {
        const data = await res.json().catch(() => ({}));
        setActionMessage({ type: 'error', text: data.error || '操作失败' });
      }
    } catch (e) {
      console.error(e);
      setActionMessage({ type: 'error', text: '网络错误' });
    }
  }

  if (status === 'unauthenticated' || missing) notFound();
  if (status === 'authenticated' && (session?.user as User)?.role !== 'admin') notFound();

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <AlertTriangle className="mx-auto h-8 w-8 text-red-500" />
        <h2 className="mt-3 text-lg font-semibold text-gray-900">用户数据读取失败</h2>
        <p className="mt-2 text-sm text-red-700">{loadError}</p>
        <button type="button" onClick={() => void fetchData()} className="mt-5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">重新加载</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">用户管理</h1>
          <p className="text-sm text-gray-500 mt-1">创建、编辑、冻结账户；冻结后可登录，但无折扣价且不可下单询价</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Plus className="w-4 h-4" /> 创建用户
        </button>
      </div>

      {actionMessage && (
        <div className={`rounded-lg px-4 py-2 text-sm ${actionMessage.type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {actionMessage.text}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-100 rounded-full flex items-center justify-center">
            <Shield className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-amber-800">{users.filter(u => u.isNewUser).length}</p>
            <p className="text-xs text-amber-700">待审核用户</p>
          </div>
        </div>
        <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-100 rounded-full flex items-center justify-center text-brand-600 font-bold text-sm">
            {users.length}
          </div>
          <div>
            <p className="text-xl font-bold text-brand-800">{users.length}</p>
            <p className="text-xs text-brand-700">总用户数</p>
          </div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 bg-slate-200 rounded-full flex items-center justify-center">
            <LockKeyhole className="w-4 h-4 text-slate-600" />
          </div>
          <div>
            <p className="text-xl font-bold text-slate-800">{users.filter(u => u.isFrozen).length}</p>
            <p className="text-xs text-slate-600">已冻结</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索用户名称、邮箱或机构..."
            value={search}
            onChange={e => {
              const nextSearch = e.target.value;
              setSearch(nextSearch);
              const visible = filterAdminUsersBySearch(users, nextSearch);
              setSelectedUserIds((current) => {
                const retained = retainVisibleSelection(current, visible);
                return retained.length === current.size ? current : new Set(retained);
              });
            }}
            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-full text-gray-900 bg-white/70"
          />
        </div>
      </div>

      {useCompactList ? (
      <div className="min-w-0 space-y-3 rounded-xl border border-white/70 bg-white/70 p-3 shadow-sm backdrop-blur-md sm:p-4">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            checked={allVisibleSelected}
            onChange={e => setSelectedUserIds(e.target.checked ? new Set(filteredUsers.map(user => user.id)) : new Set())}
          />
          全选当前结果
        </label>
        {filteredUsers.map(user => (
          <UserRow
            key={user.id}
            layout="compact"
            user={user}
            onUpdate={fetchData}
            selected={selectedUserIds.has(user.id)}
            onSelectChange={selected => {
              const next = new Set(selectedUserIds);
              if (selected) next.add(user.id);
              else next.delete(user.id);
              setSelectedUserIds(next);
            }}
            showEditButton={user.role !== 'admin'}
            templates={templates}
            canWriteCustomers={Boolean(permissions?.includes('customers.write'))}
            canWriteTier={Boolean(permissions?.includes('pricing.write'))}
            canWriteCredit={Boolean(permissions?.includes('finance.write'))}
          />
        ))}
        {filteredUsers.length === 0 && (
          <div className="rounded-xl border border-white/80 bg-white/80 px-4 py-12 text-center text-sm text-gray-600">
            {users.length === 0 ? '暂无用户' : '没有匹配的用户'}
          </div>
        )}
      </div>

      ) : (
      <div className="min-w-0 overflow-hidden rounded-2xl border border-white/70 bg-white">
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full table-fixed border-separate border-spacing-0 text-sm xl:min-w-[1240px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-20 w-10 border-b border-gray-200 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-700">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={e => setSelectedUserIds(e.target.checked ? new Set(filteredUsers.map(user => user.id)) : new Set())}
                    className="h-4 w-4 rounded border-gray-300 text-brand-600"
                    aria-label="全选当前结果"
                  />
                </th>
                <th className="sticky left-10 z-20 w-36 border-b border-gray-200 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-700 shadow-[4px_0_6px_-4px_rgba(15,23,42,0.25)]">姓名</th>
                <th className="border-b border-gray-200 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-700 xl:w-64">邮箱</th>
                <th className={`border-b border-gray-200 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-700 xl:w-36 ${userTableColumn.phone}`}>电话</th>
                <th className="border-b border-gray-200 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-700 xl:w-52">机构</th>
                <th className={`border-b border-gray-200 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-700 xl:w-28 ${userTableColumn.role}`}>角色</th>
                <th className="w-24 border-b border-gray-200 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-700">状态</th>
                <th className={`border-b border-gray-200 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-700 xl:w-40 ${userTableColumn.dates}`}>注册 / 最近登录</th>
                <th className="w-16 border-b border-gray-200 bg-gray-50 px-3 py-3 text-left font-semibold text-gray-700">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map(user => (
                <UserRow
                  key={user.id}
                  layout="table"
                  user={user}
                  onUpdate={fetchData}
                  selected={selectedUserIds.has(user.id)}
                  onSelectChange={selected => {
                    const next = new Set(selectedUserIds);
                    if (selected) next.add(user.id);
                    else next.delete(user.id);
                    setSelectedUserIds(next);
                  }}
                  showEditButton={user.role !== 'admin'}
                  templates={templates}
                  canWriteCustomers={Boolean(permissions?.includes('customers.write'))}
                  canWriteTier={Boolean(permissions?.includes('pricing.write'))}
                  canWriteCredit={Boolean(permissions?.includes('finance.write'))}
                />
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-12 text-center text-gray-600">
                    {users.length === 0 ? '暂无用户' : '没有匹配的用户'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {visibleSelectedIds.length > 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-brand-700 font-medium">
            已选择 {visibleSelectedIds.length} 个用户
          </span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <button
              onClick={() => setSelectedUserIds(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              取消选择
            </button>
            {visibleSelectedUsers.filter(u => u.isNewUser).length > 0 && (
              <button
                onClick={() => approveUsers(visibleSelectedIds)}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" /> 审核通过 ({visibleSelectedUsers.filter(u => u.isNewUser).length})
              </button>
            )}
            {permissions?.includes('pricing.write') && (
            <select
              onChange={(e) => {
                if (e.target.value) setUserTier(visibleSelectedIds, e.target.value);
              }}
              defaultValue=""
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium border-0 cursor-pointer"
            >
              <option value="" disabled>设置等级</option>
              <option value="standard">standard</option>
            </select>
            )}
            <button
              onClick={() => freezeUsers(visibleSelectedIds, true)}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              <LockKeyhole className="w-4 h-4" /> 批量冻结
            </button>
            <button
              onClick={() => freezeUsers(visibleSelectedIds, false)}
              className="px-3 py-1.5 bg-slate-500 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              批量解冻
            </button>
            <button
              onClick={() => deleteUsers(visibleSelectedIds)}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              <UserX className="w-4 h-4" /> 停用账号 ({visibleSelectedIds.length})
            </button>
          </div>
        </div>
      )}

      <UserDiscountTemplateSection
        selectedUsers={visibleSelectedUsers}
        onApplied={() => {
          setSelectedUserIds(new Set());
          setActionMessage({ type: 'success', text: '折扣模板已应用' });
          void fetchData();
        }}
      />

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setActionMessage({ type: 'success', text: '用户已创建' });
          void fetchData();
        }}
      />
    </div>
  );
}
