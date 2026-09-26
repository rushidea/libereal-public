import type { Metadata } from 'next';
import AdaptiveHeader from '@/components/AdaptiveHeader';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import SiteFooter from '@/components/SiteFooter';
import SiteOverviewPage from '@/components/SiteOverviewPage';
import { canonicalSiteUrl } from '@/lib/site-url';

export const metadata: Metadata = {
  title: '研究工具',
  description: '计算工具、荧光光谱、CD 分子与公共分析工具。',
  alternates: { canonical: canonicalSiteUrl('/research-tools') },
};

export default function ResearchToolsPage() {
  return (
    <>
      <AdaptiveHeader showNav />
      <SiteOverviewPage navigationId="research-tools" />
      <SiteFooter />
      <MobileBottomNav />
    </>
  );
}
