import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ productId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { productId } = await params;
    const userId = session.user.id as string;

    const result = await prisma.wishlist.deleteMany({
      where: { userId, productId },
    });

    return NextResponse.json({ success: true, removed: result.count > 0 });
  } catch (err) {
    console.error('[wishlist DELETE] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
