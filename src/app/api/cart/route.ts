import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { assertNoPendingForcedAck } from '@/lib/notification-ack';
import { attachDisplayPrice, resolveIsFormalMember } from '@/lib/product-display';

// 方案③：清洗购物车条目 —— 老数据可能残留原始价，统一算好 displayPrice 后剥离原始价
function sanitizeCartItems(items: unknown[], isFormalMember: boolean): unknown[] {
  return items.map((raw) => {
    const item = raw as { isQuickOrder?: boolean; product?: Record<string, unknown> };
    if (!item || item.isQuickOrder || !item.product || typeof item.product !== 'object') {
      return raw;
    }
    const p = item.product;
    const hasRawPrice =
      typeof p.price === 'number' ||
      typeof p.originalPrice === 'number' ||
      typeof p.promotionalPrice === 'number';
    if (!hasRawPrice) return raw; // 已是剥离后的新格式
    // 老格式：用现有原始价算展示价（多规格按最低变体价），然后剥离
    const product = attachDisplayPrice(
      p as { price?: number | null; originalPrice?: number | null; promotionalPrice?: number | null; brand?: string | null; variants?: Array<{ price?: number | null }> },
      isFormalMember,
    );
    return { ...item, product };
  });
}

// GET: Get current user's cart
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ items: [] });
  }

  try {
    const cart = await prisma.cart.findUnique({
      where: { userId: session.user.id },
    });
    if (!cart) return NextResponse.json({ items: [] });
    const items = JSON.parse(cart.items);
    const isFormalMember = await resolveIsFormalMember();
    return NextResponse.json({ items: sanitizeCartItems(items, isFormalMember) });
  } catch (err) {
    console.error('[cart GET] error:', err);
    return NextResponse.json({ items: [] });
  }
}

// PUT: Save cart (full replace)
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id as string },
      select: { role: true },
    });
    const forcedAckBlock = await assertNoPendingForcedAck(
      session.user.id as string,
      user?.role,
    );
    if (forcedAckBlock) return forcedAckBlock;

    const { items } = await req.json();
    if (!Array.isArray(items)) {
      return NextResponse.json({ error: 'items must be an array' }, { status: 400 });
    }

    await prisma.cart.upsert({
      where: { userId: session.user.id },
      update: { items: JSON.stringify(items) },
      create: { userId: session.user.id, items: JSON.stringify(items) },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[cart PUT] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
