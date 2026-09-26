import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "@/components/Providers";
import { CartProvider } from "@/context/CartContext";
import { CompareProvider } from "@/context/CompareContext";
import { WishlistProvider } from "@/context/WishlistContext";
import { ToastProvider } from "@/context/ToastContext";
import CartSync from "@/context/CartSync";
import { ThemeProvider } from "@/components/ThemeProvider";
import ErrorBoundaryProvider from "@/components/ErrorBoundaryProvider";
import ThemeInit from "@/components/ThemeInit";
import ChatwayWidget from "@/components/ChatwayWidget";
import ViewportDebug from "@/components/ViewportDebug";
import ForcedAckOverlay from "@/components/ForcedAckOverlay";
import JsonLd from "@/components/JsonLd";
import { buildSearchEngineOtherMeta } from "@/lib/seo/crawlers";
import { buildOrganizationJsonLd, buildWebSiteJsonLd } from "@/lib/seo/json-ld";
import {
  SITE_BRAND_NAME,
  SITE_DISPLAY_NAME,
  SITE_HOME_DESCRIPTION,
  SITE_LEGAL_NAME,
} from "@/lib/seo/site-identity";
import { getCanonicalSiteOrigin } from "@/lib/site-url";

const SITE_URL = getCanonicalSiteOrigin();


export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_DISPLAY_NAME,
    template: '%s | LIBEREAL',
  },
  description: SITE_HOME_DESCRIPTION,
  keywords: [
    "biological reagents",
    "antibodies",
    "ELISA kits",
    "proteins",
    "molecular biology",
    "生物试剂",
    "抗体",
    "ELISA试剂盒",
  ],
  authors: [{ name: SITE_BRAND_NAME }],
  creator: SITE_BRAND_NAME,
  publisher: SITE_LEGAL_NAME,
  formatDetection: { email: false, address: false, telephone: false },
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [
      { url: "/favicon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    url: SITE_URL,
    siteName: SITE_DISPLAY_NAME,
    title: SITE_DISPLAY_NAME,
    description: SITE_HOME_DESCRIPTION,
    images: [
      {
        url: "/og-image.jpg",
        width: 1200,
        height: 630,
        alt: SITE_DISPLAY_NAME,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_DISPLAY_NAME,
    description: SITE_HOME_DESCRIPTION,
    images: ["/og-image.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  other: {
    "msapplication-TileColor": "#047857",
    "apple-mobile-web-app-status-bar-style": "black-translucent",
    ...buildSearchEngineOtherMeta(),
  },
  category: "science",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  colorScheme: "light dark",
  // 状态栏/地址栏区域颜色 = 页面背景色（日间浅绿 / 暗色蓝灰），视觉上页面铺满全屏。
  // iOS Safari 对真 viewport 延伸（cover）支持不稳定，业界（abcam/sigma/cellsignal）
  // 均用 theme-color 让系统区域与页面背景融合。
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ecfdf5" },
    { media: "(prefers-color-scheme: dark)", color: "#243851" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head />
      <body suppressHydrationWarning>
        <JsonLd data={buildOrganizationJsonLd()} />
        <JsonLd data={buildWebSiteJsonLd()} />
        <ThemeInit />
        <Providers>
          <ThemeProvider>
            <ToastProvider>
              <CartProvider>
                <CompareProvider>
                  <WishlistProvider>
                    <CartSync />
                    <ForcedAckOverlay />
                    <ErrorBoundaryProvider>{children}</ErrorBoundaryProvider>
                  </WishlistProvider>
                </CompareProvider>
              </CartProvider>
            </ToastProvider>
          </ThemeProvider>
        </Providers>
        <ChatwayWidget />
        <ViewportDebug />
      </body>
    </html>
  );
}
