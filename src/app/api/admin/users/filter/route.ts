import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import type { Prisma } from '@prisma/client';

export async function GET(req: NextRequest) {
  const user = await requireAdmin('customers.read');
  if (user instanceof NextResponse) return user;

  try {
    const sp = req.nextUrl.searchParams;

    const tiersRaw = sp.get('tiers') || '';
    const tiers = tiersRaw ? tiersRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const institution = sp.get('institution') || '';
    const department = sp.get('department') || '';
    const pointsMin = sp.get('pointsMin');
    const pointsMax = sp.get('pointsMax');
    const limit = Math.min(parseInt(sp.get('limit') || '100'), 500);
    const offset = Math.max(parseInt(sp.get('offset') || '0'), 0);

    const filters: Prisma.UserWhereInput[] = [];
    if (tiers.length > 0) filters.push({ tier: { in: tiers } });
    if (institution) {
      filters.push({ OR: [
        { institutionName: { contains: institution } },
        { institution: { contains: institution } },
        { school: { contains: institution } },
      ] });
    }
    if (department) {
      filters.push({ OR: [
        { department: { contains: department } },
        { institutionUnit: { contains: department } },
        { institutionFacility: { contains: department } },
        { major: { contains: department } },
        { piLab: { contains: department } },
        { affiliatedLab: { contains: department } },
      ] });
    }
    if (pointsMin && !isNaN(parseInt(pointsMin))) {
      filters.push({ points: { gte: parseInt(pointsMin) } });
    }
    if (pointsMax && !isNaN(parseInt(pointsMax))) {
      filters.push({ points: { lte: parseInt(pointsMax) } });
    }
    const where: Prisma.UserWhereInput = filters.length > 0 ? { AND: filters } : {};

    const [total, users, distinctInstitutions, distinctDepartments] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true, name: true, email: true, role: true,
          institution: true, department: true,
          institutionType: true, institutionName: true, institutionUnit: true, institutionFacility: true,
          school: true, college: true, major: true, building: true, piLab: true, affiliatedLab: true,
          tier: true, points: true,
          isNewUser: true, createdAt: true, discountRate: true,
          brandDiscounts: true, sourceTemplateId: true,
        },
      }),
      prisma.user.findMany({
        where: { OR: [
          { institutionName: { not: null, notIn: [''] } },
          { institution: { not: null, notIn: [''] } },
          { school: { not: null, notIn: [''] } },
        ] },
        select: { institution: true, institutionName: true, school: true },
        orderBy: { institutionName: 'asc' },
      }),
      prisma.user.findMany({
        where: { OR: [
          { department: { not: null, notIn: [''] } },
          { institutionUnit: { not: null, notIn: [''] } },
          { institutionFacility: { not: null, notIn: [''] } },
          { major: { not: null, notIn: [''] } },
          { piLab: { not: null, notIn: [''] } },
          { affiliatedLab: { not: null, notIn: [''] } },
        ] },
        select: { department: true, institutionUnit: true, institutionFacility: true, major: true, piLab: true, affiliatedLab: true },
        orderBy: { department: 'asc' },
      }),
    ]);

    return NextResponse.json({
      total,
      users,
      facets: {
        institutions: Array.from(new Set(distinctInstitutions.flatMap((r) => [r.institutionName, r.school, r.institution].filter(Boolean) as string[]))),
        departments: Array.from(new Set(distinctDepartments.flatMap((r) => [r.institutionUnit, r.department, r.major, r.institutionFacility, r.piLab, r.affiliatedLab].filter(Boolean) as string[]))),
      },
    });
  } catch (err) {
    console.error('[admin/users/filter GET]', err);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}
