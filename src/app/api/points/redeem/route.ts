import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { reportError } from '@/lib/errorReporting';
import { assertNoPendingForcedAck } from '@/lib/notification-ack';

interface RedeemRequestBody {
  productId: string;
  shippingInfo?: { name: string; phone: string; address: string };
  variantIndex?: number;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const userEmail = session.user.email;

  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const forcedAckBlock = await assertNoPendingForcedAck(userId, dbUser?.role);
    if (forcedAckBlock) return forcedAckBlock;

    const body: RedeemRequestBody = await req.json();
    const { productId, shippingInfo, variantIndex } = body;

    if (!productId) {
      return NextResponse.json({ error: 'productId required' }, { status: 400 });
    }

    const product = await prisma.pointsProduct.findUnique({
      where: { id: productId },
    });
    if (!product) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    if (!product.isActive) {
      return NextResponse.json({ error: '商品已下架' }, { status: 400 });
    }
    if (product.stock !== -1 && product.stock <= 0) {
      return NextResponse.json({ error: '商品库存不足' }, { status: 400 });
    }

    // Parse variants from metadata
    let variants: { name: string; cost: number }[] = [];
    if (product.metadata) {
      try {
        const meta = JSON.parse(product.metadata);
        if (Array.isArray(meta.variants)) {
          variants = (meta.variants as unknown[])
            .filter((v): v is { name: string; cost: number } =>
              !!v &&
              typeof (v as Record<string, unknown>).name === 'string' &&
              typeof (v as Record<string, unknown>).cost === 'number'
            )
            .slice(0, 3);
        }
      } catch {
        // ignore malformed metadata
      }
    }

    let activeVariant: { name: string; cost: number } | null = null;
    let activeCost = product.pointsCost;
    if (variants.length > 0) {
      if (variantIndex === undefined || variantIndex < 0 || variantIndex >= variants.length) {
        return NextResponse.json({ error: '请选择一个规格' }, { status: 400 });
      }
      activeVariant = variants[variantIndex];
      activeCost = activeVariant.cost;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, points: true },
    });
    if (!user) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }
    if (user.points < activeCost) {
      return NextResponse.json({ error: '积分不足' }, { status: 400 });
    }

    // Physical products require shipping info
    if (product.category === 'physical' && (!shippingInfo || !shippingInfo.name || !shippingInfo.phone || !shippingInfo.address)) {
      return NextResponse.json({ error: '实物商品需要填写收货信息' }, { status: 400 });
    }

    const newPoints = user.points - activeCost;
    const newStock = product.stock === -1 ? -1 : product.stock - 1;
    const displayName = activeVariant ? `${product.name}（${activeVariant.name}）` : product.name;

    // Atomic transaction: deduct points, decrement stock, create redemption + log + notification
    const { redemptionId } = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { points: newPoints },
      });
      await tx.pointsProduct.update({
        where: { id: productId },
        data: { stock: newStock },
      });
      const redemption = await tx.pointsRedemption.create({
        data: {
          userId,
          productId,
          productName: displayName,
          pointsCost: activeCost,
          status: 'pending',
          shippingInfo: shippingInfo ? JSON.stringify(shippingInfo) : null,
          variantName: activeVariant ? activeVariant.name : null,
        },
      });
      await tx.pointsLog.create({
        data: {
          userId,
          delta: -activeCost,
          type: 'redemption',
          reason: `兑换：${displayName}`,
          relatedId: redemption.id,
        },
      });
      return { redemptionId: redemption.id };
    });

    await prisma.notification.create({
      data: {
        email: userEmail,
        role: 'user',
        type: 'points_redemption',
        title: '积分兑换成功',
        content: `您已成功兑换「${displayName}」，消耗 ${activeCost} 积分，剩余 ${newPoints} 积分。`,
        linkUrl: '/account/points',
      },
    });

    return NextResponse.json({
      success: true,
      redemptionId,
      newPoints,
    });
  } catch (err) {
    reportError(err, { tags: { route: 'points/redeem' } });
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
