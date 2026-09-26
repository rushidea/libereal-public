'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, Clock3, Mail, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';
import { permissionsForOrganizationRole } from '@/lib/organization-rbac';
import SecurityStepUpDialog from '@/components/security/SecurityStepUpDialog';

type RoleKey = 'owner' | 'admin' | 'researcher' | 'purchasing';

type Organization = {
  id: string;
  name: string;
  status: string;
  ownerUserId: string;
  membershipId: string;
  roles: Array<{ key: string; name: string }>;
  permissions?: string[];
};

type PendingInvitation = {
  id: string;
  organizationId: string;
  organizationName: string;
  requestedRole: string | null;
  invitedAt: string;
};

type Member = {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  status: string;
  joinedAt: string | null;
  createdAt: string;
  pendingRole: string | null;
  roles: Array<{ key: string; name: string }>;
  permissions?: string[];
};

type Approval = {
  id: string;
  kind: string;
  status: string;
  requestedRole: string | null;
  createdAt: string;
  reviewedAt: string | null;
  requester: { id: string; email: string; name: string | null };
  member: { id: string; userId: string; email: string; name: string | null } | null;
};

type ApiError = Error & { status?: number; code?: string };

const roleLabels: Record<RoleKey, string> = {
  owner: '组织所有者',
  admin: '审计员',
  researcher: '研究员',
  purchasing: '采购',
};

const memberRoleOptions: Array<{ key: Exclude<RoleKey, 'owner'>; label: string }> = [
  { key: 'admin', label: roleLabels.admin },
  { key: 'researcher', label: roleLabels.researcher },
  { key: 'purchasing', label: roleLabels.purchasing },
];

const memberPermissionOptions = [
  { key: 'organization.read', label: '访问组织' },
  { key: 'organization.members.read', label: '查看成员' },
  { key: 'organization.members.invite', label: '邀请成员' },
  { key: 'organization.members.manage', label: '管理成员' },
  { key: 'organization.records.read', label: '查看组织记录' },
  { key: 'organization.approvals.read', label: '查看审批' },
  { key: 'organization.approvals.review', label: '审批角色变更' },
  { key: 'organization.orders.create', label: '创建订单' },
  { key: 'organization.orders.review', label: '审核订单' },
  { key: 'organization.inquiries.create', label: '提交询价' },
  { key: 'organization.pricing.read', label: '查看价格' },
] as const;
const memberPermissionKeys = new Set<string>(memberPermissionOptions.map((permission) => permission.key));

// 复用服务端角色定义，确保角色切换时的默认权限与接口一致。
const ROLE_PERMISSIONS: Record<RoleKey, string[]> = {
  owner: [...permissionsForOrganizationRole('owner')],
  admin: [...permissionsForOrganizationRole('admin')],
  researcher: [...permissionsForOrganizationRole('researcher')],
  purchasing: [...permissionsForOrganizationRole('purchasing')],
};

function createApiError(data: { error?: string; code?: string }, status: number): ApiError {
  const error = new Error(data.error || '请求失败') as ApiError;
  error.status = status;
  error.code = data.code;
  return error;
}

function isMfaRequiredError(error: ApiError): boolean {
  return error.status === 403 && (error.message === 'MFA required' || error.message === 'Recent MFA verification required');
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({})) as { error?: string; code?: string } & T;
  if (!response.ok) throw createApiError(data, response.status);
  return data;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function statusLabel(status: string): string {
  if (status === 'active') return '正常';
  if (status === 'pending') return '待平台审核';
  if (status === 'pending_reapproval') return '待重新审核';
  if (status === 'rejected') return '平台审核未通过';
  if (status === 'removed') return '已移除';
  if (status === 'suspended') return '已暂停';
  if (status === 'approved') return '已通过';
  if (status === 'rejected') return '已拒绝';
  return status;
}

function memberStatusLabel(status: string): string {
  if (status === 'active') return '正常';
  if (status === 'pending') return '待成员确认';
  if (status === 'removed') return '已退出';
  return status;
}

function defaultRoleForMember(memberRole: string): Exclude<RoleKey, 'owner'> {
  return memberRoleOptions.some((role) => role.key === memberRole)
    ? memberRole as Exclude<RoleKey, 'owner'>
    : 'researcher';
}

export default function OrganizationsPanel() {
  const { data: session, status: sessionStatus } = useSession();
  const currentUserId = session?.user?.id || '';
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [canCreateOrganization, setCanCreateOrganization] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState<PendingInvitation[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [stepUpAction] = useState<'organization_permissions'>('organization_permissions');
  const [members, setMembers] = useState<Member[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newName, setNewName] = useState('');
  const [organizationCreated, setOrganizationCreated] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<Exclude<RoleKey, 'owner'>>('researcher');
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Exclude<RoleKey, 'owner'>>>({});
  const [permissionEditingMemberId, setPermissionEditingMemberId] = useState<string | null>(null);
  const [permissionDrafts, setPermissionDrafts] = useState<Record<string, string[]>>({});
  const [profileName, setProfileName] = useState('');
  const [profileEditing, setProfileEditing] = useState(false);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const selectedIdRef = useRef('');
  const detailSequence = useRef(0);
  const pendingActionRef = useRef<((stepUpToken?: string) => Promise<void>) | null>(null);

  const selectedOrganization = organizations.find((organization) => organization.id === selectedId) || null;
  const canCreateOrganizationEntry = canCreateOrganization && !organizationCreated && !organizations.some((organization) => organization.ownerUserId === currentUserId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    setRoleDrafts({});
    setPermissionDrafts({});
    setPermissionEditingMemberId(null);
  }, [selectedId]);

  useEffect(() => {
    setProfileName(selectedOrganization?.name || '');
    setProfileEditing(false);
  }, [selectedOrganization?.id, selectedOrganization?.name]);

  const selectedPermissions = useMemo(() => {
    if (Array.isArray(selectedOrganization?.permissions)) return new Set(selectedOrganization.permissions);
    const keys = new Set<string>();
    for (const role of selectedOrganization?.roles || []) {
      const permissionList = ROLE_PERMISSIONS[role.key as RoleKey];
      if (permissionList) permissionList.forEach((permission) => keys.add(permission));
    }
    return keys;
  }, [selectedOrganization]);
  const canReadMembers = selectedPermissions.has('organization.members.read');
  const canReadRecords = selectedPermissions.has('organization.records.read');
  const canReviewApprovals = selectedPermissions.has('organization.approvals.review');
  const isOrganizationOwner = selectedOrganization?.ownerUserId === currentUserId;
  const isOrganizationAdmin = Boolean(selectedOrganization?.roles.some((role) => role.key === 'admin'));
  const canManageMemberSettings = Boolean(isOrganizationOwner || isOrganizationAdmin);
  const canAccessMemberManagement = canManageMemberSettings && canReadMembers;
  const canInvite = selectedPermissions.has('organization.members.invite') && canAccessMemberManagement;
  const canRequestRoleChange = Boolean(
    canAccessMemberManagement,
  );
  const canEditProfile = selectedPermissions.has('organization.profile.edit') && isOrganizationOwner;
  const canDeleteSelectedOrganization = Boolean(selectedOrganization?.status === 'rejected' && isOrganizationOwner);
  const canLeaveSelectedOrganization = Boolean(
    selectedOrganization?.status === 'active' && selectedOrganization.ownerUserId !== currentUserId,
  );
  const availableMemberRoleOptions = isOrganizationOwner
    ? memberRoleOptions
    : memberRoleOptions.filter((role) => role.key !== 'admin');

  const loadOrganizations = useCallback(async (options: { preserveSelection?: boolean; preferredId?: string } = {}) => {
    const { preserveSelection = true, preferredId } = options;
    setLoading(true);
    try {
      const data = await requestJson<{ organizations: Organization[]; invitations?: PendingInvitation[]; canCreateOrganization?: boolean }>('/api/organizations', { cache: 'no-store' });
      setOrganizations(data.organizations || []);
      setPendingInvitations(data.invitations || []);
      setCanCreateOrganization(data.canCreateOrganization === true);
      const fallbackId = preserveSelection ? selectedIdRef.current : '';
      const currentId = preferredId || fallbackId;
      const nextId = currentId && data.organizations.some((organization) => organization.id === currentId)
        ? currentId
        : data.organizations[0]?.id || '';
      setSelectedId(nextId);
      setMessage(null);
      return nextId;
    } catch (error) {
      const apiError = error as ApiError;
      setMessage({ type: 'error', text: apiError.status === 401 ? '请先登录后管理组织。' : apiError.message });
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetails = useCallback(async (organizationId: string) => {
    const sequence = ++detailSequence.current;
    setDetailLoading(true);
    setMembers([]);
    setApprovals([]);
    try {
      if (canAccessMemberManagement) {
        const membersResponse = await requestJson<{ members: Member[] }>(`/api/organizations/${organizationId}/members`, { cache: 'no-store' });
        if (sequence !== detailSequence.current) return;
        setMembers(membersResponse.members || []);
      }
      if (canReviewApprovals) {
        const approvalsResponse = await requestJson<{ approvals: Approval[] }>(`/api/organizations/${organizationId}/approvals`, { cache: 'no-store' });
        if (sequence !== detailSequence.current) return;
        setApprovals(approvalsResponse.approvals || []);
      }
    } catch (error) {
      if (sequence !== detailSequence.current) return;
      const apiError = error as ApiError;
      setMessage({ type: 'error', text: apiError.message });
    } finally {
      if (sequence === detailSequence.current) setDetailLoading(false);
    }
  }, [canAccessMemberManagement, canReviewApprovals]);

  const closeStepUp = useCallback(() => {
    pendingActionRef.current = null;
    setStepUpOpen(false);
  }, []);

  const closeLeaveConfirmation = useCallback(() => {
    if (saving) return;
    setLeaveConfirmOpen(false);
  }, [saving]);

  const closeDeleteConfirmation = useCallback(() => {
    if (saving) return;
    setDeleteConfirmOpen(false);
  }, [saving]);

  const runAction = async (action: (stepUpToken?: string) => Promise<string | void>, successText: string | (() => string), stepUpToken?: string) => {
    setSaving(true);
    try {
      const preferredId = (await action(stepUpToken)) || undefined;
      const effectiveId = await loadOrganizations({ preferredId });
      if (effectiveId) await loadDetails(effectiveId);
      setMessage({ type: 'success', text: typeof successText === 'function' ? successText() : successText });
    } catch (error) {
      const apiError = error as ApiError;
      if (isMfaRequiredError(apiError)) {
        pendingActionRef.current = (token) => runAction(action, successText, token);
        setStepUpOpen(true);
        return;
      }
      setMessage({ type: 'error', text: apiError.message || '操作失败' });
    } finally {
      setSaving(false);
    }
  };


  useEffect(() => {
    if (sessionStatus === 'authenticated') void loadOrganizations({ preserveSelection: false });
  }, [loadOrganizations, sessionStatus]);

  useEffect(() => {
    if (selectedId && selectedOrganization?.status === 'active') {
      void loadDetails(selectedId);
    } else {
      detailSequence.current += 1;
      setMembers([]);
      setApprovals([]);
      setDetailLoading(false);
    }
  }, [loadDetails, selectedId, selectedOrganization?.status]);

  useEffect(() => {
    if (!stepUpOpen && !leaveConfirmOpen && !deleteConfirmOpen && !createDialogOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || saving) return;
      if (stepUpOpen) closeStepUp();
      else if (leaveConfirmOpen) closeLeaveConfirmation();
      else if (deleteConfirmOpen) closeDeleteConfirmation();
      else setCreateDialogOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [closeDeleteConfirmation, closeLeaveConfirmation, closeStepUp, createDialogOpen, deleteConfirmOpen, leaveConfirmOpen, saving, stepUpOpen]);

  const createOrganization = async () => {
    const name = newName.trim();
    if (!name) {
      setMessage({ type: 'error', text: '请输入组织名称。' });
      return;
    }
    await runAction(async () => {
      const data = await requestJson<{ organization: Organization }>('/api/organizations', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      setNewName('');
      setSelectedId(data.organization.id);
      setOrganizationCreated(true);
      setCreateDialogOpen(false);
      return data.organization.id;
    }, '组织申请已提交，等待平台管理员审核。');
  };

  const updateProfile = async () => {
    const name = profileName.trim();
    if (!name) {
      setMessage({ type: 'error', text: '请输入组织名称。' });
      return;
    }
    await runAction(async () => {
      await requestJson(`/api/organizations/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
      setProfileEditing(false);
      return selectedId;
    }, '组织名称修改已提交，等待平台管理员重新审核。');
  };

  const openMemberPermissions = (member: Member) => {
    setPermissionEditingMemberId(member.id);
    setPermissionDrafts((current) => ({ ...current, [member.id]: [...(member.permissions || [])] }));
  };

  const saveMemberPermissions = async (memberId: string, stepUpToken?: string) => {
    await runAction(async (token) => {
      await requestJson(`/api/organizations/${selectedId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: permissionDrafts[memberId] || [], ...(token ? { stepUpToken: token } : {}) }),
      });
      setPermissionEditingMemberId(null);
      return selectedId;
    }, '成员权限已更新。', stepUpToken);
  };

  const deleteSelectedOrganization = async () => {
    if (!selectedOrganization || !canDeleteSelectedOrganization) return;
    await runAction(async () => {
      await requestJson(`/api/organizations/${selectedOrganization.id}`, { method: 'DELETE' });
      setDeleteConfirmOpen(false);
      setSelectedId('');
      setOrganizationCreated(false);
    }, '组织已删除。');
  };

  const inviteMember = async () => {
    await runAction(async () => {
      await requestJson(`/api/organizations/${selectedId}/members`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setInviteEmail('');
    }, '邀请已发送，等待成员本人确认加入。');
  };

  const acceptInvitation = async (organizationId: string) => {
    await runAction(async () => {
      const data = await requestJson<{ invitation: { organizationId: string } }>(`/api/organizations/${organizationId}/invitations/accept`, {
        method: 'POST',
      });
      return data.invitation.organizationId;
    }, '已确认加入组织。');
  };

  const leaveSelectedOrganization = async () => {
    if (!selectedId) return;
    setLeaveConfirmOpen(false);
    await runAction(async () => {
      await requestJson(`/api/organizations/${selectedId}/leave`, { method: 'POST' });
    }, '退出申请已提交，等待组织所有者审核。');
  };

  const requestRoleChange = async (memberId: string, stepUpToken?: string) => {
    const role = roleDrafts[memberId];
    if (!role) return;
    let appliedImmediately = false;
    await runAction(async (token) => {
      const data = await requestJson<{ request?: { applied?: boolean } }>(`/api/organizations/${selectedId}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role, ...(token ? { stepUpToken: token } : {}) }),
      });
      appliedImmediately = data.request?.applied === true;
      setPermissionDrafts((current) => {
        const next = { ...current };
        delete next[memberId];
        return next;
      });
    }, () => appliedImmediately ? '角色已更新，默认权限已同步。' : '角色变更已提交，等待审批。', stepUpToken);
  };

  const changeRoleDraft = (memberId: string, role: Exclude<RoleKey, 'owner'>) => {
    setRoleDrafts((current) => ({ ...current, [memberId]: role }));
    setPermissionDrafts((current) => ({ ...current, [memberId]: ROLE_PERMISSIONS[role].filter((permission) => memberPermissionKeys.has(permission)) }));
  };

  const reviewApproval = async (approvalId: string, action: 'approve' | 'reject') => {
    await runAction(async () => {
      await requestJson(`/api/organizations/${selectedId}/approvals/${approvalId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      });
    }, action === 'approve' ? '审批已通过。' : '审批已拒绝。');
  };

  if (sessionStatus === 'loading') {
    return <div className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-6 text-sm ${uiSurfaces.mutedText}`}>正在读取组织信息…</div>;
  }

  if (sessionStatus === 'unauthenticated') {
    return (
      <section className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-6`}>
        <p className={`text-sm ${uiSurfaces.mutedText}`}>登录后可管理组织。</p>
        <Link href="/login" className={`${uiSurfaces.primaryButton} mt-4 inline-flex`}>前往登录</Link>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {message && (
        <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-[var(--brand-color-success-border)] bg-[var(--brand-color-success-bg)] text-[var(--brand-color-success-text)]' : 'border-[var(--brand-color-error-border)] bg-[var(--brand-color-error-bg)] text-[var(--brand-color-error-text)]'}`} role="status">
          {message.type === 'success' ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertCircle size={18} className="mt-0.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}

      {pendingInvitations.length > 0 && (
        <section className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-5`}>
          <div className="flex items-start gap-3">
            <Mail className={uiSurfaces.textInteractive} size={22} aria-hidden="true" />
            <div>
              <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>待确认的组织邀请</h2>
              <p className={`mt-1 text-sm ${uiSurfaces.mutedText}`}>确认后加入组织，获得邀请中指定的角色。</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            {pendingInvitations.map((invitation) => (
              <div key={invitation.id} className={`flex flex-col gap-3 rounded-xl border ${uiSurfaces.border} ${uiSurfaces.toolbar} p-4 sm:flex-row sm:items-center sm:justify-between`}>
                <div>
                  <p className={`text-sm font-medium ${uiSurfaces.titleText}`}>{invitation.organizationName}</p>
                  <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>邀请角色：{invitation.requestedRole ? roleLabels[invitation.requestedRole as RoleKey] || invitation.requestedRole : '—'} · {formatDate(invitation.invitedAt)}</p>
                </div>
                <button type="button" onClick={() => void acceptInvitation(invitation.organizationId)} disabled={saving} className={`${uiSurfaces.primaryButton} shrink-0 text-xs`}>确认加入</button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Building2 className={uiSurfaces.textInteractive} size={22} aria-hidden="true" />
            <div>
              <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>我的组织</h2>
              <p className={`mt-1 text-sm ${uiSurfaces.mutedText}`}>组织通过平台审核后，所有者和审计员可管理成员。</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {canCreateOrganizationEntry ? (
              <button type="button" onClick={() => setCreateDialogOpen(true)} className={`${uiSurfaces.primaryButton} inline-flex items-center gap-2 text-xs`}>
                <Plus size={15} />创建组织
              </button>
            ) : !canCreateOrganization && <span className={`${uiSurfaces.badgeWarning} shrink-0`}>当前账户未获得创建权限</span>}
            {canLeaveSelectedOrganization && <button type="button" onClick={() => setLeaveConfirmOpen(true)} disabled={saving} className={`${uiSurfaces.buttonDanger} text-xs`}>退出组织</button>}
            {canEditProfile && <button type="button" onClick={() => setProfileEditing(true)} className={`${uiSurfaces.buttonGhost} text-xs`}>编辑资料</button>}
            {selectedOrganization?.status === 'active' && canReadRecords && selectedId && (
              <Link href={`/account/organizations/history?organizationId=${encodeURIComponent(selectedId)}`} className={`${uiSurfaces.buttonGhost} text-xs`}>组织历史</Link>
            )}
            <button type="button" onClick={() => void (async () => {
              const effectiveId = await loadOrganizations();
              if (effectiveId) await loadDetails(effectiveId);
            })()} className={`${uiSurfaces.buttonGhost} inline-flex items-center gap-2 text-sm`} disabled={loading}>
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />刷新
            </button>
          </div>
        </div>

        {loading ? (
          <p className={`mt-5 text-sm ${uiSurfaces.mutedText}`}>正在读取组织列表…</p>
        ) : organizations.length > 0 ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {organizations.map((organization) => (
              <div
                key={organization.id}
                className={`rounded-xl border p-4 transition ${selectedId === organization.id ? 'border-[var(--brand-color-primary)] bg-[var(--brand-color-primary-light)]' : `${uiSurfaces.border} ${uiSurfaces.toolbar}`}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(organization.id)}
                    className={`min-w-0 flex-1 text-left ${uiSurfaces.focusRing}`}
                  >
                    <span className={`font-medium ${uiSurfaces.titleText}`}>{organization.name}</span>
                    <p className={`mt-2 text-xs ${uiSurfaces.mutedText}`}>{organization.roles.map((role) => role.name).join('、')}</p>
                  </button>
                  <span className={`${organization.status === 'active' ? uiSurfaces.badgeSuccess : uiSurfaces.badgeWarning} shrink-0`}>{statusLabel(organization.status)}</span>
                </div>
                {organization.status === 'rejected' && organization.ownerUserId === currentUserId && (
                  <div className={`mt-3 flex justify-end border-t pt-3 ${uiSurfaces.border}`}>
                    <button
                      type="button"
                      onClick={() => { setSelectedId(organization.id); setDeleteConfirmOpen(true); }}
                      disabled={saving}
                      className={`${uiSurfaces.buttonDanger} text-xs`}
                    >
                      删除组织
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className={`mt-5 rounded-xl border border-dashed ${uiSurfaces.border} px-4 py-5 text-sm ${uiSurfaces.mutedText}`}>当前账户还没有组织。</div>
        )}

        {selectedOrganization?.status === 'active' && (canAccessMemberManagement || canReadRecords) && (
          <nav className={`mt-5 grid gap-2 border-t pt-5 sm:grid-cols-3 ${uiSurfaces.border}`} aria-label="组织管理功能">
            {canAccessMemberManagement && <a href="#organization-members" className={`rounded-xl border p-3 transition hover:border-[var(--brand-color-primary)] ${uiSurfaces.border} ${uiSurfaces.toolbar}`}>
              <span className={`block text-sm font-semibold ${uiSurfaces.titleText}`}>成员管理</span>
              <span className={`mt-1 block text-xs ${uiSurfaces.mutedText}`}>邀请成员、调整角色、处理审批</span>
            </a>}
            {canReadRecords && <Link href={`/account/organizations/history?organizationId=${encodeURIComponent(selectedId)}&view=orders`} className={`rounded-xl border p-3 transition hover:border-[var(--brand-color-primary)] ${uiSurfaces.border} ${uiSurfaces.toolbar}`}>
              <span className={`block text-sm font-semibold ${uiSurfaces.titleText}`}>订单记录</span>
              <span className={`mt-1 block text-xs ${uiSurfaces.mutedText}`}>查看组织采购和积分抵扣</span>
            </Link>}
            {canReadRecords && <Link href={`/account/organizations/history?organizationId=${encodeURIComponent(selectedId)}&view=payables`} className={`rounded-xl border p-3 transition hover:border-[var(--brand-color-primary)] ${uiSurfaces.border} ${uiSurfaces.toolbar}`}>
              <span className={`block text-sm font-semibold ${uiSurfaces.titleText}`}>应付款记录</span>
              <span className={`mt-1 block text-xs ${uiSurfaces.mutedText}`}>查看账期、到期日和回款状态</span>
            </Link>}
          </nav>
        )}

        {profileEditing && canEditProfile && (
          <form className={`mt-4 flex flex-col gap-2 rounded-xl border p-4 sm:flex-row sm:items-end ${uiSurfaces.border} ${uiSurfaces.toolbar}`} onSubmit={(event) => { event.preventDefault(); void updateProfile(); }}>
            <div className="min-w-0 flex-1">
              <label className={`block text-xs font-medium ${uiSurfaces.textSecondary}`} htmlFor="organization-profile-name">组织名称</label>
              <input id="organization-profile-name" value={profileName} onChange={(event) => setProfileName(event.target.value)} maxLength={100} className={`${uiSurfaces.inputDefault} mt-1 w-full`} />
              <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>修改后需要平台重新审核。</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => { setProfileName(selectedOrganization?.name || ''); setProfileEditing(false); }} disabled={saving} className={`${uiSurfaces.buttonSecondary} text-xs`}>取消</button>
              <button type="submit" disabled={saving || !selectedOrganization || profileName.trim() === selectedOrganization.name} className={`${uiSurfaces.primaryButton} text-xs`}>保存修改</button>
            </div>
          </form>
        )}
      </section>

      {selectedOrganization && selectedOrganization.status !== 'active' && (
        <section className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-5`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>{selectedOrganization.name}</h2>
              <p className={`mt-2 text-sm ${uiSurfaces.mutedText}`}>
                {selectedOrganization.status === 'pending'
                  ? '组织申请已提交，等待平台管理员审核。审核完成前无法自行删除，审核通过后成员管理和组织业务功能会开放。'
                  : selectedOrganization.status === 'pending_reapproval'
                    ? '组织名称修改已提交，等待平台管理员重新审核。审核完成前无法自行删除，组织业务功能暂时停用。'
                    : '组织申请未通过平台审核，当前组织功能不可用。删除后可以重新提交组织申请。'}
              </p>
            </div>
          </div>
        </section>
      )}

      {selectedOrganization?.status === 'active' && (
        <>
          {canAccessMemberManagement && <section id="organization-members" className={`scroll-mt-24 rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <Users className={uiSurfaces.textInteractive} size={22} aria-hidden="true" />
                <div>
                  <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>{selectedOrganization.name} · 成员</h2>
                  {canManageMemberSettings && <p className={`mt-1 text-sm ${uiSurfaces.mutedText}`}>所有者和具备成员管理权限的成员可调整下级成员权限。</p>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canInvite && <span className={`${uiSurfaces.badgeInfo} shrink-0`}>可管理成员</span>}
              </div>
            </div>

            {canInvite && (
              <form className={`mt-5 grid gap-2 border-b pb-5 sm:grid-cols-[1fr_180px_auto] ${uiSurfaces.border}`} onSubmit={(event) => { event.preventDefault(); void inviteMember(); }}>
                <label className="sr-only" htmlFor="invite-email">成员邮箱</label>
                <div className="relative">
                  <Mail className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${uiSurfaces.textQuaternary}`} size={16} />
                  <input id="invite-email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="成员邮箱" type="email" className={`${uiSurfaces.inputDefault} pl-9`} />
                </div>
                <label className="sr-only" htmlFor="invite-role">成员角色</label>
                <select id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as Exclude<RoleKey, 'owner'>)} className={uiSurfaces.inputDefault}>
                  {availableMemberRoleOptions.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
                </select>
                <button type="submit" disabled={saving || !inviteEmail.trim()} className={`${uiSurfaces.primaryButton} inline-flex items-center justify-center gap-2`}><Plus size={16} />邀请成员</button>
              </form>
            )}

            {detailLoading ? <p className={`mt-5 text-sm ${uiSurfaces.mutedText}`}>正在读取成员信息…</p> : members.length > 0 ? (
              <div className="mt-5 space-y-3">
                {members.map((member) => {
                  const memberRole = member.roles[0]?.key || member.pendingRole || '';
                  const isOwner = memberRole === 'owner' || member.userId === selectedOrganization.ownerUserId;
                  const isCurrentUser = member.userId === currentUserId;
                  const roleText = member.roles.map((role) => role.name).join('、') || (member.pendingRole ? roleLabels[member.pendingRole as RoleKey] || member.pendingRole : '未分配角色');
                  return (
                    <div key={member.id} className={`rounded-xl border ${uiSurfaces.border} ${uiSurfaces.toolbar} p-4`}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-medium ${uiSurfaces.titleText}`}>{member.name || member.email}</p>
                          <p className={`mt-1 truncate text-xs ${uiSurfaces.mutedText}`}>{member.email} · {memberStatusLabel(member.status)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={memberRole === 'owner' ? uiSurfaces.badgeWarning : uiSurfaces.badgeInfo}>身份：{roleText}</span>
                          {canManageMemberSettings && !isOwner && member.status === 'active' && (
                            <>
                              {canRequestRoleChange && (
                                <>
                                    <select aria-label={`${member.email} 的新角色`} value={roleDrafts[member.id] || defaultRoleForMember(memberRole)} onChange={(event) => changeRoleDraft(member.id, event.target.value as Exclude<RoleKey, 'owner'>)} className={`${uiSurfaces.inputCompact} w-32`}>
                                    {availableMemberRoleOptions.map((role) => <option key={role.key} value={role.key}>{role.label}</option>)}
                                  </select>
                                  <button type="button" onClick={() => void requestRoleChange(member.id)} disabled={saving || (roleDrafts[member.id] || defaultRoleForMember(memberRole)) === memberRole} className={`${uiSurfaces.buttonSecondary} text-xs`}>{isOrganizationOwner ? '修改角色' : '申请变更'}</button>
                                </>
                              )}
                              <button type="button" onClick={() => permissionEditingMemberId === member.id ? setPermissionEditingMemberId(null) : openMemberPermissions(member)} disabled={saving} className={`${uiSurfaces.buttonSecondary} text-xs`}>
                                {permissionEditingMemberId === member.id ? '收起权限' : '权限设置'}
                              </button>
                            </>
                          )}
                          {isCurrentUser && member.status === 'active' && isOwner && (
                            <span className={`${uiSurfaces.badgeWarning} shrink-0`}>所有者不能退出</span>
                          )}
                        </div>
                      </div>
                      <p className={`mt-2 text-xs ${uiSurfaces.mutedText}`}>{member.status === 'pending' ? '邀请时间' : '加入时间'}：{formatDate(member.status === 'pending' ? member.createdAt : member.joinedAt)}</p>
                      {member.status === 'pending' && <p className={`mt-1 break-all text-xs ${uiSurfaces.mutedText}`}>邀请 ID：{member.id}</p>}
                      {permissionEditingMemberId === member.id && canManageMemberSettings && (
                        <div className={`mt-4 rounded-xl border p-4 ${uiSurfaces.border} ${uiSurfaces.panel}`}>
                          <p className={`text-sm font-semibold ${uiSurfaces.titleText}`}>成员权限</p>
                          <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>在成员角色权限基础上增加或减少权限。角色管理和组织资料编辑仍由所有者控制。</p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {memberPermissionOptions.map((permission) => {
                              const checked = (permissionDrafts[member.id] || member.permissions || []).includes(permission.key);
                              return (
                                <label key={permission.key} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${uiSurfaces.border}`}>
                                  <input type="checkbox" checked={checked} onChange={(event) => setPermissionDrafts((current) => ({
                                    ...current,
                                    [member.id]: event.target.checked
                                      ? [...(current[member.id] || member.permissions || []), permission.key]
                                      : (current[member.id] || member.permissions || []).filter((item) => item !== permission.key),
                                  }))} className="rounded border-gray-300 text-brand-600 focus:ring-brand-500" />
                                  {permission.label}
                                </label>
                              );
                            })}
                          </div>
                          <div className="mt-4 flex justify-end">
                            <button type="button" onClick={() => void saveMemberPermissions(member.id)} disabled={saving} className={`${uiSurfaces.primaryButton} text-xs`}>保存权限</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={`mt-5 text-sm ${uiSurfaces.mutedText}`}>暂无可显示的成员。</p>
            )}
          </section>}

          {canReviewApprovals && (
            <section className={`rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-5`}>
              <div className="flex items-start gap-3">
                <Clock3 className={uiSurfaces.textInteractive} size={22} aria-hidden="true" />
                <div>
                  <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>待处理审批</h2>
                  <p className={`mt-1 text-sm ${uiSurfaces.mutedText}`}>角色变更和成员退出需要组织审批，成员邀请由受邀成员本人确认。</p>
                </div>
              </div>
              {detailLoading ? (
                <p className={`mt-5 text-sm ${uiSurfaces.mutedText}`}>正在读取审批信息…</p>
              ) : approvals.filter((approval) => approval.status === 'pending').length > 0 ? (
                <div className="mt-5 space-y-3">
                  {approvals.filter((approval) => approval.status === 'pending').map((approval) => {
                    const isOwnApproval = Boolean(currentUserId && approval.requester.id === currentUserId);
                    return (
                      <div key={approval.id} className={`rounded-xl border ${uiSurfaces.border} ${uiSurfaces.toolbar} p-4`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className={`text-sm font-medium ${uiSurfaces.titleText}`}>{approval.kind === 'member_exit' ? '成员退出' : '角色变更'} · {approval.member?.email || '成员资料不可用'}</p>
                            <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>{approval.kind === 'member_exit' ? '退出申请' : `申请角色：${approval.requestedRole ? roleLabels[approval.requestedRole as RoleKey] || approval.requestedRole : '—'}`} · 提交时间：{formatDate(approval.createdAt)}</p>
                          </div>
                          {!canReviewApprovals || isOwnApproval ? (
                            <span className={`${uiSurfaces.badgeInfo} shrink-0`}>等待组织所有者审批</span>
                          ) : (
                            <div className="flex shrink-0 gap-2">
                              <button type="button" onClick={() => void reviewApproval(approval.id, 'reject')} disabled={saving} className={`${uiSurfaces.buttonDanger} text-xs`}>拒绝</button>
                              <button type="button" onClick={() => void reviewApproval(approval.id, 'approve')} disabled={saving} className={`${uiSurfaces.primaryButton} text-xs`}>通过</button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className={`mt-5 text-sm ${uiSurfaces.mutedText}`}>暂无待处理审批。</p>
              )}
            </section>
          )}
        </>
      )}

      <SecurityStepUpDialog
        open={stepUpOpen}
        action={stepUpAction}
        title="验证后调整成员权限"
        description="修改成员权限前，需要再次确认身份。可使用验证器应用、手机短信或邮箱验证码。"
        onCancel={closeStepUp}
        onVerified={async (grantToken) => {
          const pending = pendingActionRef.current;
          pendingActionRef.current = null;
          setStepUpOpen(false);
          if (pending) await pending(grantToken);
        }}
      />

      {leaveConfirmOpen && canLeaveSelectedOrganization && (
        <div className={`fixed inset-0 z-site-overlay flex items-end justify-center overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(var(--site-header-height)+var(--site-header-gap)+1rem)] sm:items-center sm:p-6 ${uiSurfaces.modalBackdrop}`} role="presentation">
          <button type="button" aria-label="关闭退出组织确认窗口" className="absolute inset-0 cursor-default" onClick={closeLeaveConfirmation} />
          <div className={`relative z-10 w-full max-w-md overflow-hidden rounded-t-[var(--brand-border-radius-lg)] sm:rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.modal}`} role="dialog" aria-modal="true" aria-labelledby="organization-leave-title" aria-describedby="organization-leave-description">
            <div className="flex items-start gap-3 border-b border-[var(--brand-color-border)] px-5 py-4 sm:px-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--brand-border-radius)] bg-[var(--brand-color-warning-bg)] text-[var(--brand-color-warning-text)]" aria-hidden="true">
                <AlertCircle size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="organization-leave-title" className={`text-base font-semibold ${uiSurfaces.titleText}`}>退出组织</h2>
                <p id="organization-leave-description" className={`mt-2 text-sm leading-6 ${uiSurfaces.textSecondary}`}>提交后等待组织所有者审核。审核通过后将失去该组织的访问权限，组织采购、应付款、询价及其他组织记录仍归该组织所有。个人账户资料、个人配方和个人记录保持不变。</p>
              </div>
              <button type="button" onClick={closeLeaveConfirmation} disabled={saving} className={`rounded-full p-2 ${uiSurfaces.textSecondary} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing} disabled:cursor-not-allowed disabled:opacity-50`} aria-label="关闭退出组织确认窗口">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-col-reverse gap-2 px-5 py-5 sm:flex-row sm:justify-end sm:px-6 sm:py-6">
              <button type="button" onClick={closeLeaveConfirmation} disabled={saving} className={`w-full sm:w-auto ${uiSurfaces.button} disabled:cursor-not-allowed disabled:opacity-60`}>取消</button>
              <button type="button" onClick={() => void leaveSelectedOrganization()} disabled={saving} className={`w-full sm:w-auto ${uiSurfaces.buttonDanger} disabled:cursor-not-allowed disabled:opacity-60`}>{saving ? '处理中…' : '确认退出组织'}</button>
            </div>
          </div>
        </div>
      )}

      {createDialogOpen && canCreateOrganization && !stepUpOpen && (
        <div className={`fixed inset-0 z-site-overlay flex items-end justify-center overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(var(--site-header-height)+var(--site-header-gap)+1rem)] sm:items-center sm:p-6 ${uiSurfaces.modalBackdrop}`} role="presentation">
          <button type="button" aria-label="关闭创建组织窗口" className="absolute inset-0 cursor-default" onClick={() => { if (!saving) setCreateDialogOpen(false); }} />
          <div className={`relative z-10 w-full max-w-md overflow-hidden rounded-t-[var(--brand-border-radius-lg)] sm:rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.modal}`} role="dialog" aria-modal="true" aria-labelledby="organization-create-title" aria-describedby="organization-create-description">
            <div className="flex items-start gap-3 border-b border-[var(--brand-color-border)] px-5 py-4 sm:px-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--brand-border-radius)] bg-[var(--brand-color-success-bg)] text-[var(--brand-color-success-text)]" aria-hidden="true">
                <Building2 size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="organization-create-title" className={`text-base font-semibold ${uiSurfaces.titleText}`}>创建组织</h2>
                <p id="organization-create-description" className={`mt-1 text-sm leading-6 ${uiSurfaces.textSecondary}`}>创建后需要平台管理员审核，审核通过后开放组织功能。</p>
              </div>
              <button type="button" onClick={() => setCreateDialogOpen(false)} disabled={saving} className={`rounded-full p-2 ${uiSurfaces.textSecondary} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing} disabled:cursor-not-allowed disabled:opacity-50`} aria-label="关闭创建组织窗口">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <form className="px-5 py-5 sm:px-6 sm:py-6" onSubmit={(event) => { event.preventDefault(); void createOrganization(); }}>
              <label htmlFor="organization-name" className={`block text-sm font-semibold ${uiSurfaces.titleText}`}>组织名称</label>
              <input id="organization-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="输入组织名称" maxLength={100} autoFocus className={`${uiSurfaces.inputDefault} mt-2 w-full`} />
              <p className={`mt-2 text-xs ${uiSurfaces.mutedText}`}>提交后将进入平台审核，审核通过后即可使用。</p>
              <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={() => setCreateDialogOpen(false)} disabled={saving} className={`w-full sm:w-auto ${uiSurfaces.button} disabled:cursor-not-allowed disabled:opacity-60`}>取消</button>
                <button type="submit" disabled={saving} className={`w-full sm:w-auto ${uiSurfaces.primaryButton} inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60`}>
                  <Plus size={16} />{saving ? '提交中…' : '创建组织'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteConfirmOpen && canDeleteSelectedOrganization && (
        <div className={`fixed inset-0 z-site-overlay flex items-end justify-center overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(var(--site-header-height)+var(--site-header-gap)+1rem)] sm:items-center sm:p-6 ${uiSurfaces.modalBackdrop}`} role="presentation">
          <button type="button" aria-label="关闭删除组织确认窗口" className="absolute inset-0 cursor-default" onClick={closeDeleteConfirmation} />
          <div className={`relative z-10 w-full max-w-md overflow-hidden rounded-t-[var(--brand-border-radius-lg)] sm:rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.modal}`} role="dialog" aria-modal="true" aria-labelledby="organization-delete-title" aria-describedby="organization-delete-description">
            <div className="flex items-start gap-3 border-b border-[var(--brand-color-border)] px-5 py-4 sm:px-6">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--brand-border-radius)] bg-[var(--brand-color-warning-bg)] text-[var(--brand-color-warning-text)]" aria-hidden="true">
                <Trash2 size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="organization-delete-title" className={`text-base font-semibold ${uiSurfaces.titleText}`}>删除组织</h2>
                <p id="organization-delete-description" className={`mt-2 text-sm leading-6 ${uiSurfaces.textSecondary}`}>删除后组织成员、角色和申请记录将一并移除，操作无法恢复。个人账户资料不会受到影响。</p>
              </div>
              <button type="button" onClick={closeDeleteConfirmation} disabled={saving} className={`rounded-full p-2 ${uiSurfaces.textSecondary} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing} disabled:cursor-not-allowed disabled:opacity-50`} aria-label="关闭删除组织确认窗口">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="flex flex-col-reverse gap-2 px-5 py-5 sm:flex-row sm:justify-end sm:px-6 sm:py-6">
              <button type="button" onClick={closeDeleteConfirmation} disabled={saving} className={`w-full sm:w-auto ${uiSurfaces.button} disabled:cursor-not-allowed disabled:opacity-60`}>取消</button>
              <button type="button" onClick={() => void deleteSelectedOrganization()} disabled={saving} className={`w-full sm:w-auto ${uiSurfaces.buttonDanger} disabled:cursor-not-allowed disabled:opacity-60`}>{saving ? '删除中…' : '确认删除'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
