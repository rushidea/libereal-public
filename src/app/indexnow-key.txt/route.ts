import { NextResponse } from 'next/server';
import { getIndexNowKey } from '@/lib/seo/indexnow';

export const dynamic = 'force-dynamic';

export async function GET() {
  const key = getIndexNowKey();
  if (!key) return new NextResponse('Not Found', { status: 404 });
  return new NextResponse(key, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
