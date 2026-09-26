import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

function parseBrandDiscounts(value: string | null): Record<string, number> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, number>;
  } catch {
    return null;
  }
}

export async function GET() {
  const user = await requireAdmin('customers.read');
  if (user instanceof NextResponse) return user;

  try {
    const customers = await prisma.user.findMany({
      where: { role: 'customer' },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, email: true, institution: true,
        department: true, institutionType: true, institutionName: true, institutionUnit: true, institutionFacility: true,
        school: true, college: true, major: true, building: true, piLab: true, affiliatedLab: true,
        phone: true, discountRate: true,
        brandDiscounts: true, tier: true, points: true,
        creditAccount: true,
        addresses: {
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
          select: { id: true, name: true, phone: true, address: true, institution: true, isDefault: true },
        },
      },
    });

    return NextResponse.json({
      customers: customers.map(customer => ({
        ...customer,
        brandDiscounts: parseBrandDiscounts(customer.brandDiscounts),
      })),
    });
  } catch (err) {
    console.error("[admin/customers GET]", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
