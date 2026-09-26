import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import type { Prisma } from '@prisma/client';

const VALID_CATEGORIES = ['tool', 'digital', 'physical'];

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAdmin('points.write');
  if (user instanceof NextResponse) return user;

  try {
    const body = await req.json();
    const { name, description, category, imageUrl, pointsCost, stock, isActive, metadata } = body;

    const existing = await prisma.pointsProduct.findUnique({ where: { id }, select: { id: true } });
    if (!existing) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }

    const updateData: Prisma.PointsProductUpdateInput = {};

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim() === '') {
        return NextResponse.json({ error: '商品名称不能为空' }, { status: 400 });
      }
      updateData.name = name.trim();
    }
    if (description !== undefined) updateData.description = description || null;
    if (category !== undefined) {
      if (!VALID_CATEGORIES.includes(category)) {
        return NextResponse.json({ error: `无效的分类：${category}` }, { status: 400 });
      }
      updateData.category = category;
    }
    if (imageUrl !== undefined) updateData.imageUrl = imageUrl || null;
    if (pointsCost !== undefined) {
      const cost = parseInt(pointsCost);
      if (isNaN(cost) || cost <= 0) {
        return NextResponse.json({ error: '积分价格必须为正整数' }, { status: 400 });
      }
      updateData.pointsCost = cost;
    }
    if (stock !== undefined) {
      const stockVal = parseInt(stock);
      if (isNaN(stockVal) || stockVal < -1) {
        return NextResponse.json({ error: '库存必须 >= -1' }, { status: 400 });
      }
      updateData.stock = stockVal;
    }
    if (isActive !== undefined) updateData.isActive = !!isActive;
    if (metadata !== undefined) {
      updateData.metadata = metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: '没有要更新的字段' }, { status: 400 });
    }

    await prisma.pointsProduct.update({ where: { id }, data: updateData });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/points/products PATCH]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const user = await requireAdmin('points.write');
  if (user instanceof NextResponse) return user;

  try {
    const existing = await prisma.pointsProduct.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!existing) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }

    // Check for pending redemptions
    const pendingCount = await prisma.pointsRedemption.count({
      where: { productId: id, status: { in: ['pending', 'shipped'] } },
    });
    if (pendingCount > 0) {
      return NextResponse.json({ error: '该商品有未完成的兑换记录，无法删除（可改为下架）' }, { status: 400 });
    }

    await prisma.pointsProduct.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/points/products DELETE]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
