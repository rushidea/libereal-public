'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Search, Shield, Check, Trash2, AlertTriangle, Plus, LockKeyhole } from 'lucide-react';
import UserRow from '@/components/admin/UserRow';
import CreateUserModal from '@/components/admin/CreateUserModal';
import UserDiscountTemplateSection from '@/components/admin/UserDiscountTemplateSection';
import { parseAdminUsersResponse } from '@/data/admin-users-response';

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

  useEffect(() => {
    if (status !== 'authenticated' || (session?.user as User)?.role !== 'admin') return;
    fetchData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, session]);

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
    if (!confirm(`确定要删除 ${userIds.length} 个用户吗？此操作不可恢复！`)) return;
    try {
      const res = await fetch('/api/admin/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds }),
      });
      if (res.ok) {
        setActionMessage({ type: 'success', text: `已删除 ${userIds.length} 个用户` });
        fetchData();
        setSelectedUserIds(new Set());
      } else {
        const data = await res.json().catch(() => ({}));
        setActionMessage({ type: 'error', text: data.error || '删除失败' });
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
        setActionMessage({ type: 'error', text: data.error || '操作失败' });
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

  const selectedUsers = users.filter(u => selectedUserIds.has(u.id));

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

      {/* Stats Overview */}
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

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-600 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="搜索用户名称、邮箱或机构..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-full text-gray-900 bg-white/70"
          />
        </div>
      </div>

      {/* User cards */}
      <div className="min-w-0 space-y-3 rounded-xl border border-white/70 bg-white/70 p-3 shadow-sm backdrop-blur-md sm:p-4">
        <label className="flex items-center gap-2 text-xs text-gray-600">
          <input
            type="checkbox"
            className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            checked={selectedUserIds.size === users.length && users.length > 0}
            onChange={e => {
              if (e.target.checked) {
                setSelectedUserIds(new Set(users.map(u => u.id)));
              } else {
                setSelectedUserIds(new Set());
              }
            }}
          />
          全选用户
        </label>
        <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {users.filter(u =>
            (!search ||
              u.name?.includes(search) ||
              u.email.includes(search) ||
              u.institution?.includes(search) ||
              u.department?.includes(search) ||
              u.institutionType?.includes(search) ||
              u.institutionName?.includes(search) ||
              u.institutionUnit?.includes(search) ||
              u.institutionFacility?.includes(search) ||
              u.school?.includes(search) ||
              u.college?.includes(search) ||
              u.major?.includes(search) ||
              u.piLab?.includes(search) ||
              u.affiliatedLab?.includes(search))
          ).map(user => (
            <UserRow
              key={user.id}
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
            />
          ))}
        </div>
        {users.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-gray-600">暂无用户</div>
        )}
      </div>

      {/* Selected users actions */}
      {selectedUserIds.size > 0 && (
        <div className="bg-brand-50 border border-brand-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
          <span className="text-sm text-brand-700 font-medium">
            已选择 {selectedUserIds.size} 个用户
          </span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <button
              onClick={() => setSelectedUserIds(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              取消选择
            </button>
            {users.filter(u => u.isNewUser && selectedUserIds.has(u.id)).length > 0 && (
              <button
                onClick={() => approveUsers(Array.from(selectedUserIds))}
                className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
              >
                <Check className="w-4 h-4" /> 审核通过 ({users.filter(u => u.isNewUser && selectedUserIds.has(u.id)).length})
              </button>
            )}
            <select
              onChange={(e) => {
                if (e.target.value) setUserTier(Array.from(selectedUserIds), e.target.value);
              }}
              defaultValue=""
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium border-0 cursor-pointer"
            >
              <option value="" disabled>设置等级</option>
              <option value="standard">standard</option>
            </select>
            <button
              onClick={() => freezeUsers(Array.from(selectedUserIds), true)}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              <LockKeyhole className="w-4 h-4" /> 批量冻结
            </button>
            <button
              onClick={() => freezeUsers(Array.from(selectedUserIds), false)}
              className="px-3 py-1.5 bg-slate-500 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              批量解冻
            </button>
            <button
              onClick={() => deleteUsers(Array.from(selectedUserIds))}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
            >
              <Trash2 className="w-4 h-4" /> 批量删除 ({selectedUserIds.size})
            </button>
          </div>
        </div>
      )}

      <UserDiscountTemplateSection
        selectedUsers={selectedUsers}
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
