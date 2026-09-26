import { describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  isMfaPhase1Enabled: vi.fn(),
  requireActiveSession: vi.fn(),
  getMfaStatus: vi.fn(),
}));

vi.mock('@/lib/security/mfa-config', () => ({ isMfaPhase1Enabled: mocks.isMfaPhase1Enabled }));
vi.mock('@/lib/session', () => ({ requireActiveSession: mocks.requireActiveSession }));
vi.mock('@/lib/security/mfa-service', () => ({ getMfaStatus: mocks.getMfaStatus }));

import { GET } from '@/app/api/auth/mfa/status/route';

describe('MFA status session boundary', () => {
  it('rejects a revoked session before reading MFA state', async () => {
    mocks.isMfaPhase1Enabled.mockReturnValue(true);
    mocks.requireActiveSession.mockResolvedValue(NextResponse.json({ error: 'Session revoked' }, { status: 401 }));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.getMfaStatus).not.toHaveBeenCalled();
  });

  it('reads MFA state only after active-session validation', async () => {
    mocks.isMfaPhase1Enabled.mockReturnValue(true);
    mocks.requireActiveSession.mockResolvedValue({ id: 'user-1' });
    mocks.getMfaStatus.mockReturnValue({ enabled: false, confirmedAt: null, lastVerifiedAt: null });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ enabled: false, confirmedAt: null, lastVerifiedAt: null });
    expect(mocks.getMfaStatus).toHaveBeenCalledWith('user-1');
  });
});
