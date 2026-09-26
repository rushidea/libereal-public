import { NextResponse } from 'next/server';
import { requireActiveSession } from '@/lib/session';
import { isPasskeyEnabled } from '@/lib/security/mfa-config';
import { listPasskeys } from '@/lib/security/passkey-service';

export async function GET() {
  if (!isPasskeyEnabled()) return NextResponse.json({ enabled: false, passkeys: [] });
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ enabled: true, passkeys: listPasskeys(user.id) });
}
