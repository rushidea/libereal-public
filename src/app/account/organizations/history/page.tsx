import AdaptiveHeader from '@/components/AdaptiveHeader';
import Breadcrumb from '@/components/Breadcrumb';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import OrganizationHistoryPanel from '@/components/account/OrganizationHistoryPanel';
import SiteFooter from '@/components/SiteFooter';
import { uiSurfaces } from '@/lib/ui-surfaces';

type PageProps = {
  searchParams: Promise<{ organizationId?: string; view?: string }>;
};

export default async function OrganizationHistoryPage({ searchParams }: PageProps) {
  const { organizationId = '', view = 'orders' } = await searchParams;
  const selectedView = view === 'payables' || view === 'receivables' ? 'payables' : view === 'inquiries' ? 'inquiries' : 'orders';
  return (
    <div className={`flex min-h-screen flex-col ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">
          <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '我的账户', href: '/account' }, { label: '组织管理', href: '/account/organizations' }, { label: '组织历史记录' }]} />
          <section className={`mb-6 rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-5`}>
            <h1 className={`text-xl font-bold ${uiSurfaces.titleText}`}>组织历史记录</h1>
          </section>
          <OrganizationHistoryPanel key={`${organizationId}-${selectedView}`} organizationId={organizationId} view={selectedView} />
        </div>
      </main>
      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
