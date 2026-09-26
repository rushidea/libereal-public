import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { homeText } from '@/lib/home-text';
import { uiSurfaces } from '@/lib/ui-surfaces';

type SurfaceTone = 'onLight' | 'onDark';

interface HomeSectionHeaderProps {
  title: string;
  subtitle?: string;
  href?: string;
  linkLabel?: string;
  className?: string;
  /** onLight: headings on glass cards or upper gradient; onDark: lower dark gradient */
  tone?: SurfaceTone;
}

export default function HomeSectionHeader({
  title,
  subtitle,
  href,
  linkLabel = '查看更多',
  className = '',
  tone = 'onLight',
}: HomeSectionHeaderProps) {
  const t = homeText[tone];
  const isDarkSurface = tone === 'onDark';

  return (
    <div className={`mb-5 flex flex-col gap-3 sm:mb-7 sm:flex-row sm:items-end sm:justify-between ${className}`}>
      <div className="min-w-0">
        <div className="mb-2 flex items-center">
          <h2
            className={`text-sm font-semibold tracking-tight sm:text-base ${
              isDarkSurface ? 'rounded-full border border-white/15 bg-white/10 px-3 py-1 text-gray-100 shadow-[0_12px_30px_rgba(255,255,255,0.08)]' : uiSurfaces.chip
            }`}
          >
            {title}
          </h2>
        </div>
        {subtitle ? (
          <p className={`mt-1.5 max-w-2xl text-sm leading-relaxed ${t.muted}`}>{subtitle}</p>
        ) : null}
      </div>
      {href ? (
        <Link
          href={href}
          className={`group inline-flex flex-shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
            isDarkSurface
              ? 'border-white/15 bg-white/10 text-gray-100 hover:border-white/25 hover:bg-white/15'
              : 'border-brand-100 bg-white/70 text-brand-700 shadow-sm shadow-brand-100/50 hover:border-brand-200 hover:bg-white'
          }`}
        >
          {linkLabel}
          <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      ) : null}
    </div>
  );
}
