import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

export async function GET(req: NextRequest) {
  const denied = await requireAdmin('customers.read');
  if (denied instanceof NextResponse) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const addresses = await prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json(addresses);
  } catch (err) {
    console.error('[admin/addresses GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin('customers.write');
  if (denied instanceof NextResponse) return denied;

  try {
    const { name, phone, address, institution, isDefault, userId } = await req.json();

    if (!name || !phone || !address || !userId) {
      return NextResponse.json({ error: 'name, phone, address, userId are required' }, { status: 400 });
    }

    let created;
    if (isDefault) {
      const results = await prisma.$transaction([
        prisma.address.updateMany({ where: { userId }, data: { isDefault: false } }),
        prisma.address.create({
          data: {
            userId,
            name,
            phone,
            address,
            institution: institution || null,
            isDefault: true,
          },
        }),
      ]);
      created = results[1];
    } else {
      created = await prisma.address.create({
        data: {
          userId,
          name,
          phone,
          address,
          institution: institution || null,
          isDefault: false,
        },
      });
    }
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error('[admin/addresses POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
