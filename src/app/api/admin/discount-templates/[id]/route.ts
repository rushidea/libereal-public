import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { alignBrandDiscountsPayload } from '@/lib/discount-brand-align';

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin('pricing.write');
  if (user instanceof NextResponse) return user;

  try {
    const { id: paramId } = await context.params;
    const body = await request.json();
    const id = (typeof body.id === 'string' && body.id) || paramId;
    const { name, discountRate, brandDiscounts, description } = body;

    if (!id) {
      return NextResponse.json({ error: '缺少模板ID' }, { status: 400 });
    }
    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: '模板名称不能为空' }, { status: 400 });
    }

    const existing = await prisma.discountTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    const { serialized, result } = await alignBrandDiscountsPayload(prisma, brandDiscounts);

    await prisma.discountTemplate.update({
      where: { id },
      data: {
        name: name.trim(),
        discountRate: discountRate ?? null,
        brandDiscounts: serialized ?? '{}',
        description: description?.trim() ?? null,
      },
    });

    return NextResponse.json({
      success: true,
      unmappedBrands: result.unmapped,
      renames: result.renames,
    });
  } catch (err) {
    console.error('[discount-templates PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin('pricing.write');
  if (user instanceof NextResponse) return user;

  try {
    const { id: paramId } = await context.params;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id') || paramId;

    if (!id) {
      return NextResponse.json({ error: '缺少模板ID' }, { status: 400 });
    }

    const existing = await prisma.discountTemplate.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    await prisma.discountTemplate.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[discount-templates DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
