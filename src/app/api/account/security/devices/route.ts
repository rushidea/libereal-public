import { NextRequest, NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';
import {
  listSecurityDevices,
  renameSecurityDevice,
  revokeSecurityDevice,
} from '@/lib/security/security-session-service';

export async function GET() {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ devices: await listSecurityDevices(user.id) });
}

export async function PATCH(request: NextRequest) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => null) as { deviceId?: string; name?: string } | null;
  const deviceId = body?.deviceId?.trim() ?? '';
  const name = body?.name ?? '';
  if (!deviceId || deviceId.length > 100 || name.trim().length === 0 || name.trim().length > 80) {
    return NextResponse.json({ error: 'Invalid device' }, { status: 400 });
  }
  const renamed = await renameSecurityDevice(user.id, deviceId, name);
  return renamed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Device not found' }, { status: 404 });
}

export async function DELETE(request: NextRequest) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => null) as { deviceId?: string; stepUpToken?: string } | null;
  const deviceId = body?.deviceId?.trim() ?? '';
  if (!deviceId || deviceId.length > 100) return NextResponse.json({ error: 'Invalid device' }, { status: 400 });
  if (!user.sessionId || !body?.stepUpToken || !(await consumeSecurityStepUpGrant(body.stepUpToken, { userId: user.id, sessionId: user.sessionId, action: 'security_device_remove' }))) {
    return NextResponse.json({ error: 'SECURITY_STEP_UP_REQUIRED', action: 'security_device_remove' }, { status: 403 });
  }
  const result = await revokeSecurityDevice(user.id, deviceId, user.sessionId);
  return result.revoked
    ? NextResponse.json({ ok: true, current: result.current })
    : NextResponse.json({ error: 'Device not found' }, { status: 404 });
}
