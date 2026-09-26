import AdaptiveHeader from '@/components/AdaptiveHeader';
import AccountSidebar from '@/components/account/AccountSidebar';
import Breadcrumb from '@/components/Breadcrumb';
import MobileBottomNav from '@/components/mobile/MobileBottomNav';
import OrganizationsPanel from '@/components/account/OrganizationsPanel';
import SiteFooter from '@/components/SiteFooter';
import { uiSurfaces } from '@/lib/ui-surfaces';

export default function OrganizationsPage() {
  return (
    <div className={`flex min-h-screen flex-col ${uiSurfaces.servicePage}`}>
      <AdaptiveHeader />
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 pb-12 sm:px-6">
          <Breadcrumb items={[{ label: '首页', href: '/' }, { label: '我的账户', href: '/account' }, { label: '组织管理' }]} />
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
            <AccountSidebar activeKey="organizations" />
            <div className="min-w-0 flex-1">
              <section className={`mb-6 rounded-2xl border ${uiSurfaces.border} ${uiSurfaces.panelStrong} p-5`}>
                <h1 className={`text-xl font-bold ${uiSurfaces.titleText}`}>组织管理</h1>
                <p className={`mt-1 text-sm ${uiSurfaces.mutedText}`}>组织通过平台审核后，管理成员、角色和组织业务。</p>
              </section>
              <OrganizationsPanel />
            </div>
          </div>
        </div>
      </main>
      <MobileBottomNav />
      <SiteFooter />
    </div>
  );
}
