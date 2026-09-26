import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireActiveSession } from '@/lib/session';
import { prisma } from '@/lib/prisma';
import { PRODUCT_LIST_SELECT } from '@/lib/prisma-selects';
import { getProductDisplayPrice } from '@/lib/product-pricing';
import { canReorderFromOrderStatus } from '@/lib/order-domain';

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_LIST_SELECT }>;

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function toCartProduct(
  product: ProductRow,
  variant: { id: string; catalogNumber: string; spec: string; price: number; originalPrice: number | null; promotionalPrice: number | null } | null,
  isFormalMember: boolean,
) {
  const { price, originalPrice, promotionalPrice, applications, reactivity, ...rest } = product;
  const selectedPrice = variant?.price ?? price;
  const selectedOriginalPrice = variant?.originalPrice ?? originalPrice;
  const selectedPromotionalPrice = variant?.promotionalPrice ?? promotionalPrice;

  return {
    ...rest,
    catalogNumber: variant?.catalogNumber ?? product.catalogNumber,
    spec: variant?.spec ?? product.spec,
    applications: parseJsonArray(applications),
    reactivity: parseJsonArray(reactivity),
    ...(variant ? { variantId: variant.id } : {}),
    displayPrice: getProductDisplayPrice({
      brand: product.brand,
      price: selectedPrice,
      originalPrice: selectedOriginalPrice,
      promotionalPrice: selectedPromotionalPrice,
    }, { isFormalMember }),
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireActiveSession();
  if (user instanceof NextResponse) return user;

  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      ownerScope: true,
      customerId: true,
      email: true,
      orderItems: {
        orderBy: { position: 'asc' },
        select: { productId: true, catalogNumber: true, brand: true, quantity: true, name: true },
      },
    },
  });

  if (!order) return NextResponse.json({ error: '订单不存在' }, { status: 404 });
  if (!canReorderFromOrderStatus(order.status)) return NextResponse.json({ error: '仅已取消或已关闭订单可以再次下单' }, { status: 409 });

  const ownsPersonalOrder = order.ownerScope === 'personal'
    && (order.customerId === user.id || order.email === user.email);
  if (!ownsPersonalOrder) return NextResponse.json({ error: '无权再次下单' }, { status: 403 });
  if (order.orderItems.length === 0) return NextResponse.json({ error: '订单中没有可再次下单的商品' }, { status: 409 });

  const productIds = [...new Set(order.orderItems.map((item) => item.productId).filter((value): value is string => Boolean(value)))];
  const catalogNumbers = [...new Set(order.orderItems.map((item) => item.catalogNumber).filter((value): value is string => Boolean(value)))];
  const productConditions: Prisma.ProductWhereInput[] = [
    ...(productIds.length ? [{ id: { in: productIds } }] : []),
    ...order.orderItems
      .filter((item): item is typeof item & { catalogNumber: string } => Boolean(item.catalogNumber))
      .map((item) => ({ catalogNumber: item.catalogNumber, ...(item.brand ? { brand: item.brand } : {}) })),
  ];
  const products = productConditions.length
    ? await prisma.product.findMany({ where: { OR: productConditions }, select: PRODUCT_LIST_SELECT })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));
  const productByCatalog = new Map(products.map((product) => [`${product.brand}:${product.catalogNumber}`, product]));
  const productVariantRows = products.length && catalogNumbers.length
    ? await prisma.productVariant.findMany({
        where: { productId: { in: products.map((product) => product.id) }, catalogNumber: { in: catalogNumbers } },
        select: { id: true, productId: true, catalogNumber: true, spec: true, price: true, originalPrice: true, promotionalPrice: true },
      })
    : [];

  const isFormalMember = await (async () => {
    const current = await prisma.user.findUnique({
      where: { id: user.id },
      select: { approvalStatus: true, isNewUser: true, isFrozen: true, isBlacklisted: true },
    });
    return Boolean(current && current.approvalStatus === 'approved' && !current.isNewUser && !current.isFrozen && !current.isBlacklisted);
  })();

  const unavailable: string[] = [];
  const cartItems = order.orderItems.map((item) => {
    const product = (item.productId ? productById.get(item.productId) : undefined)
      ?? (item.catalogNumber ? productByCatalog.get(`${item.brand ?? ''}:${item.catalogNumber}`) : undefined);
    if (!product) {
      unavailable.push(item.name);
      return null;
    }
    const variant = item.catalogNumber
      ? productVariantRows.find((candidate) => candidate.productId === product.id && candidate.catalogNumber === item.catalogNumber) ?? null
      : null;
    return {
      product: toCartProduct(product, variant, isFormalMember),
      quantity: Math.min(Math.max(item.quantity, 1), 999),
    };
  });

  if (unavailable.length > 0 || cartItems.some((item) => item === null)) {
    return NextResponse.json({ error: '订单中的部分商品已下架，暂时无法再次下单', unavailable }, { status: 409 });
  }

  const currentCart = await prisma.cart.findUnique({ where: { userId: user.id }, select: { items: true } });
  let existingItems: unknown[] = [];
  if (currentCart?.items) {
    try {
      const parsed = JSON.parse(currentCart.items) as unknown;
      if (Array.isArray(parsed)) existingItems = parsed;
    } catch {
      existingItems = [];
    }
  }

  await prisma.cart.upsert({
    where: { userId: user.id },
    update: { items: JSON.stringify([...existingItems, ...cartItems]) },
    create: { userId: user.id, items: JSON.stringify(cartItems) },
  });

  return NextResponse.json({ ok: true, itemCount: cartItems.length });
}
