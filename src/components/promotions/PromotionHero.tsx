import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import PromotionShareButton from '@/components/promotions/PromotionShareButton';
import { uiSurfaces } from '@/lib/ui-surfaces';

type PromotionHeroTone = 'brand' | 'blue' | 'sky';

type PromotionHeroAction = {
  label: string;
  href: string;
  variant?: 'primary' | 'secondary';
  showArrow?: boolean;
};

type PromotionHeroLogo = {
  src: string;
  alt: string;
  name: string;
  description: string;
};

type PromotionHeroBadge = {
  eyebrow: string;
  label: string;
};

type PromotionHeroImageTitle = {
  brand: string;
  headline: string;
};

export type PromotionHeroProps = {
  variant?: 'campaign' | 'brand';
  tone?: PromotionHeroTone;
  title: string;
  eyebrow: string;
  description: string;
  subtitle?: string;
  period?: string | null;
  image: string;
  imageAlt: string;
  share: {
    title: string;
    description: string;
    campaign: string;
    imageUrl: string;
  };
  logo?: PromotionHeroLogo;
  actions?: readonly PromotionHeroAction[];
  badge?: PromotionHeroBadge;
  imageTitle?: PromotionHeroImageTitle;
  imageDisclaimer?: string;
};

const TONES: Record<PromotionHeroTone, { border: string; panel: string; accent: string }> = {
  brand: {
    border: 'border-brand-100 dark:border-slate-400/70',
    panel: 'bg-brand-50/45 dark:bg-slate-200/55',
    accent: 'text-brand-700 dark:text-brand-800',
  },
  blue: {
    border: 'border-blue-100 dark:border-slate-400/70',
    panel: 'bg-blue-50/45 dark:bg-slate-200/55',
    accent: 'text-blue-700 dark:text-blue-800',
  },
  sky: {
    border: 'border-sky-100 dark:border-slate-400/70',
    panel: 'bg-sky-50/55 dark:bg-slate-200/55',
    accent: 'text-sky-800 dark:text-sky-900',
  },
};

export default function PromotionHero({
  variant = 'campaign',
  tone = 'brand',
  title,
  eyebrow,
  description,
  subtitle,
  period,
  image,
  imageAlt,
  share,
  logo,
  actions = [],
  badge,
  imageTitle,
  imageDisclaimer,
}: PromotionHeroProps) {
  const toneClasses = TONES[tone];

  if (variant === 'brand') {
    return (
      <section data-promotion-hero-brand className={`border-b ${toneClasses.border} ${toneClasses.panel}`}>
        <div className="mx-auto grid max-w-7xl gap-6 px-4 pb-8 pt-6 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pb-10">
          <div>
            {logo ? (
              <div className="mb-4 flex items-center gap-3">
                <Image src={logo.src} alt={logo.alt} width={56} height={56} className="h-12 w-12" priority />
                <div>
                  <p className={`text-sm font-semibold uppercase tracking-[0.12em] ${toneClasses.accent}`}>{logo.name}</p>
                  <p className={`mt-1 text-xs ${uiSurfaces.mutedText}`}>{logo.description}</p>
                </div>
              </div>
            ) : null}
            <h1 className={`max-w-[14ch] text-3xl font-semibold leading-[1.1] sm:text-4xl lg:text-5xl ${uiSurfaces.titleText}`}>{title}</h1>
            <p className={`mt-3 max-w-xl text-sm leading-6 ${uiSurfaces.mutedText}`}>{description}</p>
            {period ? <p className={`mt-2 text-[11px] leading-4 ${uiSurfaces.mutedText}`}>活动日期：{period}</p> : null}
            <div className="mt-5 flex flex-wrap gap-2">
              {actions.map((action) => (
                <a
                  key={action.href}
                  href={action.href}
                  className={action.variant === 'secondary'
                    ? `promotion-hero-brand-action inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 active:translate-y-0 ${uiSurfaces.buttonSecondary} ${uiSurfaces.focusRing} ${toneClasses.border} ${toneClasses.accent}`
                    : `inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold shadow-sm motion-safe:transition-[transform,background-color] motion-safe:hover:-translate-y-0.5 hover:bg-brand-800 active:translate-y-0 ${uiSurfaces.buttonPrimary} ${uiSurfaces.focusRing}`}
                >
                  {action.label}
                  {action.showArrow ? <ArrowRight size={16} /> : null}
                </a>
              ))}
              <PromotionShareButton {...share} className={`promotion-hero-brand-action ${toneClasses.accent} ${uiSurfaces.focusRing}`} />
            </div>
          </div>
          <div className="relative mx-auto w-full max-w-[380px] lg:justify-self-end">
            <div className="absolute inset-8 rounded-full bg-sky-200/70 blur-3xl dark:bg-slate-400/35" />
            <Image src={image} alt={imageAlt} width={460} height={460} className="relative w-full rounded-full shadow-xl" priority />
            {badge ? (
              <div className="absolute bottom-4 left-4 rounded-lg border border-white/70 bg-white/90 px-4 py-3 shadow-lg backdrop-blur dark:border-slate-300 dark:bg-slate-200/90 sm:bottom-8 sm:left-8">
                <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClasses.accent}`}>{badge.eyebrow}</p>
                <p className={`mt-1 text-sm font-medium ${uiSurfaces.titleText}`}>{badge.label}</p>
              </div>
            ) : null}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={`relative mb-6 overflow-hidden rounded-lg border shadow-sm lg:mb-10 ${toneClasses.border} ${toneClasses.panel}`}>
      <div className="relative z-10 grid lg:min-h-[360px] lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="relative order-1 h-[220px] min-h-0 overflow-hidden sm:h-[300px] lg:order-2 lg:h-auto">
          <Image src={image} alt={imageAlt} fill priority className="object-cover object-center lg:object-right" sizes="(max-width: 1024px) 100vw, 67vw" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 hidden w-[38%] bg-[linear-gradient(90deg,rgba(255,255,255,0.88)_0%,rgba(255,255,255,0.32)_48%,rgba(255,255,255,0)_100%)] lg:block dark:bg-[linear-gradient(90deg,rgba(15,23,42,0.82)_0%,rgba(15,23,42,0.25)_48%,rgba(15,23,42,0)_100%)]" />
          {imageDisclaimer ? (
            <p className="absolute bottom-3 right-3 max-w-[calc(100%_-_1.5rem)] rounded-md bg-black/45 px-2.5 py-1.5 text-right text-[11px] leading-4 text-white shadow-sm backdrop-blur-md sm:bottom-4 sm:right-4">
              {imageDisclaimer}
            </p>
          ) : null}
          {imageTitle ? (
            <div className="absolute bottom-4 left-4 rounded-lg border border-white/70 bg-white/90 px-4 py-3 shadow-lg backdrop-blur dark:border-slate-300 dark:bg-slate-200/90">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-900">{imageTitle.brand}</p>
              <p className="mt-1 text-sm font-medium text-slate-900 dark:text-slate-950">{imageTitle.headline}</p>
            </div>
          ) : null}
        </div>
        <div className={`relative order-2 flex min-w-0 flex-col justify-center border-t border-[var(--surface-border)] p-5 pt-6 sm:p-7 sm:pt-8 lg:order-1 lg:border-r lg:border-t-0 lg:p-8 lg:pr-6 ${toneClasses.panel}`}>
          <div className="hero-enter relative z-10 space-y-3" style={{ '--hero-delay': 1 } as React.CSSProperties}>
            <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${toneClasses.accent} dark:!text-[#7dd3fc]`}>{eyebrow}</p>
            <h1 className={`max-w-[18ch] text-3xl font-bold leading-[1.1] tracking-tight sm:text-4xl ${uiSurfaces.titleText}`}>{title}</h1>
            <p className={`max-w-md text-sm leading-6 ${uiSurfaces.text}`}>{description}</p>
            {subtitle && subtitle !== description ? <p className={`text-xs font-medium leading-5 ${uiSurfaces.textSecondary}`}>{subtitle}</p> : null}
            {period ? <p className={`text-[11px] leading-4 ${uiSurfaces.mutedText}`}>活动日期：{period}</p> : null}
            {actions.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {actions.map((action) => (
                  <a
                    key={action.href}
                    href={action.href}
                    className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold shadow-sm motion-safe:transition motion-safe:hover:-translate-y-0.5 active:translate-y-0 ${action.variant === 'secondary' ? `${uiSurfaces.buttonSecondary} ${toneClasses.accent}` : uiSurfaces.buttonPrimary} ${uiSurfaces.focusRing}`}
                  >
                    {action.label}
                    {action.showArrow ? <ArrowRight size={14} aria-hidden="true" /> : null}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <PromotionShareButton {...share} className={`absolute right-4 top-4 z-20 ${toneClasses.accent} dark:!text-[#7dd3fc]`} />
      </div>
    </section>
  );
}
