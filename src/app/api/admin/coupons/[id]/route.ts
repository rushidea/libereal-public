import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { couponScopeWriteData, unrestrictedCouponUpdateNeedsReapproval } from '@/lib/coupon-service';
import { requireAdmin } from '@/lib/session';

/**
 * 优惠券二次授权审批（落地 5 安全红线）：
 * - PATCH /api/admin/coupons/[id]：模板审批（approve/reject）——无门槛券模板生成后需授权；
 * - 同一路由 action=update：编辑模板名称、金额、有效期和适用范围。不改 type / stackable。
 *   无门槛券改优惠金额、发放上限、有效期或适用范围时，approvalStatus 回到 pending，并清空 approvedBy / approvedAt。
 *   核销仍读取模板审批态，未再次批准的模板不能继续被核销。满减券不回退审批。
 * - PATCH /api/admin/coupons/instances/[id]：实例发放审批——无门槛券发放后需授权。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin('pricing.write');
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { action, type } = body as { action?: string; type?: string };
  if (action === 'update') {
    return updateCouponTemplate(id, body);
  }
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'action 必须是 approve、reject 或 update' }, { status: 400 });
  }

  try {
    if (type === 'instance') {
      const inst = await prisma.couponInstance.findUnique({ where: { id } });
      if (!inst) return NextResponse.json({ error: '券实例不存在' }, { status: 404 });
      if (action === 'approve') {
        // 安全红线：仅「待授权（pending）」实例可审批通过。
        // 已生效/已使用/已作废的券一律不可重新启用（防止已核销券复活二次消费）。
        if (inst.issueApprovalStatus === 'approved') {
          return NextResponse.json({ error: '该券实例已审批通过，无需重复操作' }, { status: 400 });
        }
        if (inst.status !== 'pending') {
          return NextResponse.json({ error: '仅待授权的券实例可审批通过（当前状态不可重新启用）' }, { status: 400 });
        }
      } else if (inst.status === 'used') {
        // 已核销的券不可驳回（核销记录与订单绑定，避免审计链路断裂）
        return NextResponse.json({ error: '该券已使用，不可驳回' }, { status: 400 });
      }
      await prisma.couponInstance.update({
        where: { id },
        data: {
          issueApprovalStatus: action === 'approve' ? 'approved' : 'rejected',
          status: action === 'approve' ? 'active' : 'revoked',
          approvedBy: action === 'approve' ? user.id ?? null : undefined,
          approvedAt: action === 'approve' ? new Date() : undefined,
        },
      });
      return NextResponse.json({ success: true, message: action === 'approve' ? '券已授权发放' : '券已驳回' });
    }

    // 模板审批
    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon) return NextResponse.json({ error: '券模板不存在' }, { status: 404 });
    await prisma.coupon.update({
      where: { id },
      data: {
        approvalStatus: action === 'approve' ? 'approved' : 'rejected',
        approvedBy: user.id ?? null,
        approvedAt: new Date(),
      },
    });
    return NextResponse.json({ success: true, message: action === 'approve' ? '券模板已授权' : '券模板已驳回' });
  } catch (err) {
    console.error('[admin/coupons PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** 编辑券模板。不改 type / stackable。无门槛券的敏感字段变更会撤回模板授权。权限：pricing.write。 */
async function updateCouponTemplate(id: string, body: {
  name?: unknown;
  threshold?: unknown;
  discount?: unknown;
  validDays?: unknown;
  maxUses?: unknown;
  description?: unknown;
  scopeType?: unknown;
  scopeTargets?: unknown;
}) {
  try {
    const coupon = await prisma.coupon.findUnique({ where: { id } });
    if (!coupon) return NextResponse.json({ error: '券模板不存在' }, { status: 404 });

    const name = typeof body.name === 'string' ? body.name.trim() : coupon.name;
    if (!name) return NextResponse.json({ error: '券名称不能为空' }, { status: 400 });

    const discountNum = body.discount == null ? coupon.discount : Number(body.discount);
    if (!Number.isFinite(discountNum) || discountNum <= 0) {
      return NextResponse.json({ error: '优惠金额必须大于 0' }, { status: 400 });
    }

    let thresholdNum = coupon.threshold;
    if (coupon.type === 'threshold') {
      thresholdNum = body.threshold == null ? coupon.threshold : Number(body.threshold);
      if (!Number.isFinite(thresholdNum) || thresholdNum <= 0) {
        return NextResponse.json({ error: '满减券门槛金额必须大于 0' }, { status: 400 });
      }
    }

    if (body.scopeTargets != null && (body.scopeType == null || body.scopeType === '')) {
      return NextResponse.json({ error: '修改适用范围时必须同时提交范围类型' }, { status: 400 });
    }
    const scope = body.scopeType != null && body.scopeType !== ''
      ? await couponScopeWriteData({ scopeType: body.scopeType, scopeTargets: body.scopeTargets })
      : { ok: true as const, scopeType: coupon.scopeType, scopeTargets: coupon.scopeTargets };
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: 400 });

    let validUntil = coupon.validUntil;
    if (body.validDays != null && body.validDays !== '') {
      const days = Number(body.validDays);
      if (!Number.isFinite(days) || days < 0) {
        return NextResponse.json({ error: '有效天数无效' }, { status: 400 });
      }
      validUntil = days > 0 ? new Date(Date.now() + days * 86400000) : null;
    }

    const maxUses = body.maxUses == null ? coupon.maxUses : Number(body.maxUses);
    if (!Number.isFinite(maxUses) || maxUses < 0) {
      return NextResponse.json({ error: '发放上限无效' }, { status: 400 });
    }
    const normalizedMaxUses = maxUses > 0 ? Math.floor(maxUses) : 0;
    const needsReapproval = unrestrictedCouponUpdateNeedsReapproval(coupon, {
      discount: discountNum,
      maxUses: normalizedMaxUses,
      validUntil,
      scopeType: scope.scopeType,
      scopeTargets: scope.scopeTargets,
    });

    const updated = await prisma.coupon.update({
      where: { id },
      data: {
        name,
        threshold: coupon.type === 'threshold' ? thresholdNum : 0,
        discount: discountNum,
        description: body.description == null
          ? coupon.description
          : (typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null),
        maxUses: normalizedMaxUses,
        validUntil,
        scopeType: scope.scopeType,
        scopeTargets: scope.scopeTargets,
        // 已发放实例的发放审批记录保持不变。核销和可用券列表都会再看模板 approvalStatus，
        // 模板回到 pending 后，这些实例不能继续核销，直到模板再次批准。
        ...(needsReapproval ? { approvalStatus: 'pending', approvedBy: null, approvedAt: null } : {}),
      },
    });
    return NextResponse.json({
      success: true,
      id: updated.id,
      approvalStatus: updated.approvalStatus,
      scopeType: updated.scopeType,
      scopeTargets: updated.scopeTargets,
      message: needsReapproval
        ? '无门槛券的优惠金额、发放上限、有效期或适用范围已变更，需重新二次授权后生效'
        : '券模板已更新',
    });
  } catch (err) {
    console.error('[admin/coupons update]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
