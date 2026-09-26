'use client';

import Image from 'next/image';

import { useState } from 'react';
import Logo from '@/components/Logo';
import Link from 'next/link';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { getCloudMailUrl } from '@/lib/cloud-mail';
import { SITE_FOOTER_SLOGAN, SITE_LEGAL_NAME } from '@/lib/seo/site-identity';
import { siteNavigation } from '@/data/site-navigation';
import { uiSurfaces } from '@/lib/ui-surfaces';

interface FooterSection {
  title: string;
  links: { label: string; href: string }[];
}

const focusClass =
  `${uiSurfaces.focusRing} focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--brand-color-bg-container)]`;

const legalLinks = [
  { label: '隐私政策', href: '/privacy' },
  { label: 'Cookie政策', href: '/cookies' },
  { label: '网站使用条款', href: '/terms' },
  { label: '销售条款和条件', href: '/legal/sales-terms' },
  { label: '法律声明', href: '/legal' },
];

const footerSections: FooterSection[] = siteNavigation.map((item) => ({
  title: item.label,
  links: item.footerLinks.flatMap((link) => link.href ? [{ label: link.label, href: link.href }] : []),
}));

export default function SiteFooter() {
  const cloudMailUrl = getCloudMailUrl();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set()
  );

  const toggleSection = (title: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  return (
    <footer
      data-site-footer
      className="relative mt-auto overflow-hidden border-t border-[var(--brand-color-border)] bg-[var(--brand-color-bg-elevated)] px-4 py-8 dark:bg-[var(--brand-color-bg-container)] dark:text-[var(--brand-color-text)]"
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-100 dark:hidden"
        style={{
          backgroundImage: 'url(/images/footer-bg-molecular-day.svg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 hidden opacity-100 dark:block"
        style={{
          backgroundImage: 'url(/images/footer-bg-molecular.svg)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(2,44,34,0.24)_0%,rgba(2,44,34,0.18)_45%,rgba(2,44,34,0.26)_100%)] dark:bg-[linear-gradient(180deg,rgba(2,6,23,0.18)_0%,rgba(2,6,23,0.38)_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[var(--brand-color-border)]" />
      <div className="relative z-10 mx-auto max-w-6xl">
        <div className="grid grid-cols-1 gap-8 border-b border-[var(--brand-color-border)] pb-7 lg:grid-cols-[1.05fr_2.3fr_0.9fr] lg:gap-8">
          <div>
            <div className="mb-3 flex items-center gap-2">
              <Image
                src="/libereal-wordmark.svg"
                alt="LIBEREAL"
                width={191}
                height={30}
                className="h-[19px] w-auto"
                suppressHydrationWarning
              />
            </div>
            <p className="max-w-xs text-sm leading-6 text-white/86">
              LIBEREAL 由南京天放生物科技有限公司运营，{SITE_FOOTER_SLOGAN}
            </p>
          </div>

          <nav className="lg:hidden" aria-label="页脚导航">
            <div
              style={{ backgroundColor: 'color-mix(in srgb, var(--surface-strong) 42%, transparent)' }}
              className={`divide-y divide-[var(--brand-color-border-secondary)] rounded-[var(--brand-border-radius)] px-4 ${uiSurfaces.panelStrong} backdrop-blur-md`}
            >
              {footerSections.map((section) => {
                const sectionId = `footer-section-${section.title}`;
                const expanded = expandedSections.has(section.title);
                return (
                <div key={section.title}>
                  <button
                    onClick={() => toggleSection(section.title)}
                    aria-expanded={expanded}
                    aria-controls={sectionId}
                    className={`flex w-full items-center justify-between py-3 text-left ${focusClass}`}
                  >
                    <span className={`text-sm font-semibold ${uiSurfaces.titleText}`}>{section.title}</span>
                    {expanded ? (
                      <ChevronDown className={`h-4 w-4 ${uiSurfaces.textInteractive} transition-transform duration-200`} />
                    ) : (
                      <ChevronRight className={`h-4 w-4 ${uiSurfaces.textInteractive} transition-transform duration-200`} />
                    )}
                  </button>
                  <div
                    id={sectionId}
                    className={expanded ? 'max-h-40 pb-3' : 'max-h-0 overflow-hidden'}
                  >
                    <ul className="space-y-2 text-xs">
                      {section.links.map((link) => (
                        <li key={link.label}>
                          <Link href={link.href} className={`block border-l border-[var(--brand-color-border)] pl-2 transition ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive} ${focusClass}`}>
                            {link.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                );
              })}
            </div>
          </nav>

          <nav className="hidden grid-cols-5 gap-4 lg:grid" aria-label="页脚导航">
            {footerSections.map((section) => (
                <div key={section.title}>
                  <h4 className="mb-3 text-sm font-semibold text-white">{section.title}</h4>
                  <ul className="space-y-2 text-xs">
                    {section.links.map((link) => (
                      <li key={link.label}>
                        <Link href={link.href} className={`text-slate-100/78 transition hover:text-brand-100 ${focusClass}`}>
                          {link.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </nav>

          <aside
            style={{ backgroundColor: 'color-mix(in srgb, var(--surface-strong) 42%, transparent)' }}
            className={`rounded-[var(--brand-border-radius)] p-4 text-sm ${uiSurfaces.panelStrong} backdrop-blur-md ${uiSurfaces.text}`}
          >
            <h4 className={`mb-3 text-sm font-semibold ${uiSurfaces.titleText}`}>服务入口</h4>
            <div className="space-y-2">
              <a
                href={cloudMailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center justify-between rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-xs font-medium transition hover:border-brand-100/40 hover:bg-white/12 ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive} ${focusClass}`}
              >
                企业邮箱
                <span aria-hidden>→</span>
              </a>
              <Link
                href="/legal"
                className={`flex items-center justify-between rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-xs font-medium transition hover:border-brand-100/40 hover:bg-white/12 ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive} ${focusClass}`}
              >
                合规文件
                <span aria-hidden>→</span>
              </Link>
            </div>
          </aside>
        </div>

        <div className="flex flex-col gap-4 py-5 text-xs text-slate-100/76 lg:flex-row lg:items-center">
          <Logo className="mx-auto h-16 w-16 flex-shrink-0 lg:mx-0 lg:h-20 lg:w-20" />

          <div className="min-w-0 flex-1 space-y-2 text-center lg:text-left">
            <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 lg:justify-start">
              {legalLinks.map((link) => (
                <Link key={link.label} href={link.href} className={`transition hover:text-brand-100 ${focusClass}`}>
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 lg:justify-start">
              <span>© 2015-2026 {SITE_LEGAL_NAME} 版权所有。</span>
              <span>仅供研究使用，不用于诊断或治疗流程。</span>
            </div>
            <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 lg:justify-start">
              <span>仅供专业研究机构使用，不面向公众提供产品。</span>
              <a href="mailto:info@libereal.cn" className={`transition hover:text-brand-100 ${focusClass}`}>邮箱：info@libereal.cn。</a>
              <span>微信服务号：LIBEREAL-天放生物。</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 lg:justify-start">
              <a href="https://beian.miit.gov.cn" target="_blank" rel="noopener noreferrer" className={`transition hover:text-brand-100 ${focusClass}`}>
                苏ICP备2026025232号
              </a>
              <span className="text-white/28">|</span>
              <a href="https://beian.mps.gov.cn/#/query/webSearch?code=32011402012523" rel="noreferrer" target="_blank" className={`inline-flex items-center gap-1 transition hover:text-brand-100 ${focusClass}`}>
                <Image
                  src="/images/beian-icon.png"
                  alt="备案图标"
                  width={16}
                  height={16}
                  className="inline h-4 w-4"
                  suppressHydrationWarning
                />
                苏公网安备32011402012523号
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
