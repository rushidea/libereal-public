import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

export async function GET() {
  const admin = await requireAdmin('customers.read');
  if (admin instanceof NextResponse) return admin;

  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: {
        id: true, name: true, email: true, role: true,
        institution: true, department: true,
        institutionType: true, institutionName: true, institutionUnit: true, institutionFacility: true,
        identity: true,
        school: true, college: true, major: true, building: true, piLab: true, affiliatedLab: true,
        tier: true, phone: true, creditAccount: true,
        isNewUser: true, points: true, discountRate: true,
        brandDiscounts: true, sourceTemplateId: true, createdAt: true,
        approvalStatus: true, isBlacklisted: true, isFrozen: true,
      },
    });
    return NextResponse.json(users);
  } catch (err) {
    console.error('[users GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
