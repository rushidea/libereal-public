import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const { name, phone, address, institution, isDefault, label } = await req.json();

    const userId = session.user.id as string;
    const existing = await prisma.address.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 });
    }

    const updateData: Prisma.AddressUpdateInput = {
      name: name ?? existing.name,
      phone: phone ?? existing.phone,
      address: address ?? existing.address,
      institution: institution ?? existing.institution,
      label: label ?? existing.label,
      isDefault: isDefault !== undefined ? !!isDefault : existing.isDefault,
    };

    let updated;
    if (isDefault) {
      [updated] = await prisma.$transaction([
        prisma.address.updateMany({ where: { userId }, data: { isDefault: false } }),
        prisma.address.update({ where: { id }, data: updateData }),
      ]).then((results) => [results[1]]);
    } else {
      updated = await prisma.address.update({ where: { id }, data: updateData });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error('[addresses PATCH] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const userId = session.user.id as string;

    const existing = await prisma.address.findFirst({ where: { id, userId }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 });
    }

    await prisma.address.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[addresses DELETE] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
