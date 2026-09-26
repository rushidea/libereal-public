/** Canonical public site origin for redirects and absolute URLs behind reverse proxies. */
export const CANONICAL_SITE_ORIGIN = 'https://libereal.cn';

function stripTrailingSlash(origin: string): string {
  return origin.replace(/\/$/, '');
}

function normalizePublicOrigin(origin: string): string {
  const trimmed = stripTrailingSlash(origin.trim());
  try {
    const url = new URL(trimmed);
    if (url.hostname === 'www.libereal.cn') {
      url.hostname = 'libereal.cn';
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return trimmed;
  }
}

/** Auth callbacks and OAuth redirect targets. Prefers AUTH_URL. */
export function getPublicSiteOrigin(fallbackOrigin = 'http://localhost:3000'): string {
  return normalizePublicOrigin(
    process.env.AUTH_URL ||
      process.env.NEXTAUTH_URL ||
      process.env.NEXT_PUBLIC_SITE_URL ||
      fallbackOrigin,
  );
}

/** Canonical origin for metadata, JSON-LD, Open Graph and sitemaps. */
export function getCanonicalSiteOrigin(): string {
  return normalizePublicOrigin(process.env.NEXT_PUBLIC_SITE_URL || CANONICAL_SITE_ORIGIN);
}

export function publicSiteUrl(path = ''): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getPublicSiteOrigin()}${normalizedPath}`;
}

export function canonicalSiteUrl(path = ''): string {
  if (/^https?:\/\//i.test(path)) {
    return toAbsoluteCanonicalUrl(path);
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getCanonicalSiteOrigin()}${normalizedPath}`;
}

/** Turn a site-relative or already-absolute URL into a canonical absolute URL. */
export function toAbsoluteCanonicalUrl(pathOrUrl: string): string {
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return getCanonicalSiteOrigin();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.hostname === 'www.libereal.cn') url.hostname = 'libereal.cn';
      return url.toString();
    } catch {
      return trimmed;
    }
  }
  const path = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return `${getCanonicalSiteOrigin()}${path}`;
}

export function isPublicHttpOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1' &&
      url.hostname !== '::1'
    );
  } catch {
    return false;
  }
}
