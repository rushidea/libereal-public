import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { requireAdmin, getAdminPermissions } from '@/lib/session';
import { writeAuditLog } from '@/lib/audit';
import { isAdminEmail, normalizeEmail } from '@/lib/auth-helpers';
import { getAdminMfaPolicy } from '@/lib/security/admin-mfa-policy';
import { isMfaPhase1Enabled } from '@/lib/security/mfa-config';
import { consumeSecurityStepUpGrant } from '@/lib/security/security-step-up';
import { getAdminMfaSettings, saveAdminMfaScenarioConfig } from '@/lib/admin-mfa-settings';

function isUniqueConstraintError(error: unknown): error is { code: 'P2002' } {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

async function canManageSuperAdmin(admin: { id: string; email: string }): Promise<boolean> {
  if (isAdminEmail(admin.email)) return true;
  const assignment = await prisma.adminUserRole.findFirst({
    where: { userId: admin.id, role: { key: 'super_admin' } },
    select: { userId: true },
  });
  return Boolean(assignment);
}

export async function GET(req: NextRequest) {
  const admin = await requireAdmin('admin.access');
  if (admin instanceof NextResponse) return admin;

  const view = new URL(req.url).searchParams.get('view') || 'current';
  const permissions = await getAdminPermissions(admin);

  if (view === 'mfa-policy') {
    if (!permissions.includes('roles.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    return NextResponse.json(await getAdminMfaSettings());
  }

  if (view === 'current') {
    const mfaPolicy = await getAdminMfaPolicy(admin.id, admin.email);
    if (isAdminEmail(admin.email)) {
      return NextResponse.json({
        permissions,
        roles: [{ id: 'role_super_admin', key: 'super_admin', name: '超级管理员' }],
        mfaPolicy,
      });
    }
    const assignments = await prisma.adminUserRole.findMany({
      where: { userId: admin.id },
      select: { role: { select: { id: true, key: true, name: true } } },
    });
    return NextResponse.json({ permissions, roles: assignments.map((item) => item.role), mfaPolicy });
  }

  if (view === 'manage') {
    if (!permissions.includes('roles.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const [allRoles, users, mayManageSuperAdmin] = await Promise.all([
      prisma.adminRole.findMany({
        orderBy: { name: 'asc' },
        include: { permissions: { select: { permission: { select: { key: true, name: true } } } } },
      }),
      prisma.user.findMany({
        where: { role: 'admin' },
        orderBy: { email: 'asc' },
        select: { id: true, name: true, email: true, adminRoleAssignments: { select: { roleId: true } } },
      }),
      canManageSuperAdmin(admin),
    ]);
    const roles = mayManageSuperAdmin ? allRoles : allRoles.filter((role) => role.key !== 'super_admin');
    return NextResponse.json({ roles, users, canManageSuperAdmin: mayManageSuperAdmin });
  }

  if (view === 'audit') {
    if (!permissions.includes('audit.read')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const searchParams = new URL(req.url).searchParams;
    const resource = searchParams.get('resource')?.trim();
    const logs = await prisma.auditLog.findMany({
      where: resource ? { resource } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Number(searchParams.get('take') || 100), 1), 500),
    });
    return NextResponse.json({ logs });
  }

  return NextResponse.json({ error: 'Invalid view' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const stepUpToken = typeof body.grantToken === 'string' ? body.grantToken.trim() : undefined;
  const stepUpAction = body.view === 'mfa-policy' ? 'admin_mfa_policy' : 'admin_sensitive';
  const admin = await requireAdmin('roles.manage', { token: stepUpToken, action: stepUpAction });
  if (admin instanceof NextResponse) return admin;

  if (body.view === 'mfa-policy') {
    if (!isMfaPhase1Enabled()) return NextResponse.json({ error: 'MFA adjustment unavailable' }, { status: 409 });
    if (!admin.sessionId) return NextResponse.json({ error: 'Active session required' }, { status: 409 });
    const grantToken = typeof body.grantToken === 'string' ? body.grantToken.trim() : '';
    const authorized = await consumeSecurityStepUpGrant(grantToken, { userId: admin.id, sessionId: admin.sessionId, action: 'admin_mfa_policy' });
    if (!authorized) return NextResponse.json({ error: 'Immediate MFA verification required' }, { status: 403 });

    const previous = await getAdminMfaSettings();
    const scenarios = await saveAdminMfaScenarioConfig({ scenarios: body.scenarios, updatedByEmail: admin.email });
    await writeAuditLog({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'admin.mfa_policy_changed',
      resource: 'security',
      targetType: 'AdminMfaSetting',
      targetId: 'default',
      before: { enabled: previous.enabled, scenarios: previous.scenarios },
      after: { enabled: previous.enabled, scenarios },
      reason: '管理员 MFA 情景调整',
    });
    return NextResponse.json({ success: true, scenarios });
  }

  if (body.view === 'create-internal-user') {
    if (stepUpToken) {
      if (!admin.sessionId || !(await consumeSecurityStepUpGrant(stepUpToken, { userId: admin.id, sessionId: admin.sessionId, action: 'admin_sensitive' }))) {
        return NextResponse.json({ error: 'Immediate MFA verification required' }, { status: 403 });
      }
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const email = typeof body.email === 'string' ? normalizeEmail(body.email.trim()) : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const roleIds: string[] = Array.isArray(body.roleIds)
      ? Array.from(new Set<string>(body.roleIds.filter((id: unknown): id is string => typeof id === 'string')))
      : [];

    if (!name || name.length > 100) return NextResponse.json({ error: '姓名长度需在 1 到 100 个字符之间' }, { status: 400 });
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: '邮箱格式无效' }, { status: 400 });
    if (password.length < 8 || password.length > 128) return NextResponse.json({ error: '密码长度需在 8 到 128 个字符之间' }, { status: 400 });
    if (roleIds.length === 0) return NextResponse.json({ error: '请至少选择一个管理角色' }, { status: 400 });

    const [existing, validRoles] = await Promise.all([
      prisma.user.findUnique({ where: { email }, select: { id: true } }),
      prisma.adminRole.findMany({ where: { id: { in: roleIds } }, select: { id: true, key: true, name: true } }),
    ]);
    if (existing) return NextResponse.json({ error: '该邮箱已存在' }, { status: 409 });
    if (validRoles.length !== roleIds.length) return NextResponse.json({ error: '包含无效管理角色' }, { status: 400 });
    if (validRoles.some((role) => role.key === 'super_admin') && !(await canManageSuperAdmin(admin))) {
      return NextResponse.json({ error: '仅系统管理员或超级管理员可授予超级管理员角色' }, { status: 403 });
    }
    if (isAdminEmail(email) && !validRoles.some((role) => role.key === 'super_admin')) {
      return NextResponse.json({ error: '系统管理员邮箱必须使用超级管理员角色' }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    let created;
    try {
      created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name,
            email,
            password: passwordHash,
            role: 'admin',
            approvalStatus: 'approved',
            isNewUser: false,
            emailVerified: new Date(),
          },
          select: { id: true, name: true, email: true, role: true, createdAt: true },
        });
        await tx.adminUserRole.createMany({ data: roleIds.map((roleId) => ({ userId: user.id, roleId, assignedBy: admin.id })) });
        await writeAuditLog({
          actorId: admin.id,
          actorEmail: admin.email,
          action: 'internal_user.created',
          resource: 'roles',
          targetType: 'User',
          targetId: user.id,
          after: { ...user, roles: validRoles },
          reason: '权限与审计页面创建内部用户',
        }, tx);
        return user;
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return NextResponse.json({ error: '该邮箱已存在' }, { status: 409 });
      throw error;
    }

    return NextResponse.json({ user: created, roles: validRoles }, { status: 201 });
  }

  const userId = typeof body.userId === 'string' ? body.userId : '';
  if (stepUpToken) {
    if (!admin.sessionId || !(await consumeSecurityStepUpGrant(stepUpToken, { userId: admin.id, sessionId: admin.sessionId, action: 'admin_sensitive' }))) {
      return NextResponse.json({ error: 'Immediate MFA verification required' }, { status: 403 });
    }
  }
  const roleIds: string[] = Array.isArray(body.roleIds)
    ? Array.from(new Set<string>(body.roleIds.filter((id: unknown): id is string => typeof id === 'string')))
    : [];
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

  const [target, validRoles, previous] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true } }),
    prisma.adminRole.findMany({ where: { id: { in: roleIds } }, select: { id: true, key: true, name: true } }),
    prisma.adminUserRole.findMany({ where: { userId }, select: { roleId: true, role: { select: { key: true, name: true } } } }),
  ]);
  if (!target) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
  if (validRoles.length !== roleIds.length) return NextResponse.json({ error: '包含无效管理角色' }, { status: 400 });
  const changesSuperAdmin = validRoles.some((role) => role.key === 'super_admin') || previous.some((role) => role.role.key === 'super_admin');
  if (changesSuperAdmin && !(await canManageSuperAdmin(admin))) {
    return NextResponse.json({ error: '仅系统管理员或超级管理员可授予或撤销超级管理员角色' }, { status: 403 });
  }
  if (isAdminEmail(target.email) && !validRoles.some((role) => role.key === 'super_admin')) {
    return NextResponse.json({ error: '系统管理员邮箱必须保留超级管理员角色' }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    await tx.adminUserRole.deleteMany({ where: { userId } });
    if (roleIds.length) {
      await tx.adminUserRole.createMany({ data: roleIds.map((roleId) => ({ userId, roleId, assignedBy: admin.id })) });
    }
    await tx.user.update({ where: { id: userId }, data: { role: roleIds.length ? 'admin' : 'customer' } });
    await writeAuditLog({
      actorId: admin.id,
      actorEmail: admin.email,
      action: 'roles.changed',
      resource: 'roles',
      targetType: 'User',
      targetId: userId,
      before: { role: target.role, roles: previous.map((item) => ({ id: item.roleId, ...item.role })) },
      after: { role: roleIds.length ? 'admin' : 'customer', roles: validRoles },
      reason: typeof body.reason === 'string' ? body.reason : null,
    }, tx);
  });

  return NextResponse.json({ success: true, roles: validRoles });
}
