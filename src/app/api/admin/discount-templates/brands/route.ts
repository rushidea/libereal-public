import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { loadCatalogBrandKeys } from '@/lib/discount-brand-catalog';

export async function GET() {
  const user = await requireAdmin('pricing.read');
  if (user instanceof NextResponse) return user;

  try {
    const brands = await loadCatalogBrandKeys(prisma);
    return NextResponse.json({ brands });
  } catch (err) {
    console.error('[discount-templates/brands GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
