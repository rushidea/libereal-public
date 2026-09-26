import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireAdmin('products.read');
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      brandRecord: true,
      categoryRecord: true,
      subcategoryRecord: true,
      variants: { orderBy: { catalogNumber: 'asc' } },
      attributes: { orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }] },
      documents: { orderBy: [{ sortOrder: 'asc' }, { title: 'asc' }] },
      prices: { orderBy: { createdAt: 'desc' }, take: 100 },
    },
  });
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

  return NextResponse.json({
    product: {
      ...product,
      applications: JSON.parse(product.applications),
      reactivity: JSON.parse(product.reactivity),
      pmids: JSON.parse(product.pmids),
    },
  });
}
