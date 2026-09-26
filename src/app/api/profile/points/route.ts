import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const row = await prisma.user.findUnique({
      where: { email },
      select: { points: true, tier: true },
    });
    if (!row) return NextResponse.json({ points: 0, tier: 'standard' });
    return NextResponse.json({ points: row.points, tier: row.tier });
  } catch {
    return NextResponse.json({ points: 0, tier: 'standard' });
  }
}

export async function POST() {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { points: true, tier: true },
    });
    return NextResponse.json(user ?? { points: 0, tier: 'standard' });
  } catch (err) {
    console.error('[points POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
