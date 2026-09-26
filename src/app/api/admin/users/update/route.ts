import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { requireAdminPointsMutation } from '@/lib/admin-points-step-up';
import type { Prisma } from '@prisma/client';
import { TIER_DISCOUNT_RATES } from '@/lib/discount';
import { writeAuditLog } from '@/lib/audit';
import { validatePointsTarget } from '@/lib/points';
import { normalizeEmail } from '@/lib/auth-helpers';
import { buildLegacyInstitution, buildLegacySchoolFields, type InstitutionProfileInput } from '@/data/institution-profile';

function isEmptyBrandDiscounts(value: unknown): boolean {
  return value === null || value === '' || (typeof value === 'object' && value !== null && !Array.isArray(value) && Object.keys(value as object).length === 0);
}

function parseBrandDiscountsPayload(brandDiscounts: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (isEmptyBrandDiscounts(brandDiscounts)) {
    return { ok: true, value: null };
  }
  try {
    const parsed = typeof brandDiscounts === 'string' ? JSON.parse(brandDiscounts) : brandDiscounts;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'brandDiscounts 需为合法 JSON 对象' };
    }
    for (const [, rate] of Object.entries(parsed as Record<string, number>)) {
      if (typeof rate !== 'number' || rate < 0 || rate > 2) {
        return { ok: false, error: '品牌折扣率需在 0~2 之间' };
      }
    }
    if (Object.keys(parsed as object).length === 0) {
      return { ok: true, value: null };
    }
    return { ok: true, value: JSON.stringify(parsed) };
  } catch {
    return { ok: false, error: 'brandDiscounts 需为合法 JSON 格式' };
  }
}

export async function PUT(req: NextRequest) {
  const user = await requireAdmin('customers.write');
  if (user instanceof NextResponse) return user;

  try {
    const body = await req.json();
    const {
      userId,
      name,
      email,
      password,
      role,
      institution,
      department,
      institutionType,
      institutionName,
      institutionUnit,
      institutionDepartment,
      institutionFacility,
      piLab,
      affiliatedLab,
      phone,
      identity,
      discountRate,
      brandDiscounts,
      tier,
      points,
      isNewUser,
      approvalStatus,
      isBlacklisted,
      isFrozen,
    } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    const touchesPricing = discountRate !== undefined || brandDiscounts !== undefined;
    if (touchesPricing) {
      const pricingAdmin = await requireAdmin('pricing.write');
      if (pricingAdmin instanceof NextResponse) return pricingAdmin;
    }
    if (points !== undefined) {
      const pointsAdmin = await requireAdminPointsMutation(typeof body.stepUpToken === 'string' ? body.stepUpToken.trim() : undefined);
      if (pointsAdmin instanceof NextResponse) return pointsAdmin;
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        points: true,
        phone: true,
        institution: true,
        department: true,
        institutionType: true,
        institutionName: true,
        institutionUnit: true,
        institutionFacility: true,
        school: true,
        college: true,
        major: true,
        building: true,
        piLab: true,
        affiliatedLab: true,
        identity: true,
        approvalStatus: true,
        isBlacklisted: true,
        isFrozen: true,
        isNewUser: true,
        tier: true,
        discountRate: true,
        brandDiscounts: true,
      },
    });
    if (!targetUser) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    }

    const hasStatusChange = approvalStatus !== undefined || isBlacklisted !== undefined || isFrozen !== undefined;
    if ((hasStatusChange || role !== undefined) && targetUser.role === 'admin') {
      return NextResponse.json({ error: '管理员账户状态与角色请通过权限管理页面操作' }, { status: 403 });
    }

    if (approvalStatus !== undefined && !['pending', 'approved', 'rejected'].includes(approvalStatus)) {
      return NextResponse.json({ error: '无效的审核状态' }, { status: 400 });
    }
    if (role !== undefined && role !== 'customer' && role !== 'admin') {
      return NextResponse.json({ error: '无效的角色' }, { status: 400 });
    }

    const nextRole = role === 'admin' || role === 'customer' ? role : targetUser.role;
    // 按更新后角色判定：最终为管理员时不允许携带冻结字段，也不允许保留已冻结状态升为管理员
    if (nextRole === 'admin' && isFrozen !== undefined) {
      return NextResponse.json({ error: '不能冻结或解冻管理员账户' }, { status: 403 });
    }
    if (nextRole === 'admin' && targetUser.isFrozen) {
      return NextResponse.json({ error: '已冻结账户不能设为管理员，请先解冻' }, { status: 403 });
    }

    const roleChanging = role !== undefined && role !== targetUser.role;
    if (roleChanging || role === 'admin') {
      const rolesAdmin = await requireAdmin('roles.manage');
      if (rolesAdmin instanceof NextResponse) return rolesAdmin;
    }

    // ---- 先完成全部校验，再统一写入 ----
    const updateData: Prisma.UserUpdateManyMutationInput = {};

    if (typeof name === 'string') updateData.name = name.trim() || null;
    const hasStructuredProfile = institutionType !== undefined || institutionName !== undefined || institutionUnit !== undefined || institutionDepartment !== undefined || institutionFacility !== undefined || piLab !== undefined || affiliatedLab !== undefined;
    if (hasStructuredProfile) {
      const profile: InstitutionProfileInput = {
        institutionType: typeof institutionType === 'string' ? institutionType.trim() : targetUser.institutionType ?? '',
        institutionName: typeof institutionName === 'string' ? institutionName.trim() : targetUser.institutionName ?? targetUser.school ?? targetUser.institution ?? '',
        institutionUnit: typeof institutionUnit === 'string' ? institutionUnit.trim() : targetUser.institutionUnit ?? targetUser.college ?? '',
        department: typeof institutionDepartment === 'string' ? institutionDepartment.trim() : typeof department === 'string' ? department.trim() : targetUser.department ?? targetUser.major ?? '',
        institutionFacility: typeof institutionFacility === 'string' ? institutionFacility.trim() : targetUser.institutionFacility ?? targetUser.building ?? '',
        piLab: typeof piLab === 'string' ? piLab.trim() : targetUser.piLab ?? '',
        affiliatedLab: typeof affiliatedLab === 'string' ? affiliatedLab.trim() || null : targetUser.affiliatedLab ?? null,
      };
      const legacy = buildLegacySchoolFields(profile);
      updateData.institution = buildLegacyInstitution(profile) || null;
      updateData.institutionType = profile.institutionType || null;
      updateData.institutionName = profile.institutionName || null;
      updateData.institutionUnit = profile.institutionUnit || null;
      updateData.department = profile.department || null;
      updateData.institutionFacility = profile.institutionFacility || null;
      updateData.school = legacy.school;
      updateData.college = legacy.college;
      updateData.major = legacy.major;
      updateData.building = legacy.building;
      updateData.piLab = profile.piLab || null;
      updateData.affiliatedLab = profile.affiliatedLab;
    } else {
      if (typeof institution === 'string') updateData.institution = institution.trim() || null;
      if (typeof department === 'string') updateData.department = department.trim() || null;
    }
    if (typeof phone === 'string') updateData.phone = phone.trim() || null;
    if (typeof identity === 'string') updateData.identity = identity.trim() || null;
    if (role === 'customer' || role === 'admin') updateData.role = role;

    if (typeof email === 'string' && email.trim()) {
      const nextEmail = normalizeEmail(email.trim());
      if (!nextEmail.includes('@')) {
        return NextResponse.json({ error: '邮箱格式无效' }, { status: 400 });
      }
      if (nextEmail !== targetUser.email.toLowerCase()) {
        const clash = await prisma.user.findUnique({ where: { email: nextEmail }, select: { id: true } });
        if (clash) {
          return NextResponse.json({ error: '该邮箱已被其他账号使用' }, { status: 409 });
        }
        updateData.email = nextEmail;
      }
    }

    if (typeof password === 'string' && password.length > 0) {
      if (password.length < 8) {
        return NextResponse.json({ error: '密码至少 8 位' }, { status: 400 });
      }
      updateData.password = await bcrypt.hash(password, 12);
    }

    if (approvalStatus !== undefined) {
      updateData.approvalStatus = approvalStatus;
      if (approvalStatus === 'approved') updateData.isNewUser = false;
    }
    if (isBlacklisted !== undefined) updateData.isBlacklisted = Boolean(isBlacklisted);
    if (isFrozen !== undefined) updateData.isFrozen = Boolean(isFrozen);

    if (discountRate !== undefined) {
      if (discountRate === null || discountRate === '') {
        updateData.discountRate = null;
      } else {
        const rate = parseFloat(discountRate);
        if (isNaN(rate) || rate < 0 || rate > 2) {
          return NextResponse.json({ error: '折扣率需在 0~2 之间，如 0.85 表示 85 折' }, { status: 400 });
        }
        updateData.discountRate = rate;
      }
    }

    if (brandDiscounts !== undefined) {
      const parsed = parseBrandDiscountsPayload(brandDiscounts);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      updateData.brandDiscounts = parsed.value;
    }

    if (tier !== undefined) {
      if (!Object.prototype.hasOwnProperty.call(TIER_DISCOUNT_RATES, tier)) {
        return NextResponse.json({ error: '无效的客户等级' }, { status: 400 });
      }
      updateData.tier = tier;
    }

    let pointsDelta: number | null = null;
    let nextPoints: number | null = null;
    if (points !== undefined) {
      const pts = typeof points === 'number'
        ? points
        : typeof points === 'string' && points.trim()
          ? Number(points)
          : Number.NaN;
      const validation = validatePointsTarget(pts);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
      if (!Number.isInteger(pts)) {
        return NextResponse.json({ error: '积分必须是数字' }, { status: 400 });
      }
      nextPoints = pts;
      pointsDelta = pts - targetUser.points;
      updateData.points = pts;
    }

    if (isNewUser !== undefined) {
      updateData.isNewUser = !!isNewUser;
      if (!isNewUser) updateData.approvalStatus = 'approved';
    }

    const statusMessages: string[] = [];
    if (approvalStatus === 'approved' && targetUser.approvalStatus !== 'approved') {
      statusMessages.push('账号审核已通过，可以正常使用账户功能。');
    }
    if (approvalStatus === 'rejected' && targetUser.approvalStatus !== 'rejected') {
      statusMessages.push('账号审核未通过，请联系客服了解详情。');
    }
    if (isBlacklisted === true && !targetUser.isBlacklisted) {
      statusMessages.push('账户限制已生效，当前无法提交订单或询价。');
    }
    if (isBlacklisted === false && targetUser.isBlacklisted) {
      statusMessages.push('账户限制已解除，可以恢复提交订单或询价。');
    }
    if (isFrozen === true && !targetUser.isFrozen) {
      statusMessages.push('账户已冻结：仍可登录，但无法看到折扣价格，也无法提交订单或询价。');
    }
    if (isFrozen === false && targetUser.isFrozen) {
      statusMessages.push('账户冻结已解除，折扣价格与下单询价功能已恢复。');
    }

    const notifyEmail = typeof updateData.email === 'string' ? updateData.email : targetUser.email;
    const shouldNotifyApproval = isNewUser !== undefined && !isNewUser;

    const transactionResult = await prisma.$transaction(async (tx) => {
      if (points !== undefined) {
        const changed = await tx.user.updateMany({
          where: { id: userId, points: targetUser.points },
          data: updateData,
        });
        if (changed.count !== 1) return { conflict: true as const };
      } else if (Object.keys(updateData).length > 0) {
        await tx.user.update({ where: { id: userId }, data: updateData });
      }

      if (pointsDelta != null && pointsDelta !== 0 && nextPoints != null) {
        await tx.pointsLog.create({
          data: {
            userId,
            delta: pointsDelta,
            type: 'admin_adjust',
            reason: 'admin/users/update 编辑',
            adminEmail: user.email,
          },
        });
      }

      if (statusMessages.length > 0) {
        await tx.notification.create({
          data: {
            email: notifyEmail,
            role: 'customer',
            type: 'account_status_changed',
            title: '账户状态更新',
            content: statusMessages.join(' '),
            linkUrl: '/account',
            metadata: JSON.stringify({ userId }),
          },
        });
      }

      if (shouldNotifyApproval) {
        await tx.notification.create({
          data: {
            email: targetUser.email,
            role: 'user',
            type: 'approval',
            title: '账户审核已通过',
            content: '您的账户已通过审核，现在可以正常使用所有功能。',
          },
        });
      }
      return { conflict: false as const };
    });
    if (transactionResult.conflict) {
      return NextResponse.json({ error: '积分已被其他操作修改，请刷新后重试' }, { status: 409 });
    }

    const updatedUser = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        email: true,
        role: true,
        phone: true,
        institution: true,
        department: true,
        institutionType: true,
        institutionName: true,
        institutionUnit: true,
        institutionFacility: true,
        school: true,
        college: true,
        major: true,
        building: true,
        piLab: true,
        affiliatedLab: true,
        identity: true,
        points: true,
        approvalStatus: true,
        isBlacklisted: true,
        isFrozen: true,
        isNewUser: true,
        tier: true,
        discountRate: true,
        brandDiscounts: true,
      },
    });
    await writeAuditLog({
      actorId: user.id,
      actorEmail: user.email,
      action: hasStatusChange ? 'customer.account_status_changed' : points !== undefined ? 'points.adjusted' : 'customer.profile_changed',
      resource: points !== undefined ? 'points' : 'customers',
      targetType: 'User',
      targetId: userId,
      before: targetUser,
      after: updatedUser,
      reason: '客户管理页面修改',
    });
    return NextResponse.json({ success: true, user: updatedUser });
  } catch (err) {
    console.error('[admin/users/update]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
