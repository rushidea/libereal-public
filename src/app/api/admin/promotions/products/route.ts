import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/session';
import { withPromotionRepository } from '@/lib/promotion-repository';

export async function GET(req: NextRequest) {
  const admin = await requireAdmin('pricing.read');
  if (admin instanceof NextResponse) return admin;
  const productId = req.nextUrl.searchParams.get('productId');
  if (productId !== null) {
    if (!productId.trim() || productId.length > 200) return NextResponse.json({ error: '商品参数无效' }, { status: 400 });
    try {
      const data = withPromotionRepository((_repository, db) => {
        const product = db.prepare('SELECT id FROM Product WHERE id=? AND hazardous=0 AND deletedAt IS NULL').get(productId);
        if (!product) return null;
        const variants = db.prepare('SELECT id,catalogNumber,spec FROM ProductVariant WHERE productId=? ORDER BY catalogNumber, id LIMIT 2001').all(productId);
        return { variants: variants.slice(0, 2000), variantsTruncated: variants.length > 2000 };
      });
      return data ? NextResponse.json(data) : NextResponse.json({ error: '商品不可用' }, { status: 404 });
    } catch (error) {
      console.error('[promotion variants]', error);
      return NextResponse.json({ error: '商品规格查询暂时不可用' }, { status: 503 });
    }
  }
  const query = req.nextUrl.searchParams.get('search')?.trim() ?? '';
  if (query.length < 2 || query.length > 100) return NextResponse.json({ products: [] });
  const offsetText = req.nextUrl.searchParams.get('offset') ?? '0';
  if (!/^(0|[1-9][0-9]{0,5})$/.test(offsetText)) return NextResponse.json({ error: '分页参数无效' }, { status: 400 });
  const offset = Number(offsetText);
  try {
    const products = withPromotionRepository((_repository, db) => {
      const pattern = `%${query}%`;
      const rows = db.prepare(`SELECT p.id,p.name,p.catalogNumber FROM Product p WHERE p.hazardous=0 AND p.deletedAt IS NULL AND
        (p.name LIKE ? OR p.catalogNumber LIKE ? OR EXISTS (
          SELECT 1 FROM ProductVariant v WHERE v.productId=p.id AND (v.catalogNumber LIKE ? OR v.spec LIKE ?)
        )) ORDER BY EXISTS (
          SELECT 1 FROM ProductVariant v WHERE v.productId=p.id AND v.catalogNumber = ?
        ) DESC, EXISTS (
          SELECT 1 FROM ProductVariant v WHERE v.productId=p.id AND (v.catalogNumber LIKE ? OR v.spec LIKE ?)
        ) DESC, p.catalogNumber, p.id LIMIT 26 OFFSET ?`).all(pattern, pattern, pattern, pattern, query, pattern, pattern, offset) as Array<{ id: string; name: string; catalogNumber: string }>;
      const hasMore = rows.length > 25;
      let remaining = 2000;
      const results = rows.slice(0, 25).map((product) => ({ ...product, variants: [] as unknown[], variantsTruncated: false }));
      // Allocate matching variants across all products first; a large unrelated
      // variant list must not hide another product's matching catalog number.
      for (const product of results) {
        const variants = db.prepare(`SELECT id,catalogNumber,spec FROM ProductVariant WHERE productId=?
          AND (catalogNumber LIKE ? OR spec LIKE ?) ORDER BY (catalogNumber = ?) DESC, catalogNumber, id LIMIT ?`)
          .all(product.id, pattern, pattern, query, remaining + 1);
        const visible = variants.slice(0, remaining);
        remaining -= visible.length;
        product.variants.push(...visible);
        product.variantsTruncated = variants.length > visible.length;
      }
      for (const product of results) {
        const variants = db.prepare(`SELECT id,catalogNumber,spec FROM ProductVariant WHERE productId=?
          AND NOT (catalogNumber LIKE ? OR spec LIKE ?) ORDER BY catalogNumber, id LIMIT ?`)
          .all(product.id, pattern, pattern, remaining + 1);
        const visible = variants.slice(0, remaining);
        remaining -= visible.length;
        product.variants.push(...visible);
        product.variantsTruncated ||= variants.length > visible.length;
      }
      return { products: results, hasMore };
    });
    return NextResponse.json(products);
  } catch (error) {
    console.error('[promotion product search]', error);
    return NextResponse.json({ error: '商品查询暂时不可用' }, { status: 503 });
  }
}
