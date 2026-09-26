import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;

  if (!email) {
    return NextResponse.json({ role: 'customer' });
  }

  try {
    const row = await prisma.user.findUnique({
      where: { email },
      select: { role: true },
    });
    return NextResponse.json({ role: row?.role ?? 'customer' });
  } catch (err) {
    console.error('[role API] error:', err);
    return NextResponse.json({ role: 'customer' });
  }
}
