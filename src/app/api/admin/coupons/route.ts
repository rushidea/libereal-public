import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

function newCouponCode(): string {
  // 12 位大写字母+数字券码（排除易混淆字符）
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

/** GET：模板列表（含实例数与授权状态） */
export async function GET() {
  const user = await requireAdmin('pricing.read');
  if (user instanceof NextResponse) return user;

  try {
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { instances: true } } },
    });
    return NextResponse.json(coupons);
  } catch (err) {
    console.error('[admin/coupons GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST：创建券模板（无门槛券 → 待授权；满减券 → 直接生效）；action=issue 时发放券 */
export async function POST(request: Request) {
  const user = await requireAdmin('pricing.write');
  if (user instanceof NextResponse) return user;

  try {
    const body = await request.json();
    const { action } = body;
    if (action === 'issue') {
      return await issueCoupon(request, user);
    }

    const { name, type, threshold, discount, validDays, maxUses, description } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: '券名称不能为空' }, { status: 400 });
    }
    const couponType = type === 'unrestricted' ? 'unrestricted' : 'threshold';
    const discountNum = Number(discount);
    if (!Number.isFinite(discountNum) || discountNum <= 0) {
      return NextResponse.json({ error: '优惠金额必须大于 0' }, { status: 400 });
    }
    const thresholdNum = couponType === 'threshold' ? Number(threshold) : 0;
    if (couponType === 'threshold' && (!Number.isFinite(thresholdNum) || thresholdNum <= 0)) {
      return NextResponse.json({ error: '满减券门槛金额必须大于 0' }, { status: 400 });
    }

    const now = new Date();
    // 无门槛券：模板生成即需二次授权（安全红线：避免错误生成）
    const requiresApproval = couponType === 'unrestricted';
    const coupon = await prisma.coupon.create({
      data: {
        name: name.trim(),
        type: couponType,
        threshold: thresholdNum,
        discount: discountNum,
        stackable: couponType === 'unrestricted',
        requiresApproval,
        approvalStatus: requiresApproval ? 'pending' : 'auto',
        createdBy: user.id ?? null,
        maxUses: Number(maxUses) > 0 ? Number(maxUses) : 0,
        description: description?.trim() || null,
        validFrom: now,
        validUntil: Number(validDays) > 0
          ? new Date(now.getTime() + Number(validDays) * 86400000)
          : null,
      },
    });

    return NextResponse.json({
      success: true,
      id: coupon.id,
      approvalStatus: coupon.approvalStatus,
      message: requiresApproval ? '无门槛券已创建，需管理员二次授权后生效' : '满减券已生效',
    });
  } catch (err) {
    console.error('[admin/coupons POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** 发放券（定向/通用；无门槛券发放同样需二次授权）。user 已通过权限校验。 */
async function issueCoupon(request: Request, user: { id?: string | null }) {
  try {
    const body = await request.json();
    const { couponId, userId, count } = body;
    if (!couponId || typeof couponId !== 'string') {
      return NextResponse.json({ error: '缺少券模板 id' }, { status: 400 });
    }
    const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) return NextResponse.json({ error: '券模板不存在' }, { status: 404 });

    // 无门槛券发放二次授权：创建实例即标记 pending，管理员确认后 active
    const requiresIssueApproval = coupon.requiresApproval;
    const issueCount = Math.max(1, Math.min(Number(count) || 1, 100));

    // 模板总量红线：maxUses>0 时，已发放实例数 + 本次发放数不得超过 maxUses
    if (coupon.maxUses > 0) {
      const issuedCount = await prisma.couponInstance.count({ where: { couponId: coupon.id } });
      const remaining = Math.max(0, coupon.maxUses - issuedCount);
      if (issueCount > remaining) {
        return NextResponse.json(
          {
            error: `该券模板总量上限 ${coupon.maxUses} 张，已发放 ${issuedCount} 张，本次最多还能发 ${remaining} 张`,
          },
          { status: 400 },
        );
      }
    }

    const instances = [];
    for (let i = 0; i < issueCount; i++) {
      let code = newCouponCode();
      // 撞码重试
      for (let attempt = 0; attempt < 5; attempt++) {
        const exists = await prisma.couponInstance.findUnique({ where: { code } });
        if (!exists) break;
        code = newCouponCode();
      }
      const inst = await prisma.couponInstance.create({
        data: {
          couponId: coupon.id,
          userId: userId || null,
          code,
          status: requiresIssueApproval ? 'pending' : 'active',
          issueApprovalStatus: requiresIssueApproval ? 'pending' : 'auto',
          issuedBy: user.id ?? null,
          expiresAt: coupon.validUntil,
        },
      });
      instances.push(inst);
    }

    return NextResponse.json({
      success: true,
      issued: instances.length,
      requiresApproval: requiresIssueApproval,
      message: requiresIssueApproval
        ? `已生成 ${instances.length} 张无门槛券，需管理员二次授权后发放`
        : `已发放 ${instances.length} 张券`,
    });
  } catch (err) {
    console.error('[admin/coupons issue]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
