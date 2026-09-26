const IMAGE_EXT = /\.(?:jpg|jpeg|png|gif|webp)(?:\?|$)/i;

const SCIENCENET_SKIP_IMAGES = [
  '/images/paper.jpg',
  '/images/news.jpg',
  '/images/newcomm.gif',
  '/images/t11.gif',
  /** Sidebar thumbnails on paper/news article pages — not article hero images. */
  '/upload/news/images/',
];

function resolveUrl(url: string, baseUrl: string): string | null {
  const trimmed = url.split('?')[0].trim();
  if (!trimmed || trimmed.includes('{{')) return null;

  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith('/')) {
    try {
      return new URL(trimmed, baseUrl).href;
    } catch {
      return null;
    }
  }
  return null;
}

export function isSciencenetContentImage(url: string): boolean {
  if (!IMAGE_EXT.test(url)) return false;
  if (SCIENCENET_SKIP_IMAGES.some((skip) => url.includes(skip))) return false;
  if (url.includes('/style/images/')) return false;
  return true;
}

function isContentImage(url: string): boolean {
  return isSciencenetContentImage(url);
}

function extractOgImage(html: string): string | null {
  const ogMatch =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i);

  if (!ogMatch?.[1]) return null;

  const url = ogMatch[1].split('?')[0];
  if (!url.startsWith('http')) return null;
  // Skip site homepages masquerading as og:image (e.g. JBR)
  if (!IMAGE_EXT.test(url)) return null;

  return url;
}

/** Sciencenet: kxws body images or /upload/paper/images/ in article content. */
export function extractSciencenetImage(html: string, articleUrl: string): string | null {
  const kxwsMatches = html.matchAll(
    /https?:\/\/rmtzx\.sciencenet\.cn\/kxwsprint\/[^"']+\.(?:jpg|jpeg|png)/gi
  );
  for (const match of kxwsMatches) {
    if (match[0] && isContentImage(match[0])) {
      return match[0];
    }
  }

  const paperMatches = html.matchAll(
    /\/upload\/paper\/images\/\d+\/\d+\/[^"'\s)]+\.(?:jpg|jpeg|png|gif)/gi
  );
  for (const match of paperMatches) {
    const resolved = resolveUrl(match[0], articleUrl);
    if (resolved && isContentImage(resolved)) {
      return resolved;
    }
  }

  return null;
}

interface JbrFigItem {
  sort?: number;
  filePath?: string;
}

interface JbrArticleMeta {
  firstFig?: JbrFigItem;
  figList?: JbrFigItem[];
}

/**
 * JBR article detail page embeds figure metadata in Base64 `article_meta_data`.
 * Hero image uses the last entry in `figList` (sorted by `sort`).
 */
export function extractJbrFigureImage(html: string): string | null {
  const match = html.match(/var article_meta_data\s*=\s*['"]([^'"]+)['"]/);
  if (!match?.[1]) return null;

  try {
    const data = JSON.parse(
      Buffer.from(match[1], 'base64').toString('utf8')
    ) as JbrArticleMeta;

    const figures = [...(data.figList ?? [])].sort(
      (a, b) => (a.sort ?? 0) - (b.sort ?? 0)
    );
    const filePath = figures.at(-1)?.filePath ?? data.firstFig?.filePath;
    if (!filePath) return null;

    return resolveUrl(filePath, 'http://www.jbr-pub.org.cn/');
  } catch {
    return null;
  }
}

function extractGenericFigureImages(html: string, baseUrl: string): string[] {
  const images: string[] = [];

  const springerPattern =
    /src=["']([^"']*springer-static[^"']*\.(?:jpg|png|jpeg|webp|gif))["']/gi;
  for (const match of html.matchAll(springerPattern)) {
    const resolved = resolveUrl(match[1] || '', baseUrl);
    if (resolved && isContentImage(resolved)) {
      images.push(resolved);
    }
  }

  if (images.length > 0) return images;

  const figurePatterns = [
    /<figure[^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["'][^>]*>[\s\S]*?<\/figure>/gi,
    /<figure[^>]+id=["']fig-\d+["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/gi,
    /<div[^>]+class=["'][^"']*fig[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/gi,
  ];

  for (const pattern of figurePatterns) {
    for (const match of html.matchAll(pattern)) {
      const resolved = resolveUrl((match[1] || match[2] || ''), baseUrl);
      if (resolved && isContentImage(resolved)) {
        images.push(resolved);
      }
    }
  }

  return images;
}

export function extractArticleImageFromHtml(html: string, articleUrl: string): string | null {
  if (articleUrl.includes('jbr-pub.org.cn')) {
    // JBR: only figList metadata — no og:image or generic page scraping
    return extractJbrFigureImage(html);
  }

  if (articleUrl.includes('sciencenet.cn')) {
    const sciencenetImage = extractSciencenetImage(html, articleUrl);
    if (sciencenetImage) return sciencenetImage;
  }

  const ogImage = extractOgImage(html);
  if (ogImage) return ogImage;

  const genericImages = extractGenericFigureImages(html, articleUrl);
  if (genericImages.length > 0) {
    return genericImages[0];
  }

  return null;
}

export async function fetchArticleImage(articleUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(articleUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const html = await response.text();
    return extractArticleImageFromHtml(html, articleUrl);
  } catch {
    return null;
  }
}
