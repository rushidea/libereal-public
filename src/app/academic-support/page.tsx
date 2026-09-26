import type { Metadata } from 'next';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import SiteOverviewPage from '@/components/SiteOverviewPage';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: '学术支持',
  description: '研究热点、期刊论文、服务号文章、常见问题和技术支持。',
  alternates: { canonical: canonicalSiteUrl('/academic-support') },
};

export default function AcademicSupportPage() {
  return (
    <>
      <AdaptiveHeader showNav />
      <SiteOverviewPage navigationId="academic-support" />
      <SiteFooter />
      <MobileBottomNav />
    </>
  );
}
