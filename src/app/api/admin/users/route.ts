import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { reportError } from '@/lib/errorReporting';
import { TIER_DISCOUNT_RATES } from '@/lib/discount';
import { requireAdmin } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { normalizeEmail } from '@/lib/auth-helpers';
import { buildLegacyInstitution, buildLegacySchoolFields, type InstitutionProfileInput } from '@/data/institution-profile';
import {
  ADMIN_USER_DELETE_ERRORS,
  adminUserDeleteBlockMessage,
  parseAdminUserDeleteIds,
} from '@/data/admin-user-delete';
import { validateNewPasswordLength } from '@/lib/password-policy';

function generateUserId() {
  return `usr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(req: Request) {
  const admin = await requireAdmin('customers.write');
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const emailRaw = typeof body.email === 'string' ? body.email.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const role = body.role === 'admin' ? 'admin' : 'customer';
    const institution = typeof body.institution === 'string' ? body.institution.trim() : '';
    const institutionType = typeof body.institutionType === 'string' ? body.institutionType.trim() : '';
    const institutionProfile: InstitutionProfileInput = {
      institutionType: institutionType || (typeof body.school === 'string' && body.school.trim() ? '高校' : ''),
      institutionName: typeof body.institutionName === 'string' ? body.institutionName.trim() : (typeof body.school === 'string' ? body.school.trim() : institution),
      institutionUnit: typeof body.institutionUnit === 'string' ? body.institutionUnit.trim() : (typeof body.college === 'string' ? body.college.trim() : ''),
      department: typeof body.institutionDepartment === 'string' ? body.institutionDepartment.trim() : (typeof body.department === 'string' ? body.department.trim() : (typeof body.major === 'string' ? body.major.trim() : '')),
      institutionFacility: typeof body.institutionFacility === 'string' ? body.institutionFacility.trim() : (typeof body.building === 'string' ? body.building.trim() : ''),
      piLab: typeof body.piLab === 'string' ? body.piLab.trim() : '',
      affiliatedLab: typeof body.affiliatedLab === 'string' ? body.affiliatedLab.trim() || null : null,
    };
    const hasStructuredProfile = Boolean(
      body.institutionName || body.institutionUnit || body.institutionDepartment || body.institutionFacility || body.piLab || body.affiliatedLab,
    );
    const legacy = buildLegacySchoolFields(institutionProfile);
    const legacyInstitution = hasStructuredProfile ? buildLegacyInstitution(institutionProfile) : institution;
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const tier = typeof body.tier === 'string' && Object.prototype.hasOwnProperty.call(TIER_DISCOUNT_RATES, body.tier)
      ? body.tier
      : 'standard';
    const approvalStatus = ['pending', 'approved', 'rejected'].includes(body.approvalStatus)
      ? body.approvalStatus
      : 'approved';

    if (role === 'admin') {
      const rolesAdmin = await requireAdmin('roles.manage');
      if (rolesAdmin instanceof NextResponse) return rolesAdmin;
    }

    if (!emailRaw) {
      return NextResponse.json({ error: '请填写邮箱' }, { status: 400 });
    }
    const email = normalizeEmail(emailRaw);
    if (!email.includes('@')) {
      return NextResponse.json({ error: '邮箱格式无效' }, { status: 400 });
    }
    const passwordLengthError = validateNewPasswordLength(password);
    if (passwordLengthError) {
      return NextResponse.json({ error: passwordLengthError }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: '该邮箱已存在' }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 12);
    const id = generateUserId();
    const created = await prisma.user.create({
      data: {
        id,
        name: name || email.split('@')[0],
        email,
        password: hashed,
        role,
        institution: legacyInstitution || institution || null,
        department: institutionProfile.department || null,
        institutionType: hasStructuredProfile ? institutionProfile.institutionType || null : null,
        institutionName: hasStructuredProfile ? institutionProfile.institutionName || null : null,
        institutionUnit: hasStructuredProfile ? institutionProfile.institutionUnit || null : null,
        institutionFacility: hasStructuredProfile ? institutionProfile.institutionFacility || null : null,
        school: legacy.school,
        college: legacy.college,
        major: legacy.major,
        building: legacy.building,
        piLab: hasStructuredProfile ? institutionProfile.piLab || null : null,
        affiliatedLab: hasStructuredProfile ? institutionProfile.affiliatedLab : null,
        phone: phone || null,
        tier,
        approvalStatus,
        isNewUser: approvalStatus !== 'approved',
        emailVerified: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
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
        phone: true,
        tier: true,
        approvalStatus: true,
        isFrozen: true,
        createdAt: true,
      },
    });

    await writeAuditLog({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'customer.created',
      resource: 'customers',
      targetType: 'User',
      targetId: created.id,
      after: created,
      reason: '管理员后台创建用户',
    });

    return NextResponse.json({ user: created }, { status: 201 });
  } catch (err) {
    reportError(err, { tags: { route: 'admin/users' }, extra: { method: 'POST' } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * 停用客户，不物理删除。
 * 积分流水、授信账户、应收、兑换和后台角色都挂在用户上并级联删除；
 * 订单 customerId 只是 SetNull。硬删除会拆掉财务记录，订单还在但客户主体没了。
 * 这里只把账号标为冻结，并逐个写审计。管理员、当前登录账号和组织负责人整批拒绝。
 */
export async function DELETE(req: Request) {
  const admin = await requireAdmin('customers.write');
  if (admin instanceof NextResponse) return admin;

  try {
    const body = await req.json().catch(() => null) as { userIds?: unknown } | null;
    const parsed = parseAdminUserDeleteIds(body?.userIds);
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { ids: userIds } = parsed;

    const targets = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, role: true, isFrozen: true, points: true },
    });
    if (targets.length !== userIds.length) {
      return NextResponse.json({ error: ADMIN_USER_DELETE_ERRORS.missing }, { status: 404 });
    }

    const protectedMessage = adminUserDeleteBlockMessage(targets, admin.id, []);
    if (protectedMessage) {
      return NextResponse.json({ error: protectedMessage }, { status: 403 });
    }

    const owner = await prisma.organization.findFirst({
      where: { ownerUserId: { in: userIds } },
      select: { ownerUserId: true },
    });
    if (owner) {
      return NextResponse.json({ error: ADMIN_USER_DELETE_ERRORS.owner }, { status: 403 });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.updateMany({
        where: { id: { in: userIds } },
        data: { isFrozen: true },
      });
      for (const target of targets) {
        await writeAuditLog({
          actorId: admin.id,
          actorEmail: admin.email,
          action: 'customer.deactivated',
          resource: 'customers',
          targetType: 'User',
          targetId: target.id,
          before: {
            email: target.email,
            role: target.role,
            isFrozen: target.isFrozen,
            points: target.points,
          },
          after: { isFrozen: true, points: target.points, hardDeleted: false },
          reason: '后台停用用户，保留积分流水、授信和订单',
          metadata: { hardDelete: false },
        }, tx);
      }
    });

    return NextResponse.json({ success: true, deactivated: userIds.length });
  } catch (err) {
    reportError(err, { tags: { route: 'admin/users' }, extra: { method: 'DELETE' } });
    return NextResponse.json({ error: ADMIN_USER_DELETE_ERRORS.failed }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const denied = await requireAdmin('customers.write');
  if (denied instanceof NextResponse) return denied;

  try {
    const { userIds, action, tier } = await req.json();
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({ error: 'userIds is required' }, { status: 400 });
    }

    if (action === 'approve') {
      await prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: { isNewUser: false, approvalStatus: 'approved' },
      });
    } else if (action === 'setTier' && tier && Object.prototype.hasOwnProperty.call(TIER_DISCOUNT_RATES, tier)) {
      await prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: { tier },
      });
    } else if (action === 'freeze' || action === 'unfreeze') {
      const targets = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, role: true, isFrozen: true },
      });
      if (targets.length === 0) {
        return NextResponse.json({ error: '未找到目标用户' }, { status: 404 });
      }
      if (targets.some((item) => item.role === 'admin')) {
        return NextResponse.json({ error: '不能冻结或解冻管理员账户' }, { status: 403 });
      }
      await prisma.user.updateMany({
        where: { id: { in: userIds } },
        data: { isFrozen: action === 'freeze' },
      });
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    reportError(err, { tags: { route: 'admin/users' }, extra: { method: 'PATCH' } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
