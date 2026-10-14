import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { enqueueBackgroundTask } from '@/lib/background-tasks';
import { writeAuditLog } from '@/lib/audit';
import { invalidateProductFilters } from '@/lib/product-filter-cache';
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
  if (!product || product.deletedAt) return NextResponse.json({ error: '产品不存在或已删除' }, { status: 404 });

  return NextResponse.json({
    product: {
      ...product,
      applications: JSON.parse(product.applications),
      reactivity: JSON.parse(product.reactivity),
      pmids: JSON.parse(product.pmids),
    },
  });
}

/**
 * 软删除。规格、价格、证书、库存账户和订单预占都挂在商品上并设置了级联删除，
 * 订单、询价和报价又只保存 productId 文本。硬删除会拆掉这些历史，所以只写入 deletedAt。
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireAdmin('products.write');
  if (admin instanceof NextResponse) return admin;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'Missing product id' }, { status: 400 });

  try {
    const existing = await prisma.product.findUnique({
      where: { id },
      select: { id: true, deletedAt: true, catalogNumber: true, name: true, brand: true },
    });
    if (!existing) return NextResponse.json({ error: '产品不存在或已删除' }, { status: 404 });
    if (existing.deletedAt) return NextResponse.json({ success: true, alreadyDeleted: true });

    const deletedAt = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: { deletedAt } });
      await writeAuditLog({
        actorId: admin.id,
        actorEmail: admin.email,
        action: 'product.deleted',
        resource: 'products',
        targetType: 'Product',
        targetId: id,
        before: {
          deletedAt: null,
          catalogNumber: existing.catalogNumber,
          name: existing.name,
          brand: existing.brand,
        },
        after: { deletedAt: deletedAt.toISOString() },
        reason: '后台删除产品',
      }, tx);
    });
    await invalidateProductFilters();
    await enqueueBackgroundTask('search.index_update', { source: 'admin-product-delete' }, {
      priority: -5,
      dedupeKey: `search-index-update:${Math.floor(Date.now() / 60000)}`,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[admin/products DELETE] error:', err);
    return NextResponse.json({ error: '删除失败，请稍后重试。' }, { status: 500 });
  }
}
