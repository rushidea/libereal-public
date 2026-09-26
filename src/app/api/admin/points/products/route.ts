import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

const VALID_CATEGORIES = ['tool', 'digital', 'physical'];

export async function GET(req: NextRequest) {
  const user = await requireAdmin('points.read');
  if (user instanceof NextResponse) return user;

  try {
    const { searchParams } = new URL(req.url);
    const includeInactive = searchParams.get('includeInactive') === 'true';

    const where = includeInactive ? {} : { isActive: true };
    const products = await prisma.pointsProduct.findMany({
      where,
      orderBy: { pointsCost: 'asc' },
    });
    return NextResponse.json({ products });
  } catch (err) {
    console.error('[admin/points/products GET]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin('points.write');
  if (user instanceof NextResponse) return user;

  try {
    const body = await req.json();
    const { name, description, category, imageUrl, pointsCost, stock, metadata } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: '商品名称必填' }, { status: 400 });
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: `无效的分类：${category}` }, { status: 400 });
    }
    const cost = parseInt(pointsCost);
    if (isNaN(cost) || cost <= 0) {
      return NextResponse.json({ error: '积分价格必须为正整数' }, { status: 400 });
    }
    const stockVal = stock === undefined || stock === null ? -1 : parseInt(stock);
    if (isNaN(stockVal) || stockVal < -1) {
      return NextResponse.json({ error: '库存必须 >= -1（-1 表示无限）' }, { status: 400 });
    }

    const product = await prisma.pointsProduct.create({
      data: {
        name: name.trim(),
        description: description || null,
        category,
        imageUrl: imageUrl || null,
        pointsCost: cost,
        stock: stockVal,
        isActive: true,
        metadata: metadata ? (typeof metadata === 'string' ? metadata : JSON.stringify(metadata)) : null,
      },
    });

    return NextResponse.json({ success: true, id: product.id });
  } catch (err) {
    console.error('[admin/points/products POST]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
