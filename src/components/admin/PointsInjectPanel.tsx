'use client';

import { useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { adminSurfaceClasses } from '@/lib/admin-surfaces';
import { isAdminMfaStepUpResponse, useAdminMfaStepUp } from '@/components/admin/AdminMfaStepUpDialog';

export default function PointsInjectPanel() {
  const { begin: beginMfaStepUp, dialog: mfaDialog } = useAdminMfaStepUp();
  const [targetType, setTargetType] = useState<'personal' | 'group'>('personal');
  const [userQuery, setUserQuery] = useState('');
  const [userId, setUserId] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('');
  const [matches, setMatches] = useState<{ id: string; name: string | null; email: string; points: number }[]>([]);
  const [groupId, setGroupId] = useState('');
  const [groups, setGroups] = useState<{ id: string; name: string; points: number }[]>([]);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [groupsLoaded, setGroupsLoaded] = useState(false);

  async function searchUsers(q: string) {
    setUserQuery(q);
    if (q.trim().length < 2) {
      setMatches([]);
      return;
    }
    try {
      const res = await fetch(`/api/admin/users/search?q=${encodeURIComponent(q.trim())}&limit=8`);
      if (!res.ok) return;
      const data = await res.json();
      setMatches((data.users || []).map((u: { id: string; name: string | null; email: string; points: number }) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        points: u.points,
      })));
    } catch {
      setMatches([]);
    }
  }

  async function ensureGroups() {
    if (groupsLoaded) return;
    try {
      const res = await fetch('/api/admin/research-groups');
      if (res.ok) {
        const data = await res.json();
        setGroups((data.groups || [])
          .filter((g: { status: string }) => g.status === 'active')
          .map((g: { id: string; name: string; points: number }) => ({
          id: g.id,
          name: g.name,
          points: g.points,
        })));
      }
    } finally {
      setGroupsLoaded(true);
    }
  }

  async function submitInject(
    body: { targetType: 'personal' | 'group'; userId?: string; groupId?: string; points: number; reason?: string; stepUpToken?: string },
    allowMfaStepUp = true,
  ) {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/points/inject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (allowMfaStepUp && isAdminMfaStepUpResponse(res.status, data.error)) {
        await beginMfaStepUp((grantToken) => submitInject({ ...body, stepUpToken: grantToken }, false));
        return;
      }
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || '注入失败' });
        return;
      }
      setMessage({ type: 'success', text: `已注入 ${body.points} 积分` });
      setPoints('');
      setReason('');
      if (body.targetType === 'group') {
        setGroupsLoaded(false);
        await ensureGroups();
      }
    } catch {
      setMessage({ type: 'error', text: '网络错误' });
    } finally {
      setLoading(false);
    }
  }

  async function handleInject() {
    setMessage(null);
    const amount = Math.floor(Number(points));
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage({ type: 'error', text: '注入积分须为正整数' });
      return;
    }
    if (targetType === 'personal' && !userId) {
      setMessage({ type: 'error', text: '请选择用户' });
      return;
    }
    if (targetType === 'group' && !groupId) {
      setMessage({ type: 'error', text: '请选择课题组' });
      return;
    }

    await submitInject({
      targetType,
      userId: targetType === 'personal' ? userId : undefined,
      groupId: targetType === 'group' ? groupId : undefined,
      points: amount,
      reason: reason.trim() || undefined,
    });
  }

  return (
    <div className={`max-w-2xl space-y-4 p-5 ${adminSurfaceClasses.panel}`}>
      <h3 className="font-semibold text-gray-800 flex items-center gap-2">
        <Plus className="w-4 h-4 text-brand-600" /> 积分注入
      </h3>
      <p className="text-sm text-gray-500">向个人或课题组账户注入积分，流水类型为管理员注入。</p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTargetType('personal')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            targetType === 'personal' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700'
          }`}
        >
          个人
        </button>
        <button
          type="button"
          onClick={() => {
            setTargetType('group');
            void ensureGroups();
          }}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            targetType === 'group' ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-700'
          }`}
        >
          课题组
        </button>
      </div>

      {targetType === 'personal' ? (
        <div className="relative">
          <label className="block text-sm font-medium text-gray-700 mb-1">用户</label>
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={selectedLabel || userQuery}
              onChange={(e) => {
                setSelectedLabel('');
                setUserId('');
                void searchUsers(e.target.value);
              }}
              placeholder="搜索邮箱或姓名"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900"
            />
          </div>
          {matches.length > 0 && !selectedLabel && (
            <div className={`absolute z-10 mt-1 max-h-48 w-full overflow-y-auto ${adminSurfaceClasses.panelStrong} rounded-brand shadow-[var(--shadow-panel)]`}>
              {matches.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => {
                    setUserId(u.id);
                    setSelectedLabel(`${u.email}${u.name ? ` · ${u.name}` : ''}（${u.points} 分）`);
                    setUserQuery('');
                    setMatches([]);
                  }}
                >
                  {u.email}{u.name ? ` · ${u.name}` : ''} · {u.points} 分
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">课题组</label>
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            onFocus={() => void ensureGroups()}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900"
          >
            <option value="">选择课题组</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}（{g.points} 分）
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">积分数</label>
        <input
          type="number"
          min={1}
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">原因</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="可选"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900"
        />
      </div>

      <button
        type="button"
        onClick={handleInject}
        disabled={loading}
        className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50"
      >
        {loading ? '提交中…' : '注入'}
      </button>
      {message && (
        <p className={`text-sm ${message.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>
          {message.text}
        </p>
      )}
      {mfaDialog}
    </div>
  );
}
