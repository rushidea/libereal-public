import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { listPendingForcedAcks } from '@/lib/notification-ack';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ pending: [] });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id as string },
      select: { id: true, role: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (user.role === 'admin') {
      return NextResponse.json({ pending: [] });
    }

    const pending = await listPendingForcedAcks(user.id);
    return NextResponse.json({ pending });
  } catch (err) {
    console.error('[notifications pending-ack GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
