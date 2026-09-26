import type { Metadata } from 'next';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import SiteOverviewPage from '@/components/SiteOverviewPage';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: '资源中心',
  description: '应用与场景、实验方法、缓冲液配制和实验方案库。',
  alternates: { canonical: canonicalSiteUrl('/resources') },
};

export default function ResourcesPage() {
  return (
    <>
      <AdaptiveHeader showNav />
      <SiteOverviewPage navigationId="resources" />
      <SiteFooter />
      <MobileBottomNav />
    </>
  );
}
