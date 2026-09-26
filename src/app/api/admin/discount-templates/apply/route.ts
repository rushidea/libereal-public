import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import type { Prisma } from '@prisma/client';
import { alignBrandDiscountsPayload } from '@/lib/discount-brand-align';

export async function POST(request: Request) {
  const user = await requireAdmin('pricing.write');
  if (user instanceof NextResponse) return user;

  try {
    const body = await request.json();
    const { templateId, userIds } = body;

    if (!templateId) {
      return NextResponse.json({ error: '缺少模板ID' }, { status: 400 });
    }
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: '请选择至少一个用户' }, { status: 400 });
    }

    const template = await prisma.discountTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      return NextResponse.json({ error: '模板不存在' }, { status: 404 });
    }

    const { serialized, result } = await alignBrandDiscountsPayload(prisma, template.brandDiscounts);

    const updateData: Prisma.UserUpdateInput = {
      discountRate: template.discountRate,
      brandDiscounts: serialized ?? '{}',
      sourceTemplateId: templateId,
    };
    await prisma.user.updateMany({
      where: { id: { in: userIds } },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      appliedCount: userIds.length,
      unmappedBrands: result.unmapped,
      renames: result.renames,
    });
  } catch (err) {
    console.error('[discount-templates/apply POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
