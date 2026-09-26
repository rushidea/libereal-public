import { NextResponse } from 'next/server';
import { listSitemapShardHrefs } from '@/lib/seo/sitemap-entries';
import { renderSitemapIndex, SITEMAP_XML_HEADERS } from '@/lib/seo/sitemap-xml';

export const dynamic = 'force-dynamic';

export async function GET() {
  const locs = await listSitemapShardHrefs();
  return new NextResponse(renderSitemapIndex(locs), {
    headers: SITEMAP_XML_HEADERS,
  });
}
