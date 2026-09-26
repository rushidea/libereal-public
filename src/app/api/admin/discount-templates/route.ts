import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { alignBrandDiscountsPayload } from '@/lib/discount-brand-align';

export async function GET() {
  const user = await requireAdmin('pricing.read');
  if (user instanceof NextResponse) return user;

  try {
    const templates = await prisma.discountTemplate.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(templates);
  } catch (err) {
    console.error('[discount-templates GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await requireAdmin('pricing.write');
  if (user instanceof NextResponse) return user;

  try {
    const body = await request.json();
    const { name, discountRate, brandDiscounts, description } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: '模板名称不能为空' }, { status: 400 });
    }

    const { serialized, result } = await alignBrandDiscountsPayload(prisma, brandDiscounts);

    const template = await prisma.discountTemplate.create({
      data: {
        name: name.trim(),
        discountRate: discountRate ?? 1.0,
        brandDiscounts: serialized ?? '{}',
        description: description?.trim() || null,
      },
    });

    return NextResponse.json({
      success: true,
      id: template.id,
      unmappedBrands: result.unmapped,
      renames: result.renames,
    });
  } catch (err) {
    console.error('[discount-templates POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
