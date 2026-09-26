import {
  Activity,
  ChevronDown,
  ChevronUp,
  Droplets,
  FlaskConical,
  Headphones,
  Mail,
  MessageCircle,
  Microscope,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { supportFaqs, type SupportFaqCategory } from '@/data/support-faqs';
import { SERVICE_EMAILS } from '@/data/serviceEmails';
import { uiSurfaces } from '@/lib/ui-surfaces';

const faqIconMap: Record<SupportFaqCategory['iconKey'], LucideIcon> = {
  flask: FlaskConical,
  microscope: Microscope,
  droplets: Droplets,
  activity: Activity,
};

type SupportFaqPanelProps = {
  searchQuery: string;
  openFaq: string | null;
  onToggleFaq: (category: string | null) => void;
};

export default function SupportFaqPanel({
  searchQuery,
  openFaq,
  onToggleFaq,
}: SupportFaqPanelProps) {
  return (
    <div className="space-y-4">
      {supportFaqs.map((faq) => {
        const Icon = faqIconMap[faq.iconKey];
        const isSearchMatch =
          !searchQuery ||
          faq.items.some(
            (item) =>
              item.q.toLowerCase().includes(searchQuery.toLowerCase()) ||
              item.a.toLowerCase().includes(searchQuery.toLowerCase())
          );
        if (searchQuery && !isSearchMatch) return null;

        return (
          <div
            key={faq.category}
            className={`overflow-hidden rounded-brand-lg ${uiSurfaces.panel}`}
          >
            <button
              onClick={() => onToggleFaq(openFaq === faq.category ? null : faq.category)}
              className={`flex w-full items-center gap-4 p-5 text-left transition-colors hover:bg-[var(--surface-hover)] ${uiSurfaces.focusRing}`}
            >
              <div className={`p-2.5 rounded-xl ${faq.color} backdrop-blur-sm`}>
                <Icon className={`w-5 h-5 ${faq.iconColor}`} />
              </div>
              <span className={`flex-1 text-lg font-semibold ${uiSurfaces.titleText}`}>{faq.category}</span>
              {openFaq === faq.category ? (
                <ChevronUp className={`h-5 w-5 ${uiSurfaces.textSecondary}`} />
              ) : (
                <ChevronDown className={`h-5 w-5 ${uiSurfaces.textSecondary}`} />
              )}
            </button>
            {openFaq === faq.category ? (
              <div className="border-t border-[var(--surface-border)]">
                {faq.items.map((item, idx) => (
                  <div
                    key={idx}
                    className={`border-b border-[var(--surface-border)] p-5 last:border-b-0 ${idx !== 0 ? 'border-t' : ''}`}
                  >
                    <p className={`mb-2 font-semibold ${uiSurfaces.textInteractive}`}>{item.q}</p>
                    <p className={`leading-relaxed ${uiSurfaces.mutedText}`}>{item.a}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}

      <div className={`mt-8 rounded-brand-lg p-6 ${uiSurfaces.panel}`}>
        <h3 className={`mb-4 flex items-center gap-2 text-lg font-bold ${uiSurfaces.titleText}`}>
          <Headphones className={`h-5 w-5 ${uiSurfaces.textInteractive}`} />
          联系我们
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: Mail, label: '客服与支持', value: SERVICE_EMAILS.support, sub: '含技术支持与投诉，24小时内回复' },
            { icon: MessageCircle, label: '在线客服', value: '微信搜索', sub: 'libereal_science' },
            { icon: Headphones, label: '商务销售', value: SERVICE_EMAILS.sales, sub: '询价与合作' },
          ].map((item) => {
            const ContactIcon = item.icon;
            return (
              <div key={item.label} className="text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-brand bg-[var(--brand-color-primary-bg)]">
                  <ContactIcon className={`h-5 w-5 ${uiSurfaces.textInteractive}`} />
                </div>
                <p className={`text-xs ${uiSurfaces.textSecondary}`}>{item.label}</p>
                <p className={`text-sm font-medium ${uiSurfaces.titleText}`}>{item.value}</p>
                <p className={`text-xs ${uiSurfaces.textQuaternary}`}>{item.sub}</p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
