import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  getCstBaseCatalogNumber,
  isCstCatalogSizeSibling,
} from '@/lib/product-variant-lookup';
import { STOREFRONT_HIDDEN_HAZARDOUS } from '@/lib/product-visibility';
import { attachDisplayPrices, resolveIsFormalMember } from '@/lib/product-display';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const baseSku = getCstBaseCatalogNumber(id);

  try {
    // CST size siblings only (T/S/L). Labselect must not use this endpoint's prefix logic.
    const rows = await prisma.product.findMany({
      where: {
        catalogNumber: { startsWith: baseSku },
        brand: 'CST',
        ...STOREFRONT_HIDDEN_HAZARDOUS,
      },
      orderBy: {
        catalogNumber: 'asc',
      },
    });

    const variants = rows.filter((row) => isCstCatalogSizeSibling(id, row.catalogNumber));

    const parsed = variants.map((p) => ({
      ...p,
      id: p.catalogNumber,
      applications: JSON.parse(p.applications),
      reactivity: JSON.parse(p.reactivity),
    }));

    // 方案③：服务端按请求者状态算展示价，剥离原始价
    const isFormalMember = await resolveIsFormalMember();

    return NextResponse.json({ variants: attachDisplayPrices(parsed, isFormalMember) });
  } catch (err) {
    console.error('[variants GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}