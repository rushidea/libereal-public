import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  consumeSecurityStepUpGrant: vi.fn(),
}));

vi.mock('@/lib/session', () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock('@/lib/security/security-step-up', () => ({ consumeSecurityStepUpGrant: mocks.consumeSecurityStepUpGrant }));

import { requireAdminPointsMutation } from '@/lib/admin-points-step-up';

describe('管理员积分变更身份确认', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      role: 'admin',
      sessionId: 'session-1',
    });
    mocks.consumeSecurityStepUpGrant.mockResolvedValue(true);
  });

  it('没有一次性凭证时沿用管理员 MFA 策略', async () => {
    const result = await requireAdminPointsMutation();

    expect(result).toMatchObject({ id: 'admin-1' });
    expect(mocks.requireAdmin).toHaveBeenCalledWith('points.write', {
      token: undefined,
      action: 'admin_sensitive',
    });
    expect(mocks.consumeSecurityStepUpGrant).not.toHaveBeenCalled();
  });

  it('验证通过后消费一次性凭证', async () => {
    const result = await requireAdminPointsMutation('grant-1');

    expect(result).toMatchObject({ id: 'admin-1' });
    expect(mocks.consumeSecurityStepUpGrant).toHaveBeenCalledWith('grant-1', {
      userId: 'admin-1',
      sessionId: 'session-1',
      action: 'admin_sensitive',
    });
  });

  it('凭证失效时阻止积分变更', async () => {
    mocks.consumeSecurityStepUpGrant.mockResolvedValue(false);

    const result = await requireAdminPointsMutation('expired-grant');

    expect(result).toBeInstanceOf(NextResponse);
    expect((result as NextResponse).status).toBe(403);
  });
});
