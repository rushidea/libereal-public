import type { Metadata } from 'next';
import {
  SITE_DISPLAY_NAME,
  SITE_HOME_DESCRIPTION,
} from '@/lib/seo/site-identity';
import { getCanonicalSiteOrigin } from '@/lib/site-url';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: { absolute: SITE_DISPLAY_NAME },
  description: SITE_HOME_DESCRIPTION,
  alternates: {
    canonical: getCanonicalSiteOrigin(),
  },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    url: getCanonicalSiteOrigin(),
    siteName: SITE_DISPLAY_NAME,
    title: SITE_DISPLAY_NAME,
    description: SITE_HOME_DESCRIPTION,
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: SITE_DISPLAY_NAME,
      },
    ],
  },
};

export default function HomeLayout({ children }: { children: React.ReactNode }) {
  return children;
}
