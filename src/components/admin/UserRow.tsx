'use client';

import React, { useState } from 'react';
import { Check, X, Edit2, Save, Shield, LockKeyhole } from 'lucide-react';
import { saveUserProfileThenCredit } from '@/lib/admin-user-row-save';
import { getInstitutionLabels } from '@/data/institution-profile';

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

interface UserRowProps {
  user: UserType & { discountRate?: number | null; brandDiscounts?: string | null; department?: string; identity?: string; sourceTemplateId?: string | null };
  onUpdate: () => void;
  selected?: boolean;
  onSelectChange?: (selected: boolean) => void;
  showEditButton?: boolean;
  templates?: DiscountTemplateLite[];
}

const CUSTOMER_TIERS = [{ value: 'standard', label: 'standard' }];

export default function UserRow({ user, onUpdate, selected, onSelectChange, showEditButton, templates = [] }: UserRowProps) {
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

  const handleSave = async () => {
    setSaving(true);
    setFeedback(null);
    try {
      const payload: Record<string, unknown> = {
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
      };

      const result = await saveUserProfileThenCredit({
        saveProfile: async () => {
          const res = await fetch('/api/admin/users/update', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));
          return { ok: res.ok, error: data.error };
        },
        saveCredit: user.role === 'admin'
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
            return { ok: creditRes.ok, error: creditData.error };
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

  return (
    <>
      <article className={`min-w-0 rounded-brand border border-gray-200 bg-white/70 p-3 shadow-sm hover:bg-gray-50 sm:p-4 ${selected ? 'border-brand-300 bg-brand-50/40' : ''}`}>
        <div className="min-w-0">
          <div className="flex min-w-0 items-start gap-3">
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={e => { onSelectChange?.(e.target.checked); }}
              className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-brand-500 cursor-pointer"
              aria-label={`选择${user.name || user.email}`}
            />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <div className="break-words font-medium text-gray-900">{user.name || '未设置'}</div>
            {Boolean(user.isNewUser) && (
              <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                <Shield className="w-3 h-3" /> 待审核
              </span>
            )}
            {user.approvalStatus === 'rejected' && <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">审核未通过</span>}
            {user.isBlacklisted && <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">账户限制</span>}
            {user.isFrozen && <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded" title="可登录，无折扣价，不可下单询价"><LockKeyhole className="w-3 h-3" /> 已冻结</span>}
              </div>
              <div className="break-words text-gray-500 text-xs">{user.email}</div>
          {user.role !== 'admin' && (
            <div className="mt-1 flex items-center gap-2">
              {showEditButton && (
                <button
                  onClick={(e) => { e.stopPropagation(); setEditing(!editing); setFeedback(null); }}
                  className="text-xs text-gray-400 hover:text-brand-600 flex items-center gap-1"
                >
                  <Edit2 className="w-3 h-3" /> {editing ? '收起' : '编辑'}
                </button>
              )}
              <button
                type="button"
                disabled={saving}
                onClick={(e) => { e.stopPropagation(); void handleToggleFreeze(); }}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                {user.isFrozen ? '解冻' : '冻结'}
              </button>
            </div>
          )}
          {feedback && !editing && (
            <p className={`mt-1 text-xs ${feedback.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>{feedback.text}</p>
          )}
              <div className="mt-3 grid grid-cols-1 gap-2 border-t border-gray-100 pt-3 text-[13px] leading-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                <div className="flex min-w-0 items-start gap-1">
                  <span className="shrink-0 pt-0.5 text-[10px] text-gray-500">角色</span>
                  <span className={`min-w-0 truncate rounded-full px-2 py-0.5 text-xs font-medium ${user.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-700'}`}>
                    {user.role}
                  </span>
                </div>
                <div className="flex min-w-0 items-start gap-1">
                  <span className="shrink-0 pt-0.5 text-[10px] text-gray-500">等级</span>
                  <p className="min-w-0 break-words text-xs text-gray-700" title={user.tier || '-'}>{user.tier || '-'}</p>
                </div>
                <div className="flex min-w-0 items-start gap-1">
                  <span className="shrink-0 pt-0.5 text-[10px] text-gray-500">机构</span>
                  <p className="min-w-0 break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] text-xs text-gray-700" title={getInstitution(user)}>{getInstitution(user)}</p>
                </div>
                <div className="flex min-w-0 items-start gap-1">
                  <span className="shrink-0 pt-0.5 text-[10px] text-gray-500">组织单元</span>
                  <p className="min-w-0 break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] text-xs text-gray-700" title={getInstitutionUnit(user)}>{getInstitutionUnit(user)}</p>
                </div>
                <div className="flex min-w-0 items-start gap-1">
                  <span className="shrink-0 pt-0.5 text-[10px] text-gray-500">部门</span>
                  <p className="min-w-0 break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] text-xs text-gray-700" title={getDepartment(user)}>{getDepartment(user)}</p>
                </div>
                <div className="flex min-w-0 items-start gap-1">
                  <span className="shrink-0 pt-0.5 text-[10px] text-gray-500">具体单元</span>
                  <p className="min-w-0 break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] text-xs text-gray-700" title={getInstitutionFacility(user)}>{getInstitutionFacility(user)}</p>
                </div>
                <div className="flex min-w-0 items-start gap-1 sm:col-span-2 lg:col-span-1">
                  <span className="shrink-0 pt-0.5 text-[10px] text-gray-500">实验室</span>
                  <p className="min-w-0 break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] text-xs text-gray-700" title={getLaboratory(user)}>{getLaboratory(user)}</p>
                </div>
                <div className="flex min-w-0 items-start gap-1">
                  <span className="shrink-0 pt-0.5 text-[10px] text-gray-500">折扣</span>
                  <p className="min-w-0 break-words text-xs text-gray-700">
                    {user.sourceTemplateId
                      ? (templates.find(t => t.id === user.sourceTemplateId)?.name ?? '已删除模板')
                      : user.discountRate != null
                        ? `${user.discountRate <= 2 ? `${(user.discountRate * 10).toFixed(1).replace(/\.0$/, '')}折` : user.discountRate}`
                        : '—'}
                  </p>
                </div>
                <div className="flex min-w-0 items-start gap-1">
                  <span className="shrink-0 pt-0.5 text-[10px] text-gray-500">注册</span>
                  <p className="min-w-0 break-words text-xs text-gray-600">{new Date(user.createdAt).toLocaleDateString('zh-CN')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </article>
{editing && (
        <div className="mt-2 min-w-0 rounded-brand border border-brand-100 bg-brand-50/50 p-3 sm:p-4">
            <div className="space-y-3">
              {/* Basic User Info - shown when 用户管理 is active */}
              {showEditButton && (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                        placeholder="留空则不修改"
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
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
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
                    <input
                      type="text"
                      value={identity}
                      onChange={e => setIdentity(e.target.value)}
                      className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      placeholder="身份/职位"
                    />
                  </div>
                </div>
                </div>
              )}
              {showEditButton && user.role !== 'admin' && (
                <div className="grid grid-cols-1 gap-3 border-t border-brand-100 pt-3 sm:grid-cols-2 lg:grid-cols-6">
                  <div>
                    <label className="text-xs font-medium text-gray-700">等级默认额度</label>
                    <div className="mt-1 rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-600">¥{(user.creditAccount?.baseLimit ?? 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">人工额度</label>
                    <input type="number" min="0" value={creditOverride} onChange={e => setCreditOverride(e.target.value)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm" placeholder="使用默认额度" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">临时额度</label>
                    <input type="number" min="0" value={temporaryLimit} onChange={e => setTemporaryLimit(e.target.value)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">临时额度到期</label>
                    <input type="date" value={temporaryUntil} onChange={e => setTemporaryUntil(e.target.value)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">账期</label>
                    <input type="number" min="1" max="365" value={paymentTermDays} onChange={e => setPaymentTermDays(e.target.value)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-700">授信状态</label>
                    <select value={creditStatus} onChange={e => setCreditStatus(e.target.value)} className="mt-1 w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm">
                      <option value="active">正常</option>
                      <option value="credit_limited">限额下单</option>
                      <option value="paused">暂停授信</option>
                      <option value="overdue_hold">逾期暂停</option>
                    </select>
                  </div>
                </div>
              )}

              {showEditButton && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border border-gray-200 bg-white/70 p-3">
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
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
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                    <input type="checkbox" checked={isBlacklisted} onChange={e => setIsBlacklisted(e.target.checked)} className="rounded border-gray-300 text-amber-600 focus:ring-amber-500" />
                    账户限制，无法下单
                  </label>
                  <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
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
      )}
    </>
  );
}
