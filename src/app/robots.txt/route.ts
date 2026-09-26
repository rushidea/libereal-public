import { NextResponse } from 'next/server';
import { renderRobotsTxt } from '@/lib/seo/crawlers';

export const dynamic = 'force-dynamic';

export async function GET() {
  return new NextResponse(renderRobotsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
