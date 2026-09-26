import { describe, expect, it } from 'vitest';

/** 审核状态机语义：与 API 约定一致的纯逻辑校验 */
function nextAuditAction(status: string, action: 'approve' | 'reject' | 'archive') {
  if (action === 'approve') {
    if (status !== 'pending') return { ok: false as const, error: '仅待审核课题组可通过' };
    return { ok: true as const, status: 'active', locked: true };
  }
  if (action === 'reject') {
    if (status !== 'pending') return { ok: false as const, error: '仅待审核课题组可拒绝' };
    return { ok: true as const, discarded: true };
  }
  if (action === 'archive') {
    if (status === 'pending') return { ok: false as const, error: '待审核课题组请使用通过或拒绝' };
    return { ok: true as const, status: 'archived' };
  }
  return { ok: false as const, error: '未知操作' };
}

describe('research group audit', () => {
  it('approves pending into locked active', () => {
    expect(nextAuditAction('pending', 'approve')).toEqual({
      ok: true,
      status: 'active',
      locked: true,
    });
  });

  it('rejects pending by discard', () => {
    expect(nextAuditAction('pending', 'reject')).toEqual({
      ok: true,
      discarded: true,
    });
  });

  it('blocks approve/reject on non-pending', () => {
    expect(nextAuditAction('active', 'approve').ok).toBe(false);
    expect(nextAuditAction('active', 'reject').ok).toBe(false);
  });
});
