'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users, Plus, Archive, Check, X, Search } from 'lucide-react';
import { formatPoints, POINTS_LOG_TYPE_LABELS, type PointsLogType } from '@/lib/points';
import { adminSurfaceClasses } from '@/lib/admin-surfaces';
import { isAdminMfaStepUpResponse, useAdminMfaStepUp } from '@/components/admin/AdminMfaStepUpDialog';

type Member = {
  id: string;
  role: string;
  user: { id: string; email: string; name: string | null };
};

type Group = {
  id: string;
  name: string;
  points: number;
  status: string;
  locked: boolean;
  memberCount: number;
  members: Member[];
  createdAt: string;
  reviewedByEmail?: string | null;
};

type GroupLog = {
  id: string;
  delta: number;
  type: string;
  reason: string | null;
  relatedId: string | null;
  organizationName: string | null;
  actorName: string | null;
  createdAt: string;
};

type UserHit = {
  id: string;
  name: string | null;
  email: string;
  points: number;
};

function statusLabel(g: Group) {
  if (g.status === 'pending') return '待审核';
  if (g.status === 'archived') return '已归档';
  if (g.locked) return '已锁定';
  return '正常';
}

function UserSearchField({
  label,
  placeholder,
  onSelect,
  excludeIds,
}: {
  label: string;
  placeholder: string;
  onSelect: (user: UserHit) => void | Promise<void>;
  excludeIds?: ReadonlySet<string>;
}) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<UserHit[]>([]);
  const [selectedLabel, setSelectedLabel] = useState('');
  const excludeKey = excludeIds ? [...excludeIds].sort().join(',') : '';

  useEffect(() => {
    if (query.trim().length < 2) return;
    const excluded = new Set(excludeKey ? excludeKey.split(',') : []);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(query.trim())}&limit=8`);
          if (!res.ok) return;
          const data = await res.json();
          const users = (data.users || []) as UserHit[];
          setMatches(users.filter((u) => !excluded.has(u.id)));
        } catch {
          setMatches([]);
        }
      })();
    }, 200);
    return () => clearTimeout(timer);
  }, [query, excludeKey]);

  return (
    <div className="relative">
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={selectedLabel || query}
          onChange={(e) => {
            const nextQuery = e.target.value;
            setSelectedLabel('');
            setQuery(nextQuery);
            if (nextQuery.trim().length < 2) setMatches([]);
          }}
          placeholder={placeholder}
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900"
        />
      </div>
      {matches.length > 0 && !selectedLabel && (
        <div className={`absolute z-20 mt-1 max-h-48 w-full overflow-y-auto ${adminSurfaceClasses.panelStrong} rounded-brand shadow-[var(--shadow-panel)]`}>
          {matches.map((u) => (
            <button
              key={u.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => {
                void onSelect(u);
                setSelectedLabel(`${u.email}${u.name ? ` · ${u.name}` : ''}`);
                setQuery('');
                setMatches([]);
              }}
            >
              {u.email}{u.name ? ` · ${u.name}` : ''}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ResearchGroupsManager() {
  const { begin: beginMfaStepUp, dialog: mfaDialog } = useAdminMfaStepUp();
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [owner, setOwner] = useState<UserHit | null>(null);
  const [ownerKey, setOwnerKey] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [memberSearchKey, setMemberSearchKey] = useState(0);
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [groupLogs, setGroupLogs] = useState<Record<string, GroupLog[]>>({});
  const [logsLoading, setLogsLoading] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/research-groups');
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '加载失败');
        return;
      }
      setGroups(data.groups || []);
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  async function loadGroupLogs(id: string) {
    setLogsLoading(id);
    try {
      const res = await fetch(`/api/admin/research-groups/${encodeURIComponent(id)}/logs`, { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || '积分流水读取失败');
        return;
      }
      setGroupLogs((current) => ({ ...current, [id]: data.logs || [] }));
    } catch {
      setMessage('积分流水读取失败');
    } finally {
      setLogsLoading((current) => (current === id ? null : current));
    }
  }

  async function handleCreate() {
    setMessage('');
    if (!name.trim()) {
      setMessage('请填写课题组名称');
      return;
    }
    if (!owner) {
      setMessage('请搜索并选择负责人');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/admin/research-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ownerUserId: owner.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error || '创建失败');
        return;
      }
      setName('');
      setOwner(null);
      setOwnerKey((k) => k + 1);
      setMessage(`已创建并锁定「${data.name}」，可在下方搜索添加成员`);
      setExpandedId(data.id);
      await fetchGroups();
    } catch {
      setMessage('网络错误');
    } finally {
      setCreating(false);
    }
  }

  async function patchGroup(id: string, body: Record<string, unknown>, allowMfaStepUp = true): Promise<boolean> {
    setMessage('');
    const res = await fetch(`/api/admin/research-groups/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (allowMfaStepUp && isAdminMfaStepUpResponse(res.status, data.error)) {
      await beginMfaStepUp((grantToken) => patchGroup(id, { ...body, stepUpToken: grantToken }, false).then(() => undefined));
      return false;
    }
    if (!res.ok) {
      setMessage(data.error || '操作失败');
      return false;
    }
    await fetchGroups();
    return true;
  }

  const pending = groups.filter((g) => g.status === 'pending');
  const others = groups.filter((g) => g.status !== 'pending');

  return (
    <div className="space-y-4">
      <div className={`max-w-2xl space-y-3 p-5 ${adminSurfaceClasses.panel}`}>
        <h3 className="font-semibold text-gray-800 flex items-center gap-2">
          <Plus className="w-4 h-4 text-brand-600" /> 管理员创建课题组
        </h3>
        <p className="text-xs text-gray-500">创建后立即锁定；成员请在课题组详情中通过搜索添加。</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="课题组名称"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900"
        />
        <UserSearchField
          key={ownerKey}
          label="负责人"
          placeholder="搜索邮箱或姓名"
          onSelect={(u) => setOwner(u)}
        />
        {owner && (
          <p className="text-xs text-gray-500">已选：{owner.email}{owner.name ? ` · ${owner.name}` : ''}</p>
        )}
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50"
        >
          {creating ? '创建中…' : '创建并锁定'}
        </button>
      </div>

      {message && <p className="text-sm text-gray-700">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-gray-500">加载中…</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-amber-800">待审核（{pending.length}）</h3>
              {pending.map((g) => (
                <div key={g.id} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div>
                      <p className="font-medium text-gray-900">{g.name}</p>
                      <p className="text-xs text-gray-600">
                        申请人 {g.members.find((m) => m.role === 'owner')?.user.email || '—'}
                        · {new Date(g.createdAt).toLocaleString('zh-CN')}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="px-3 py-1.5 bg-emerald-600 text-white text-sm rounded-lg flex items-center gap-1"
                        onClick={() => void patchGroup(g.id, { action: 'approve' }).then((ok) => {
                          if (ok) setMessage(`已通过并锁定「${g.name}」`);
                        })}
                      >
                        <Check className="w-3.5 h-3.5" /> 通过
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-lg flex items-center gap-1"
                        onClick={() => {
                          if (!confirm(`拒绝并丢弃「${g.name}」？此操作不可恢复。`)) return;
                          void patchGroup(g.id, { action: 'reject' }).then((ok) => {
                            if (ok) setMessage(`已拒绝并丢弃「${g.name}」`);
                          });
                        }}
                      >
                        <X className="w-3.5 h-3.5" /> 拒绝
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {others.length === 0 && pending.length === 0 ? (
            <div className={`${adminSurfaceClasses.panel} p-8 text-center text-sm ${adminSurfaceClasses.muted}`}>
              暂无课题组
            </div>
          ) : (
            <div className="space-y-2">
              {others.map((g) => {
                const open = expandedId === g.id;
                const memberIds = new Set(g.members.map((m) => m.user.id));
                return (
                  <div key={g.id} className={`${adminSurfaceClasses.panel} overflow-hidden`}>
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedId(open ? null : g.id);
                        if (!open) {
                          setMemberSearchKey((k) => k + 1);
                          void loadGroupLogs(g.id);
                        }
                      }}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Users className="w-4 h-4 text-brand-600 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate">{g.name}</p>
                          <p className="text-xs text-gray-500">
                            {g.memberCount} 人 · {formatPoints(g.points)} 分 · {statusLabel(g)}
                          </p>
                        </div>
                      </div>
                    </button>
                    {open && (
                      <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                        <ul className="text-sm text-gray-700 space-y-1">
                          {g.members.map((m) => (
                            <li key={m.id} className="flex items-center justify-between gap-2">
                              <span>
                                {m.user.email}
                                {m.user.name ? ` · ${m.user.name}` : ''}
                                <span className="ml-1 text-xs text-gray-400">
                                  {m.role === 'owner' ? '负责人' : '成员'}
                                </span>
                              </span>
                              {m.role !== 'owner' && (
                                <button
                                  type="button"
                                  className="text-xs text-red-600 hover:underline"
                                  onClick={() => void patchGroup(g.id, { action: 'remove_member', userId: m.user.id })}
                                >
                                  移除
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                        {g.status === 'active' && (
                          <div className="space-y-2">
                            <UserSearchField
                              key={`${g.id}-${memberSearchKey}`}
                              label="搜索添加成员"
                              placeholder="搜索邮箱或姓名后添加"
                              excludeIds={memberIds}
                              onSelect={async (u) => {
                                const ok = await patchGroup(g.id, { action: 'add_member', userId: u.id });
                                if (ok) {
                                  setMessage(`已添加 ${u.email}`);
                                  setMemberSearchKey((k) => k + 1);
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg flex items-center gap-1"
                              onClick={() => void patchGroup(g.id, {
                                action: 'set_status',
                                status: 'archived',
                              })}
                            >
                              <Archive className="w-3.5 h-3.5" />
                              归档
                            </button>
                          </div>
                        )}
                        {g.status === 'archived' && (
                          <button
                            type="button"
                            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-sm rounded-lg"
                            onClick={() => void patchGroup(g.id, { action: 'set_status', status: 'active' })}
                          >
                            恢复为已锁定
                          </button>
                        )}
                        <div className="border-t border-gray-100 pt-3">
                          <h4 className="mb-2 text-sm font-semibold text-gray-800">积分流水</h4>
                          {logsLoading === g.id ? (
                            <p className="text-xs text-gray-500">加载中…</p>
                          ) : (groupLogs[g.id] || []).length === 0 ? (
                            <p className="text-xs text-gray-500">暂无积分流水</p>
                          ) : (
                            <div className="space-y-2">
                              {(groupLogs[g.id] || []).map((log) => (
                                <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                                  <span>{new Date(log.createdAt).toLocaleString('zh-CN')} · {POINTS_LOG_TYPE_LABELS[log.type as PointsLogType] || log.type}</span>
                                  <span className={log.delta > 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-red-600'}>
                                    {log.delta > 0 ? '+' : ''}{formatPoints(log.delta)} 分
                                  </span>
                                  <span className="w-full text-gray-500">
                                    {log.organizationName || '个人采购'}{log.relatedId ? ` · ${log.relatedId}` : ''}{log.reason ? ` · ${log.reason}` : ''}{log.actorName ? ` · 操作人 ${log.actorName}` : ''}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {mfaDialog}
    </div>
  );
}
