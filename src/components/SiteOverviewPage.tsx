import Link from 'next/link';
import {
  ArrowRight,
  Beaker,
  Building2,
  BookOpen,
  Calculator,
  FlaskConical,
  LifeBuoy,
} from 'lucide-react';
import Breadcrumb from '@/components/Breadcrumb';
import {
  getNavigationLinkHref,
  siteNavigationById,
  type SiteNavigationId,
  type SiteNavigationLink,
} from '@/data/site-navigation';
import { uiSurfaces } from '@/lib/ui-surfaces';

const overviewIcons: Record<SiteNavigationId, typeof Beaker> = {
  products: FlaskConical,
  'research-tools': Calculator,
  resources: BookOpen,
  'academic-support': LifeBuoy,
  about: Building2,
};

type SiteOverviewPageProps = {
  navigationId: SiteNavigationId;
};

function OverviewLink({ link }: { link: SiteNavigationLink }) {
  const href = getNavigationLinkHref(link);
  if (!href) return null;

  return (
    <Link
      href={href}
      className={`group flex min-h-11 items-center justify-between gap-3 border-b border-[var(--brand-color-border-secondary)] py-3 text-sm last:border-b-0 ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.focusRing}`}
    >
      <span>{link.label}</span>
      <ArrowRight className="h-4 w-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export default function SiteOverviewPage({ navigationId }: SiteOverviewPageProps) {
  const navigation = siteNavigationById[navigationId];
  const Icon = overviewIcons[navigationId];

  return (
    <div className={`min-h-screen pb-16 lg:pb-0 ${uiSurfaces.servicePage}`}>
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        <Breadcrumb items={[{ label: '首页', href: '/' }, { label: navigation.label }]} />

        <header className="mb-10 flex items-center gap-4 border-b border-[var(--brand-color-border)] pb-6">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--brand-border-radius)] bg-[var(--brand-color-primary-bg)] ${uiSurfaces.textInteractive}`}>
            <Icon className="h-5 w-5" />
          </span>
          <h1 className={`text-2xl font-semibold tracking-tight ${uiSurfaces.titleText}`}>{navigation.label}</h1>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {navigation.groups.map((group) => (
            <section key={group.id} className={`p-5 sm:p-6 ${uiSurfaces.panel}`}>
              <h2 className={`mb-2 text-lg font-semibold ${uiSurfaces.titleText}`}>{group.label}</h2>
              <div>
                {group.links.map((link) => <OverviewLink key={link.id} link={link} />)}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
