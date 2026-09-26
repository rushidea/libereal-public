'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText } from 'lucide-react';
import type { LegalDocumentPublic } from '@/data/legal-documents';
import { uiSurfaces } from '@/lib/ui-surfaces';

type LegalConsentChecklistProps = {
  context: 'register' | 'checkout';
  acceptedIds: string[];
  onChange: (ids: string[]) => void;
  onRequiredIdsChange?: (ids: string[]) => void;
  className?: string;
};

export default function LegalConsentChecklist({
  context,
  acceptedIds,
  onChange,
  onRequiredIdsChange,
  className = '',
}: LegalConsentChecklistProps) {
  const [documents, setDocuments] = useState<LegalDocumentPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/legal/documents?context=${context}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setDocuments(Array.isArray(data.documents) ? data.documents : []);
        const ids = (Array.isArray(data.documents) ? data.documents : []).map((d: LegalDocumentPublic) => d.id);
        onRequiredIdsChange?.(ids);
      })
      .catch(() => {
        if (!cancelled) setError('无法加载协议列表，请刷新后重试');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [context, onRequiredIdsChange]);

  const requiredIds = useMemo(() => documents.map((d) => d.id), [documents]);

  const toggle = (id: string) => {
    if (acceptedIds.includes(id)) {
      onChange(acceptedIds.filter((x) => x !== id));
    } else {
      onChange([...acceptedIds, id]);
    }
  };

  const allAccepted = requiredIds.length > 0 && requiredIds.every((id) => acceptedIds.includes(id));

  if (loading) {
    return <p className={`text-xs ${uiSurfaces.mutedText} ${className}`}>加载协议...</p>;
  }

  if (error) {
    return <p className={`${uiSurfaces.statusError} text-xs ${className}`}>{error}</p>;
  }

  if (documents.length === 0) {
    return null;
  }

  return (
    <div className={`rounded-[var(--brand-border-radius-lg)] ${uiSurfaces.panel} p-3 ${className}`}>
      <p className={`mb-2 text-xs font-medium ${uiSurfaces.titleText}`}>
        {context === 'register' ? '注册前请阅读并同意以下协议' : '下单前请阅读并同意以下协议'}
      </p>
      <ul className="space-y-2">
        {documents.map((doc) => {
          const href = doc.kind === 'site' ? doc.sitePath ?? '#' : doc.downloadUrl ?? '#';
          const isExternalPdf = doc.kind === 'pdf';
          return (
            <li key={doc.id} className="flex items-start gap-2">
              <input
                id={`legal-consent-${doc.id}`}
                type="checkbox"
                checked={acceptedIds.includes(doc.id)}
                onChange={() => toggle(doc.id)}
                className={`mt-0.5 h-4 w-4 rounded-[var(--brand-border-radius-sm)] border-[var(--surface-border)] accent-[var(--brand-color-primary)] ${uiSurfaces.focusRing}`}
              />
              <label htmlFor={`legal-consent-${doc.id}`} className={`min-w-0 flex-1 text-xs leading-relaxed ${uiSurfaces.textSecondary}`}>
                我已阅读并同意{' '}
                {isExternalPdf ? (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-0.5 font-medium ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive} hover:underline ${uiSurfaces.focusRing}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    《{doc.title}》
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <Link href={href} className={`font-medium ${uiSurfaces.textInteractive} ${uiSurfaces.textInteractiveHover} ${uiSurfaces.textInteractiveActive} hover:underline ${uiSurfaces.focusRing}`} target="_blank">
                    《{doc.title}》
                  </Link>
                )}
                {context === 'checkout' && doc.id === 'site-sales-terms' ? (
                  <span className="mt-1 block font-medium text-[var(--brand-color-warning-text)]">
                    勾选即确认理解：本订单中属于试剂类的商品可能因温控、密封、污染控制或储存连续性要求，在拆封、使用或交付后无法恢复原始销售状态；除质量问题、错发、运输损坏、另有约定或法律另有规定外，机构及生产经营用途采购不适用无理由退换。生活消费用途订单按法律规定处理。
                  </span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
      {!allAccepted ? (
        <p className={`mt-2 text-xs ${uiSurfaces.statusWarning}`}>请勾选全部必同意项后继续</p>
      ) : null}
    </div>
  );
}

export function useLegalConsentComplete(context: 'register' | 'checkout', acceptedIds: string[], documentsCount: number | null) {
  return documentsCount === null || (documentsCount > 0 && acceptedIds.length >= documentsCount);
}

type LegalDocumentDownloadsProps = {
  documents: LegalDocumentPublic[];
  title?: string;
  compact?: boolean;
};

export function LegalDocumentDownloads({ documents, title = '文书下载', compact = false }: LegalDocumentDownloadsProps) {
  if (documents.length === 0) return null;

  return (
    <section className={compact ? '' : 'mt-6'}>
      {!compact ? <h2 className={`mb-3 text-lg font-semibold ${uiSurfaces.titleText}`}>{title}</h2> : null}
      <div className={`grid gap-2 ${compact ? '' : 'sm:grid-cols-2'}`}>
        {documents.map((doc) => {
          const href = doc.kind === 'site' ? doc.sitePath ?? '#' : doc.downloadUrl ?? '#';
          const isPdf = doc.kind === 'pdf';
          return (
            <a
              key={doc.id}
              href={href}
              target={isPdf ? '_blank' : undefined}
              rel={isPdf ? 'noopener noreferrer' : undefined}
              className={`flex items-start gap-3 rounded-[var(--brand-border-radius-lg)] p-3 text-sm transition hover:border-[var(--brand-color-primary-border-hover)] ${uiSurfaces.panel} ${uiSurfaces.focusRing}`}
            >
              <FileText className={`mt-0.5 h-4 w-4 flex-shrink-0 ${uiSurfaces.textInteractive}`} />
              <span className="min-w-0">
                <span className={`block font-medium ${uiSurfaces.titleText}`}>{doc.title}</span>
                {doc.description ? (
                  <span className={`mt-0.5 block text-xs leading-relaxed ${uiSurfaces.mutedText}`}>{doc.description}</span>
                ) : null}
              </span>
              {isPdf ? <ExternalLink className={`ml-auto h-3.5 w-3.5 flex-shrink-0 ${uiSurfaces.textQuaternary}`} /> : null}
            </a>
          );
        })}
      </div>
    </section>
  );
}
