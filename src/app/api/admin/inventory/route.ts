import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/session';
import { receiveInventoryBatch, setActualInventory, setInboundInventory } from '@/lib/inventory';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin('inventory.read');
  if (admin instanceof NextResponse) return admin;
  const search = new URL(req.url).searchParams.get('search')?.trim() || '';
  const accounts = await prisma.inventoryAccount.findMany({
    where: search ? { product: { OR: [{ name: { contains: search } }, { catalogNumber: { contains: search } }, { brand: { contains: search } }] } } : {},
    take: 200,
    orderBy: { updatedAt: 'desc' },
    include: {
      product: { select: { id: true, catalogNumber: true, name: true, brand: true } },
      variant: { select: { id: true, catalogNumber: true, spec: true } },
      batches: { orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }] },
      transactions: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });
  return NextResponse.json({ accounts });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin('inventory.write');
  if (admin instanceof NextResponse) return admin;
  try {
    const body = await req.json();
    if (typeof body.productId !== 'string') return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    const result = await prisma.$transaction(async (tx) => {
      if (body.actualQuantity !== undefined) {
        await setActualInventory(tx, {
          productId: body.productId, variantId: body.variantId || null,
          actualQuantity: Number(body.actualQuantity), reason: String(body.reason || '管理员库存盘点'), actorId: admin.id,
        });
      }
      if (body.inboundQuantity !== undefined) {
        await setInboundInventory(tx, {
          productId: body.productId, variantId: body.variantId || null,
          quantity: Number(body.inboundQuantity), reason: String(body.reason || '管理员调整采购在途'), actorId: admin.id,
        });
      }
      return tx.inventoryAccount.findFirst({ where: { productId: body.productId, variantId: body.variantId || null } });
    });
    return NextResponse.json({ account: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (['INVALID_INVENTORY_QUANTITY', 'INVALID_INBOUND_QUANTITY'].includes(message)) return NextResponse.json({ error: message }, { status: 400 });
    if (message === 'INVENTORY_BELOW_RESERVED') return NextResponse.json({ error: message }, { status: 409 });
    console.error('[admin inventory PATCH] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin('inventory.write');
  if (admin instanceof NextResponse) return admin;
  try {
    const body = await req.json();
    if (typeof body.productId !== 'string') return NextResponse.json({ error: 'productId is required' }, { status: 400 });
    const expiryDate = body.expiryDate ? new Date(body.expiryDate) : null;
    if (expiryDate && Number.isNaN(expiryDate.getTime())) return NextResponse.json({ error: 'INVALID_EXPIRY_DATE' }, { status: 400 });
    const result = await prisma.$transaction((tx) => receiveInventoryBatch(tx, {
      productId: body.productId, variantId: body.variantId || null,
      batchNumber: String(body.batchNumber || ''), quantity: Number(body.quantity), expiryDate, actorId: admin.id,
    }));
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'INVALID_BATCH_RECEIPT') return NextResponse.json({ error: message }, { status: 400 });
    console.error('[admin inventory POST] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
