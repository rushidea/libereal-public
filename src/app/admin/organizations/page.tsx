'use client';

import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { uiSurfaces } from '@/lib/ui-surfaces';

type PendingOrganization = {
  id: string;
  name: string;
  status: 'pending' | 'pending_reapproval' | string;
  createdAt: string;
  owner: { email: string; name: string | null };
  memberCount: number;
  pendingName: string | null;
};

type CreationGrant = {
  userId: string;
  email: string;
  name: string | null;
  grantedAt: string;
  grantedBy: { id: string; email: string; name: string | null } | null;
};

type CreationCandidate = { id: string; email: string; name: string | null };

function statusLabel(status: string) {
  return status === 'pending_reapproval' ? '资料待复核' : '待审核';
}

export default function AdminOrganizationsPage() {
  const [organizations, setOrganizations] = useState<PendingOrganization[]>([]);
  const [creationGrants, setCreationGrants] = useState<CreationGrant[]>([]);
  const [creationSearch, setCreationSearch] = useState('');
  const [creationSearchResults, setCreationSearchResults] = useState<CreationCandidate[]>([]);
  const [selectedCreationUserId, setSelectedCreationUserId] = useState('');
  const [canManageCreation, setCanManageCreation] = useState(false);
  const [creationSaving, setCreationSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processingId, setProcessingId] = useState<string | null>(null);

  const loadOrganizations = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/admin/organizations', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '组织审核列表暂时不可用');
      setOrganizations(Array.isArray(data.organizations) ? data.organizations : []);
      setCreationGrants(Array.isArray(data.organizationCreationGrants) ? data.organizationCreationGrants : []);
      setCreationSearchResults(Array.isArray(data.organizationCreationCandidates) ? data.organizationCreationCandidates : []);
      setCanManageCreation(data.canManageOrganizationCreation === true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '组织审核列表暂时不可用');
    } finally {
      setLoading(false);
    }
  };

  const updateCreationAccess = async (userId: string, allowed: boolean) => {
    setCreationSaving(true);
    setError('');
    try {
      const response = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, allowed }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '组织创建权限保存失败');
      await loadOrganizations();
      setSelectedCreationUserId('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '组织创建权限保存失败');
    } finally {
      setCreationSaving(false);
    }
  };

  useEffect(() => {
    void loadOrganizations();
  }, []);

  useEffect(() => {
    if (!canManageCreation) return;
    const query = creationSearch.trim();
    if (query.length < 2) {
      setCreationSearchResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/organizations?q=${encodeURIComponent(query)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || '用户搜索失败');
        setCreationSearchResults(Array.isArray(data.organizationCreationCandidates) ? data.organizationCreationCandidates : []);
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : '用户搜索失败');
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canManageCreation, creationSearch]);

  const review = async (organization: PendingOrganization, action: 'approve' | 'reject') => {
    setProcessingId(organization.id);
    setError('');
    try {
      const response = await fetch(`/api/admin/organizations/${organization.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || '组织审核操作失败');
      setOrganizations((current) => current.filter((item) => item.id !== organization.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '组织审核操作失败');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className={`text-2xl font-bold ${uiSurfaces.titleText}`}>组织审核</h1>
        <p className={`mt-1 text-sm ${uiSurfaces.mutedText}`}>审核组织创建和组织资料变更。</p>
      </div>

      <section className={`rounded-brand border p-4 ${uiSurfaces.panel}`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>组织创建权限</h2>
            <p className={`mt-1 text-sm ${uiSurfaces.mutedText}`}>默认关闭，仅对指定账号开放组织创建入口；组织提交后仍需平台审核。</p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:items-end">
            <span className={creationGrants.length > 0 ? uiSurfaces.badgeSuccess : uiSurfaces.badgeWarning}>{creationGrants.length > 0 ? `已授权 ${creationGrants.length} 个账号` : '暂无授权账号'}</span>
            {canManageCreation && (
              <>
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
                  <input
                    value={creationSearch}
                    onChange={(event) => {
                      setCreationSearch(event.target.value);
                      setSelectedCreationUserId('');
                    }}
                    placeholder="搜索邮箱、姓名或用户编号"
                    disabled={creationSaving}
                    className={`min-h-10 w-full min-w-0 rounded-brand border px-3 text-sm sm:w-72 ${uiSurfaces.input}`}
                    aria-label="搜索组织创建授权账号"
                  />
                  <button type="button" onClick={() => void updateCreationAccess(selectedCreationUserId, true)} disabled={creationSaving || !selectedCreationUserId} className={`${uiSurfaces.primaryButton} text-xs`}>
                    {creationSaving ? '保存中…' : '授权创建'}
                  </button>
                </div>
                {creationSearch.trim().length >= 2 && (
                  <div className={`mt-2 w-full max-w-xl rounded-brand border p-2 ${uiSurfaces.toolbar}`}>
                    {creationSearchResults.filter((candidate) => !creationGrants.some((grant) => grant.userId === candidate.id)).length > 0 ? (
                      <div className="space-y-1">
                        {creationSearchResults.filter((candidate) => !creationGrants.some((grant) => grant.userId === candidate.id)).map((candidate) => (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() => setSelectedCreationUserId(candidate.id)}
                            className={`flex w-full items-start justify-between gap-3 rounded-brand px-3 py-2 text-left text-sm ${selectedCreationUserId === candidate.id ? 'bg-brand-100 text-brand-900' : `${uiSurfaces.text} hover:bg-[var(--surface-hover)]`}`}
                          >
                            <span className="min-w-0 truncate">{candidate.name ? `${candidate.name} · ` : ''}{candidate.email}</span>
                            <span className="shrink-0 text-xs opacity-70">选择</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className={`px-3 py-2 text-sm ${uiSurfaces.mutedText}`}>没有匹配的用户。</p>
                    )}
                  </div>
                )}
                {selectedCreationUserId && (
                  <p className={`mt-2 text-xs ${uiSurfaces.mutedText}`}>已选择：{creationSearchResults.find((candidate) => candidate.id === selectedCreationUserId)?.email || selectedCreationUserId}</p>
                )}
              </>
            )}
          </div>
        </div>
        {creationGrants.length > 0 && (
          <div className="mt-4 space-y-2 border-t pt-4">
            {creationGrants.map((grant) => (
              <div key={grant.userId} className={`flex flex-wrap items-center justify-between gap-2 rounded-brand border px-3 py-2 text-sm ${uiSurfaces.toolbar}`}>
                <span className={uiSurfaces.text}>{grant.name ? `${grant.name} · ` : ''}{grant.email}</span>
                {canManageCreation && <button type="button" onClick={() => void updateCreationAccess(grant.userId, false)} disabled={creationSaving} className={`${uiSurfaces.buttonDanger} text-xs`}>撤销授权</button>}
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <div className="rounded-brand border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}
      {loading ? (
        <div className={`rounded-brand border p-6 text-sm ${uiSurfaces.panel} ${uiSurfaces.mutedText}`}>正在加载组织审核列表…</div>
      ) : organizations.length === 0 ? (
        <div className={`rounded-brand border p-6 text-sm ${uiSurfaces.panel} ${uiSurfaces.mutedText}`}>当前没有待审核组织。</div>
      ) : (
        <div className="space-y-3">
          {organizations.map((organization) => {
            const processing = processingId === organization.id;
            const isReapproval = organization.status === 'pending_reapproval';
            return (
              <section key={organization.id} className={`rounded-brand border p-4 ${uiSurfaces.panel}`}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className={`text-base font-semibold ${uiSurfaces.titleText}`}>{organization.name}</h2>
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{statusLabel(organization.status)}</span>
                    </div>
                    {isReapproval && organization.pendingName && (
                      <p className={`text-sm ${uiSurfaces.text}`}>拟修改名称：{organization.pendingName}</p>
                    )}
                    <p className={`text-sm ${uiSurfaces.mutedText}`}>
                      所有者：{organization.owner.name || '未设置'} · {organization.owner.email}
                    </p>
                    <p className={`text-xs ${uiSurfaces.mutedText}`}>
                      创建于 {new Date(organization.createdAt).toLocaleString('zh-CN')} · 当前成员 {organization.memberCount} 人
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      disabled={processing}
                      onClick={() => void review(organization, 'approve')}
                      className={`inline-flex min-h-10 items-center gap-1.5 rounded-brand bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50 ${uiSurfaces.focusRing}`}
                    >
                      <Check size={15} />
                      通过
                    </button>
                    <button
                      type="button"
                      disabled={processing}
                      onClick={() => void review(organization, 'reject')}
                      className={`inline-flex min-h-10 items-center gap-1.5 rounded-brand border px-3 text-sm font-medium ${uiSurfaces.text} ${uiSurfaces.panel} hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${uiSurfaces.focusRing}`}
                    >
                      <X size={15} />
                      {isReapproval ? '拒绝修改' : '拒绝'}
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}

    </div>
  );
}
