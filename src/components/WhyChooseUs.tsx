import { Package, FlaskConical, Receipt, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { WHY_CHOOSE_US_ITEMS, type WhyChooseUsIcon, type WhyChooseUsItem } from '@/data/why-choose-us';
import { uiSurfaces } from '@/lib/ui-surfaces';

const ICONS: Record<WhyChooseUsIcon, LucideIcon> = {
  package: Package,
  flask: FlaskConical,
  receipt: Receipt,
  users: Users,
};

export type WhyChooseUsProps = {
  items?: readonly WhyChooseUsItem[];
  className?: string;
};

export default function WhyChooseUs({ items = WHY_CHOOSE_US_ITEMS, className = '' }: WhyChooseUsProps) {
  return (
    <section className={`px-4 py-6 sm:py-10 ${className}`.trim()}>
      <div className="max-w-6xl mx-auto">
        <div className={`grid grid-cols-1 gap-4 rounded-lg p-4 sm:grid-cols-2 sm:gap-6 sm:p-6 lg:grid-cols-4 ${uiSurfaces.panel}`}>
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <div key={item.title} className="text-center">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg border border-white/70 bg-white/70 shadow-sm shadow-brand-100/40 backdrop-blur-md sm:transition-transform sm:hover:-translate-y-0.5 dark:border-slate-300/70 dark:bg-slate-100/64">
                  <Icon size={28} className="text-brand-600 dark:text-slate-950" />
                </div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-950">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-600 dark:text-slate-700">{item.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
