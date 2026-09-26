'use client';

import { useEffect, useState } from 'react';
import { Check, History, KeyRound, LockKeyhole, Save, ShieldCheck } from 'lucide-react';
import SecurityStepUpDialog from '@/components/security/SecurityStepUpDialog';
import { isAdminMfaStepUpResponse, useAdminMfaStepUp } from '@/components/admin/AdminMfaStepUpDialog';
import { formatAdminMfaScenarioCount, getAdminMfaProtectionView } from '@/lib/admin-mfa-protection-view';

type Role = { id: string; key: string; name: string; description?: string; permissions: Array<{ permission: { key: string; name: string } }> };
type AdminUser = { id: string; name?: string; email: string; adminRoleAssignments: Array<{ roleId: string }> };
type AuditLog = { id: string; actorEmail?: string; action: string; resource: string; targetType: string; targetId?: string; reason?: string; createdAt: string };
type MfaScenario = { id: string; label: string; detail: string };
type MfaScenarioGroup = { id: string; title: string; summary: string; items: MfaScenario[] };
type MfaSettings = {
  enabled: boolean;
  available: boolean;
  scenariosEnforced?: boolean;
  protection?: {
    badge: string;
    tone: 'unavailable' | 'off' | 'on';
    hint: string;
  };
  scenarios: Record<string, boolean>;
  groups: MfaScenarioGroup[];
  updatedAt: string | null;
  updatedByEmail: string | null;
  policySummary: {
    adminLogin: string;
    userLogin: string;
    sensitiveOperations: string;
    ordinaryOperations: string;
    adjustment: string;
  };
};

export default function AdminAccessPage() {
  const { begin: beginAdminStepUp, dialog: adminStepUpDialog } = useAdminMfaStepUp();
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [internalName, setInternalName] = useState('');
  const [internalEmail, setInternalEmail] = useState('');
  const [internalPassword, setInternalPassword] = useState('');
  const [internalRoleIds, setInternalRoleIds] = useState<string[]>([]);
  const [internalMessage, setInternalMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [canManageRoles, setCanManageRoles] = useState(false);
  const [canManageSuperAdmin, setCanManageSuperAdmin] = useState(false);
  const [mfaSettings, setMfaSettings] = useState<MfaSettings | null>(null);
  const [mfaScenarios, setMfaScenarios] = useState<Record<string, boolean>>({});
  const [mfaEditing, setMfaEditing] = useState(false);
  const [mfaGrantToken, setMfaGrantToken] = useState('');
  const [mfaWorking, setMfaWorking] = useState(false);
  const [mfaStepUpOpen, setMfaStepUpOpen] = useState(false);
  const [pendingMfaScenarioId, setPendingMfaScenarioId] = useState<string | null>(null);
  const [mfaMessage, setMfaMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = async () => {
    const [manageResponse, auditResponse] = await Promise.all([
      fetch('/api/admin/access?view=manage'),
      fetch('/api/admin/access?view=audit&take=100'),
    ]);
    if (manageResponse.ok) {
      setCanManageRoles(true);
      const data = await manageResponse.json();
      setRoles(data.roles || []);
      setUsers(data.users || []);
      setCanManageSuperAdmin(Boolean(data.canManageSuperAdmin));
    }
    if (auditResponse.ok) setLogs((await auditResponse.json()).logs || []);
    const mfaResponse = await fetch('/api/admin/access?view=mfa-policy', { cache: 'no-store' });
    if (mfaResponse.ok) {
      const data = await mfaResponse.json() as MfaSettings;
      setMfaSettings(data);
      setMfaScenarios(data.scenarios || {});
    }
  };

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const selected = users.find((user) => user.id === selectedUser);
    setRoleIds(selected?.adminRoleAssignments.map((item) => item.roleId) || []);
  }, [selectedUser, users]);

  const save = async (stepUpToken?: string) => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      const response = await fetch('/api/admin/access', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser, roleIds, reason: '后台角色设置', ...(stepUpToken ? { grantToken: stepUpToken } : {}) }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok && !stepUpToken && isAdminMfaStepUpResponse(response.status, data.error)) {
        await beginAdminStepUp((grantToken) => save(grantToken));
        return;
      }
      if (response.ok) await load();
      else setMfaMessage({ type: 'error', text: data.error || '角色保存失败' });
    } finally { setSaving(false); }
  };

  const createInternalUser = async (stepUpToken?: string) => {
    setInternalMessage(null);
    if (!internalName.trim() || !internalEmail.trim() || internalPassword.length < 8 || internalRoleIds.length === 0) {
      setInternalMessage({ type: 'error', text: '请填写姓名、邮箱、至少 8 位密码并选择管理角色。' });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch('/api/admin/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          view: 'create-internal-user',
          name: internalName.trim(),
          email: internalEmail.trim(),
          password: internalPassword,
          roleIds: internalRoleIds,
          ...(stepUpToken ? { grantToken: stepUpToken } : {}),
        }),
      });
      const data = await response.json().catch(() => ({})) as { user?: { email?: string }; error?: string };
      if (!response.ok && !stepUpToken && isAdminMfaStepUpResponse(response.status, data.error)) {
        await beginAdminStepUp((grantToken) => createInternalUser(grantToken));
        return;
      }
      if (!response.ok) {
        setInternalMessage({ type: 'error', text: data.error || '内部用户创建失败' });
        return;
      }
      setInternalName('');
      setInternalEmail('');
      setInternalPassword('');
      setInternalRoleIds([]);
      setInternalMessage({ type: 'success', text: `内部用户 ${data.user?.email || ''} 创建成功。` });
      await load();
    } catch {
      setInternalMessage({ type: 'error', text: '创建请求失败' });
    } finally { setSaving(false); }
  };

  const saveMfaSettings = async () => {
    if (!mfaEditing || !mfaGrantToken) {
      setMfaStepUpOpen(true);
      return;
    }
    setMfaWorking(true);
    setMfaMessage(null);
    try {
      const response = await fetch('/api/admin/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ view: 'mfa-policy', scenarios: mfaScenarios, grantToken: mfaGrantToken }),
      });
      const data = await response.json().catch(() => null) as { scenarios?: Record<string, boolean>; error?: string } | null;
      if (!response.ok) {
        setMfaEditing(false);
        setMfaGrantToken('');
        setMfaMessage({ type: 'error', text: `${data?.error || '安全规则保存失败。'} 请重新确认身份后再保存。` });
        return;
      }
      if (data?.scenarios) setMfaScenarios(data.scenarios);
      setMfaEditing(false);
      setMfaGrantToken('');
      setMfaMessage({ type: 'success', text: '安全规则已保存。' });
      await load();
    } catch {
      setMfaEditing(false);
      setMfaGrantToken('');
      setMfaMessage({ type: 'error', text: '保存请求失败，请重新确认身份后再保存。' });
    } finally {
      setMfaWorking(false);
    }
  };

  const toggleMfaScenario = (id: string) => {
    if (!mfaSettings?.available || mfaWorking) return;
    if (!mfaEditing || !mfaGrantToken) {
      setPendingMfaScenarioId(id);
      setMfaStepUpOpen(true);
      return;
    }
    setMfaScenarios((current) => ({ ...current, [id]: !current[id] }));
  };

  const openMfaStepUp = () => {
    setPendingMfaScenarioId(null);
    setMfaStepUpOpen(true);
  };

  const assignableRoles = roles.filter((role) => canManageSuperAdmin || role.key !== 'super_admin');
  const mfaProtection = mfaSettings
    ? getAdminMfaProtectionView({ available: mfaSettings.available, enabled: mfaSettings.enabled })
    : null;
  const mfaScenariosEnforced = mfaProtection?.scenariosEnforced ?? false;

  return (
    <div className="space-y-8">
      <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><ShieldCheck className="h-6 w-6 text-brand-600" />权限与审计</h1>
      {canManageRoles && <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">创建内部用户</h2>
          <p className="mt-1 text-sm leading-6 text-gray-500">创建后自动进入管理员列表，并按所选角色获得后台权限。</p>
        </div>
        <div className="grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2">
          <label className="text-sm text-gray-700">姓名
            <input value={internalName} onChange={(event) => setInternalName(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" placeholder="内部用户姓名" />
          </label>
          <label className="text-sm text-gray-700">邮箱
            <input type="email" value={internalEmail} onChange={(event) => setInternalEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" placeholder="name@example.com" />
          </label>
          <label className="text-sm text-gray-700">初始密码
            <input type="password" minLength={8} value={internalPassword} onChange={(event) => setInternalPassword(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" placeholder="至少 8 位" />
          </label>
          <div className="text-sm text-gray-700 sm:col-span-2">
            <p className="font-medium">管理角色</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {assignableRoles.map((role) => (
                <label key={role.id} className="flex items-start gap-2 rounded-lg border border-gray-200 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={internalRoleIds.includes(role.id)}
                    onChange={(event) => setInternalRoleIds((current) => event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id))}
                    className="mt-0.5 h-4 w-4 accent-brand-600"
                  />
                  <span><span className="block font-medium text-gray-900">{role.name}</span><span className="mt-0.5 block text-xs leading-5 text-gray-500">{role.description}</span></span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <button type="button" onClick={() => void createInternalUser()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              创建内部用户
            </button>
            {internalMessage && <p className={`text-sm ${internalMessage.type === 'error' ? 'text-red-600' : 'text-emerald-700'}`} role="status">{internalMessage.text}</p>}
          </div>
        </div>
      </section>}
      {canManageRoles && <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">管理角色</h2>
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700" htmlFor="admin-user">管理账户</label>
            <select id="admin-user" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm">
              <option value="">选择账户</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.name || user.email} · {user.email}</option>)}
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {assignableRoles.map((role) => (
              <label key={role.id} className="flex cursor-pointer gap-3 rounded-lg border border-gray-200 bg-white p-4">
                <input type="checkbox" checked={roleIds.includes(role.id)} disabled={!selectedUser} onChange={(event) => setRoleIds((current) => event.target.checked ? [...current, role.id] : current.filter((id) => id !== role.id))} className="mt-1 h-4 w-4 accent-brand-600" />
                <span><span className="block text-sm font-semibold text-gray-900">{role.name}</span><span className="mt-1 block text-xs leading-5 text-gray-500">{role.description}</span></span>
              </label>
            ))}
          </div>
        </div>
        <button type="button" onClick={() => void save()} disabled={!selectedUser || saving} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Save className="h-4 w-4" />保存角色</button>
      </section>}

      {mfaSettings && mfaProtection && canManageRoles && <section className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900"><LockKeyhole className="h-5 w-5 text-brand-600" />管理员双因素认证设置</h2>
            <p className="mt-1 text-sm leading-6 text-gray-500">{mfaProtection.hint}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-medium ${mfaProtection.tone === 'on' ? 'bg-emerald-50 text-emerald-700' : mfaProtection.tone === 'off' ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
            {mfaProtection.badge}
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {mfaSettings.groups.map((group) => {
            const enabledCount = group.items.filter((item) => mfaScenarios[item.id]).length;
            return <section key={group.id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="text-sm font-semibold text-gray-900">{group.title}</h3><p className="mt-1 text-xs leading-5 text-gray-500">{group.summary}</p></div>
                <span className="shrink-0 text-xs text-gray-500">{formatAdminMfaScenarioCount(enabledCount, mfaScenariosEnforced)}</span>
              </div>
              <div className="mt-3 divide-y divide-gray-100">
                {group.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1">
                  <div className="min-w-0"><p className="text-sm text-gray-800">{item.label}</p><p className="mt-0.5 text-xs text-gray-500">{item.detail}</p></div>
                  <button type="button" onClick={() => toggleMfaScenario(item.id)} disabled={mfaWorking || !mfaSettings.available} aria-pressed={Boolean(mfaScenarios[item.id])} aria-label={`${item.label}是否需要再次验证`} className={`relative h-6 w-11 shrink-0 rounded-full transition ${mfaScenarios[item.id] ? 'bg-brand-600' : 'bg-gray-300'} disabled:cursor-not-allowed disabled:opacity-50`}>
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${mfaScenarios[item.id] ? 'right-1' : 'left-1'}`} />
                  </button>
                </div>)}
              </div>
            </section>;
          })}
        </div>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="text-sm font-semibold text-gray-900">登录与操作总策略</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ['管理员登录', mfaSettings.policySummary.adminLogin],
              ['普通用户登录', mfaSettings.policySummary.userLogin],
              ['敏感操作', mfaSettings.policySummary.sensitiveOperations],
              ['一般操作', mfaSettings.policySummary.ordinaryOperations],
              ['安全规则调整', mfaSettings.policySummary.adjustment],
            ].map(([label, value]) => <div key={label} className="rounded-lg bg-gray-50 px-3 py-3">
              <p className="text-xs text-gray-500">{label}</p>
              <p className="mt-1 text-sm font-medium text-gray-900">{value}</p>
            </div>)}
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex items-center gap-2">
            {mfaEditing && <span className="inline-flex items-center gap-1 text-xs text-emerald-700"><Check className="h-4 w-4" />当前可调整</span>}
            <button type="button" onClick={() => mfaEditing ? void saveMfaSettings() : openMfaStepUp()} disabled={mfaWorking || !mfaSettings.available} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
              <KeyRound className="h-4 w-4" />{mfaEditing ? '保存设置' : '调整设置'}
            </button>
          </div>
        </div>
        {mfaMessage && <p className={`text-sm ${mfaMessage.type === 'error' ? 'text-red-600' : 'text-emerald-700'}`} role="status">{mfaMessage.text}</p>}
      </section>}

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900"><History className="h-5 w-5 text-brand-600" />审计记录</h2>
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="px-4 py-3">时间</th><th className="px-4 py-3">操作人</th><th className="px-4 py-3">操作</th><th className="px-4 py-3">资源</th><th className="px-4 py-3">对象</th><th className="px-4 py-3">原因</th></tr></thead>
            <tbody className="divide-y divide-gray-100">{logs.map((log) => <tr key={log.id}><td className="px-4 py-3 text-gray-500">{new Date(log.createdAt).toLocaleString('zh-CN')}</td><td className="px-4 py-3">{log.actorEmail || '系统'}</td><td className="px-4 py-3">{log.action}</td><td className="px-4 py-3">{log.resource}</td><td className="px-4 py-3 text-gray-500">{log.targetType}{log.targetId ? ` · ${log.targetId}` : ''}</td><td className="px-4 py-3 text-gray-500">{log.reason || '—'}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <SecurityStepUpDialog
        open={mfaStepUpOpen}
        action="admin_mfa_policy"
        title="确认身份后调整设置"
        description="调整登录安全规则前，需要再次确认身份。可使用验证器应用、手机短信或邮箱验证码。"
        onCancel={() => {
          setPendingMfaScenarioId(null);
          setMfaStepUpOpen(false);
        }}
        onVerified={(grantToken) => {
          setMfaGrantToken(grantToken);
          setMfaEditing(true);
          setMfaStepUpOpen(false);
          if (pendingMfaScenarioId) {
            const scenarioId = pendingMfaScenarioId;
            setMfaScenarios((current) => ({ ...current, [scenarioId]: !current[scenarioId] }));
            setPendingMfaScenarioId(null);
          }
          setMfaMessage({ type: 'success', text: '身份确认完成，可以调整各项设置。' });
        }}
      />
      {adminStepUpDialog}
    </div>
  );
}
