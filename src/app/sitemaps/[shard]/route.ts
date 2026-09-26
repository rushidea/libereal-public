import { NextResponse } from 'next/server';
import {
  buildPagesSitemapEntries,
  buildProductSitemapEntries,
  listProductSitemapShardIds,
} from '@/lib/seo/sitemap-entries';
import { renderUrlset, SITEMAP_XML_HEADERS } from '@/lib/seo/sitemap-xml';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ shard: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { shard } = await context.params;
  if (shard === 'pages.xml') {
    const entries = await buildPagesSitemapEntries();
    return xmlResponse(renderUrlset(entries));
  }

  const productMatch = /^products-(\d+)\.xml$/.exec(shard);
  if (productMatch) {
    const shardIndex = Number(productMatch[1]);
    const ids = await listProductSitemapShardIds();
    if (!ids.includes(shard)) {
      return new NextResponse('Not Found', { status: 404 });
    }
    const entries = await buildProductSitemapEntries(shardIndex);
    return xmlResponse(renderUrlset(entries));
  }

  return new NextResponse('Not Found', { status: 404 });
}

function xmlResponse(body: string) {
  return new NextResponse(body, {
    headers: SITEMAP_XML_HEADERS,
  });
}
