import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { withPromotionRepository } from '@/lib/promotion-repository';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin('pricing.read');
  if (admin instanceof NextResponse) return admin;
  const query = req.nextUrl.searchParams.get('search')?.trim() ?? '';
  if (query.length < 2 || query.length > 100) return NextResponse.json({ products: [] });
  try {
    const products = withPromotionRepository((_repository, db) => {
      const rows = db.prepare(`SELECT id,name,catalogNumber FROM Product WHERE hazardous=0 AND
        (name LIKE ? OR catalogNumber LIKE ?) ORDER BY catalogNumber LIMIT 25`).all(`%${query}%`, `%${query}%`) as Array<{ id: string; name: string; catalogNumber: string }>;
      return rows.map((product) => ({ ...product, variants: db.prepare('SELECT id,catalogNumber,spec FROM ProductVariant WHERE productId=? ORDER BY catalogNumber LIMIT 100').all(product.id) }));
    });
    return NextResponse.json({ products });
  } catch (error) {
    console.error('[promotion product search]', error);
    return NextResponse.json({ error: '商品查询暂时不可用' }, { status: 503 });
  }
}
