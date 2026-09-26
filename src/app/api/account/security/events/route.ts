import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { listSecurityEvents } from '@/lib/security/security-session-service';

export async function GET() {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  const events = await listSecurityEvents(user.id, 12);
  return NextResponse.json({
    events: events.map(({ userAgent, ...event }) => {
      void userAgent;
      return event;
    }),
  });
}
