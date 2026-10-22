import { getCanonicalSiteOrigin } from '@/lib/site-url';

export const ROBOTS_DISALLOW_PATHS = [
  '/api/',
  '/admin/',
  '/account/',
  '/login',
  '/register',
  '/cart',
  '/order',
  '/checkout',
  '/reset-password',
  '/forgot-password',
] as const;

/** Public paths called out for crawlers. `/` already allows the rest of the site. */
export const ROBOTS_ALLOW_PATHS = ['/', '/mail'] as const;

/** Explicit agents in addition to `*`. Each block repeats the same allow/disallow rules. */
export const NAMED_SEARCH_ENGINE_USER_AGENTS = [
  'bingbot',
  'msnbot',
  'BingPreview',
  'Sogou web spider',
  'Sogou inst spider',
  'Sogou News Spider',
  'Sogou Orion spider',
] as const;

export const BINGBOT_ROBOTS_CONTENT = 'index, follow, max-image-preview:large, max-snippet:-1';

function renderAgentBlock(userAgent: string): string {
  const allows = ROBOTS_ALLOW_PATHS.map((path) => `Allow: ${path}`).join('\n');
  const disallows = ROBOTS_DISALLOW_PATHS.map((path) => `Disallow: ${path}`).join('\n');
  return `User-agent: ${userAgent}\n${allows}\n${disallows}`;
}

export function renderRobotsTxt(): string {
  const origin = getCanonicalSiteOrigin();
  const agents = ['*', ...NAMED_SEARCH_ENGINE_USER_AGENTS];
  const blocks = agents.map(renderAgentBlock).join('\n\n');
  return `${blocks}\n\nSitemap: ${origin}/sitemap.xml\nHost: ${origin}\n`;
}

export function buildSearchEngineOtherMeta(): Record<string, string> {
  return {
    bingbot: BINGBOT_ROBOTS_CONTENT,
    'applicable-device': 'pc,mobile',
  };
}
