import { NextRequest, NextResponse } from 'next/server';
import { fetchProductFiltersCached } from '@/lib/product-filter-cache';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get('category') || undefined;
    const sub = searchParams.get('sub') || undefined;
    const data = await fetchProductFiltersCached(category, sub);
    return NextResponse.json(data);
  } catch (err) {
    console.error('[products/filters GET] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
