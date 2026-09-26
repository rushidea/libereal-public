import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { requireAdmin } from '@/lib/session';
import { requireAdminPointsMutation } from '@/lib/admin-points-step-up';
import { writeAuditLog } from '@/lib/audit';
import { validatePointsTarget } from '@/lib/points';
import { buildLegacyInstitution, buildLegacySchoolFields, type InstitutionProfileInput } from '@/data/institution-profile';

function parseBrandDiscounts(value: string | null): Record<string, number> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, number>;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const denied = await requireAdmin('customers.read');
  if (denied instanceof NextResponse) return denied;

  try {
    const { searchParams } = new URL(req.url);
    const roleFilter = searchParams.get('role') || 'customer';

    const users = await prisma.user.findMany({
      where: { role: roleFilter },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, email: true, phone: true, institution: true,
        department: true, institutionType: true, institutionName: true, institutionUnit: true, institutionFacility: true,
        school: true, college: true, major: true, building: true, piLab: true, affiliatedLab: true,
        role: true, tier: true, points: true, creditAccount: true,
        discountRate: true, brandDiscounts: true, sourceTemplateId: true, createdAt: true,
      },
    });

    return NextResponse.json({
      users: users.map(user => ({
        ...user,
        brandDiscounts: parseBrandDiscounts(user.brandDiscounts),
      })),
    });
  } catch (err) {
    console.error('[admin/users GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin('customers.write');
  if (admin instanceof NextResponse) return admin;

  try {
    const { id } = await params;
    const body = await req.json() as {
      tier?: string;
      discountRate?: number | null;
      brandDiscounts?: Record<string, number> | null;
      points?: number;
      stepUpToken?: string;
      name?: string;
      phone?: string;
      institution?: string;
      [key: string]: unknown;
    };
    const { tier, discountRate, brandDiscounts, points, name, phone, institution } = body;
    const hasStructuredProfile = Object.prototype.hasOwnProperty.call(body, 'institutionType') ||
      Object.prototype.hasOwnProperty.call(body, 'institutionName') ||
      Object.prototype.hasOwnProperty.call(body, 'institutionUnit') ||
      Object.prototype.hasOwnProperty.call(body, 'institutionDepartment') ||
      Object.prototype.hasOwnProperty.call(body, 'institutionFacility') ||
      Object.prototype.hasOwnProperty.call(body, 'piLab') ||
      Object.prototype.hasOwnProperty.call(body, 'affiliatedLab');
    const profile: InstitutionProfileInput = {
      institutionType: typeof body.institutionType === 'string' ? body.institutionType.trim() : '',
      institutionName: typeof body.institutionName === 'string' ? body.institutionName.trim() : '',
      institutionUnit: typeof body.institutionUnit === 'string' ? body.institutionUnit.trim() : '',
      department: typeof body.institutionDepartment === 'string' ? body.institutionDepartment.trim() : '',
      institutionFacility: typeof body.institutionFacility === 'string' ? body.institutionFacility.trim() : '',
      piLab: typeof body.piLab === 'string' ? body.piLab.trim() : '',
      affiliatedLab: typeof body.affiliatedLab === 'string' ? body.affiliatedLab.trim() || null : null,
    };
    if (discountRate !== undefined || brandDiscounts !== undefined) {
      const pricingAdmin = await requireAdmin('pricing.write');
      if (pricingAdmin instanceof NextResponse) return pricingAdmin;
    }
    if (points !== undefined) {
      const pointsAdmin = await requireAdminPointsMutation(typeof body.stepUpToken === 'string' ? body.stepUpToken.trim() : undefined);
      if (pointsAdmin instanceof NextResponse) return pointsAdmin;
    }

    const existing = await prisma.user.findUnique({ where: { id }, select: { id: true, tier: true, discountRate: true, brandDiscounts: true, points: true, name: true, phone: true, institution: true, institutionType: true, institutionName: true, institutionUnit: true, department: true, institutionFacility: true, school: true, college: true, major: true, building: true, piLab: true, affiliatedLab: true } });
    if (!existing) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const updateData: Prisma.UserUpdateManyMutationInput = {};
    if (tier !== undefined) updateData.tier = tier;
    if (discountRate !== undefined) updateData.discountRate = discountRate;
    if (brandDiscounts !== undefined) {
      updateData.brandDiscounts = brandDiscounts ? JSON.stringify(brandDiscounts) : null;
    }
    let pointsDelta = 0;
    if (points !== undefined) {
      const nextPoints = Number(points);
      const validation = validatePointsTarget(nextPoints);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
      pointsDelta = nextPoints - existing.points;
      updateData.points = nextPoints;
    }
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone;
    if (institution !== undefined && !hasStructuredProfile) updateData.institution = institution;
    if (hasStructuredProfile) {
      const legacy = buildLegacySchoolFields(profile);
      updateData.institution = buildLegacyInstitution(profile) || (typeof institution === 'string' ? institution : null);
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
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (points !== undefined) {
        const changed = await tx.user.updateMany({
          where: { id, points: existing.points },
          data: updateData,
        });
        if (changed.count !== 1) return null;
      } else {
        await tx.user.update({ where: { id }, data: updateData });
      }

      const result = await tx.user.findUnique({ where: { id } });
      if (!result) return null;
      if (pointsDelta !== 0) {
        await tx.pointsLog.create({
          data: {
            userId: id,
            delta: pointsDelta,
            type: 'admin_adjust',
            reason: 'admin/users/[id] 编辑',
            adminEmail: admin.email,
          },
        });
      }
      await writeAuditLog({ actorId: admin.id, actorEmail: admin.email, action: points !== undefined ? 'points.adjusted' : 'customer.profile_changed', resource: points !== undefined ? 'points' : 'customers', targetType: 'User', targetId: id, before: existing, after: { tier: result.tier, discountRate: result.discountRate, brandDiscounts: result.brandDiscounts, points: result.points, name: result.name, phone: result.phone, institution: result.institution }, reason: '客户详情修改' }, tx);
      return result;
    });
    if (!updated) {
      return NextResponse.json({ error: '积分已被其他操作修改，请刷新后重试' }, { status: 409 });
    }
    return NextResponse.json({ user: updated });
  } catch (err) {
    console.error('[admin/users/[id] PATCH] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
