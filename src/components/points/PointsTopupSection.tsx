'use client';

import { useState } from 'react';
import { Coins, Users, Plus, Trash2 } from 'lucide-react';
import { formatPoints } from '@/lib/points';
import { uiSurfaces } from '@/lib/ui-surfaces';

export type PointsBalanceView = {
  personalPoints: number;
  group: {
    id: string;
    name: string;
    points: number;
    role: string;
    status: string;
    locked: boolean;
    usable: boolean;
    members?: Array<{
      id: string;
      role: string;
      user: { id: string; email: string | null; name: string | null };
    }>;
  } | null;
};

type Props = {
  balance: PointsBalanceView | null;
  onBalanceChange: () => void;
};

export default function PointsTopupSection({ balance, onBalanceChange }: Props) {
  const [targetType, setTargetType] = useState<'personal' | 'group'>('personal');
  const [points, setPoints] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [groupName, setGroupName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [groupMessage, setGroupMessage] = useState('');
  const [removingMemberId, setRemovingMemberId] = useState('');

  const groupUsable = Boolean(balance?.group?.usable);
  const groupPending = balance?.group?.status === 'pending';

  async function handleTopup() {
    setError('');
    const amount = Math.floor(Number(points));
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('请输入有效的充值积分');
      return;
    }
    if (targetType === 'group' && !groupUsable) {
      setError(groupPending ? '课题组待审核通过后方可充值' : '未加入可用课题组');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/points/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, points: amount }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '创建充值单失败');
        return;
      }
      window.location.href = data.redirectUrl;
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGroup() {
    setGroupMessage('');
    const name = groupName.trim();
    if (!name) {
      setGroupMessage('请填写课题组名称');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/research-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGroupMessage(data.error || '提交失败');
        return;
      }
      setGroupName('');
      setGroupMessage('已提交，等待管理员审核通过后生效');
      onBalanceChange();
    } catch {
      setGroupMessage('网络错误');
    } finally {
      setLoading(false);
    }
  }

  async function handleInvite() {
    setGroupMessage('');
    const email = inviteEmail.trim();
    if (!email) {
      setGroupMessage('请填写成员邮箱');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/research-groups', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGroupMessage(data.error || '添加失败');
        return;
      }
      setInviteEmail('');
      setGroupMessage(`已添加 ${data.member?.user?.name || data.member?.user?.email || email}`);
      onBalanceChange();
    } catch {
      setGroupMessage('网络错误');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveMember(memberId: string, memberName: string) {
    if (!window.confirm(`确定移除成员“${memberName}”吗？移除后，该成员将无法继续使用课题组积分。`)) {
      return;
    }
    setGroupMessage('');
    setRemovingMemberId(memberId);
    try {
      const res = await fetch('/api/research-groups', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGroupMessage(data.error || '移除失败');
        return;
      }
      setGroupMessage(`已移除 ${data.member?.name || memberName}`);
      onBalanceChange();
    } catch {
      setGroupMessage('网络错误');
    } finally {
      setRemovingMemberId('');
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className={`${uiSurfaces.panel} rounded-brand border-[var(--surface-border)] p-4`}>
          <div className={`mb-1 flex items-center gap-2 text-sm ${uiSurfaces.textSecondary}`}>
            <Coins className="w-4 h-4" /> 个人积分
          </div>
          <div className={`text-2xl font-bold ${uiSurfaces.titleText}`}>
            {formatPoints(balance?.personalPoints ?? 0)}
          </div>
          <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>1 积分 = 1 元，结账可抵扣</p>
        </div>
        <div className={`${uiSurfaces.panel} rounded-brand border-[var(--surface-border)] p-4`}>
          <div className={`mb-1 flex items-center gap-2 text-sm ${uiSurfaces.textSecondary}`}>
            <Users className="w-4 h-4" /> 课题组积分
          </div>
          {balance?.group ? (
            <>
              <div className={`text-2xl font-bold ${uiSurfaces.titleText}`}>
                {groupUsable ? formatPoints(balance.group.points) : '—'}
              </div>
              <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>
                {balance.group.name}
                {balance.group.role === 'owner' ? ' · 负责人' : ' · 成员'}
                {groupPending ? ' · 待审核' : balance.group.locked ? ' · 已锁定' : ''}
              </p>
            </>
          ) : (
            <p className={`mt-2 text-sm ${uiSurfaces.mutedText}`}>尚未加入课题组</p>
          )}
        </div>
      </div>

      <div className={`${uiSurfaces.panel} rounded-brand border-[var(--surface-border)] p-5`}>
        <h3 className={`mb-3 font-semibold ${uiSurfaces.titleText}`}>支付宝充值</h3>
        <div className="flex gap-2 mb-3">
          <button
            type="button"
            onClick={() => setTargetType('personal')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              targetType === 'personal' ? 'bg-emerald-500 text-white' : 'bg-white/60 text-gray-600'
            }`}
          >
            充到个人
          </button>
          <button
            type="button"
            onClick={() => setTargetType('group')}
            disabled={!groupUsable}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40 ${
              targetType === 'group' ? 'bg-emerald-500 text-white' : 'bg-white/60 text-gray-600'
            }`}
          >
            充到课题组
          </button>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 max-w-md">
          <input
            type="number"
            min={1}
            step={1}
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder="充值积分数"
            className={`flex-1 ${uiSurfaces.input} rounded-brand px-3 py-2 text-sm ${uiSurfaces.focusRing}`}
          />
          <button
            type="button"
            onClick={handleTopup}
            disabled={loading}
            className="px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? '处理中…' : '去支付'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">支付金额与积分数量 1:1，收款方为平台。</p>
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>

      <div className={`${uiSurfaces.panel} rounded-brand border-[var(--surface-border)] p-5`}>
        <h3 className={`mb-3 flex items-center gap-2 font-semibold ${uiSurfaces.titleText}`}>
          <Plus className="w-4 h-4" /> 课题组
        </h3>
        {!balance?.group ? (
          <div className="space-y-2">
            <p className={`text-xs ${uiSurfaces.mutedText}`}>提交后需管理员审核，通过后锁定生效；不通过则申请作废。</p>
            <div className="flex flex-col sm:flex-row gap-2 max-w-md">
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="课题组名称"
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900"
              />
              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={loading}
                className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50"
              >
                提交申请
              </button>
            </div>
          </div>
        ) : groupPending ? (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            「{balance.group.name}」待管理员审核。通过后锁定生效，期间不可充值、抵扣或添加成员。
          </p>
        ) : balance.group.role === 'owner' ? (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2 max-w-md">
              <input
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="成员邮箱"
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900"
              />
              <button
                type="button"
                onClick={handleInvite}
                disabled={loading}
                className="px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50"
              >
                添加成员
              </button>
            </div>

            <div className="border-t border-[var(--surface-border)] pt-3">
              <h4 className={`mb-2 text-sm font-medium ${uiSurfaces.titleText}`}>成员管理</h4>
              {balance.group.members?.length ? (
                <div className="space-y-2">
                  {balance.group.members.map((member) => {
                    const displayName = member.user.name || member.user.email || '未设置姓名';
                    return (
                      <div
                        key={member.id}
                        className="flex flex-col gap-2 rounded-lg border border-[var(--surface-border)] px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className={`truncate text-sm ${uiSurfaces.titleText}`}>{displayName}</p>
                          <p className={`truncate text-xs ${uiSurfaces.mutedText}`}>
                            {member.user.email || '未填写邮箱'} · {member.role === 'owner' ? '负责人' : '成员'}
                          </p>
                        </div>
                        {member.role !== 'owner' && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMember(member.id, displayName)}
                            disabled={loading || removingMemberId === member.id}
                            className="inline-flex shrink-0 items-center justify-center gap-1 self-start rounded-lg border border-red-200 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 sm:self-auto"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {removingMemberId === member.id ? '处理中…' : '移除'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className={`text-sm ${uiSurfaces.mutedText}`}>暂无成员信息</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">已加入「{balance.group.name}」，共享课题组积分。</p>
        )}
        {groupMessage && <p className="text-sm text-gray-700 mt-2">{groupMessage}</p>}
      </div>
    </div>
  );
}
