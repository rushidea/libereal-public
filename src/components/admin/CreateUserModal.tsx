'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { adminSurfaceClasses } from '@/lib/admin-surfaces';

const TIERS = ['standard'];

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export default function CreateUserModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'customer' | 'admin'>('customer');
  const [institutionType, setInstitutionType] = useState('高校');
  const [institutionName, setInstitutionName] = useState('');
  const [institutionUnit, setInstitutionUnit] = useState('');
  const [department, setDepartment] = useState('');
  const [institutionFacility, setInstitutionFacility] = useState('');
  const [piLab, setPiLab] = useState('');
  const [affiliatedLab, setAffiliatedLab] = useState('');
  const [phone, setPhone] = useState('');
  const [tier, setTier] = useState('standard');
  const [approvalStatus, setApprovalStatus] = useState('approved');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  if (!open) return null;

  function reset() {
    setName('');
    setEmail('');
    setPassword('');
    setRole('customer');
    setInstitutionType('高校');
    setInstitutionName('');
    setInstitutionUnit('');
    setDepartment('');
    setInstitutionFacility('');
    setPiLab('');
    setAffiliatedLab('');
    setPhone('');
    setTier('standard');
    setApprovalStatus('approved');
    setError('');
    setSuccess('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          password,
          role,
          institutionType,
          institutionName,
          institutionUnit,
          institutionDepartment: department,
          department,
          institutionFacility,
          piLab,
          affiliatedLab,
          phone,
          tier,
          approvalStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '创建失败');
        return;
      }
      setSuccess(`已创建 ${data.user?.email || email}`);
      reset();
      onCreated();
      onClose();
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-site-overlay flex justify-center overflow-y-auto bg-black/40 px-4 pb-4 pt-[calc(var(--site-header-height)+var(--site-header-gap))]" onClick={onClose}>
      <div
        className={`my-auto w-full max-w-lg ${adminSurfaceClasses.modal}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Plus className="w-5 h-5 text-brand-600" /> 创建用户
          </h2>
          <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-700">用户名</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="显示名称" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">邮箱</label>
              <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">初始密码</label>
              <input required type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="至少 8 位" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">角色</label>
              <select value={role} onChange={(e) => setRole(e.target.value as 'customer' | 'admin')} className={`mt-1 w-full ${adminSurfaceClasses.input} px-3 py-2 text-sm`}>
                <option value="customer">customer</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">机构类型</label>
              <input list="admin-institution-types" value={institutionType} onChange={(e) => setInstitutionType(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="高校、医院、科研院所或其他" />
              <datalist id="admin-institution-types">
                <option value="高校" />
                <option value="医院" />
                <option value="科研院所" />
              </datalist>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">机构名称</label>
              <input value={institutionName} onChange={(e) => setInstitutionName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">组织单元</label>
              <input value={institutionUnit} onChange={(e) => setInstitutionUnit(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="学院、院区、研究所或中心" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">部门或学系</label>
              <input value={department} onChange={(e) => setDepartment(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">具体单元</label>
              <input value={institutionFacility} onChange={(e) => setInstitutionFacility(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="楼号、病区、研究中心或课题组" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">PI 实验室</label>
              <input value={piLab} onChange={(e) => setPiLab(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">依托实验室</label>
              <input value={affiliatedLab} onChange={(e) => setAffiliatedLab(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">电话</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">等级</label>
              <select value={tier} onChange={(e) => setTier(e.target.value)} className={`mt-1 w-full ${adminSurfaceClasses.input} px-3 py-2 text-sm`}>
                {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-700">审核状态</label>
              <select value={approvalStatus} onChange={(e) => setApprovalStatus(e.target.value)} className={`mt-1 w-full ${adminSurfaceClasses.input} px-3 py-2 text-sm`}>
                <option value="approved">审核通过</option>
                <option value="pending">待审核</option>
                <option value="rejected">审核不通过</option>
              </select>
            </div>
          </div>
          {role === 'admin' && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              创建为 admin 后，细粒度后台权限仍需在「权限与审计」中分配角色。
            </p>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">
              取消
            </button>
            <button type="submit" disabled={loading} className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50">
              {loading ? '创建中…' : '创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
