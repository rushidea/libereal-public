import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_req: NextRequest) {
  try {
    const products = await prisma.pointsProduct.findMany({
      where: {
        isActive: true,
        OR: [{ stock: -1 }, { stock: { gt: 0 } }],
      },
      orderBy: { pointsCost: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        category: true,
        imageUrl: true,
        pointsCost: true,
        stock: true,
        metadata: true,
      },
    });
    return NextResponse.json({ products });
  } catch (err) {
    console.error('[points/products]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
