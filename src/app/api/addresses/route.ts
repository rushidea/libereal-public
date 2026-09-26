import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeEmail } from '@/lib/auth-helpers';

async function resolveUserId(session: { user?: { id?: string | null; email?: string | null } } | null): Promise<string | null> {
  const directId = session?.user?.id;
  if (directId) return directId;
  const email = session?.user?.email ? normalizeEmail(session.user.email) : '';
  if (!email) return null;
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: email } },
        { googleEmail: { equals: email } },
      ],
    },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function GET(_req: NextRequest) {
  const session = await auth();
  const userId = await resolveUserId(session);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const addresses = await prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return NextResponse.json(addresses);
  } catch (err) {
    console.error('[addresses GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = await resolveUserId(session);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { name, phone, address, institution, isDefault, label } = await req.json();

    if (!name || !phone || !address) {
      return NextResponse.json({ error: 'name, phone, address are required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (isDefault) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const [_, created] = await prisma.$transaction([
        prisma.address.updateMany({ where: { userId }, data: { isDefault: false } }),
        prisma.address.create({
          data: {
            userId,
            name,
            phone,
            address,
            institution: institution || null,
            label: label || null,
            isDefault: true,
          },
        }),
      ]);
      return NextResponse.json(created, { status: 201 });
    } else {
      const newAddress = await prisma.address.create({
        data: {
          userId,
          name,
          phone,
          address,
          institution: institution || null,
          label: label || null,
          isDefault: false,
        },
      });
      return NextResponse.json(newAddress, { status: 201 });
    }
  } catch (err) {
    console.error('[addresses POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
