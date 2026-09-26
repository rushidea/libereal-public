import { NextRequest, NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';
import {
  listSecuritySessions,
  revokeAllSecuritySessions,
  revokeOtherSecuritySessions,
  revokeSecuritySessionById,
} from '@/lib/security/security-session-service';

export async function GET() {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const sessions = await listSecuritySessions(user.id, user.sessionId);
  return NextResponse.json({
    sessions: sessions.map(({ sessionId, userAgent, ...session }) => {
      void sessionId;
      void userAgent;
      return session;
    }),
  });
}

export async function POST(request: NextRequest) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => null) as { action?: string; sessionRecordId?: string; stepUpToken?: string } | null;
  const action = body?.action;

  if (action !== 'revoke' && action !== 'revoke-others' && action !== 'revoke-all') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }
  if (action === 'revoke') {
    const id = body?.sessionRecordId?.trim() ?? '';
    if (!id || id.length > 100) return NextResponse.json({ error: 'Invalid session' }, { status: 400 });
  }
  if (!user.sessionId || !body?.stepUpToken || !(await consumeSecurityStepUpGrant(body.stepUpToken, { userId: user.id, sessionId: user.sessionId, action: 'security_session_revoke' }))) {
    return NextResponse.json({ error: 'SECURITY_STEP_UP_REQUIRED', action: 'security_session_revoke' }, { status: 403 });
  }

  if (action === 'revoke') {
    const id = body.sessionRecordId!.trim();
    const revoked = await revokeSecuritySessionById(user.id, id);
    return revoked
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  if (action === 'revoke-others') {
    if (!user.sessionId) return NextResponse.json({ error: 'Current session unavailable' }, { status: 409 });
    return NextResponse.json({ revoked: await revokeOtherSecuritySessions(user.id, user.sessionId) });
  }
  if (action === 'revoke-all') {
    return NextResponse.json({ revoked: await revokeAllSecuritySessions(user.id) });
  }
  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
