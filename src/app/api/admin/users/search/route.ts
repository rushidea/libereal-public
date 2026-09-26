import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

export async function GET(req: NextRequest) {
  const user = await requireAdmin('customers.read');
  if (user instanceof NextResponse) return user;

  const q = req.nextUrl.searchParams.get('q')?.trim() || '';
  if (q.length < 1) {
    return NextResponse.json({ users: [] });
  }

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') || '10'), 50);

  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: q } },
          { name: { contains: q } },
          { id: { contains: q } },
        ],
      },
      orderBy: { points: 'desc' },
      take: limit,
      select: { id: true, name: true, email: true, points: true, tier: true },
    });

    return NextResponse.json({ users });
  } catch (err) {
    console.error('[admin/users/search GET]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
