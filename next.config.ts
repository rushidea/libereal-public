import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Parent ~/package-lock.json is unrelated; pin tracing root to this app.
  outputFileTracingRoot: path.join(__dirname),
  experimental: {
    cpus: 1,
    workerThreads: false,
    proxyClientMaxBodySize: '50mb',
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
  // www → apex (nginx should redirect first; this is a fallback if traffic reaches Next.js)
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.libereal.cn' }],
        destination: 'https://libereal.cn/:path*',
        permanent: true,
      },
    ];
  },
  // 关闭 dev 浮层 (右下角 ⚡ 图标) — 已知在 Mac WebKit/Edge + Turbopack 模式下会拦截 input keydown
  devIndicators: false,
  // 关闭 React strict mode (dev mode) — 修复 input keydown 在 Mac WebKit/Edge 被拦截的 bug
  // 严格 hydration + double-invoke 在 Next 16 + Turbopack + React 19 组合下触发 input 不可交互
  reactStrictMode: false,
  // HTML shells stay uncacheable so a deploy cannot leave browsers/CDNs on an old
  // document that points at removed hashed chunks. Later rules override this for
  // public media. /_next/static and /_next/image are excluded: a custom
  // Cache-Control whose source starts with /_next/ warns and, because it is
  // applied first, blocks Next from setting its own header. With none set,
  // production serves /_next/static as `public, max-age=31536000, immutable`
  // and dev keeps `no-cache, must-revalidate`. /_next/image sets its own TTL.
  // `/:path*` does not match `/`; homepage revalidate=3600 is unchanged.
  async headers() {
    const publicAssetCache = 'public, max-age=86400, stale-while-revalidate=604800';
    return [
      {
        source: '/:path((?!_next/static|_next/image).+)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
      {
        source: '/video/:path*',
        headers: [
          { key: 'Cache-Control', value: publicAssetCache },
        ],
      },
      {
        source: '/images/:path*',
        headers: [
          { key: 'Cache-Control', value: publicAssetCache },
        ],
      },
      {
        source: '/fonts/:path*',
        headers: [
          { key: 'Cache-Control', value: publicAssetCache },
        ],
      },
      {
        source: '/brand/:path*',
        headers: [
          { key: 'Cache-Control', value: publicAssetCache },
        ],
      },
      {
        source: '/wechat/:path*',
        headers: [
          { key: 'Cache-Control', value: publicAssetCache },
        ],
      },
      {
        source: '/:file(favicon\\.ico|favicon\\.png|og-image\\.jpg|libereal-wordmark\\.svg|brand-logo-email\\.png|brand-logo-transparent\\.png|footer-logo\\.png)',
        headers: [
          { key: 'Cache-Control', value: publicAssetCache },
        ],
      },
      {
        source: '/sitemap.xml',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/sitemaps/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400' },
        ],
      },
      {
        source: '/robots.txt',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=3600' },
        ],
      },
    ];
  },
  // Allow <Image> to load from these external hosts (news thumbnails, etc.)
  // See: https://nextjs.org/docs/app/api-reference/next-config-js/images
  images: {
    remotePatterns: [
      // jbr-pub.org.cn (some RSS feeds serve http URLs - allow both)
      { protocol: 'http', hostname: 'www.jbr-pub.org.cn' },
      { protocol: 'https', hostname: 'www.jbr-pub.org.cn' },
      { protocol: 'http', hostname: 'jbr-pub.org.cn' },
      { protocol: 'https', hostname: 'jbr-pub.org.cn' },
      // Nature RSS + article hero images
      { protocol: 'https', hostname: 'www.nature.com' },
      { protocol: 'https', hostname: 'media.nature.com' },
      { protocol: 'https', hostname: 'media.springer-static.com' },
      { protocol: 'https', hostname: 'media.springernature.com' },
      { protocol: 'https', hostname: 'nature.com' },
      // Science Magazine RSS + article images
      { protocol: 'https', hostname: 'www.science.org' },
      // Sciencenet (科学网) - some URLs have double slashes (//upload/...)
      { protocol: 'http', hostname: 'news.sciencenet.cn' },
      { protocol: 'https', hostname: 'news.sciencenet.cn' },
      { protocol: 'http', hostname: 'paper.sciencenet.cn' },
      { protocol: 'https', hostname: 'paper.sciencenet.cn' },
      { protocol: 'http', hostname: 'rmtzx.sciencenet.cn' },
      { protocol: 'https', hostname: 'rmtzx.sciencenet.cn' },
      // Abcepta product images (imported from vendor catalog)
      { protocol: 'http', hostname: 'www.abcepta.com.cn' },
      { protocol: 'https', hostname: 'www.abcepta.com.cn' },
      { protocol: 'http', hostname: 'abcepta.com.cn' },
      { protocol: 'https', hostname: 'abcepta.com.cn' },
      // Fallback image source
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
  },
};

export default nextConfig;
