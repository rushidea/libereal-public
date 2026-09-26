import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin('customers.read');
  if (admin instanceof NextResponse) return admin;

  try {
    const { id: userId } = await params;

    const addresses = await prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      select: { id: true, name: true, phone: true, address: true, institution: true, isDefault: true },
    });

    return NextResponse.json(addresses);
  } catch (err) {
    console.error('[addresses GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
