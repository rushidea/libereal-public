import { describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireActiveSession: vi.fn(),
  consumeSecurityStepUpGrant: vi.fn(),
  listSecuritySessions: vi.fn(),
  listSecurityDevices: vi.fn(),
  listSecurityEvents: vi.fn(),
  revokeSecuritySessionById: vi.fn(),
  revokeOtherSecuritySessions: vi.fn(),
  revokeAllSecuritySessions: vi.fn(),
  renameSecurityDevice: vi.fn(),
  revokeSecurityDevice: vi.fn(),
}));

vi.mock('@/lib/session', () => ({
  requireActiveSession: mocks.requireActiveSession,
}));

vi.mock('@/lib/security/security-step-up', () => ({
  consumeSecurityStepUpGrant: mocks.consumeSecurityStepUpGrant,
}));

vi.mock('@/lib/security/security-session-service', () => ({
  listSecuritySessions: mocks.listSecuritySessions,
  listSecurityDevices: mocks.listSecurityDevices,
  listSecurityEvents: mocks.listSecurityEvents,
  revokeSecuritySessionById: mocks.revokeSecuritySessionById,
  revokeOtherSecuritySessions: mocks.revokeOtherSecuritySessions,
  revokeAllSecuritySessions: mocks.revokeAllSecuritySessions,
  renameSecurityDevice: mocks.renameSecurityDevice,
  revokeSecurityDevice: mocks.revokeSecurityDevice,
}));

import * as sessionsRoute from '@/app/api/account/security/sessions/route';
import * as devicesRoute from '@/app/api/account/security/devices/route';
import * as eventsRoute from '@/app/api/account/security/events/route';

const user = { id: 'user-1', email: 'user@example.com', role: 'customer', sessionId: 'session-1', authLevel: 'mfa_verified', mfaVerifiedAt: Date.now(), mfaMethod: 'totp' as const };

describe('Security Center routes', () => {
  it('lists sessions, devices, and events for the active user', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.listSecuritySessions.mockResolvedValue([{ id: 'record-1', current: true }]);
    mocks.listSecurityDevices.mockResolvedValue([{ id: 'device-1' }]);
    mocks.listSecurityEvents.mockResolvedValue([{ id: 'event-1' }]);

    const sessions = await sessionsRoute.GET();
    const devices = await devicesRoute.GET();
    const events = await eventsRoute.GET();

    expect(await sessions.json()).toEqual({ sessions: [{ id: 'record-1', current: true }] });
    expect(await devices.json()).toEqual({ devices: [{ id: 'device-1' }] });
    expect(await events.json()).toEqual({ events: [{ id: 'event-1' }] });
    expect(mocks.listSecuritySessions).toHaveBeenCalledWith('user-1', 'session-1');
  });

  it('rejects unauthenticated reads', async () => {
    mocks.requireActiveSession.mockResolvedValue(NextResponse.json({ error: '未登录' }, { status: 401 }));
    const response = await sessionsRoute.GET();
    expect(response.status).toBe(401);
  });

  it('requires a scoped security step-up and validates session actions', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.consumeSecurityStepUpGrant.mockResolvedValue(false);
    const unauthorized = await sessionsRoute.POST(new NextRequest('http://localhost/api/account/security/sessions', {
      method: 'POST',
      body: JSON.stringify({ action: 'revoke-others' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(unauthorized.status).toBe(403);
    expect(await unauthorized.json()).toMatchObject({ error: 'SECURITY_STEP_UP_REQUIRED', action: 'security_session_revoke' });

    const invalid = await sessionsRoute.POST(new NextRequest('http://localhost/api/account/security/sessions', {
      method: 'POST',
      body: JSON.stringify({ action: 'unknown' }),
      headers: { 'content-type': 'application/json' },
    }));
    expect(invalid.status).toBe(400);
  });

  it('revokes a selected session and a device through scoped service calls', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.consumeSecurityStepUpGrant.mockResolvedValue(true);
    mocks.revokeSecuritySessionById.mockResolvedValue(true);
    mocks.revokeSecurityDevice.mockResolvedValue({ revoked: true, current: false });

    const sessionResponse = await sessionsRoute.POST(new NextRequest('http://localhost/api/account/security/sessions', {
      method: 'POST',
      body: JSON.stringify({ action: 'revoke', sessionRecordId: 'record-1', stepUpToken: 'grant-1' }),
      headers: { 'content-type': 'application/json' },
    }));
    const deviceResponse = await devicesRoute.DELETE(new NextRequest('http://localhost/api/account/security/devices', {
      method: 'DELETE',
      body: JSON.stringify({ deviceId: 'device-1', stepUpToken: 'grant-2' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(sessionResponse.status).toBe(200);
    expect(deviceResponse.status).toBe(200);
    expect(mocks.revokeSecuritySessionById).toHaveBeenCalledWith('user-1', 'record-1');
    expect(mocks.revokeSecurityDevice).toHaveBeenCalledWith('user-1', 'device-1', 'session-1');
    expect(mocks.consumeSecurityStepUpGrant).toHaveBeenCalledWith('grant-1', { userId: 'user-1', sessionId: 'session-1', action: 'security_session_revoke' });
    expect(mocks.consumeSecurityStepUpGrant).toHaveBeenCalledWith('grant-2', { userId: 'user-1', sessionId: 'session-1', action: 'security_device_remove' });
  });

  it('allows device renaming with an active session only', async () => {
    mocks.requireActiveSession.mockResolvedValue(user);
    mocks.renameSecurityDevice.mockResolvedValue(true);

    const response = await devicesRoute.PATCH(new NextRequest('http://localhost/api/account/security/devices', {
      method: 'PATCH',
      body: JSON.stringify({ deviceId: 'device-1', name: '办公电脑' }),
      headers: { 'content-type': 'application/json' },
    }));

    expect(response.status).toBe(200);
    expect(mocks.renameSecurityDevice).toHaveBeenCalledWith('user-1', 'device-1', '办公电脑');
  });
});
