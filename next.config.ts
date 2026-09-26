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
  // 避免部署后浏览器/CDN 长期缓存旧版 HTML 壳（与新版 JS 不匹配导致显示异常）
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, must-revalidate' },
        ],
      },
      {
        source: '/video/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      {
        source: '/images/home/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
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
      // Hashed /_next/static/* assets already get immutable long-cache headers from
      // Next.js in production; a custom rule here is ignored and triggers a dev warning.
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
      // Abcepta product images
      { protocol: 'https', hostname: 'www.abcepta.com.cn' },
      { protocol: 'https', hostname: 'abcepta.com.cn' },
    ],
  },
};

export default nextConfig;
