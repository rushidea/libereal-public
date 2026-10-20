'use client';

import React, { useState } from 'react';
import { Check, X, Edit2, Save, Shield, LockKeyhole } from 'lucide-react';
import { adminPermissionErrorMessage } from '@/data/admin-permission-message';
import { saveUserProfileThenCredit } from '@/lib/admin-user-row-save';
import { getInstitutionLabels } from '@/data/institution-profile';
import { PASSWORD_MIN_LENGTH, validateNewPasswordLength } from '@/lib/password-policy';
import {
  CUSTOMER_IDENTITY_OPTIONS,
  INTERNAL_IDENTITY_OPTIONS,
  isAssignableIdentity,
} from '@/lib/identity-options';

interface UserType {
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
  isNewUser?: boolean;
  approvalStatus?: string;
  isBlacklisted?: boolean;
  isFrozen?: boolean;
  identity?: string;
  creditAccount?: {
    baseLimit: number;
    overrideLimit?: number | null;
    temporaryLimit: number;
    temporaryUntil?: string | null;
    usedAmount: number;
    status: string;
    paymentTermDays: number;
  } | null;
  lastLoginAt?: string | null;
}

interface DiscountTemplateLite {
  id: string;
  name: string;
}

function displayValue(value: string | null | undefined): string {
  return value?.trim() || '';
}

function getInstitution(user: UserType): string {
  return displayValue(user.institutionName) || displayValue(user.school) || displayValue(user.institution) || '-';
}

function getInstitutionUnit(user: UserType): string {
  return displayValue(user.institutionUnit) || displayValue(user.college) || '-';
}

function getDepartment(user: UserType): string {
  const department = displayValue(user.department);
  if (department) return department;
  return displayValue(user.major) || '-';
}

function getInstitutionFacility(user: UserType): string {
  return displayValue(user.institutionFacility) || displayValue(user.building) || '-';
}

function getLaboratory(user: UserType): string {
  const labs = [
    displayValue(user.affiliatedLab) ? `依托：${displayValue(user.affiliatedLab)}` : '',
    displayValue(user.piLab) ? `PI：${displayValue(user.piLab)}` : '',
  ].filter(Boolean);
  return labs.join(' / ') || '-';
}

function TruncatedText({ text, title, className = '' }: { text: string; title?: string; className?: string }) {
  const value = text.trim() || '—';
  return <div className={`max-w-full truncate ${className}`} title={title || value}>{value}</div>;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('zh-CN');
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function organizationSummary(user: UserType): string {
  const parts = [
    getInstitution(user),
    getInstitutionUnit(user),
    getDepartment(user),
    getInstitutionFacility(user),
    getLaboratory(user),
  ].filter(part => part && part !== '-');
  return parts.join(' / ') || '—';
}

export const userTableColumn = {
  phone: 'hidden xl:table-cell',
  role: 'hidden xl:table-cell',
  dates: 'hidden xl:table-cell',
} as const;

function StatusBadges({ user }: { user: UserType }) {
  const quiet = !user.isNewUser && user.approvalStatus !== 'rejected' && !user.isBlacklisted && !user.isFrozen;
  return (
    <div className="flex min-w-0 flex-wrap gap-1">
      {Boolean(user.isNewUser) && (
        <span className="inline-flex items-center gap-1 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">
          <Shield className="h-3 w-3" /> 待审核
        </span>
      )}
      {user.approvalStatus === 'rejected' && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">审核未通过</span>}
      {user.isBlacklisted && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">账户限制</span>}
      {user.isFrozen && (
        <span className="inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700" title="可登录，无折扣价，不可下单询价">
          <LockKeyhole className="h-3 w-3" /> 已冻结
        </span>
      )}
      {quiet && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">正常</span>}
    </div>
  );
}

interface UserRowProps {
  user: UserType & { discountRate?: number | null; brandDiscounts?: string | null; department?: string; identity?: string; sourceTemplateId?: string | null };
  onUpdate: () => void;
  selected?: boolean;
  onSelectChange?: (selected: boolean) => void;
  showEditButton?: boolean;
  templates?: DiscountTemplateLite[];
  layout?: 'table' | 'compact';
  canWriteCustomers?: boolean;
  canWriteTier?: boolean;
  canWriteCredit?: boolean;
}

const CUSTOMER_TIERS = [{ value: 'standard', label: 'standard' }];

export default function UserRow({ user, onUpdate, selected, onSelectChange, showEditButton, templates = [], layout = 'table', canWriteCustomers = false, canWriteTier = false, canWriteCredit = false }: UserRowProps) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name ?? '');
  const [email, setEmail] = useState(user.email ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(user.role ?? 'customer');
  const [institutionType, setInstitutionType] = useState(user.institutionType ?? (user.school ? '高校' : '待补充'));
  const [institutionName, setInstitutionName] = useState(user.institutionName ?? user.school ?? user.institution ?? '');
  const [institutionUnit, setInstitutionUnit] = useState(user.institutionUnit ?? user.college ?? '');
  const [department, setDepartment] = useState(user.department ?? user.major ?? '');
  const [institutionFacility, setInstitutionFacility] = useState(user.institutionFacility ?? user.building ?? '');
  const [piLab, setPiLab] = useState(user.piLab ?? '');
  const [affiliatedLab, setAffiliatedLab] = useState(user.affiliatedLab ?? '');
  const [tier, setTier] = useState(user.tier ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');
  const [identity, setIdentity] = useState(user.identity ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [approvalStatus, setApprovalStatus] = useState(user.approvalStatus ?? (user.isNewUser ? 'pending' : 'approved'));
  const [isBlacklisted, setIsBlacklisted] = useState(Boolean(user.isBlacklisted));
  const [isFrozen, setIsFrozen] = useState(Boolean(user.isFrozen));
  const [creditOverride, setCreditOverride] = useState(user.creditAccount?.overrideLimit?.toString() ?? '');
  const [temporaryLimit, setTemporaryLimit] = useState(user.creditAccount?.temporaryLimit?.toString() ?? '0');
  const [temporaryUntil, setTemporaryUntil] = useState(user.creditAccount?.temporaryUntil?.slice(0, 10) ?? '');
  const [creditStatus, setCreditStatus] = useState(user.creditAccount?.status ?? 'active');
  const [paymentTermDays, setPaymentTermDays] = useState(user.creditAccount?.paymentTermDays?.toString() ?? '30');
  const institutionLabels = getInstitutionLabels(institutionType);

  const parsedBrandDiscounts = (() => {
    if (!user.brandDiscounts) return null;
    try { return JSON.parse(user.brandDiscounts) as Record<string, number>; }
    catch { return null; }
  })();

  const creditDirty = () => {
    const account = user.creditAccount;
    const nextOverride = creditOverride === '' ? null : Number(creditOverride);
    const currentOverride = account?.overrideLimit ?? null;
    const nextUntil = temporaryUntil || null;
    const currentUntil = account?.temporaryUntil ? account.temporaryUntil.slice(0, 10) : null;
    return nextOverride !== currentOverride
      || Number(temporaryLimit || 0) !== (account?.temporaryLimit ?? 0)
      || nextUntil !== currentUntil
      || Number(paymentTermDays || 30) !== (account?.paymentTermDays ?? 30)
      || creditStatus !== (account?.status ?? 'active');
  };

  const profileDirty = () => name !== (user.name ?? '')
    || email !== (user.email ?? '')
    || password.length > 0
    || (user.role !== 'admin' && role !== (user.role ?? 'customer'))
    || phone !== (user.phone ?? '')
    || identity !== (user.identity ?? '')
    || institutionType !== (user.institutionType ?? (user.school ? '高校' : '待补充'))
    || institutionName !== (user.institutionName ?? user.school ?? user.institution ?? '')
    || institutionUnit !== (user.institutionUnit ?? user.college ?? '')
    || department !== (user.department ?? user.major ?? '')
    || institutionFacility !== (user.institutionFacility ?? user.building ?? '')
    || piLab !== (user.piLab ?? '')
    || affiliatedLab !== (user.affiliatedLab ?? '')
    || approvalStatus !== (user.approvalStatus ?? (user.isNewUser ? 'pending' : 'approved'))
    || isBlacklisted !== Boolean(user.isBlacklisted)
    || isFrozen !== Boolean(user.isFrozen);

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      if (password.length > 0) {
        const passwordLengthError = validateNewPasswordLength(password);
        if (passwordLengthError) {
          setFeedback({ type: 'error', text: passwordLengthError });
          return;
        }
      }
      const tierChanged = tier !== (user.tier ?? '');
      if (profileDirty() && !canWriteCustomers) {
        setFeedback({ type: 'error', text: '修改客户资料需要客户管理权限。' });
        return;
      }
      if (tierChanged && !canWriteTier) {
        setFeedback({ type: 'error', text: '修改客户等级需要价格权限。' });
        return;
      }
      if (creditDirty() && !canWriteCredit) {
        setFeedback({ type: 'error', text: '修改授信需要财务权限。' });
        return;
      }
      const payload: Record<string, unknown> | null = canWriteCustomers
        ? {
          userId: user.id,
          name,
          email,
          password: password || undefined,
          role: user.role === 'admin' ? undefined : role,
          institutionType,
          institutionName,
          institutionUnit,
          institutionDepartment: department,
          institutionFacility,
          piLab,
          affiliatedLab,
          tier,
          phone,
          identity,
          approvalStatus,
          isBlacklisted,
          isFrozen,
        }
        : tierChanged
          ? { userId: user.id, tier }
          : null;

      const result = await saveUserProfileThenCredit({
        saveProfile: async () => {
          if (!payload) return { ok: true };
          const res = await fetch('/api/admin/users/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));
          return { ok: res.ok, error: adminPermissionErrorMessage(data.error, data.requiredPermission) };
        },
        saveCredit: user.role === 'admin' || !creditDirty() || !canWriteCredit
          ? null
          : async () => {
            const creditRes = await fetch(`/api/admin/users/${user.id}/credit`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                overrideLimit: creditOverride === '' ? null : Number(creditOverride),
                temporaryLimit: Number(temporaryLimit || 0),
                temporaryUntil: temporaryUntil || null,
                status: creditStatus,
                paymentTermDays: Number(paymentTermDays || 30),
                reason: '用户管理页面调整',
              }),
            });
            const creditData = await creditRes.json().catch(() => ({}));
            return { ok: creditRes.ok, error: adminPermissionErrorMessage(creditData.error, creditData.requiredPermission) };
          },
      });

      if (result.status === 'ok') {
        setPassword('');
        setEditing(false);
        setFeedback({ type: 'success', text: '已保存' });
        onUpdate();
        return;
      }

      if (result.status === 'credit_failed') {
        setFeedback({ type: 'error', text: result.error });
        onUpdate();
        return;
      }

      setFeedback({ type: 'error', text: result.error });
    } catch {
      setFeedback({ type: 'error', text: '网络错误' });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleFreeze = async () => {
    if (user.role === 'admin') return;
    const next = !user.isFrozen;
    if (!confirm(next
      ? `冻结 ${user.name || user.email}？冻结后仍可登录，但看不到折扣价，也无法下单或询价。`
      : `解冻 ${user.name || user.email}？`)) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/users/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, isFrozen: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setIsFrozen(next);
        setFeedback({ type: 'success', text: next ? '已冻结' : '已解冻' });
        onUpdate();
      } else {
        setFeedback({ type: 'error', text: data.error || '操作失败' });
      }
    } catch {
      setFeedback({ type: 'error', text: '网络错误' });
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    if (!confirm(`确定审核通过用户 ${user.name || user.email}？`)) return;
    setSaving(true);
    try {
      const res = await fetch('/api/admin/users/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, isNewUser: false }),
      });
      if (res.ok) onUpdate();
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setName(user.name ?? '');
    setEmail(user.email ?? '');
    setPassword('');
    setRole(user.role ?? 'customer');
    setInstitutionType(user.institutionType ?? (user.school ? '高校' : '待补充'));
    setInstitutionName(user.institutionName ?? user.school ?? user.institution ?? '');
    setInstitutionUnit(user.institutionUnit ?? user.college ?? '');
    setDepartment(user.department ?? user.major ?? '');
    setInstitutionFacility(user.institutionFacility ?? user.building ?? '');
    setPiLab(user.piLab ?? '');
    setAffiliatedLab(user.affiliatedLab ?? '');
    setTier(user.tier ?? '');
    setPhone(user.phone ?? '');
    setIdentity(user.identity ?? '');
    setApprovalStatus(user.approvalStatus ?? (user.isNewUser ? 'pending' : 'approved'));
    setIsBlacklisted(Boolean(user.isBlacklisted));
    setIsFrozen(Boolean(user.isFrozen));
    setCreditOverride(user.creditAccount?.overrideLimit?.toString() ?? '');
    setTemporaryLimit(user.creditAccount?.temporaryLimit?.toString() ?? '0');
    setTemporaryUntil(user.creditAccount?.temporaryUntil?.slice(0, 10) ?? '');
    setCreditStatus(user.creditAccount?.status ?? 'active');
    setPaymentTermDays(user.creditAccount?.paymentTermDays?.toString() ?? '30');
    setFeedback(null);
    setEditing(false);
  };

  const discountText = user.sourceTemplateId
    ? (templates.find(t => t.id === user.sourceTemplateId)?.name ?? '已删除模板')
    : user.discountRate != null
      ? `${user.discountRate <= 2 ? `${(user.discountRate * 10).toFixed(1).replace(/\.0$/, '')}折` : user.discountRate}`
      : '—';

  const displayName = user.name || '未设置';
  const orgTitle = organizationSummary(user);
  const orgLabel = getInstitution(user);
  const phoneLabel = displayValue(user.phone) || '—';
  const createdLabel = formatDate(user.createdAt);
  const lastLoginLabel = formatDateTime(user.lastLoginAt);
  const actions = user.role !== 'admin' ? (
    <div className="flex flex-wrap items-center gap-2">
      {showEditButton && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setEditing(!editing); setFeedback(null); }}
          className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-brand-600"
          title={editing ? '收起' : '编辑'}
        >
          <Edit2 className="h-3.5 w-3.5" />
          {layout === 'compact' && (editing ? '收起' : '编辑')}
        </button>
      )}
      <button
        type="button"
        disabled={saving}
        onClick={(e) => { e.stopPropagation(); void handleToggleFreeze(); }}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 disabled:opacity-50"
        title={user.isFrozen ? '解冻' : '冻结'}
      >
        <LockKeyhole className="h-3.5 w-3.5" />
        {layout === 'compact' && (user.isFrozen ? '解冻' : '冻结')}
      </button>
    </div>
  ) : null;

  const editor = editing ? (
        <div className="min-w-0 rounded-brand border border-brand-100 bg-brand-50/50 p-3 sm:p-4">
            <div className="space-y-3">
              {showEditButton && (
                <div className="space-y-3">
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="text-xs font-medium text-gray-700">用户名</label>
                      <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        placeholder="显示名称"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700">邮箱</label>
                      <input
                        type="email"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700">新密码</label>
                      <input
                        type="password"
                        minLength={password.length > 0 ? PASSWORD_MIN_LENGTH : undefined}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        placeholder={`留空则不修改；填写时至少 ${PASSWORD_MIN_LENGTH} 位`}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-700">角色</label>
                      <select
                        value={role}
                        onChange={e => setRole(e.target.value)}
                        className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      >
                        <option value="customer">customer</option>
                        <option value="admin">admin</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <label className="text-xs font-medium text-gray-700">机构类型</label>
                    <input
                      type="text"
                      value={institutionType}
                      onChange={e => setInstitutionType(e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder="高校、医院、科研院所或其他"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">{institutionLabels.name}</label>
                    <input
                      type="text"
                      value={institutionName}
                      onChange={e => setInstitutionName(e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder={institutionLabels.name}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">{institutionLabels.unit}</label>
                    <input
                      type="text"
                      value={institutionUnit}
                      onChange={e => setInstitutionUnit(e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder={institutionLabels.unit}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">{institutionLabels.department}</label>
                    <input
                      type="text"
                      value={department}
                      onChange={e => setDepartment(e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder={institutionLabels.department}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">{institutionLabels.facility}</label>
                    <input
                      type="text"
                      value={institutionFacility}
                      onChange={e => setInstitutionFacility(e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder={institutionLabels.facility}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">PI 实验室</label>
                    <input
                      type="text"
                      value={piLab}
                      onChange={e => setPiLab(e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder="PI 实验室"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">依托实验室</label>
                    <input
                      type="text"
                      value={affiliatedLab}
                      onChange={e => setAffiliatedLab(e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder="依托实验室"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">等级</label>
                    <select
                      value={tier}
                      onChange={e => setTier(e.target.value)}
                      disabled={!canWriteTier}
                      title={canWriteTier ? undefined : '修改客户等级需要价格权限'}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-gray-50 disabled:text-gray-500"
                    >
                      {!CUSTOMER_TIERS.some(item => item.value === tier) && tier && (
                        <option value={tier}>{tier}（当前值）</option>
                      )}
                      {CUSTOMER_TIERS.map(item => (
                        <option key={item.value} value={item.value}>{item.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">电话</label>
                    <input
                      type="text"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder="联系电话"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">身份</label>
                    <select
                      value={identity}
                      onChange={e => setIdentity(e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      <option value="">未设置</option>
                      {identity && !isAssignableIdentity(identity) ? (
                        <option value={identity}>{identity}（当前值）</option>
                      ) : null}
                      <optgroup label="客户身份">
                        {CUSTOMER_IDENTITY_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </optgroup>
                      <optgroup label="内部角色">
                        {INTERNAL_IDENTITY_OPTIONS.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                </div>
                </div>
              )}
              {showEditButton && user.role !== 'admin' && (
                <div className="grid min-w-0 grid-cols-1 gap-3 border-t border-brand-100 pt-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <label className="text-xs font-medium text-gray-700">等级默认额度</label>
                    <div className="mt-1 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-600">¥{(user.creditAccount?.baseLimit ?? 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">人工额度</label>
                    <input type="number" min="0" value={creditOverride} onChange={e => setCreditOverride(e.target.value)} disabled={!canWriteCredit} title={canWriteCredit ? undefined : '修改授信需要财务权限'} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500" placeholder="使用默认额度" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">临时额度</label>
                    <input type="number" min="0" value={temporaryLimit} onChange={e => setTemporaryLimit(e.target.value)} disabled={!canWriteCredit} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">临时额度到期</label>
                    <input type="date" value={temporaryUntil} onChange={e => setTemporaryUntil(e.target.value)} disabled={!canWriteCredit} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">账期</label>
                    <input type="number" min="1" max="365" value={paymentTermDays} onChange={e => setPaymentTermDays(e.target.value)} disabled={!canWriteCredit} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">授信状态</label>
                    <select value={creditStatus} onChange={e => setCreditStatus(e.target.value)} disabled={!canWriteCredit} title={canWriteCredit ? undefined : '修改授信需要财务权限'} className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm disabled:bg-gray-50 disabled:text-gray-500">
                      <option value="active">正常</option>
                      <option value="credit_limited">限额下单</option>
                      <option value="paused">暂停授信</option>
                      <option value="overdue_hold">逾期暂停</option>
                    </select>
                  </div>
                </div>
              )}

              {showEditButton && (
                <div className="grid min-w-0 grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white/70 p-3 sm:grid-cols-3">
                  <label className="flex min-w-0 items-center gap-2 text-xs font-medium text-gray-700">
                    <span>审核状态</span>
                    <select
                      value={approvalStatus}
                      onChange={e => setApprovalStatus(e.target.value)}
                      className="flex-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800"
                    >
                      <option value="pending">待审核</option>
                      <option value="approved">审核通过</option>
                      <option value="rejected">审核不通过</option>
                    </select>
                  </label>
                  <label className="flex min-w-0 items-center gap-2 break-words text-xs font-medium text-gray-700">
                    <input type="checkbox" checked={isBlacklisted} onChange={e => setIsBlacklisted(e.target.checked)} className="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
                    账户限制，无法下单
                  </label>
                  <label className="flex min-w-0 items-center gap-2 break-words text-xs font-medium text-gray-700">
                    <input type="checkbox" checked={isFrozen} onChange={e => setIsFrozen(e.target.checked)} className="rounded border-gray-300 text-slate-600 focus:ring-slate-500" />
                    冻结（可登录，无折扣价，不可下单询价）
                  </label>
                </div>
              )}
              {feedback && editing && (
                <p className={`text-xs ${feedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{feedback.text}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {Boolean(user.isNewUser) && (
                  <button
                    onClick={handleApprove}
                    disabled={saving}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white rounded-lg text-xs font-medium transition-colors"
                  >
                    <Check className="w-3 h-3" />
                    审核通过
                  </button>
                )}
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-1 px-3 py-1.5 bg-brand-500 hover:bg-brand-600 disabled:bg-brand-300 text-white rounded-lg text-xs font-medium transition-colors"
                >
                  <Save className="w-3 h-3" />
                  {saving ? '保存中...' : '保存'}
                </button>
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-medium transition-colors"
                >
                  <X className="w-3 h-3" />
                  取消
                </button>
              </div>
            </div>
        </div>
  ) : null;

  if (layout === 'table') {
    return (
      <>
        <tr className={`group border-b border-gray-100 ${selected ? 'bg-brand-50/50' : 'hover:bg-gray-50/50'}`}>
          <td className={`sticky left-0 z-10 w-10 border-b border-gray-100 px-3 py-3 ${selected ? 'bg-brand-50' : 'bg-white group-hover:bg-gray-50'}`}>
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={e => { onSelectChange?.(e.target.checked); }}
              className="h-4 w-4 cursor-pointer rounded border-gray-300 text-brand-600"
              aria-label={`选择${displayName}`}
            />
          </td>
          <td className={`sticky left-10 z-10 w-36 border-b border-gray-100 px-3 py-3 shadow-[4px_0_6px_-4px_rgba(15,23,42,0.25)] ${selected ? 'bg-brand-50' : 'bg-white group-hover:bg-gray-50'}`}>
            <TruncatedText text={displayName} className="font-medium text-gray-900" />
            <TruncatedText text={user.role} className="mt-0.5 text-xs text-gray-500 xl:hidden" />
          </td>
          <td className="min-w-0 border-b border-gray-100 px-3 py-3">
            <TruncatedText text={user.email} className="text-gray-700" />
          </td>
          <td className={`min-w-0 border-b border-gray-100 px-3 py-3 ${userTableColumn.phone}`}>
            <TruncatedText text={phoneLabel} className="text-gray-700" />
          </td>
          <td className="min-w-0 border-b border-gray-100 px-3 py-3">
            <TruncatedText text={orgLabel === '-' ? '—' : orgLabel} title={orgTitle} className="text-gray-700" />
            {discountText !== '—' && <TruncatedText text={`折扣 ${discountText}`} className="text-xs text-gray-500" />}
          </td>
          <td className={`min-w-0 overflow-hidden border-b border-gray-100 px-3 py-3 ${userTableColumn.role}`}>
            <TruncatedText text={user.role} className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`} />
            <TruncatedText text={user.tier || '—'} className="mt-1 text-xs text-gray-500" />
          </td>
          <td className="min-w-0 overflow-hidden border-b border-gray-100 px-3 py-3">
            <StatusBadges user={user} />
          </td>
          <td className={`min-w-0 border-b border-gray-100 px-3 py-3 text-xs text-gray-600 ${userTableColumn.dates}`}>
            <TruncatedText text={`注册 ${createdLabel}`} />
            <TruncatedText text={`登录 ${lastLoginLabel}`} className="text-gray-500" />
          </td>
          <td className="whitespace-nowrap border-b border-gray-100 px-3 py-3">{actions}</td>
        </tr>
        {feedback && !editing && (
          <tr>
            <td colSpan={9} className={`px-3 pb-2 text-xs ${feedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{feedback.text}</td>
          </tr>
        )}
        {editing && (
          <tr>
            <td colSpan={9} className="border-b border-brand-200 bg-brand-50/70 p-3">
              {editor}
            </td>
          </tr>
        )}
      </>
    );
  }

  return (
    <div className={`min-w-0 overflow-hidden rounded-xl border bg-white/85 p-4 shadow-sm ${selected ? 'border-brand-300' : 'border-white/80'}`}>
      <div className="flex min-w-0 items-start gap-3">
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={e => { onSelectChange?.(e.target.checked); }}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-brand-600"
          aria-label={`选择${displayName}`}
        />
        <div className="min-w-0 flex-1">
          <TruncatedText text={displayName} className="font-medium text-gray-900" />
          <TruncatedText text={user.email} className="text-xs text-gray-600" />
          <div className="mt-3 grid grid-cols-1 gap-y-2">
            <div className="min-w-0">
              <div className="text-[11px] text-gray-500">电话</div>
              <TruncatedText text={phoneLabel} className="text-sm text-gray-700" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-gray-500">机构</div>
              <TruncatedText text={orgLabel === '-' ? '—' : orgLabel} title={orgTitle} className="text-sm text-gray-700" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-gray-500">角色</div>
              <TruncatedText text={user.role} className="text-sm text-gray-700" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-gray-500">等级</div>
              <TruncatedText text={user.tier || '—'} className="text-sm text-gray-700" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-gray-500">注册</div>
              <TruncatedText text={createdLabel} className="text-sm text-gray-700" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] text-gray-500">最近登录</div>
              <TruncatedText text={lastLoginLabel} className="text-sm text-gray-700" />
            </div>
          </div>
          <div className="mt-3"><StatusBadges user={user} /></div>
          {discountText !== '—' && (
            <TruncatedText text={`折扣 ${discountText}`} className="mt-2 text-xs text-gray-500" />
          )}
        </div>
      </div>
      {actions && <div className="mt-3 flex justify-end">{actions}</div>}
      {feedback && !editing && (
        <p className={`mt-2 text-xs ${feedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{feedback.text}</p>
      )}
      {editor && <div className="mt-3">{editor}</div>}
    </div>
  );
}
