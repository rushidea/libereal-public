import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

interface SessionUser {
  id: string;
  role?: string;
  email?: string;
}

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 });
  }

  const session = await auth();
  return NextResponse.json({
    hasSession: !!session,
    user: session?.user,
    role: (session?.user as SessionUser)?.role,
    expires: session?.expires,
  });
}
