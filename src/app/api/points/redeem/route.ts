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

const SHIPPING_NAME_MAX = 50;
const SHIPPING_PHONE_MAX = 20;
const SHIPPING_ADDRESS_MAX = 500;

class RedeemConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedeemConflictError';
  }
}

function parseShippingInfo(
  shippingInfo: unknown
): { ok: true; value: { name: string; phone: string; address: string } } | { ok: false; error: string } {
  if (shippingInfo === null || shippingInfo === undefined) {
    return { ok: false, error: '实物商品需要填写收货信息' };
  }
  if (typeof shippingInfo !== 'object' || Array.isArray(shippingInfo)) {
    return { ok: false, error: '收货信息格式无效' };
  }
  const raw = shippingInfo as Record<string, unknown>;
  if (typeof raw.name !== 'string' || typeof raw.phone !== 'string' || typeof raw.address !== 'string') {
    return { ok: false, error: '收货信息格式无效' };
  }
  const name = raw.name.trim();
  const phone = raw.phone.trim();
  const address = raw.address.trim();
  if (!name || !phone || !address) {
    return { ok: false, error: '实物商品需要填写收货信息' };
  }
  if (name.length > SHIPPING_NAME_MAX) {
    return { ok: false, error: `收货人姓名不能超过 ${SHIPPING_NAME_MAX} 个字符` };
  }
  if (phone.length > SHIPPING_PHONE_MAX) {
    return { ok: false, error: `联系电话不能超过 ${SHIPPING_PHONE_MAX} 个字符` };
  }
  if (address.length > SHIPPING_ADDRESS_MAX) {
    return { ok: false, error: `收货地址不能超过 ${SHIPPING_ADDRESS_MAX} 个字符` };
  }
  return { ok: true, value: { name, phone, address } };
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

    let normalizedShipping: { name: string; phone: string; address: string } | null = null;
    if (product.category === 'physical') {
      const parsed = parseShippingInfo(shippingInfo);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      normalizedShipping = parsed.value;
    }

    const displayName = activeVariant ? `${product.name}（${activeVariant.name}）` : product.name;
    const unlimitedStock = product.stock === -1;

    // Atomic transaction: conditional decrement points/stock, create redemption + log
    const { redemptionId, newPoints } = await prisma.$transaction(async (tx) => {
      const pointsUpdate = await tx.user.updateMany({
        where: { id: userId, points: { gte: activeCost } },
        data: { points: { decrement: activeCost } },
      });
      if (pointsUpdate.count !== 1) {
        throw new RedeemConflictError('积分不足或已被其他操作修改，请刷新后重试');
      }

      if (!unlimitedStock) {
        const stockUpdate = await tx.pointsProduct.updateMany({
          where: { id: productId, stock: { gte: 1 } },
          data: { stock: { decrement: 1 } },
        });
        if (stockUpdate.count !== 1) {
          throw new RedeemConflictError('商品库存不足，请刷新后重试');
        }
      }

      const redemption = await tx.pointsRedemption.create({
        data: {
          userId,
          productId,
          productName: displayName,
          pointsCost: activeCost,
          status: 'pending',
          shippingInfo: normalizedShipping ? JSON.stringify(normalizedShipping) : null,
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
      const updatedUser = await tx.user.findUnique({
        where: { id: userId },
        select: { points: true },
      });
      return { redemptionId: redemption.id, newPoints: updatedUser?.points ?? 0 };
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
    if (err instanceof RedeemConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    reportError(err, { tags: { route: 'points/redeem' } });
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
