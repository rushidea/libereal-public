import { NextRequest, NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import { reportError } from '@/lib/errorReporting';
import { requireAdmin } from '@/lib/session';

/**
 * POST /api/admin/revalidate-filters
 *
 * Invalidates the product filters cache. Call after bulk product imports/updates
 * (e.g. after running scripts/update-cst-db.cjs).
 *
 * Auth: admin only.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(_req: NextRequest) {
  try {
    const session = await requireAdmin('products.write');
    if (session instanceof NextResponse) return session;

    revalidateTag('product-filters', 'max');
    return NextResponse.json({ ok: true, message: 'Product filters cache invalidated' });
  } catch (err) {
    reportError(err, { tags: { route: '/api/admin/revalidate-filters' } });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
