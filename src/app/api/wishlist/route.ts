import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { attachDisplayPrice, resolveIsFormalMember } from '@/lib/product-display';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const userId = session.user.id as string;

    const items = await prisma.wishlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        product: {
          select: {
            id: true,
            catalogNumber: true,
            name: true,
            brand: true,
            price: true,
            originalPrice: true,
            promotionalPrice: true,
            category: true,
            subcategory: true,
            spec: true,
            imageUrl: true,
            inStock: true,
          },
        },
      },
    });

    // Reshape to flat structure matching previous SQL response
    const flat = items.map((w) => ({
      wishlistId: w.id,
      addedAt: w.createdAt,
      id: w.product.id,
      catalogNumber: w.product.catalogNumber,
      name: w.product.name,
      brand: w.product.brand,
      price: w.product.price,
      originalPrice: w.product.originalPrice,
      promotionalPrice: w.product.promotionalPrice,
      category: w.product.category,
      subcategory: w.product.subcategory,
      spec: w.product.spec,
      imageUrl: w.product.imageUrl,
      inStock: w.product.inStock,
    }));

    // 方案③：按请求者状态计算展示价，剥离原始价
    const isFormalMember = await resolveIsFormalMember();

    return NextResponse.json(flat.map((item) => attachDisplayPrice(item, isFormalMember)));
  } catch (err) {
    console.error('[wishlist GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { productId } = await req.json();
    if (!productId) {
      return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    }

    const userId = session.user.id as string;

    // Verify product exists
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    // Upsert to handle duplicates gracefully
    await prisma.wishlist.upsert({
      where: { userId_productId: { userId, productId } },
      create: { userId, productId },
      update: {},
    });

    return NextResponse.json({ success: true, productId });
  } catch (err) {
    console.error('[wishlist POST] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
